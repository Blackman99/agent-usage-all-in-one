import { describe, expect, it } from 'vitest';

import { OpenCodeLocalConnector } from '../../src/connectors/opencode-local/opencode-local-connector.js';

describe('OpenCodeLocalConnector', () => {
  it('publishes all local OpenCode Provider usage outside the Go subscription', async () => {
    const connector = new OpenCodeLocalConnector({
      localHistoryClient: {
        async readHistory() {
          return [
            request('go', 'opencode-go', 'opencode-go/deepseek-v4-flash', 0.42),
            request('direct', 'anthropic', 'anthropic/claude-sonnet-4', null)
          ];
        }
      },
      clock: () => new Date('2026-08-29T00:00:00.000Z')
    });

    const snapshot = await connector.collect();

    expect(snapshot).toMatchObject({
      provider: { id: 'opencode', displayName: 'OpenCode' },
      billingDomains: [{ id: 'local-history', displayName: 'Local history' }],
      quotaBuckets: [],
      usageReconciliation: {
        authoritativeIdPrefixes: ['opencode-local-request:'],
        retiredIdPrefixes: []
      },
      usage: [
        expect.objectContaining({
          id: 'opencode-local-request:go',
          billingDomainId: 'local-history',
          model: 'opencode-go/deepseek-v4-flash',
          inputTokens: 700,
          outputTokens: 250,
          authority: 'local-observation'
        }),
        expect.objectContaining({
          id: 'opencode-local-request:direct',
          billingDomainId: 'local-history',
          model: 'anthropic/claude-sonnet-4',
          inputTokens: 700,
          outputTokens: 250,
          authority: 'local-observation'
        })
      ],
      costs: [
        expect.objectContaining({
          id: 'opencode-local-request-cost:go',
          billingDomainId: 'local-history',
          kind: 'reported-estimate',
          amount: 0.42,
          model: 'opencode-go/deepseek-v4-flash',
          usageObservationId: 'opencode-local-request:go'
        })
      ]
    });
    expect(snapshot.usage[0]).not.toHaveProperty('totalTokens');
  });

  it('fails closed without retiring cached local history when the database read fails', async () => {
    const connector = new OpenCodeLocalConnector({
      localHistoryClient: {
        async readHistory() {
          throw new Error('private database detail');
        }
      }
    });

    const snapshot = await connector.collect();

    expect(snapshot.usage).toEqual([]);
    expect(snapshot.costs).toEqual([]);
    expect(snapshot).not.toHaveProperty('usageReconciliation');
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'opencode-local-refresh-failed' })
    ]);
  });
});

function request(id: string, providerId: string, model: string, cost: number | null) {
  return {
    id,
    providerId,
    model,
    cost,
    inputTokens: 700,
    outputTokens: 250,
    reasoningTokens: 50,
    cacheReadTokens: 200,
    cacheWriteTokens: 0,
    observedAtMs: Date.parse('2026-08-28T00:00:00.000Z')
  };
}
