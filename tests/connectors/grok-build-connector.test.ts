import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GrokBuildConnector,
  type GrokBuildBillingClient
} from '../../src/connectors/grok-build/grok-build-connector.js';
import {
  StdioGrokBillingClient,
  type GrokBillingProcess
} from '../../src/connectors/grok-build/stdio-grok-billing-client.js';
import {
  parseGrokHeadlessResult,
  parseGrokOtlpMetrics
} from '../../src/connectors/grok-build/grok-telemetry.js';
import { LocalTranscriptUsageClient } from '../../src/server/local-transcript-usage-client.js';

const transcriptWorkspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    transcriptWorkspaces
      .splice(0)
      .map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('Grok Build official billing adapter', () => {
  it('uses the official ACP billing capability without reading or forwarding OAuth tokens', async () => {
    const process = new FakeGrokBillingProcess(billingFixture);
    const client = new StdioGrokBillingClient({
      command: '/usr/local/bin/grok',
      spawnProcess(command, arguments_) {
        expect(command).toBe('/usr/local/bin/grok');
        expect(arguments_).toEqual(['agent', '--no-leader', 'stdio']);
        return process;
      },
      timeoutMs: 1_000
    });

    await expect(client.readBilling()).resolves.toEqual(billingFixture);
    expect(process.methods).toEqual(['initialize', 'x.ai/billing']);
    expect(process.requests[1]).toMatchObject({ method: 'x.ai/billing', params: {} });
    expect(JSON.stringify(process.requests)).not.toContain('oauth');
    expect(process.killed).toBe(true);
  });

  it('fails closed when the official client does not expose x.ai/billing', async () => {
    const process = new FakeGrokBillingProcess(undefined, -32601);
    const client = new StdioGrokBillingClient({
      spawnProcess: () => process,
      readUnifiedLog: async () => '',
      timeoutMs: 1_000
    });

    await expect(client.readBilling()).rejects.toMatchObject({
      code: 'grok-billing-capability-unsupported',
      recovery: 'Open Grok Build and run /usage, then update Grok Build before retrying.'
    });
  });

  it('falls back to the latest official unified-log billing event when ACP is unavailable', async () => {
    const process = new FakeGrokBillingProcess(undefined, -32601);
    const client = new StdioGrokBillingClient({
      spawnProcess: () => process,
      readUnifiedLog: async () => grokBillingLogFixture,
      timeoutMs: 1_000
    });

    await expect(client.readBilling()).resolves.toEqual({
      ...billingFixture,
      onDemandEnabled: null,
      sourceObservedAt: '2026-08-28T02:37:06.249Z'
    });
    expect(process.killed).toBe(true);
  });

  it('uses the official unified log when the Grok executable cannot start', async () => {
    const client = new StdioGrokBillingClient({
      spawnProcess() {
        throw new Error('grok is not on PATH');
      },
      readUnifiedLog: async () => grokBillingLogFixture,
      timeoutMs: 1_000
    });

    await expect(client.readBilling()).resolves.toMatchObject({
      subscriptionTier: 'SuperGrok Heavy',
      sourceObservedAt: '2026-08-28T02:37:06.249Z'
    });
  });

  it('skips malformed observation timestamps and keeps searching older billing events', async () => {
    const process = new FakeGrokBillingProcess(undefined, -32601);
    const client = new StdioGrokBillingClient({
      spawnProcess: () => process,
      readUnifiedLog: async () =>
        [
          grokBillingLogFixture,
          JSON.stringify({
            ts: 'not-a-timestamp',
            msg: 'billing: fetched credits config',
            ctx: billingFixture
          })
        ].join('\n'),
      timeoutMs: 1_000
    });

    await expect(client.readBilling()).resolves.toMatchObject({
      subscriptionTier: 'SuperGrok Heavy',
      sourceObservedAt: '2026-08-28T02:37:06.249Z'
    });
  });
});

