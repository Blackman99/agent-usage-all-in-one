import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CodexConnector,
  type CodexAccountClient,
  type CodexAccountPayload
} from '../../src/connectors/codex/codex-connector.js';
import {
  StdioCodexAccountClient,
  type CodexAppServerProcess
} from '../../src/connectors/codex/stdio-codex-account-client.js';
import { LocalTranscriptUsageClient } from '../../src/server/local-transcript-usage-client.js';

const transcriptWorkspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    transcriptWorkspaces
      .splice(0)
      .map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('CodexConnector', () => {
  it('keeps official account totals and adds model usage from local rollouts for reconciliation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-codex-transcript-'));
    transcriptWorkspaces.push(workspace);
    const tokenCount = JSON.stringify({
      timestamp: '2026-08-28T01:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 40,
            cache_write_input_tokens: 10,
            output_tokens: 20,
            reasoning_output_tokens: 5,
            total_tokens: 130
          }
        }
      }
    });
    await writeFile(
      join(workspace, 'rollout.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-08-28T00:59:00.000Z',
          type: 'session_meta',
          payload: { id: 'session-1' }
        }),
        JSON.stringify({
          timestamp: '2026-08-28T00:59:30.000Z',
          type: 'turn_context',
          payload: { model: 'gpt-5.6-sol' }
        }),
        tokenCount,
        tokenCount
      ].join('\n')
    );
    const client: CodexAccountClient = {
      async readAccount() {
        return accountPayload;
      }
    };
    const historyClient = new LocalTranscriptUsageClient({
      provider: 'codex',
      root: workspace,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    const snapshot = await new CodexConnector(
      client,
      () => new Date('2026-08-28T02:00:00.000Z'),
      historyClient
    ).collect();

    expect(snapshot.usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex:daily:2026-08-27',
          sourceReportedTotalTokens: 1250,
          authority: 'official-account'
        }),
        expect.objectContaining({
          billingDomainId: 'subscription',
          model: 'gpt-5.6-sol',
          sessionId: 'session-1',
          inputTokens: 50,
          outputTokens: 20,
          reasoningTokens: 5,
          cacheReadTokens: 40,
          cacheWriteTokens: 10,
          modelAttribution: 'known',
          timePrecision: 'event',
          usageScope: 'this-mac',
          aggregationTemporality: 'delta',
          authority: 'local-observation',
          sourceReportedTotalTokens: 130
        })
      ])
    );
    expect(snapshot.usageReconciliation).toEqual({
      authoritativeIdPrefix: 'codex-transcript:',
      retiredIdPrefixes: []
    });
  });

  it('falls back to local rollouts when the official Codex account adapter fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-codex-fallback-'));
    transcriptWorkspaces.push(workspace);
    await writeFile(
      join(workspace, 'rollout.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-08-28T00:59:00.000Z',
          type: 'session_meta',
          payload: { id: 'session-fallback' }
        }),
        JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-sol' } }),
        JSON.stringify({
          timestamp: '2026-08-28T01:00:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 80,
                cached_input_tokens: 30,
                output_tokens: 20,
                total_tokens: 100
              }
            }
          }
        })
      ].join('\n')
    );
    const historyClient = new LocalTranscriptUsageClient({
      provider: 'codex',
      root: workspace,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    const connector = new CodexConnector(
      {
        async readAccount() {
          throw Object.assign(new Error('private adapter detail'), {
            code: 'app-server-timeout',
            recovery: 'Retry automatically.'
          });
        }
      },
      () => new Date('2026-08-28T02:00:00.000Z'),
      historyClient
    );

    const snapshot = await connector.collect();

    expect(snapshot.quotaBuckets).toEqual([]);
    expect(snapshot.usage).toEqual([
      expect.objectContaining({ model: 'gpt-5.6-sol', sourceReportedTotalTokens: 100 })
    ]);
    expect(snapshot.warnings).toEqual([expect.objectContaining({ code: 'app-server-timeout' })]);
  });

  it('keeps model detail and reconciles an overlapping official day to its account total', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-codex-account-reconcile-'));
    transcriptWorkspaces.push(workspace);
    await writeFile(
      join(workspace, 'rollout.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-08-28T00:59:00.000Z',
          type: 'session_meta',
          payload: { id: 'session-reconcile' }
        }),
        JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-sol' } }),
        JSON.stringify({
          timestamp: '2026-08-28T01:00:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120
              }
            }
          }
        })
      ].join('\n')
    );
    const snapshot = await new CodexConnector(
      {
        async readAccount() {
          return {
            ...accountPayload,
            tokenUsage: {
              ...accountPayload.tokenUsage!,
              dailyUsageBuckets: [{ startDate: '2026-08-28', tokens: 999 }]
            }
          };
        }
      },
      () => new Date('2026-08-28T02:00:00.000Z'),
      new LocalTranscriptUsageClient({
        provider: 'codex',
        root: workspace,
        clock: () => new Date('2026-08-28T02:00:00.000Z')
      })
    ).collect();

    expect(snapshot.usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'codex:daily:2026-08-28', sourceReportedTotalTokens: 999 }),
        expect.objectContaining({ model: 'gpt-5.6-sol', sourceReportedTotalTokens: 120 }),
        expect.objectContaining({
          id: 'codex-transcript:account-remainder:2026-08-28',
          reconciledRemainderTokens: 879,
          modelAttribution: 'unclassified',
          authority: 'estimate'
        })
      ])
    );
    expect(
      snapshot.usage.find(
        (observation) => observation.id === 'codex-transcript:account-remainder:2026-08-28'
      )
    ).not.toHaveProperty('sourceReportedTotalTokens');
  });

  it('fails the local scan closed when Codex reports an impossible total', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-codex-invalid-total-'));
    transcriptWorkspaces.push(workspace);
    await writeFile(
      join(workspace, 'rollout.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-08-28T00:59:00.000Z',
          type: 'session_meta',
          payload: { id: 'session-invalid' }
        }),
        JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-sol' } }),
        JSON.stringify({
          timestamp: '2026-08-28T01:00:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 1 }
            }
          }
        })
      ].join('\n')
    );
    const snapshot = await new CodexConnector(
      {
        async readAccount() {
          return {
            ...accountPayload,
            tokenUsage: {
              ...accountPayload.tokenUsage!,
              dailyUsageBuckets: [{ startDate: '2026-08-28', tokens: 999 }]
            }
          };
        }
      },
      () => new Date('2026-08-28T02:00:00.000Z'),
      new LocalTranscriptUsageClient({
        provider: 'codex',
        root: workspace,
        clock: () => new Date('2026-08-28T02:00:00.000Z')
      })
    ).collect();

    expect(snapshot.usage).toEqual([
      expect.objectContaining({
        id: 'codex:daily:2026-08-28',
        sourceReportedTotalTokens: 999
      })
    ]);
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'local-transcript-scan-incomplete' })
    ]);
  });

  it('does not reconcile stored transcript rows after an incomplete local scan', async () => {
    const connector = new CodexConnector(
      {
        async readAccount() {
          return { ...accountPayload, tokenUsage: null };
        }
      },
      () => new Date('2026-08-28T02:00:00.000Z'),
      {
        async readUsage() {
          return {
            usage: [
              {
                id: 'codex-transcript:partial',
                billingDomainId: 'subscription',
                model: 'gpt-5.6-sol',
                observedAt: '2026-08-28T01:00:00.000Z',
                inputTokens: 50,
                outputTokens: 10,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                authority: 'local-observation' as const
              }
            ],
            costs: [],
            complete: false
          };
        }
      }
    );

    const snapshot = await connector.collect();

    expect(snapshot).not.toHaveProperty('usageReconciliation');
    expect(snapshot.usage).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'codex-transcript:account-remainder:2026-08-28' })
      ])
    );
  });

  it('does not count parent history copied into a forked rollout', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-codex-fork-'));
    transcriptWorkspaces.push(workspace);
    const usage = (timestamp: string, outputTokens: number) =>
      JSON.stringify({
        timestamp,
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 40,
              output_tokens: outputTokens,
              reasoning_output_tokens: 5
            }
          }
        }
      });
    await writeFile(
      join(workspace, 'parent.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-08-28T01:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'parent' }
        }),
        JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-sol' } }),
        usage('2026-08-28T01:00:05.000Z', 20)
      ].join('\n')
    );
    await writeFile(
      join(workspace, 'fork.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-08-28T02:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'fork',
            source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } }
          }
        }),
        JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-sol' } }),
        usage('2026-08-28T02:00:00.010Z', 20),
        usage('2026-08-28T02:00:05.000Z', 30)
      ].join('\n')
    );
    const historyClient = new LocalTranscriptUsageClient({
      provider: 'codex',
      root: workspace,
      clock: () => new Date('2026-08-28T03:00:00.000Z')
    });
    const snapshot = await new CodexConnector(
      {
        async readAccount() {
          return accountPayload;
        }
      },
      () => new Date('2026-08-28T03:00:00.000Z'),
      historyClient
    ).collect();

    const transcriptUsage = snapshot.usage.filter((observation) =>
      observation.id.startsWith('codex-transcript:')
    );
    expect(transcriptUsage).toHaveLength(2);
    expect(transcriptUsage.map((observation) => observation.sessionId).sort()).toEqual([
      'fork',
      'parent'
    ]);
    expect(
      transcriptUsage.reduce((total, observation) => total + observation.outputTokens, 0)
    ).toBe(50);
  });

  it('maps dynamic official quota windows and total-token daily buckets without inventing token kinds', async () => {
    const client: CodexAccountClient = {
      async readAccount() {
        return accountPayload;
      }
    };
    const connector = new CodexConnector(client, () => new Date('2026-08-28T02:00:00.000Z'));
    const snapshot = await connector.collect();

    expect(snapshot).toMatchObject({
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
          sourceReportedTotalTokens: 1250,
          inputTokens: 0,
          outputTokens: 0,
          model: null,
          modelAttribution: 'unclassified',
          timePrecision: 'day',
          usageScope: 'account-wide',
          authority: 'official-account'
        }
      ]
    });
    expect(snapshot.usage[0]).not.toHaveProperty('totalTokens');
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
