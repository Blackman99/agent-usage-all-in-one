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

describe('token and money workbench', () => {
  it('keeps cost purposes and Grok billing domains separate while preserving gaps', async () => {
    const repository = await fixture();

    const cny = repository.getOverview(NOW, {
      window: '24h',
      timeZone: 'UTC',
      comparisonCurrency: 'CNY'
    }).workbench;

    expect(cny).toMatchObject({
      window: '24h',
      comparisonCurrency: 'CNY',
      recordedTokens: 200,
      costs: {
        actual: {
          purpose: 'actual',
          status: 'available',
          amount: 1.8,
          comparisonCurrency: 'CNY',
          amountCoverage: 1,
          authorities: ['official-account']
        },
        reportedEstimate: {
          purpose: 'reported-estimate',
          status: 'available',
          amount: 0.00288,
          comparisonCurrency: 'CNY',
          authorities: ['local-observation']
        },
        retailEquivalent: {
          purpose: 'retail-equivalent',
          status: 'available',
          amount: 0.00072,
          comparisonCurrency: 'CNY',
          pricingCoverage: 0.5,
          authorities: ['estimate']
        }
      },
      trend: { granularity: 'hour' },
      tokenBreakdown: {
        status: 'available',
        classificationCoverage: 1,
        authorities: ['official-account']
      }
    });
    expect(cny.providerSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'grok',
          billingDomainId: 'grok-build-subscription',
          includedInHeadline: true,
          recordedTokens: 100,
          tokenShare: 0.5,
          retailEquivalent: expect.objectContaining({ status: 'available', amount: 0.00072 })
        }),
        expect.objectContaining({
          providerId: 'grok',
          billingDomainId: 'xai-api',
          includedInHeadline: false,
          tokenShare: null,
          retailShare: null
        })
      ])
    );
    expect(cny.dayBreakdown.filter((bucket) => !bucket.gap)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordedTokens: 100,
          retailEquivalent: expect.objectContaining({ status: 'available', amount: 0.00072 })
        })
      ])
    );
    expect(cny.costs.actual.nativeAmounts).toEqual([
      { currency: 'USD', amount: 0.25, knownRecords: 1, records: 1 }
    ]);
    expect(cny.costs.retailEquivalent.nativeAmounts).toEqual([
      { currency: 'USD', amount: 0.0001, knownRecords: 1, records: 1 }
    ]);
    expect(cny.trend.buckets).toHaveLength(24);
    expect(cny.trend.buckets.some((bucket) => bucket.gap)).toBe(true);
    expect(
      cny.trend.buckets
        .flatMap((bucket) => bucket.segments)
        .find((segment) => segment.billingDomainId === 'grok-build-subscription')
    ).toMatchObject({ timePrecisions: ['day'] });
    expect(
      cny.trend.buckets
        .flatMap((bucket) => bucket.segments)
        .filter((segment) => segment.providerId === 'grok')
        .map((segment) => [segment.billingDomainId, segment.includedInHeadline])
    ).toEqual([
      ['grok-build-subscription', true],
      ['xai-api', false]
    ]);
    expect(
      cny.trend.buckets
        .flatMap((bucket) => bucket.segments)
        .some((segment) => segment.billingDomainId === 'combined')
    ).toBe(false);

    const usd = repository.getOverview(NOW, {
      window: '24h',
      timeZone: 'UTC',
      comparisonCurrency: 'USD'
    }).workbench;
    expect(usd.costs.actual).toMatchObject({ status: 'available', amount: 0.25 });
    expect(usd.costs.reportedEstimate).toMatchObject({ status: 'available', amount: 0.0004 });
    expect(usd.costs.retailEquivalent).toMatchObject({ status: 'available', amount: 0.0001 });
    expect(
      usd.modelRanking.entries.find((entry) => entry.billingDomainId === 'xai-api')
    ).toMatchObject({
      includedInHeadline: false,
      tokenShare: null,
      retailShare: null
    });

    repository.close();
  });

  it('disables only the requested conversion and uses daily buckets for longer windows', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-workbench-no-rate-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(
      snapshot(
        'claude-code',
        'Claude Code',
        'subscription',
        'Subscription',
        [
          usage(
            'claude-usage',
            'subscription',
            '2026-08-28T01:00:00.000Z',
            'claude-fable-4-5',
            'event'
          )
        ],
        [
          {
            ...cost(
              'claude-reported',
              'subscription',
              '2026-08-28T01:00:00.000Z',
              'reported-estimate',
              0.001
            ),
            authority: 'local-observation'
          }
        ]
      )
    );

    const cny = repository.getOverview(NOW, {
      window: '7d',
      comparisonCurrency: 'CNY'
    }).workbench;
    expect(cny.costs.reportedEstimate).toMatchObject({
      status: 'unavailable',
      amount: null,
      amountCoverage: 1,
      conversionUnavailableReasons: ['missing-rate'],
      nativeAmounts: [{ currency: 'USD', amount: 0.001 }]
    });
    expect(cny.providerSummary).toEqual([
      expect.objectContaining({
        providerId: 'claude-code',
        retailEquivalent: expect.objectContaining({ status: 'unavailable', amount: null })
      })
    ]);
    expect(cny.dayBreakdown.filter((bucket) => !bucket.gap)).toEqual([
      expect.objectContaining({
        retailEquivalent: expect.objectContaining({ status: 'unavailable', amount: null })
      })
    ]);
    expect(cny.trend).toMatchObject({ granularity: 'day' });
    expect(cny.trend.buckets).toHaveLength(7);

    const usd = repository.getOverview(NOW, {
      window: '30d',
      comparisonCurrency: 'USD'
    }).workbench;
    expect(usd.costs.reportedEstimate).toMatchObject({
      status: 'available',
      amount: 0.001,
      comparisonCurrency: 'USD'
    });
    expect(usd.trend.buckets).toHaveLength(30);
    expect(usd.trend.granularity).toBe('day');

    repository.close();
  });

  it('marks category totals partial when source-reported tokens exceed classified tokens', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-workbench-partial-tokens-'));
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
              'partial-codex-usage',
              'subscription',
              '2026-08-28T01:00:00.000Z',
              'gpt-5',
              'event'
            ),
            sourceReportedTotalTokens: 120
          }
        ],
        []
      )
    );

    const workbench = repository.getOverview(NOW, { window: '24h' }).workbench;
    expect(workbench.recordedTokens).toBe(120);
    expect(workbench.tokenBreakdown).toMatchObject({
      status: 'partial',
      tokenTotals: { total: 120, input: 80, output: 20 },
      classificationCoverage: 100 / 120,
      authorities: ['official-account'],
      lastObservedAt: '2026-08-28T01:00:00.000Z'
    });

    repository.close();
  });

  it('keeps recorded tokens unavailable for a cost-only billing domain', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-workbench-cost-only-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(
      snapshot(
        'grok',
        'Grok',
        'xai-api',
        'xAI API',
        [],
        [
          {
            ...cost(
              'cost-only-retail',
              'xai-api',
              '2026-08-28T01:00:00.000Z',
              'retail-equivalent',
              0.25
            ),
            authority: 'estimate'
          }
        ]
      )
    );

    const workbench = repository.getOverview(NOW, {
      window: '24h',
      comparisonCurrency: 'USD'
    }).workbench;
    expect(workbench.recordedTokens).toBeNull();
    expect(workbench.providerSummary).toEqual([
      expect.objectContaining({
        providerId: 'grok',
        billingDomainId: 'xai-api',
        recordedTokens: null,
        tokenShare: null,
        authorities: [],
        lastObservedAt: null,
        retailEquivalent: expect.objectContaining({
          status: 'available',
          amount: 0.25,
          authorities: ['estimate'],
          observedAt: '2026-08-28T01:00:00.000Z'
        })
      })
    ]);
    expect(workbench.dayBreakdown.find((day) => day.retailEquivalent.records > 0)).toMatchObject({
      gap: true,
      recordedTokens: null,
      tokenShare: null,
      authorities: [],
      lastObservedAt: null,
      retailEquivalent: {
        status: 'available',
        amount: 0.25,
        authorities: ['estimate'],
        observedAt: '2026-08-28T01:00:00.000Z'
      }
    });

    repository.close();
  });
});

