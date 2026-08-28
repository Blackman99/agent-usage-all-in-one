import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorSnapshot } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('history and cost analysis', () => {
  it('uses UTC half-open windows, local day labels, and isolated cost kinds', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-history-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const now = new Date('2026-08-28T02:00:00.000Z');
    const snapshot = historySnapshot();
    repository.saveSnapshot(snapshot);
    repository.saveSnapshot(snapshot);
    repository.saveExchangeRateSnapshot({
      id: 'usd-cny-2026-08-28',
      baseCurrency: 'USD',
      quoteCurrency: 'CNY',
      rate: 7.2,
      observedAt: '2026-08-28T00:00:00.000Z',
      source: 'European Central Bank reference feed'
    });
    repository.saveExchangeRateSnapshot({
      id: 'eur-cny-stale',
      baseCurrency: 'EUR',
      quoteCurrency: 'CNY',
      rate: 8,
      observedAt: '2026-07-01T00:00:00.000Z',
      source: 'stale fixture'
    });

    const overview = repository.getOverview(now, {
      window: '24h',
      timeZone: 'Asia/Shanghai',
      comparisonCurrency: 'CNY'
    });
    const history = overview.providers[0].billingDomains[0].history;

    expect(history).toMatchObject({
      window: '24h',
      start: '2026-08-27T02:00:00.000Z',
      end: '2026-08-28T02:00:00.000Z',
      timeZone: 'Asia/Shanghai',
      lastObservedAt: '2026-08-27T16:30:00.000Z',
      models: [
        { model: 'included-model', tokenTotals: { total: 125 } },
        { model: 'boundary-model', tokenTotals: { total: 10 } }
      ],
      days: [
        { day: '2026-08-27', tokenTotals: { total: 10 } },
        { day: '2026-08-28', tokenTotals: { total: 125 } }
      ]
    });
    expect(history.costs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'actual',
          currency: 'USD',
          amount: 1,
          convertedAmount: 7.2,
          comparisonCurrency: 'CNY',
          observedAt: '2026-08-27T16:30:00.000Z'
        }),
        expect.objectContaining({
          kind: 'reported-estimate',
          currency: 'USD',
          amount: 2,
          priceSnapshots: [
            expect.objectContaining({ id: 'fixture-price-v1', version: '2026-08-01' })
          ]
        }),
        expect.objectContaining({
          kind: 'subscription',
          currency: 'EUR',
          amount: 10,
          convertedAmount: null,
          conversionUnavailableReason: 'stale-rate'
        }),
        expect.objectContaining({
          kind: 'actual',
          currency: 'JPY',
          amount: null,
          convertedAmount: null,
          conversionUnavailableReason: 'unknown-native-amount'
        })
      ])
    );
    expect(history.exchangeRates).toEqual([
      expect.objectContaining({
        id: 'usd-cny-2026-08-28',
        source: 'European Central Bank reference feed'
      })
    ]);
    repository.close();
  });

  it('changes results for 24-hour, 7-day, and 30-day windows', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-windows-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(historySnapshot());
    const now = new Date('2026-08-28T02:00:00.000Z');
    const total = (window: '24h' | '7d' | '30d') =>
      repository.getOverview(now, { window }).providers[0].billingDomains[0].history.tokenTotals
        .total;

    expect(total('24h')).toBe(135);
    expect(total('7d')).toBe(1_184);
    expect(total('30d')).toBe(1_184);
    repository.close();
  });
});

function historySnapshot(): ConnectorSnapshot {
  const usage = [
    ['boundary', 'boundary-model', '2026-08-27T02:00:00.000Z', 10],
    ['included', 'included-model', '2026-08-27T16:30:00.000Z', 125],
    ['older', 'older-model', '2026-08-25T00:00:00.000Z', 50],
    ['before-boundary', 'excluded-model', '2026-08-27T01:59:59.999Z', 999],
    ['at-end', 'excluded-end', '2026-08-28T02:00:00.000Z', 999]
  ].map(([id, model, observedAt, total]) => ({
    id: String(id),
    billingDomainId: 'subscription',
    model: String(model),
    observedAt: String(observedAt),
    inputTokens: Number(total),
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    authority: 'official-account' as const
  }));
  return {
    provider: { id: 'history', displayName: 'History' },
    billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
    quotaBuckets: [],
    usage,
    costs: [
      {
        id: 'actual-usd',
        billingDomainId: 'subscription',
        observedAt: '2026-08-27T16:30:00.000Z',
        kind: 'actual',
        amount: 1,
        currency: 'USD',
        authority: 'official-account'
      },
      {
        id: 'estimate-usd',
        billingDomainId: 'subscription',
        observedAt: '2026-08-27T16:30:00.000Z',
        kind: 'reported-estimate',
        amount: 2,
        currency: 'USD',
        authority: 'estimate',
        priceSnapshot: {
          id: 'fixture-price-v1',
          version: '2026-08-01',
          source: 'fixture retail pricing',
          effectiveAt: '2026-08-01T00:00:00.000Z'
        }
      },
      {
        id: 'subscription-eur',
        billingDomainId: 'subscription',
        observedAt: '2026-08-27T16:30:00.000Z',
        kind: 'subscription',
        amount: 10,
        currency: 'EUR',
        authority: 'official-account'
      },
      {
        id: 'unknown-jpy',
        billingDomainId: 'subscription',
        observedAt: '2026-08-27T16:30:00.000Z',
        kind: 'actual',
        amount: null,
        currency: 'JPY',
        authority: 'unavailable'
      }
    ],
    observedAt: '2026-08-28T01:59:00.000Z'
  };
}
