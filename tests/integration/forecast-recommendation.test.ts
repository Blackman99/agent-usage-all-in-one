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

describe('quota forecast and recommendation', () => {
  it('predicts exhaustion from continuous history and recommends the safer agent', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-forecast-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const now = new Date('2026-08-28T02:00:00.000Z');
    for (const [observedAt, used] of [
      ['2026-08-28T00:00:00.000Z', 40],
      ['2026-08-28T01:00:00.000Z', 60],
      ['2026-08-28T02:00:00.000Z', 80]
    ] as const) {
      repository.saveSnapshot(
        quotaSnapshot('alpha', 'Alpha', observedAt, used, '2026-08-28T06:00:00.000Z')
      );
    }
    for (const [observedAt, used] of [
      ['2026-08-28T00:00:00.000Z', 20],
      ['2026-08-28T01:00:00.000Z', 25],
      ['2026-08-28T02:00:00.000Z', 30]
    ] as const) {
      repository.saveSnapshot(
        quotaSnapshot('beta', 'Beta', observedAt, used, '2026-08-28T12:00:00.000Z')
      );
    }

    const overview = repository.getOverview(now);
    expect(overview.providers.find((provider) => provider.id === 'alpha')?.forecasts).toEqual([
      expect.objectContaining({
        billingDomainId: 'subscription',
        bucketId: 'five-hour',
        burnRatePercentPerHour: 20,
        predictedExhaustionAt: '2026-08-28T03:00:00.000Z',
        willLastUntilReset: false,
        confidence: 'high',
        evidence: expect.objectContaining({ samples: 3, continuous: true })
      })
    ]);
    expect(overview.riskSummary.mostConstrained).toMatchObject({
      providerId: 'alpha',
      bucketId: 'five-hour',
      remainingPercent: 20,
      authority: 'official-account',
      observedAt: '2026-08-28T02:00:00.000Z'
    });
    expect(overview.riskSummary.recommendation).toMatchObject({
      providerId: 'beta',
      displayName: 'Beta',
      billingDomainId: 'subscription',
      readOnly: true,
      reasonKeys: ['highest-safe-capacity', 'forecast-lasts-until-reset'],
      evidence: expect.objectContaining({
        authority: 'official-account',
        observedAt: '2026-08-28T02:00:00.000Z'
      })
    });
    repository.close();
  });

  it('withholds forecasts for insufficient, stale, or discontinuous history', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-no-forecast-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(
      quotaSnapshot(
        'insufficient',
        'Insufficient',
        '2026-08-28T01:50:00.000Z',
        50,
        '2026-08-28T06:00:00.000Z'
      )
    );
    for (const [observedAt, used] of [
      ['2026-08-27T20:00:00.000Z', 10],
      ['2026-08-27T21:00:00.000Z', 20],
      ['2026-08-27T22:00:00.000Z', 30]
    ] as const) {
      repository.saveSnapshot(
        quotaSnapshot('stale', 'Stale', observedAt, used, '2026-08-28T06:00:00.000Z')
      );
    }
    for (const [observedAt, used] of [
      ['2026-08-27T18:00:00.000Z', 10],
      ['2026-08-28T01:00:00.000Z', 20],
      ['2026-08-28T02:00:00.000Z', 30]
    ] as const) {
      repository.saveSnapshot(
        quotaSnapshot(
          'discontinuous',
          'Discontinuous',
          observedAt,
          used,
          '2026-08-28T06:00:00.000Z'
        )
      );
    }

    const overview = repository.getOverview(new Date('2026-08-28T02:00:00.000Z'));
    expect(
      overview.providers.map((provider) => ({ id: provider.id, forecasts: provider.forecasts }))
    ).toEqual([
      { id: 'discontinuous', forecasts: [] },
      { id: 'insufficient', forecasts: [] },
      { id: 'stale', forecasts: [] }
    ]);
    expect(overview.riskSummary.recommendation?.providerId).toBe('insufficient');
    repository.close();
  });

  it('keeps forecasts isolated across Grok billing domains', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-domain-forecast-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    for (const [observedAt, used] of [
      ['2026-08-28T00:00:00.000Z', 20],
      ['2026-08-28T01:00:00.000Z', 40],
      ['2026-08-28T02:00:00.000Z', 60]
    ] as const) {
      const snapshot = quotaSnapshot('grok', 'Grok', observedAt, used, '2026-08-28T08:00:00.000Z');
      snapshot.billingDomains = [
        { id: 'grok-build-subscription', displayName: 'Build / SuperGrok' },
        { id: 'xai-api', displayName: 'xAI API' }
      ];
      snapshot.quotaBuckets[0].billingDomainId = 'grok-build-subscription';
      snapshot.quotaBuckets.push({
        ...snapshot.quotaBuckets[0],
        id: 'monthly-spend',
        billingDomainId: 'xai-api',
        label: 'Monthly spend',
        usedPercent: 10
      });
      repository.saveSnapshot(snapshot);
    }
    repository.saveSnapshot({
      provider: { id: 'grok', displayName: 'Grok' },
      billingDomains: [{ id: 'xai-api', displayName: 'xAI API' }],
      quotaBuckets: [],
      usage: [],
      costs: [],
      observedAt: '2026-08-28T02:05:00.000Z'
    });

    const overview = repository.getOverview(new Date('2026-08-28T02:05:00.000Z'));
    const grok = overview.providers[0];
    expect(grok.forecasts).toHaveLength(1);
    expect(grok.forecasts[0].billingDomainId).toBe('grok-build-subscription');
    expect(grok.billingDomains.find((domain) => domain.id === 'xai-api')?.forecasts).toEqual([]);
    expect(overview.riskSummary.mostConstrained).toMatchObject({
      billingDomainId: 'grok-build-subscription',
      observedAt: '2026-08-28T02:00:00.000Z'
    });
    repository.close();
  });

  it('uses only post-reset samples and breaks equal recommendation scores deterministically', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-reset-forecast-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    for (const provider of [
      ['alpha-tie', 'Alpha tie'],
      ['beta-tie', 'Beta tie']
    ] as const) {
      for (const [observedAt, used] of [
        ['2026-08-28T00:00:00.000Z', 80],
        ['2026-08-28T01:00:00.000Z', 10],
        ['2026-08-28T01:30:00.000Z', 20],
        ['2026-08-28T02:00:00.000Z', 30]
      ] as const) {
        repository.saveSnapshot(
          quotaSnapshot(provider[0], provider[1], observedAt, used, '2026-08-28T06:00:00.000Z')
        );
      }
    }

    const overview = repository.getOverview(new Date('2026-08-28T02:00:00.000Z'));
    expect(overview.providers[0].forecasts[0]).toMatchObject({
      burnRatePercentPerHour: 20,
      predictedExhaustionAt: '2026-08-28T05:30:00.000Z',
      evidence: { windowStart: '2026-08-28T01:00:00.000Z', samples: 3 }
    });
    expect(overview.riskSummary.recommendation?.providerId).toBe('alpha-tie');
    repository.close();
  });
});

function quotaSnapshot(
  id: string,
  displayName: string,
  observedAt: string,
  usedPercent: number,
  resetsAt: string
): ConnectorSnapshot {
  return {
    provider: { id, displayName },
    billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
    quotaBuckets: [
      {
        id: 'five-hour',
        billingDomainId: 'subscription',
        label: '5 hour',
        usedPercent,
        resetsAt,
        authority: 'official-account'
      }
    ],
    usage: [],
    costs: [],
    observedAt
  };
}