async function fixture(): Promise<SqliteUsageRepository> {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-workbench-'));
  workspaces.push(workspace);
  const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
  repository.saveExchangeRateSnapshot({
    id: 'usd-cny-2026-08-28',
    baseCurrency: 'USD',
    quoteCurrency: 'CNY',
    rate: 7.2,
    observedAt: '2026-08-28T00:00:00.000Z',
    source: 'Test rate'
  });
  repository.saveSnapshot(
    snapshot(
      'codex',
      'Codex',
      'subscription',
      'Subscription',
      [usage('codex-usage', 'subscription', '2026-08-27T03:15:00.000Z', 'gpt-5', 'event')],
      [cost('codex-actual', 'subscription', '2026-08-27T03:15:00.000Z', 'actual', 0.25)]
    )
  );
  repository.saveSnapshot(
    snapshot(
      'grok',
      'Grok',
      'grok-build-subscription',
      'Build / SuperGrok',
      [
        usage(
          'grok-build-usage',
          'grok-build-subscription',
          '2026-08-28T00:15:00.000Z',
          'grok-build',
          'day'
        )
      ],
      [
        {
          ...cost(
            'grok-reported',
            'grok-build-subscription',
            '2026-08-28T00:15:00.000Z',
            'reported-estimate',
            0.0004
          ),
          authority: 'local-observation'
        },
        {
          ...cost(
            'grok-retail',
            'grok-build-subscription',
            '2026-08-28T00:15:00.000Z',
            'retail-equivalent',
            0.0001
          ),
          authority: 'estimate',
          usageObservationId: 'grok-build-usage',
          pricedTokens: 100
        },
        cost(
          'grok-subscription',
          'grok-build-subscription',
          '2026-08-28T00:15:00.000Z',
          'subscription',
          20
        )
      ]
    )
  );
  repository.saveSnapshot(
    snapshot(
      'grok',
      'Grok',
      'xai-api',
      'xAI API',
      [usage('xai-usage', 'xai-api', '2026-08-28T01:10:00.000Z', 'grok-4.6', 'event')],
      [
        cost('xai-actual', 'xai-api', '2026-08-28T01:10:00.000Z', 'actual', 0.3),
        {
          ...cost('xai-retail', 'xai-api', '2026-08-28T01:10:00.000Z', 'retail-equivalent', 0.0002),
          authority: 'estimate',
          usageObservationId: 'xai-usage',
          pricedTokens: 100
        }
      ]
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
  observedAt: string,
  model: string,
  timePrecision: UsageObservation['timePrecision']
): UsageObservation {
  return {
    id,
    billingDomainId,
    model,
    observedAt,
    inputTokens: 80,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelAttribution: 'known',
    timePrecision,
    usageScope: 'account-wide',
    aggregationTemporality: 'delta',
    authority: 'official-account'
  };
}

function cost(
  id: string,
  billingDomainId: string,
  observedAt: string,
  kind: CostRecord['kind'],
  amount: number
): CostRecord {
  return {
    id,
    billingDomainId,
    observedAt,
    kind,
    amount,
    currency: 'USD',
    authority: 'official-account'
  };
}
