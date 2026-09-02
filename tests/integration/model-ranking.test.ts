import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorSnapshot, CostRecord, UsageObservation } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const NOW = new Date('2026-08-28T02:00:00.000Z');
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('model ranking read model', () => {
  it('keeps the same complete model set when sorting by Tokens or cost', async () => {
    const repository = await fixture();
    const ranking = repository.getOverview(NOW, {
      window: '24h',
      timeZone: 'UTC',
      comparisonCurrency: 'USD'
    }).workbench.modelRanking;
    const allModels = ranking.entries.map((entry) => entry.id).sort();

    expect([...ranking.byTokens].sort()).toEqual(allModels);
    expect([...ranking.byCost].sort()).toEqual(allModels);
    expect([...ranking.byRetailEquivalent].sort()).toEqual(allModels);
    repository.close();
  });

  it('ranks every isolated known model without mixing in unclassified usage', async () => {
    const repository = await fixture();
    const workbench = repository.getOverview(NOW, {
      window: '24h',
      timeZone: 'UTC',
      comparisonCurrency: 'USD'
    }).workbench;

    expect(workbench.modelRanking.byTokens).toEqual([
      'codex::subscription::shared-model',
      'claude-code::subscription::fable-model',
      'opencode-go::subscription::open-model',
      'grok::xai-api::shared-model',
      'codex::subscription::model-four',
      'codex::subscription::model-five'
    ]);
    expect(workbench.modelRanking.byRetailEquivalent).toEqual([
      'claude-code::subscription::fable-model',
      'grok::xai-api::shared-model',
      'opencode-go::subscription::open-model',
      'codex::subscription::shared-model',
      'codex::subscription::model-four',
      'codex::subscription::model-five'
    ]);
    const shared = workbench.modelRanking.entries.filter((entry) => entry.model === 'shared-model');
    expect(shared).toHaveLength(2);
    expect(shared.map((entry) => [entry.providerId, entry.billingDomainId])).toEqual([
      ['codex', 'subscription'],
      ['grok', 'xai-api']
    ]);
    expect(shared[0]).toMatchObject({
      tokenTotals: { total: 500 },
      tokenShare: 500 / 2900,
      retailEquivalent: { status: 'unavailable', amount: null }
    });
    expect(shared[1]).toMatchObject({
      tokenTotals: { total: 300 },
      retailEquivalent: { status: 'available', amount: 3, comparisonCurrency: 'USD' },
      retailShare: 3 / 9
    });
    expect(workbench.modelRanking.unclassified).toEqual([
      expect.objectContaining({
        providerId: 'codex',
        billingDomainId: 'subscription',
        tokenTotals: expect.objectContaining({ total: 1000 }),
        tokenShare: 1000 / 2900,
        tokenEvidence: expect.objectContaining({ totalDerivations: ['source-reported'] })
      })
    ]);
    expect(
      workbench.modelRanking.entries.reduce((total, entry) => total + entry.tokenTotals.total, 0) +
        workbench.modelRanking.unclassified.reduce(
          (total, entry) => total + entry.tokenTotals.total,
          0
        )
    ).toBe(workbench.recordedTokens);

    const fable = workbench.modelRanking.entries.find(
      (entry) => entry.id === 'claude-code::subscription::fable-model'
    );
    expect(fable).toMatchObject({
      authorities: ['local-observation'],
      lastObservedAt: '2026-08-28T00:30:00.000Z',
      tokenEvidence: {
        sourceReportedTokens: 400,
        totalDerivations: ['source-reported'],
        timePrecisions: ['event']
      },
      composition: { total: 400, input: 320, output: 80, reasoning: 0 },
      priceSnapshots: [
        {
          version: '2026-08-01',
          source: 'Official fixture pricing',
          effectiveAt: '2026-08-01T00:00:00.000Z'
        }
      ]
    });
    expect(fable?.trend).toHaveLength(24);
    expect(fable?.trend.some((bucket) => bucket.gap)).toBe(true);
    expect(fable?.trend.find((bucket) => !bucket.gap)).toMatchObject({
      tokenTotals: { total: 400 },
      recordedTokens: 400,
      retailEquivalent: { status: 'available', amount: 4 }
    });

    repository.close();
  });

  it('keeps every audit row reachable through an audit-evidence query', async () => {
    const repository = await fixture();
    const query = { window: '24h', timeZone: 'UTC', comparisonCurrency: 'USD' } as const;
    const displayed = repository
      .getOverview(NOW, query)
      .providers.find((provider) => provider.id === 'claude-code')!.billingDomains[0];
    const audited = repository
      .getOverview(NOW, { ...query, auditEvidence: true })
      .providers.find((provider) => provider.id === 'claude-code')!.billingDomains[0];

    expect(displayed.costs).toBeUndefined();
    expect(displayed.history.models[0].observations).toBeUndefined();
    expect(displayed.history.models[0].priceEvidence).toBeUndefined();

    const fable = audited.history.models.find((model) => model.model === 'fable-model')!;
    expect(audited.costs).toEqual(
      expect.arrayContaining([expect.objectContaining({ usageObservationId: 'claude-fable' })])
    );
    expect(fable.observations).toEqual([
      expect.objectContaining({
        id: 'claude-fable',
        sourceReportedTotalTokens: 400,
        recordedTokens: 400,
        totalDerivation: 'source-reported'
      })
    ]);
    expect(fable.priceEvidence).toEqual([
      expect.objectContaining({
        usageObservationId: 'claude-fable',
        pricedTokens: 400,
        lineItems: [
          { tokenKind: 'input', tokens: 320, ratePerMillion: 10_000, amount: 3.2 },
          { tokenKind: 'output', tokens: 80, ratePerMillion: 10_000, amount: 0.8 }
        ],
        priceSnapshot: expect.objectContaining({
          version: '2026-08-01',
          source: 'Official fixture pricing',
          effectiveAt: '2026-08-01T00:00:00.000Z'
        })
      })
    ]);
    repository.close();
  });

  it('keeps the displayed read model sized by the display, not by the retained history', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-model-ranking-size-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const observations: UsageObservation[] = [];
    const costs: CostRecord[] = [];
    for (let index = 0; index < 3_000; index += 1) {
      const observedAt = new Date(NOW.getTime() - (index + 1) * 60_000).toISOString();
      const id = `bulk-${index}`;
      observations.push({
        ...usage(id, 'subscription', 'bulk-model', 1_000, observedAt),
        sourceReportedTotalTokens: 1_000
      });
      costs.push({
        ...retailCost('bulk', 'subscription', 'bulk-model', id, 1_000, 0.01),
        id: `bulk-retail-${index}`,
        observedAt
      });
    }
    repository.saveSnapshot(
      snapshot('codex', 'Codex', 'subscription', 'Subscription', observations, costs)
    );

    const displayed = repository.getOverview(NOW, { window: '30d', timeZone: 'UTC' });
    const entry = displayed.workbench.modelRanking.entries[0];

    // Every observation still counts toward the totals the Dashboard shows.
    expect(entry.tokenEvidence.observationCount).toBe(3_000);
    expect(entry.tokenTotals.total).toBe(3_000_000);
    expect(entry.priceSnapshots).toHaveLength(1);
    // Carrying the 3,000 observations and 3,000 cost records would run to megabytes.
    expect(JSON.stringify(displayed).length).toBeLessThan(500_000);

    const audited = repository.getOverview(NOW, {
      window: '30d',
      timeZone: 'UTC',
      auditEvidence: true
    });
    expect(audited.providers[0].billingDomains[0].history.models[0].observations).toHaveLength(
      3_000
    );
    repository.close();
  });

  it('keeps source-total-only and named-model remainders out of known-model rankings', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-model-ranking-remainder-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(
      snapshot(
        'codex',
        'Codex',
        'subscription',
        'Subscription',
        [
          {
            ...usage(
              'source-total-only',
              'subscription',
              'named-but-unclassified',
              300,
              '2026-08-28T00:10:00.000Z'
            ),
            inputTokens: 0,
            outputTokens: 0
          },
          {
            ...usage(
              'named-with-remainder',
              'subscription',
              'partially-classified',
              150,
              '2026-08-28T00:20:00.000Z'
            ),
            inputTokens: 80,
            outputTokens: 20
          }
        ],
        []
      )
    );

    const overview = repository.getOverview(NOW, { window: '24h', auditEvidence: true });
    const ranking = overview.workbench.modelRanking;
    expect(ranking.entries).toEqual([
      expect.objectContaining({
        id: 'codex::subscription::partially-classified',
        tokenTotals: expect.objectContaining({ total: 100 }),
        composition: expect.objectContaining({ total: 100, input: 80, output: 20 }),
        // The ranking entry reports only the classified part; the 50-Token remainder
        // stays in the unclassified section asserted below.
        tokenEvidence: expect.objectContaining({
          recordedTokens: 100,
          classifiedTokens: 100,
          unclassifiedTokens: 0,
          usageScopes: ['this-mac'],
          aggregationTemporalities: ['delta']
        })
      })
    ]);
    expect(
      overview.providers[0].billingDomains[0].history.models.find(
        (model) => model.model === 'partially-classified'
      )?.observations
    ).toEqual([
      expect.objectContaining({
        id: 'named-with-remainder',
        recordedTokens: 150,
        classifiedTokens: 100,
        sourceReportedTotalTokens: 150,
        unclassifiedTokens: 50,
        usageScope: 'this-mac',
        aggregationTemporality: 'delta',
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        }
      })
    ]);
    expect(ranking.unclassified).toEqual([
      expect.objectContaining({
        providerId: 'codex',
        billingDomainId: 'subscription',
        tokenTotals: expect.objectContaining({ total: 350 })
      })
    ]);
    expect(
      ranking.entries.reduce((total, entry) => total + entry.tokenTotals.total, 0) +
        ranking.unclassified.reduce((total, entry) => total + entry.tokenTotals.total, 0)
    ).toBe(450);
    repository.close();
  });
});