describe('GrokBuildConnector', () => {
  it('automatically reads model usage and reported cost from local session updates', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-grok-transcript-'));
    transcriptWorkspaces.push(workspace);
    const update = JSON.stringify({
      timestamp: Date.parse('2026-08-28T01:00:00.000Z') / 1000,
      params: {
        sessionId: 'session-1',
        _meta: { agentTimestampMs: Date.parse('2026-08-28T01:00:00.000Z') },
        update: {
          sessionUpdate: 'turn_completed',
          prompt_id: 'prompt-1',
          usage: {
            inputTokens: 440,
            outputTokens: 20,
            cachedReadTokens: 300,
            cacheCreationTokens: 40,
            reasoningTokens: 5,
            costUsdTicks: 4_200_000_000,
            modelUsage: {
              'grok-code-fast-1': {
                inputTokens: 440,
                outputTokens: 20,
                cachedReadTokens: 300,
                cacheCreationTokens: 40,
                reasoningTokens: 5
              }
            }
          }
        }
      }
    });
    await writeFile(join(workspace, 'updates.jsonl'), `${update}\n${update}\n`);

    const snapshot = await new GrokBuildConnector({
      billingClient: {
        async readBilling() {
          return billingFixture;
        }
      },
      historyClient: new LocalTranscriptUsageClient({
        provider: 'grok',
        root: workspace,
        clock: () => new Date('2026-08-28T02:00:00.000Z')
      }),
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    }).collect();

    expect(snapshot.usage).toEqual([
      expect.objectContaining({
        billingDomainId: 'grok-build-subscription',
        model: 'grok-code-fast-1',
        sessionId: 'session-1',
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 5,
        cacheReadTokens: 300,
        cacheWriteTokens: 40,
        modelAttribution: 'known',
        timePrecision: 'event',
        usageScope: 'this-mac',
        aggregationTemporality: 'delta',
        authority: 'local-observation'
      })
    ]);
    expect(snapshot.costs).toEqual([
      expect.objectContaining({
        kind: 'reported-estimate',
        amount: 0.42,
        currency: 'USD',
        model: 'grok-code-fast-1',
        authority: 'local-observation'
      })
    ]);
    expect(snapshot.usageReconciliation).toEqual({
      authoritativeIdPrefix: 'grok-transcript:',
      retiredIdPrefixes: ['grok-otel:', 'grok-headless:']
    });
  });

  it('maps the provider-native shared weekly pool without inventing a five-hour window', async () => {
    const billingClient: GrokBuildBillingClient = {
      async readBilling() {
        return billingFixture;
      }
    };
    const snapshot = await new GrokBuildConnector({
      billingClient,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    }).collect();

    expect(snapshot.billingDomains).toEqual([
      {
        id: 'grok-build-subscription',
        displayName: 'Grok Build / SuperGrok shared pool'
      }
    ]);
    expect(snapshot.quotaBuckets).toEqual([
      {
        id: 'grok-build:weekly',
        billingDomainId: 'grok-build-subscription',
        label: 'Weekly limit',
        usedPercent: 61.2,
        resetsAt: '2026-09-01T00:00:00.000Z',
        authority: 'official-client',
        scope: 'account-wide',
        status: 'SuperGrok Heavy'
      }
    ]);
    expect(snapshot.quotaBuckets.some((bucket) => bucket.label.includes('5 hour'))).toBe(false);
  });

  it('preserves the official log observation time instead of presenting fallback data as fresh', async () => {
    const billingClient: GrokBuildBillingClient = {
      async readBilling() {
        return { ...billingFixture, sourceObservedAt: '2026-08-28T02:37:06.249Z' };
      }
    };
    const snapshot = await new GrokBuildConnector({
      billingClient,
      clock: () => new Date('2026-08-28T05:00:00.000Z')
    }).collect();

    expect(snapshot.observedAt).toBe('2026-08-28T02:37:06.249Z');
  });

  it('keeps the provider available with an actionable /usage recovery when billing is unavailable', async () => {
    const billingClient: GrokBuildBillingClient = {
      async readBilling() {
        throw Object.assign(new Error('Billing capability changed.'), {
          code: 'grok-billing-schema-changed',
          recovery: 'Open Grok Build and run /usage, then update Agent Usage.'
        });
      }
    };
    const snapshot = await new GrokBuildConnector({ billingClient }).collect();

    expect(snapshot.quotaBuckets).toEqual([]);
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({
        code: 'grok-billing-schema-changed',
        recovery: expect.stringContaining('/usage')
      })
    ]);
  });
});

