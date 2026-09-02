import { describe, expect, it } from 'vitest';

import {
  AntigravityConnector,
  ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID
} from '../../src/connectors/antigravity/antigravity-connector.js';
import type { UsageObservation } from '../../src/core/types.js';
import type {
  AntigravitySqliteUsageClient,
  AntigravitySqliteUsageResult
} from '../../src/server/antigravity-sqlite-usage-client.js';

const OBSERVED_AT = new Date('2026-09-02T12:00:00.000Z');

function mockClient(result: Partial<AntigravitySqliteUsageResult>): AntigravitySqliteUsageClient {
  return {
    async readUsage() {
      return { usage: [], costs: [], complete: true, ...result };
    }
  } as unknown as AntigravitySqliteUsageClient;
}

function observation(id: string, model: string): UsageObservation {
  return {
    id: `antigravity:${id}`,
    billingDomainId: ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID,
    model,
    observedAt: '2026-09-02T10:00:00.000Z',
    inputTokens: 50_000,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 10_000,
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
  };
}

describe('AntigravityConnector', () => {
  it('publishes official client quota buckets when live language server responds', async () => {
    const mockQuotaClient = {
      async readQuota() {
        return [
          {
            id: 'gemini-5h',
            billingDomainId: ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID,
            label: '5 hour',
            usedPercent: 74,
            windowDurationMinutes: 300,
            resetsAt: '2026-09-02T14:56:41Z',
            authority: 'official-client' as const,
            scope: 'account-wide' as const
          },
          {
            id: 'gemini-weekly',
            billingDomainId: ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID,
            label: 'Week',
            usedPercent: 17,
            windowDurationMinutes: 10_080,
            resetsAt: '2026-09-09T04:01:34Z',
            authority: 'official-client' as const,
            scope: 'account-wide' as const
          }
        ];
      }
    };

    const connector = new AntigravityConnector({
      historyClient: mockClient({
        usage: [observation('conv-1:0', 'gemini-3.7-flash')]
      }),
      quotaClient:
        mockQuotaClient as unknown as import('../../src/server/antigravity-quota-client.js').AntigravityQuotaClient,
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();

    expect(snapshot.quotaBuckets).toMatchObject([
      {
        id: 'gemini-5h',
        label: '5 hour',
        usedPercent: 74,
        windowDurationMinutes: 300,
        authority: 'official-client'
      },
      {
        id: 'gemini-weekly',
        label: 'Week',
        usedPercent: 17,
        windowDurationMinutes: 10_080,
        authority: 'official-client'
      }
    ]);
  });

  it('falls back to local calculation when live quota is unavailable', async () => {
    const unreachableQuotaClient = {
      async readQuota() {
        return null;
      }
    };

    const connector = new AntigravityConnector({
      historyClient: mockClient({
        usage: [observation('conv-1:0', 'gemini-3.7-flash')]
      }),
      quotaClient:
        unreachableQuotaClient as unknown as import('../../src/server/antigravity-quota-client.js').AntigravityQuotaClient,
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();

    expect(snapshot).toMatchObject({
      provider: { id: 'antigravity', displayName: 'Antigravity' },
      billingDomains: [
        { id: ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID, displayName: 'Gemini Code Assist' }
      ],
      quotaBuckets: [
        {
          id: 'gemini-5h',
          label: '5 hour',
          windowDurationMinutes: 300,
          authority: 'local-observation'
        },
        {
          id: 'gemini-weekly',
          label: 'Week',
          windowDurationMinutes: 10_080,
          authority: 'local-observation'
        }
      ],
      usageReconciliation: {
        authoritativeIdPrefixes: ['antigravity:'],
        retiredIdPrefixes: []
      },
      observedAt: OBSERVED_AT.toISOString()
    });
    expect(snapshot.usage).toHaveLength(1);
    expect(snapshot.warnings).toEqual([]);
  });

  it('falls back to local calculation when reading the live language server throws', async () => {
    const throwingQuotaClient = {
      async readQuota() {
        throw new Error('ECONNREFUSED');
      }
    };

    const connector = new AntigravityConnector({
      historyClient: mockClient({
        usage: [observation('conv-1:0', 'gemini-3.7-flash')]
      }),
      quotaClient:
        throwingQuotaClient as unknown as import('../../src/server/antigravity-quota-client.js').AntigravityQuotaClient,
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();

    expect(snapshot.quotaBuckets).toMatchObject([
      {
        id: 'gemini-5h',
        label: '5 hour',
        windowDurationMinutes: 300,
        authority: 'local-observation'
      },
      {
        id: 'gemini-weekly',
        label: 'Week',
        windowDurationMinutes: 10_080,
        authority: 'local-observation'
      }
    ]);
    expect(snapshot.usage).toHaveLength(1);
    expect(snapshot.warnings).toEqual([]);
  });

  it('reports safe degraded failure when SQLite read throws', async () => {
    const failingClient = {
      async readUsage() {
        throw new Error('EACCES: permission denied');
      }
    } as unknown as AntigravitySqliteUsageClient;

    const connector = new AntigravityConnector({
      historyClient: failingClient,
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();
    const warnings = snapshot.warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'antigravity-sqlite-read-failed',
      message: 'Failed to read local Antigravity conversation stores.'
    });
  });

  it('reports incomplete session scan warning when history is partial', async () => {
    const connector = new AntigravityConnector({
      historyClient: mockClient({
        complete: false,
        usage: [observation('conv-1:0', 'gemini-3.7-flash')]
      }),
      clock: () => OBSERVED_AT
    });

    const snapshot = await connector.collect();
    const warnings = snapshot.warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'antigravity-session-scan-incomplete'
    });
  });
});