async function fixture(): Promise<SqliteUsageRepository> {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-model-ranking-'));
  workspaces.push(workspace);
  const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
  repository.saveSnapshot(
    snapshot(
      'codex',
      'Codex',
      'subscription',
      'Subscription',
      [
        usage('codex-shared', 'subscription', 'shared-model', 500, '2026-08-27T04:00:00.000Z'),
        usage('codex-four', 'subscription', 'model-four', 200, '2026-08-27T05:00:00.000Z'),
        usage('codex-five', 'subscription', 'model-five', 100, '2026-08-27T06:00:00.000Z'),
        {
          ...usage('codex-all', 'subscription', 'all-models', 1000, '2026-08-27T07:00:00.000Z'),
          modelAttribution: 'unclassified'
        }
      ],
      []
    )
  );
  repository.saveSnapshot(
    snapshot(
      'claude-code',
      'Claude Code',
      'subscription',
      'Subscription',
      [usage('claude-fable', 'subscription', 'fable-model', 400, '2026-08-28T00:30:00.000Z')],
      [retailCost('claude', 'subscription', 'fable-model', 'claude-fable', 400, 4)]
    )
  );
  repository.saveSnapshot(
    snapshot(
      'opencode-go',
      'OpenCode Go',
      'subscription',
      'Subscription',
      [usage('opencode-model', 'subscription', 'open-model', 400, '2026-08-28T00:45:00.000Z')],
      [retailCost('opencode', 'subscription', 'open-model', 'opencode-model', 400, 2)]
    )
  );
  repository.saveSnapshot(
    snapshot(
      'grok',
      'Grok',
      'xai-api',
      'xAI API',
      [usage('grok-shared', 'xai-api', 'shared-model', 300, '2026-08-28T01:15:00.000Z')],
      [retailCost('grok', 'xai-api', 'shared-model', 'grok-shared', 300, 3)]
    )
  );
  return repository;
}

