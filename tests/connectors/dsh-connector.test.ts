import { describe, expect, it } from 'vitest';

import { DshConnector } from '../../src/connectors/dsh/dsh-connector.js';
import type { UsageObservation } from '../../src/core/types.js';
import type {
  LocalTranscriptUsageResult,
  TranscriptUsageClient
} from '../../src/server/local-transcript-usage-client.js';

const OBSERVED_AT = new Date('2026-09-01T00:00:00.000Z');

function historyClient(result: Partial<LocalTranscriptUsageResult>): TranscriptUsageClient {
  return {
    async readUsage() {
      return { usage: [], costs: [], complete: true, ...result };
    }
  };
}

function observation(id: string, billingDomainId: string, model: string | null): UsageObservation {
  return {
    id: `dsh-transcript:${id}`,
    billingDomainId,
    model,
    observedAt: '2026-08-31T12:00:00.000Z',
    inputTokens: 1_000,
    outputTokens: 200,
    reasoningTokens: 50,
    cacheReadTokens: 5_000,
    cacheWriteTokens: 0,
    tokenSemantics: {
      reasoning: 'included-in-output',
      cacheRead: 'separate',
      cacheWrite: 'separate'
    },
    modelAttribution: model ? 'known' : 'unclassified',
    timePrecision: 'event',
    usageScope: 'this-mac',
    aggregationTemporality: 'delta',
    authority: 'local-observation'
  };
}

describe('DshConnector', () => {
  it('publishes local session usage without claiming a quota window', async () => {
    const connector = new DshConnector({
      historyClient: historyClient({
        usage: [observation('a', 'deepseek-official', 'deepseek-v4-flash')]
      }),
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();

    expect(snapshot).toMatchObject({
      provider: { id: 'dsh', displayName: 'dsh' },
      billingDomains: [{ id: 'deepseek-official', displayName: 'DeepSeek API' }],
      quotaBuckets: [],
      usageReconciliation: {
        authoritativeIdPrefixes: ['dsh-transcript:'],
        retiredIdPrefixes: []
      },
      observedAt: OBSERVED_AT.toISOString()
    });
    expect(snapshot.usage).toHaveLength(1);
    expect(snapshot.costs).toEqual([]);
    expect(snapshot.warnings ?? []).toEqual([]);
  });

  it('keeps every observed route as its own billing domain, deployment default first', async () => {
    const connector = new DshConnector({
      historyClient: historyClient({
        usage: [
          observation('a', 'openai-compatible', 'gpt-5.6-terra'),
          observation('b', 'deepseek-official', 'deepseek-v4-pro'),
          observation('c', 'anthropic-compatible', 'claude-opus-5')
        ]
      }),
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();

    expect(snapshot.billingDomains).toEqual([
      { id: 'deepseek-official', displayName: 'DeepSeek API' },
      { id: 'anthropic-compatible', displayName: 'anthropic-compatible' },
      { id: 'openai-compatible', displayName: 'openai-compatible' }
    ]);
  });

  it('declares the deployment default domain before any request is observed', async () => {
    const connector = new DshConnector({
      historyClient: historyClient({}),
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();

    expect(snapshot.billingDomains).toEqual([
      { id: 'deepseek-official', displayName: 'DeepSeek API' }
    ]);
    expect(snapshot).not.toHaveProperty('usageReconciliation');
  });

  it('reports an unreadable session log without discarding what was read', async () => {
    const connector = new DshConnector({
      historyClient: historyClient({
        usage: [observation('a', 'deepseek-official', 'deepseek-v4-flash')],
        complete: false
      }),
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();

    expect(snapshot.usage).toHaveLength(1);
    expect(snapshot).not.toHaveProperty('usageReconciliation');
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'dsh-session-log-scan-incomplete' })
    ]);
  });

  it('names an unknown on-disk format instead of reporting a gap of unknown cause', async () => {
    const connector = new DshConnector({
      historyClient: historyClient({ complete: false, unsupportedFormat: true }),
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();

    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'dsh-session-format-unsupported' })
    ]);
  });

  it('degrades to an empty snapshot when the reader itself fails', async () => {
    const connector = new DshConnector({
      historyClient: {
        async readUsage() {
          throw new Error('session root unreadable');
        }
      },
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();

    expect(snapshot).toMatchObject({
      provider: { id: 'dsh', displayName: 'dsh' },
      usage: [],
      costs: []
    });
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'dsh-session-log-read-failed' })
    ]);
  });
});
