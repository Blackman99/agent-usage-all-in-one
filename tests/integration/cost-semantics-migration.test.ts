import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorSnapshot } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const NOW = new Date('2026-08-28T02:00:00.000Z');
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true }))
  );
});

describe('cost purpose expand-contract migration', () => {
  it('classifies provable estimates, preserves unknown evidence, and drops overlapping allowance rows', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-cost-migration-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');
    const legacyWriter = new SqliteUsageRepository(databasePath);
    legacyWriter.saveSnapshot(legacySnapshot());
    legacyWriter.close();

    const migrated = new SqliteUsageRepository(databasePath);
    const domain = migrated.getOverview(NOW, {
      window: '24h',
      comparisonCurrency: 'USD',
      auditEvidence: true
    }).providers[0].billingDomains[0];

    expect(domain.history.costs.map((cost) => cost.kind).sort()).toEqual([
      'actual',
      'legacy-unknown',
      'reported-estimate',
      'retail-equivalent',
      'subscription'
    ]);
    expect(domain.history.costs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'actual', amount: 1 }),
        expect.objectContaining({ kind: 'subscription', amount: 10 }),
        expect.objectContaining({ kind: 'reported-estimate', amount: 2 }),
        expect.objectContaining({ kind: 'retail-equivalent', amount: 3 }),
        expect.objectContaining({ kind: 'legacy-unknown', amount: 4 })
      ])
    );
    expect(domain.history.costs.some((cost) => cost.kind === ('estimate' as never))).toBe(false);
    expect(domain.history.costs.reduce((sum, cost) => sum + (cost.amount ?? 0), 0)).toBe(20);
    expect(domain.history.days[0].costs.map((cost) => cost.kind)).not.toContain('subscription');
    expect(domain.costs?.find((cost) => cost.kind === 'subscription')).toMatchObject({
      model: null,
      usageObservationId: null,
      pricedTokens: null,
      lineItems: []
    });
    expect(domain.costs?.some((cost) => cost.id.startsWith('opencode-quota-estimate:'))).toBe(
      false
    );
    migrated.close();

    const restarted = new SqliteUsageRepository(databasePath);
    expect(
      restarted
        .getOverview(NOW, { window: '24h' })
        .providers[0].billingDomains[0].history.costs.map((cost) => cost.kind)
        .sort()
    ).toEqual([
      'actual',
      'legacy-unknown',
      'reported-estimate',
      'retail-equivalent',
      'subscription'
    ]);
    restarted.close();
  });
});

function legacySnapshot(): ConnectorSnapshot {
  const observedAt = '2026-08-28T01:00:00.000Z';
  return {
    provider: { id: 'migration', displayName: 'Migration fixture' },
    billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
    quotaBuckets: [
      {
        id: 'rolling',
        billingDomainId: 'subscription',
        label: '5 hour',
        usedPercent: 50,
        resetsAt: '2026-08-28T05:00:00.000Z',
        authority: 'official-account',
        limitAmount: 12,
        limitCurrency: 'USD'
      }
    ],
    usage: [],
    costs: [
      cost('actual', 'actual', 1),
      {
        ...cost('subscription', 'subscription', 10),
        model: 'must-not-be-allocated',
        usageObservationId: 'must-not-be-allocated',
        pricedTokens: 10,
        lineItems: [{ tokenKind: 'input', tokens: 10, ratePerMillion: 1, amount: 0.00001 }]
      },
      cost('claude-otel-cost:legacy', 'estimate', 2, {
        authority: 'local-observation',
        priceSnapshotId: 'claude-code-otlp-reported-cost-v1'
      }),
      cost('legacy-retail', 'estimate', 3, {
        usageObservationId: 'usage-1',
        pricedTokens: 100,
        lineItems: [{ tokenKind: 'input', tokens: 100, ratePerMillion: 30_000, amount: 3 }],
        priceSnapshotId: 'legacy-retail-v1'
      }),
      cost('generic-estimate', 'estimate', 4),
      cost('opencode-quota-estimate:rolling', 'estimate', 6)
    ] as ConnectorSnapshot['costs'],
    observedAt
  };
}

function cost(
  id: string,
  kind: string,
  amount: number,
  options: {
    authority?: 'estimate' | 'local-observation';
    priceSnapshotId?: string;
    usageObservationId?: string;
    pricedTokens?: number;
    lineItems?: ConnectorSnapshot['costs'][number]['lineItems'];
  } = {}
) {
  return {
    id,
    billingDomainId: 'subscription',
    observedAt: '2026-08-28T01:00:00.000Z',
    kind,
    amount,
    currency: 'USD',
    authority: options.authority ?? ('estimate' as const),
    usageObservationId: options.usageObservationId,
    pricedTokens: options.pricedTokens,
    lineItems: options.lineItems,
    priceSnapshot: options.priceSnapshotId
      ? {
          id: options.priceSnapshotId,
          version: 'legacy-v1',
          source: 'legacy fixture',
          effectiveAt: '2026-08-01T00:00:00.000Z'
        }
      : undefined
  };
}