function snapshot(
  providerId: string,
  providerDisplayName: string,
  billingDomainId: string,
  billingDomainDisplayName: string,
  observations: UsageObservation[],
  costs: CostRecord[]
): ConnectorSnapshot {
  return {
    provider: { id: providerId, displayName: providerDisplayName },
    billingDomains: [{ id: billingDomainId, displayName: billingDomainDisplayName }],
    quotaBuckets: [],
    usage: observations,
    costs,
    observedAt: observations.at(-1)?.observedAt ?? NOW.toISOString()
  };
}

function usage(
  id: string,
  billingDomainId: string,
  model: string,
  total: number,
  observedAt: string
): UsageObservation {
  return {
    id,
    billingDomainId,
    model,
    observedAt,
    sourceReportedTotalTokens: total,
    inputTokens: Math.floor(total * 0.8),
    outputTokens: total - Math.floor(total * 0.8),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelAttribution: 'known',
    timePrecision: 'event',
    usageScope: 'this-mac',
    aggregationTemporality: 'delta',
    authority: 'local-observation'
  };
}

function retailCost(
  id: string,
  billingDomainId: string,
  model: string,
  observationId: string,
  pricedTokens: number,
  amount: number
): CostRecord {
  return {
    id: `${id}-retail`,
    billingDomainId,
    observedAt:
      observationId === 'claude-fable'
        ? '2026-08-28T00:30:00.000Z'
        : observationId === 'opencode-model'
          ? '2026-08-28T00:45:00.000Z'
          : '2026-08-28T01:15:00.000Z',
    kind: 'retail-equivalent',
    amount,
    currency: 'USD',
    authority: 'estimate',
    model,
    usageObservationId: observationId,
    pricedTokens,
    lineItems: [
      {
        tokenKind: 'input',
        tokens: pricedTokens * 0.8,
        ratePerMillion: (amount * 1_000_000) / pricedTokens,
        amount: amount * 0.8
      },
      {
        tokenKind: 'output',
        tokens: pricedTokens * 0.2,
        ratePerMillion: (amount * 1_000_000) / pricedTokens,
        amount: amount * 0.2
      }
    ],
    priceSnapshot: {
      id: `${id}-price-v1`,
      version: '2026-08-01',
      source: 'Official fixture pricing',
      sourceUrl: 'https://example.invalid/official-pricing',
      canonicalModel: model,
      effectiveAt: '2026-08-01T00:00:00.000Z',
      effectiveUntil: null,
      currency: 'USD',
      ratesPerMillion: {
        input: (amount * 1_000_000) / pricedTokens,
        output: (amount * 1_000_000) / pricedTokens,
        reasoning: null,
        'cache-read': null,
        'cache-write': null
      }
    },
    calculatedAt: '2026-08-28T01:30:00.000Z'
  };
}
