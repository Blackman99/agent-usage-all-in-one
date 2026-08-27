import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  ClaudeCodeConnector,
  type ClaudeQuotaClient
} from '../../src/connectors/claude-code/claude-code-connector.js';
import {
  ScreenReaderClaudeQuotaClient,
  type ClaudeUsageProcess,
  parseClaudeUsageScreen
} from '../../src/connectors/claude-code/claude-usage-screen-client.js';
import { parseClaudeOtlpMetrics } from '../../src/connectors/claude-code/claude-otlp.js';

describe('Claude Code quota adapter', () => {
  it('preserves All models, Fable only, and future official labels dynamically', () => {
    expect(
      parseClaudeUsageScreen(usageScreenFixture, new Date('2026-08-28T02:00:00.000Z'))
    ).toEqual([
      {
        id: '5-hour-limit',
        label: '5 hour',
        usedPercent: 42,
        resetsAt: '2026-08-28T04:13:00.000Z'
      },
      {
        id: 'weekly-all-models',
        label: 'Week · All models',
        usedPercent: 24,
        resetsAt: '2026-08-31T09:59:00.000Z'
      },
      {
        id: 'weekly-fable-only',
        label: 'Week · Fable only',
        usedPercent: 17,
        resetsAt: '2026-08-31T09:59:00.000Z'
      },
      {
        id: 'weekly-future-model-only',
        label: 'Week · Future model only',
        usedPercent: 3,
        resetsAt: '2026-08-31T09:59:00.000Z'
      }
    ]);
  });

  it('runs only the official screen-reader usage command and never requests OAuth material', async () => {
    const process = new FakeClaudeUsageProcess();
    const client = new ScreenReaderClaudeQuotaClient({
      command: '/usr/local/bin/claude',
      spawnProcess: (_command, arguments_) => {
        expect(arguments_[0]).toBe('-c');
        expect(arguments_[1]).toContain(
          'spawn {/usr/local/bin/claude} --safe-mode --ax-screen-reader'
        );
        expect(arguments_[1]).toContain('send -- "/usage\\r"');
        return process;
      },
      timeoutMs: 1_000,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    await expect(client.readQuota()).resolves.toHaveLength(4);
    expect(process.killed).toBe(true);
  });

  it('fails closed when the official screen has no subscription quota', () => {
    expect(() =>
      parseClaudeUsageScreen(
        'Settings Status Config Usage Stats\nSession\nUsage: 0 input, 0 output\nEsc to cancel',
        new Date('2026-08-28T02:00:00.000Z')
      )
    ).toThrow(expect.objectContaining({ code: 'claude-subscription-quota-unavailable' }));
  });
});

describe('ClaudeCodeConnector', () => {
  it('maps quota as experimental official-client data', async () => {
    const quotaClient: ClaudeQuotaClient = {
      async readQuota() {
        return parseClaudeUsageScreen(usageScreenFixture, new Date('2026-08-28T02:00:00.000Z'));
      }
    };
    const connector = new ClaudeCodeConnector({
      quotaClient,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    const snapshot = await connector.collect();
    expect(snapshot.quotaBuckets).toEqual([
      expect.objectContaining({
        id: '5-hour-limit',
        label: '5 hour',
        authority: 'official-client',
        scope: 'account-wide'
      }),
      expect.objectContaining({ label: 'Week · All models' }),
      expect.objectContaining({ label: 'Week · Fable only' }),
      expect.objectContaining({ label: 'Week · Future model only' })
    ]);
    expect(snapshot.usage).toEqual([]);
  });

  it('returns a provider warning instead of blocking independent OTLP history', async () => {
    const quotaClient: ClaudeQuotaClient = {
      async readQuota() {
        throw Object.assign(new Error('Claude subscription quota is unavailable.'), {
          code: 'claude-subscription-quota-unavailable',
          recovery: 'Open Claude Code and run /usage, then retry.'
        });
      }
    };
    const snapshot = await new ClaudeCodeConnector({ quotaClient }).collect();

    expect(snapshot.quotaBuckets).toEqual([]);
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'claude-subscription-quota-unavailable' })
    ]);
  });
});

describe('Claude Code OTLP metrics', () => {
  it('normalizes official token kinds and estimated cost without identity attributes', () => {
    const snapshot = parseClaudeOtlpMetrics(otlpFixture, new Date('2026-08-28T02:00:00.000Z'));

    expect(snapshot.provider).toEqual({ id: 'claude-code', displayName: 'Claude Code' });
    expect(snapshot.usage).toEqual([
      expect.objectContaining({
        id: 'claude-otel:1756346400000000000:claude-fable-5',
        model: 'claude-fable-5',
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 400,
        cacheWriteTokens: 50,
        totalTokens: 575,
        authority: 'local-observation'
      })
    ]);
    expect(snapshot.costs).toEqual([
      expect.objectContaining({
        kind: 'estimate',
        amount: 0.42,
        currency: 'USD',
        authority: 'local-observation'
      })
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('person@example.com');
  });
});

const usageScreenFixture = `
Settings Status Config Usage Stats
Plan usage limits — Max (20x)
5-hour limit
42% used
Resets in 2h 13m
Weekly · All models
24% used
Resets Aug 31, 5:59 PM (Asia/Shanghai)
Weekly · Fable only
17% used
Resets Aug 31, 5:59 PM (Asia/Shanghai)
Weekly · Future model only
3% used
Resets Aug 31, 5:59 PM (Asia/Shanghai)
Esc to cancel
`;

const otlpFixture = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'claude-code' } },
          { key: 'user.email', value: { stringValue: 'person@example.com' } }
        ]
      },
      scopeMetrics: [
        {
          metrics: [
            ...(['input', 'output', 'cacheRead', 'cacheCreation'] as const).map((type, index) => ({
              name: 'claude_code.token.usage',
              sum: {
                dataPoints: [
                  {
                    timeUnixNano: '1756346400000000000',
                    asInt: [100, 25, 400, 50][index].toString(),
                    attributes: [
                      { key: 'type', value: { stringValue: type } },
                      { key: 'model', value: { stringValue: 'claude-fable-5' } },
                      { key: 'user.email', value: { stringValue: 'person@example.com' } }
                    ]
                  }
                ]
              }
            })),
            {
              name: 'claude_code.cost.usage',
              sum: {
                dataPoints: [
                  {
                    timeUnixNano: '1756346400000000000',
                    asDouble: 0.42,
                    attributes: [{ key: 'model', value: { stringValue: 'claude-fable-5' } }]
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
};

class FakeClaudeUsageProcess extends EventEmitter implements ClaudeUsageProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  constructor() {
    super();
    queueMicrotask(() => this.stdout.write(`${usageScreenFixture}\n__CLAUDE_USAGE_DONE__\n`));
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }
}
