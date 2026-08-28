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
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('global usage summary', () => {
  it('reconciles selected-window domain totals without merging Grok billing domains', async () => {
    const repository = await fixture();

    const sevenDay = repository.getOverview(NOW, { window: '7d' }).globalSummary;
    expect(sevenDay).toMatchObject({
      window: '7d',
      recordedTokens: 625,
      latestObservedAt: '2026-08-28T01:00:00.000Z',
      generatedAt: NOW.toISOString(),
      tokenEvidence: {
        recordedTokens: 625,
        observationCount: 2,
        classifiedTokens: 525,
        unclassifiedTokens: 100,
        classificationCoverage: 0.84,
        timePrecisions: ['day', 'event']
      },
      apiRetailEquivalent: {
        status: 'unavailable',
        amount: null,
        currency: 'USD',
        pricingCoverage: 0
      },
      mostConstrained: {
        providerId: 'grok',
        billingDomainId: 'grok-build-subscription',
        label: 'Weekly limit',
        remainingPercent: 20
      }
    });
    expect(sevenDay.contributions).toEqual([
      expect.objectContaining({
        providerId: 'codex',
        billingDomainId: 'subscription',
        recordedTokens: 100
      }),
      expect.objectContaining({
        providerId: 'grok',
        billingDomainId: 'grok-build-subscription',
        recordedTokens: 525
      })
    ]);

    const thirtyDayOverview = repository.getOverview(NOW, { window: '30d' });
    const thirtyDay = thirtyDayOverview.globalSummary;
    expect(thirtyDay.recordedTokens).toBe(625);
    expect(thirtyDay.mostConstrained).toMatchObject({
      bucketId: 'grok:week',
      resetsAt: '2026-09-01T00:00:00.000Z'
    });
    expect(thirtyDay.mostConstrained).toEqual(sevenDay.mostConstrained);
    expect(
      thirtyDay.contributions
        .filter((contribution) => contribution.providerId === 'grok')
        .map((contribution) => [contribution.billingDomainId, contribution.recordedTokens])
    ).toEqual([['grok-build-subscription', 525]]);
    expect(
      thirtyDayOverview.providers
        .find((provider) => provider.id === 'grok')
        ?.billingDomains.find((domain) => domain.id === 'xai-api')?.history.tokenTotals.total
    ).toBe(1_742);
    expect(
      thirtyDay.contributions.some((contribution) => contribution.billingDomainId === 'combined')
    ).toBe(false);
    repository.close();
  });

  it('reports unavailable instead of zero when the selected window has no observations', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-empty-summary-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(xaiSnapshot());

    expect(repository.getOverview(NOW, { window: '24h' }).globalSummary).toMatchObject({
      window: '24h',
      recordedTokens: null,
      latestObservedAt: null,
      tokenEvidence: {
        recordedTokens: 0,
        observationCount: 0,
        classificationCoverage: null,
        timePrecisions: []
      },
      contributions: []
    });
    repository.close();
  });
});

async function fixture(): Promise<SqliteUsageRepository> {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-global-summary-'));
  workspaces.push(workspace);
  const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
  repository.saveSnapshot({
    provider: { id: 'codex', displayName: 'Codex' },
    billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
    quotaBuckets: [
      {
        id: 'codex:week',
        billingDomainId: 'subscription',
        label: 'Week',
        usedPercent: 40,
        resetsAt: '2026-09-01T00:00:00.000Z',
        observedAt: '2026-08-28T00:00:00.000Z',
        authority: 'official-account'
      }
    ],
    usage: [
      {
        id: 'codex-day',
        billingDomainId: 'subscription',
        model: null,
        observedAt: '2026-08-27T00:00:00.000Z',
        sourceReportedTotalTokens: 100,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        modelAttribution: 'unclassified',
        timePrecision: 'day',
        usageScope: 'account-wide',
        authority: 'official-account'
      }
    ],
    costs: [],
    observedAt: '2026-08-28T00:00:00.000Z'
  });
  repository.saveSnapshot({
    provider: { id: 'grok', displayName: 'Grok' },
    billingDomains: [{ id: 'grok-build-subscription', displayName: 'Build / SuperGrok' }],
    quotaBuckets: [
      {
        id: 'grok:week',
        billingDomainId: 'grok-build-subscription',
        label: 'Weekly limit',
        usedPercent: 80,
        resetsAt: '2026-09-01T00:00:00.000Z',
        observedAt: '2026-08-28T01:00:00.000Z',
        authority: 'official-client'
      }
    ],
    usage: [
      {
        id: 'grok-event',
        billingDomainId: 'grok-build-subscription',
        model: 'grok-build',
        observedAt: '2026-08-28T01:00:00.000Z',
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
      }
    ],
    costs: [],
    observedAt: '2026-08-28T01:00:00.000Z'
  });
  repository.saveSnapshot(xaiSnapshot());
  return repository;
}

function xaiSnapshot(): ConnectorSnapshot {
  return {
    provider: { id: 'grok', displayName: 'Grok' },
    billingDomains: [{ id: 'xai-api', displayName: 'xAI API' }],
    quotaBuckets: [],
    usage: [
      {
        id: 'xai-invoice',
        billingDomainId: 'xai-api',
        model: 'grok-4.6',
        observedAt: '2026-08-01T00:00:00.000Z',
        inputTokens: 908,
        outputTokens: 534,
        reasoningTokens: 42,
        cacheReadTokens: 300,
        cacheWriteTokens: 0,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        modelAttribution: 'known',
        timePrecision: 'billing-period',
        usageScope: 'account-wide',
        aggregationTemporality: 'delta',
        authority: 'official-account'
      }
    ],
    costs: [],
    observedAt: '2026-08-28T01:00:00.000Z'
  };
}