describe('Grok Build usage observations', () => {
  it('normalizes v1 alpha OTLP token types by model and session while discarding identity fields', () => {
    const snapshot = parseGrokOtlpMetrics(grokOtlpFixture, new Date('2026-08-28T02:00:00.000Z'));

    expect(snapshot.provider).toEqual({ id: 'grok', displayName: 'Grok' });
    expect(snapshot.usage).toEqual([
      expect.objectContaining({
        id: 'grok-otel:1787878800000000000:session-123:grok-build',
        billingDomainId: 'grok-build-subscription',
        model: 'grok-build',
        sessionId: 'session-123',
        inputTokens: 100,
        outputTokens: 25,
        reasoningTokens: 12,
        cacheReadTokens: 400,
        cacheWriteTokens: 0,
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
    expect(snapshot.costs).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('person@example.com');
    expect(snapshot.usage[0]).not.toHaveProperty('totalTokens');
  });

  it('rejects unknown alpha OTLP schema versions instead of silently miscounting', () => {
    const changed = structuredClone(grokOtlpFixture);
    changed.resourceMetrics[0].resource.attributes[0].value.stringValue = 'v2';

    expect(() => parseGrokOtlpMetrics(changed, new Date('2026-08-28T02:00:00.000Z'))).toThrow(
      expect.objectContaining({ code: 'grok-otel-schema-unsupported' })
    );
  });

  it('rejects cumulative metrics without exposing a manual telemetry command', () => {
    const cumulative = structuredClone(grokOtlpFixture);
    cumulative.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.aggregationTemporality =
      'AGGREGATION_TEMPORALITY_CUMULATIVE';

    expect(() => parseGrokOtlpMetrics(cumulative, new Date('2026-08-28T02:00:00.000Z'))).toThrow(
      expect.objectContaining({
        code: 'grok-otel-temporality-unsupported',
        recovery:
          'Update Grok Build, restart it with delta telemetry enabled, then refresh Agent Usage.'
      })
    );
  });

  it('normalizes official headless JSON while treating absent cost as unknown, not zero', () => {
    const snapshot = parseGrokHeadlessResult(
      {
        sessionId: 'session-456',
        requestId: 'request-1',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 300,
          cache_creation_input_tokens: 40,
          reasoning_tokens: 5,
          total_tokens: 460
        },
        modelUsage: {
          'grok-build': {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadInputTokens: 300,
            cacheCreationInputTokens: 40,
            modelCalls: 2
          }
        },
        usage_is_incomplete: true
      },
      new Date('2026-08-28T02:00:00.000Z')
    );

    expect(snapshot.usage).toEqual([
      expect.objectContaining({
        model: 'grok-build',
        sessionId: 'session-456',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 300,
        cacheWriteTokens: 40,
        sourceReportedTotalTokens: 460,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        timePrecision: 'event',
        usageScope: 'this-mac',
        aggregationTemporality: 'delta'
      })
    ]);
    expect(snapshot.usage[0]).not.toHaveProperty('totalTokens');
    expect(snapshot.costs).toEqual([]);
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'grok-headless-usage-incomplete' })
    ]);
  });
});

const billingFixture = {
  config: {
    creditUsagePercent: 61.2,
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-08-25T00:00:00.000Z',
      end: '2026-09-01T00:00:00.000Z'
    },
    isUnifiedBillingUser: true
  },
  onDemandEnabled: true,
  subscriptionTier: 'SuperGrok Heavy'
};

const grokBillingLogFixture = [
  JSON.stringify({ ts: '2026-08-28T02:00:00.000Z', msg: 'unrelated event', ctx: {} }),
  '{malformed-json',
  JSON.stringify({
    ts: '2026-08-28T02:37:06.249Z',
    msg: 'billing: fetched credits config',
    ctx: { ...billingFixture, onDemandEnabled: null }
  })
].join('\n');

const grokOtlpFixture = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: 'grok_code.schema.version', value: { stringValue: 'v1' } },
          { key: 'user.id', value: { stringValue: 'person@example.com' } }
        ]
      },
      scopeMetrics: [
        {
          metrics: (['input', 'output', 'reasoning', 'cache_read'] as const).map((type, index) => ({
            name: 'grok_code.token.usage',
            sum: {
              aggregationTemporality: 'AGGREGATION_TEMPORALITY_DELTA',
              dataPoints: [
                {
                  timeUnixNano: '1787878800000000000',
                  asInt: [100, 25, 12, 400][index].toString(),
                  attributes: [
                    { key: 'type', value: { stringValue: type } },
                    { key: 'model', value: { stringValue: 'grok-build' } },
                    { key: 'session.id', value: { stringValue: 'session-123' } },
                    { key: 'user.id', value: { stringValue: 'person@example.com' } }
                  ]
                }
              ]
            }
          }))
        }
      ]
    }
  ]
};

class FakeGrokBillingProcess extends EventEmitter implements GrokBillingProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly requests: unknown[] = [];
  readonly methods: string[] = [];
  readonly stdin: Writable;
  killed = false;
  #buffer = '';

  constructor(
    private readonly billing: unknown,
    private readonly billingErrorCode?: number
  ) {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.#buffer += chunk.toString();
        let newline = this.#buffer.indexOf('\n');
        while (newline !== -1) {
          const line = this.#buffer.slice(0, newline);
          this.#buffer = this.#buffer.slice(newline + 1);
          this.#reply(line);
          newline = this.#buffer.indexOf('\n');
        }
        callback();
      }
    });
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }

  #reply(line: string): void {
    const request = JSON.parse(line) as { id: number; method: string };
    this.requests.push(request);
    this.methods.push(request.method);
    queueMicrotask(() => {
      if (request.method === 'x.ai/billing' && this.billingErrorCode) {
        this.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: this.billingErrorCode, message: 'Method not found' }
          })}\n`
        );
        return;
      }
      this.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: request.method === 'initialize' ? { protocolVersion: 1 } : this.billing
        })}\n`
      );
    });
  }
}
