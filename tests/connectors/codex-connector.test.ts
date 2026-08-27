import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  CodexConnector,
  type CodexAccountClient,
  type CodexAccountPayload
} from '../../src/connectors/codex/codex-connector.js';
import {
  StdioCodexAccountClient,
  type CodexAppServerProcess
} from '../../src/connectors/codex/stdio-codex-account-client.js';

describe('CodexConnector', () => {
  it('maps dynamic official quota windows and total-token daily buckets without inventing token kinds', async () => {
    const client: CodexAccountClient = {
      async readAccount() {
        return accountPayload;
      }
    };
    const connector = new CodexConnector(client, () => new Date('2026-08-28T02:00:00.000Z'));

    expect(await connector.collect()).toMatchObject({
      provider: { id: 'codex', displayName: 'Codex' },
      billingDomains: [{ id: 'subscription', displayName: 'Codex subscription' }],
      quotaBuckets: [
        {
          id: 'codex:primary',
          label: '5 hour',
          usedPercent: 42,
          resetsAt: '2026-08-28T05:00:00.000Z',
          authority: 'official-account'
        },
        {
          id: 'codex:secondary',
          label: 'Week',
          usedPercent: 18,
          resetsAt: '2026-09-01T00:00:00.000Z',
          authority: 'official-account'
        }
      ],
      usage: [
        {
          id: 'codex:daily:2026-08-27',
          observedAt: '2026-08-27T00:00:00.000Z',
          totalTokens: 1250,
          inputTokens: 0,
          outputTokens: 0,
          authority: 'official-account'
        }
      ]
    });
  });

  it('keeps quota available when account token activity is unsupported', async () => {
    const client: CodexAccountClient = {
      async readAccount() {
        return { ...accountPayload, tokenUsage: null };
      }
    };
    const connector = new CodexConnector(client, () => new Date('2026-08-28T02:00:00.000Z'));

    const snapshot = await connector.collect();
    expect(snapshot.quotaBuckets).toHaveLength(2);
    expect(snapshot.usage).toEqual([]);
  });
});

describe('StdioCodexAccountClient', () => {
  it('initializes the official JSONL protocol and reads rate limits plus account usage', async () => {
    const process = new FakeCodexProcess();
    const client = new StdioCodexAccountClient({
      command: '/usr/local/bin/codex',
      spawnProcess: () => process,
      timeoutMs: 1_000
    });

    expect(await client.readAccount()).toEqual(accountPayload);
    expect(process.methods).toEqual([
      'initialize',
      'initialized',
      'account/rateLimits/read',
      'account/usage/read'
    ]);
    expect(process.killed).toBe(true);
  });

  it('keeps official quota when token activity is not implemented by this Codex version', async () => {
    const process = new FakeCodexProcess({
      errors: { 'account/usage/read': { code: -32601, message: 'Method not found' } }
    });
    const client = new StdioCodexAccountClient({
      spawnProcess: () => process,
      timeoutMs: 1_000
    });

    await expect(client.readAccount()).resolves.toEqual({
      rateLimits: accountPayload.rateLimits,
      tokenUsage: null
    });
  });

  it.each([
    {
      name: 'a missing rate-limit method',
      process: () =>
        new FakeCodexProcess({
          errors: { 'account/rateLimits/read': { code: -32601, message: 'Method not found' } }
        }),
      code: 'app-server-method-unsupported'
    },
    {
      name: 'a changed response schema',
      process: () => new FakeCodexProcess({ rateLimits: { unexpected: true } }),
      code: 'app-server-schema-changed'
    },
    {
      name: 'a timeout',
      process: () => new FakeCodexProcess({ ignoredMethods: new Set(['initialize']) }),
      code: 'app-server-timeout'
    }
  ])('normalizes $name into a safe degraded error', async ({ process, code }) => {
    const child = process();
    const client = new StdioCodexAccountClient({
      spawnProcess: () => child,
      timeoutMs: 5
    });

    await expect(client.readAccount()).rejects.toMatchObject({ code });
    expect(child.killed).toBe(true);
  });

  it('normalizes a missing Codex executable without exposing spawn details', async () => {
    const client = new StdioCodexAccountClient({
      spawnProcess: () => {
        throw new Error('ENOENT /private/path/codex secret-looking-argument');
      }
    });

    await expect(client.readAccount()).rejects.toMatchObject({
      code: 'app-server-unavailable',
      message: 'Codex app-server is unavailable.'
    });
  });
});

const accountPayload: CodexAccountPayload = {
  rateLimits: {
    rateLimits: {
      limitId: 'codex',
      limitName: 'Codex',
      primary: {
        usedPercent: 42,
        windowDurationMins: 300,
        resetsAt: Date.parse('2026-08-28T05:00:00.000Z') / 1000
      },
      secondary: {
        usedPercent: 18,
        windowDurationMins: 10_080,
        resetsAt: Date.parse('2026-09-01T00:00:00.000Z') / 1000
      }
    },
    rateLimitsByLimitId: null
  },
  tokenUsage: {
    summary: {
      lifetimeTokens: 42_000,
      peakDailyTokens: 12_000,
      longestRunningTurnSec: null,
      currentStreakDays: 3,
      longestStreakDays: 8
    },
    dailyUsageBuckets: [{ startDate: '2026-08-27', tokens: 1250 }]
  }
};

interface FakeCodexProcessOptions {
  rateLimits?: unknown;
  tokenUsage?: unknown;
  errors?: Record<string, { code: number; message: string }>;
  ignoredMethods?: Set<string>;
}

class FakeCodexProcess extends EventEmitter implements CodexAppServerProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly methods: string[] = [];
  killed = false;
  #buffer = '';
  readonly #options: FakeCodexProcessOptions;

  constructor(options: FakeCodexProcessOptions = {}) {
    super();
    this.#options = options;
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string) => {
      this.#buffer += chunk;
      let newline = this.#buffer.indexOf('\n');
      while (newline !== -1) {
        const line = this.#buffer.slice(0, newline);
        this.#buffer = this.#buffer.slice(newline + 1);
        this.#respond(JSON.parse(line) as { id?: number; method: string });
        newline = this.#buffer.indexOf('\n');
      }
    });
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }

  #respond(message: { id?: number; method: string }): void {
    this.methods.push(message.method);
    if (message.id === undefined) return;
    if (this.#options.ignoredMethods?.has(message.method)) return;
    const error = this.#options.errors?.[message.method];
    if (error) {
      queueMicrotask(() => this.stdout.write(`${JSON.stringify({ id: message.id, error })}\n`));
      return;
    }
    const result =
      message.method === 'initialize'
        ? {
            userAgent: 'codex-cli-test',
            codexHome: '/tmp/codex',
            platformFamily: 'unix',
            platformOs: 'macos'
          }
        : message.method === 'account/rateLimits/read'
          ? (this.#options.rateLimits ?? accountPayload.rateLimits)
          : (this.#options.tokenUsage ?? accountPayload.tokenUsage);
    queueMicrotask(() => this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
  }
}
