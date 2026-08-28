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

  it('parses the current Claude Team usage screen and its timezone-aware reset times', () => {
    expect(
      parseClaudeUsageScreen(currentUsageScreenFixture, new Date('2026-08-28T02:00:00.000Z'))
    ).toEqual([
      {
        id: 'current-session',
        label: '5 hour',
        usedPercent: 25,
        resetsAt: '2026-08-28T06:50:00.000Z'
      },
      {
        id: 'current-week-all-models',
        label: 'Week · All models',
        usedPercent: 41,
        resetsAt: '2026-08-31T16:00:00.000Z'
      },
      {
        id: 'current-week-fable',
        label: 'Week · Fable only',
        usedPercent: 75,
        resetsAt: '2026-08-31T15:59:00.000Z'
      }
    ]);
  });

  it('reconciles screen redraws without inventing a Refreshing quota bucket', () => {
    const quota = parseClaudeUsageScreen(
      `${currentUsageScreenFixture}
Refreshing…
26% 26% used
Resets 2:49pm (Asia/Shanghai)
Current week (all models)
42% 42% used
Resets Aug 31 at 11:59pm (Asia/Shanghai)
Esc to cancelCurrent week (all models)
43% 43% used
Resets Aug 31 at 11:59pm (Asia/Shanghai)`,
      new Date('2026-08-28T02:00:00.000Z')
    );

    expect(quota).toHaveLength(3);
    expect(quota.some((bucket) => bucket.label === 'Refreshing…')).toBe(false);
    expect(quota).toContainEqual(
      expect.objectContaining({ label: 'Week · All models', usedPercent: 43 })
    );
  });

  it('runs only the official screen-reader usage command and never requests OAuth material', async () => {
    const process = new FakeClaudeUsageProcess();
    const client = new ScreenReaderClaudeQuotaClient({
      command: '/usr/local/bin/claude',
      spawnProcess: (_command, arguments_) => {
        expect(arguments_[0]).toBe('-c');
        const script = arguments_[1];
        expect(script).toContain('spawn {/usr/local/bin/claude} --safe-mode --ax-screen-reader');
        expect(script).toContain('send -- "/usage\\r"');
        expect(script.indexOf('__CLAUDE_USAGE_DONE__')).toBeGreaterThan(
          script.indexOf('send -- "/exit\\r"')
        );
        return process;
      },
      timeoutMs: 1_000,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    await expect(client.readQuota()).resolves.toHaveLength(4);
    expect(process.killed).toBe(false);
  });

  it('keeps enough time for both client startup and the complete Fable redraw', async () => {
    const process = new FakeClaudeUsageProcess();
    let script = '';
    const client = new ScreenReaderClaudeQuotaClient({
      spawnProcess: (_command, arguments_) => {
        script = arguments_[1];
        return process;
      },
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    await expect(client.readQuota()).resolves.toHaveLength(4);
    expect(script).toContain('send -- "/usage\\r"\nset timeout 8');
    expect(script).toContain('-re {Esc to cancel} {\n    set timeout 14');
  });

  it('isolates subscription quota reads from API and hosted-provider overrides', async () => {
    const process = new FakeClaudeUsageProcess();
    const client = new ScreenReaderClaudeQuotaClient({
      environment: {
        PATH: '/usr/local/bin',
        CLAUDE_CODE_OAUTH_TOKEN: 'subscription-session-token',
        ANTHROPIC_API_KEY: 'api-key',
        ANTHROPIC_AUTH_TOKEN: 'proxy-token',
        ANTHROPIC_BASE_URL: 'https://proxy.example.test',
        ANTHROPIC_MODEL: 'proxy-model',
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_USE_VERTEX: '1',
        CLAUDE_CODE_USE_FOUNDRY: '1'
      },
      spawnProcess: (_command, _arguments, options) => {
        expect(options.env).toEqual({
          PATH: '/usr/local/bin',
          CLAUDE_CODE_OAUTH_TOKEN: 'subscription-session-token'
        });
        return process;
      },
      timeoutMs: 1_000,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    await expect(client.readQuota()).resolves.toHaveLength(4);
  });

  it('waits for the completed usage screen before returning delayed Fable quota', async () => {
    const process = new FakeDelayedClaudeUsageProcess();
    const client = new ScreenReaderClaudeQuotaClient({
      spawnProcess: () => process,
      timeoutMs: 1_000,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    await expect(client.readQuota()).resolves.toEqual([
      expect.objectContaining({ label: '5 hour' }),
      expect.objectContaining({ label: 'Week · All models' }),
      expect.objectContaining({ label: 'Week · Fable only' })
    ]);
  });

  it('uses a complete quota screen when the official client exits before the completion marker', async () => {
    const process = new FakeClaudeExitAfterUsageProcess();
    const client = new ScreenReaderClaudeQuotaClient({
      spawnProcess: () => process,
      timeoutMs: 1_000,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    await expect(client.readQuota()).resolves.toEqual([
      expect.objectContaining({ label: '5 hour' }),
      expect.objectContaining({ label: 'Week · All models' }),
      expect.objectContaining({ label: 'Week · Fable only' })
    ]);
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
        id: 'claude-otel:1787878800000000000:claude-fable-5',
        model: 'claude-fable-5',
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 400,
        cacheWriteTokens: 50,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        modelAttribution: 'known',
        timePrecision: 'event',
        usageScope: 'this-mac',
        aggregationTemporality: 'delta',
        authority: 'local-observation'
      })
    ]);
    expect(snapshot.costs).toEqual([
      expect.objectContaining({
        kind: 'estimate',
        amount: 0.42,
        sourceId: 'claude-otel:1787878800000000000:claude-fable-5',
        currency: 'USD',
        authority: 'local-observation'
      })
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('person@example.com');
    expect(snapshot.usage[0]).not.toHaveProperty('totalTokens');
  });

  it('rejects cumulative metrics instead of adding successive account totals', () => {
    const cumulative = structuredClone(otlpFixture);
    cumulative.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.aggregationTemporality =
      'AGGREGATION_TEMPORALITY_CUMULATIVE';

    expect(() => parseClaudeOtlpMetrics(cumulative, new Date('2026-08-28T02:00:00.000Z'))).toThrow(
      expect.objectContaining({ code: 'claude-otel-temporality-unsupported' })
    );
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

const currentUsageScreenFixture = `
Settings  Status   Config   Usage   Stats
Current session
25% 25% used
Resets 2:50pm (Asia/Shanghai)
Current week (all models)
41% 41% used
Resets Sep 1 at 12am (Asia/Shanghai)
Current week (Fable)
75% 75% used
Resets Aug 31 at 11:59pm (Asia/Shanghai)
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
                aggregationTemporality: 'AGGREGATION_TEMPORALITY_DELTA',
                dataPoints: [
                  {
                    timeUnixNano: '1787878800000000000',
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
                aggregationTemporality: 'AGGREGATION_TEMPORALITY_DELTA',
                dataPoints: [
                  {
                    timeUnixNano: '1787878800000000000',
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

class FakeDelayedClaudeUsageProcess extends EventEmitter implements ClaudeUsageProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  constructor() {
    super();
    queueMicrotask(() => {
      this.stdout.write(`
Current session
25% 25% used
Resets 2:50pm (Asia/Shanghai)
Current week (all models)
41% 41% used
Resets Sep 1 at 12am (Asia/Shanghai)
Esc to cancel
`);
      setTimeout(() => {
        this.stdout.write(`
Current week (Fable)
75% 75% used
Resets Aug 31 at 11:59pm (Asia/Shanghai)
Esc to cancel
__CLAUDE_USAGE_DONE__
`);
      }, 10);
    });
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }
}

class FakeClaudeExitAfterUsageProcess extends EventEmitter implements ClaudeUsageProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();

  constructor() {
    super();
    queueMicrotask(() => {
      this.stdout.write(currentUsageScreenFixture);
      this.emit('exit', 22, null);
    });
  }

  kill(): boolean {
    return true;
  }
}
