import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OFFICIAL_PRICING_CATALOG, type RetailPriceCatalog } from '$core/retail-pricing.js';
import { UsageApplication } from '$core/usage-application.js';
import type { ConnectorSnapshot, UsageObservation } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const NOW = new Date('2026-08-28T12:00:00.000Z');
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true }))
  );
});

describe('retained retail-equivalent backfill', () => {
  it('backfills by observation-time price once and preserves the recorded snapshot on restart', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-price-backfill-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');
    const seed = new SqliteUsageRepository(databasePath);
    seed.saveSnapshot(
      snapshot([
        usage('before-release', '2026-08-11T23:59:59.999Z'),
        usage('at-release', '2026-08-12T00:00:00.000Z')
      ])
    );
    seed.close();

    const first = new SqliteUsageRepository(databasePath);
    const firstApplication = application(first);
    expect(await retailHistory(firstApplication)).toEqual(
      expect.objectContaining({
        kind: 'retail-equivalent',
        amount: 0.325,
        pricingEvidence: {
          pricedTokens: 130_000,
          unpricedTokens: 130_000,
          recordedTokens: 260_000,
          pricingCoverage: 0.5
        },
        priceSnapshots: [
          expect.objectContaining({
            id: 'xai-grok-4.6-short-2026-08-12',
            version: 'xai-2026-08-12',
            contextTier: 'prompt-at-or-below-200k'
          })
        ]
      })
    );
    first.close();

    const restarted = new SqliteUsageRepository(databasePath);
    const restartedApplication = application(restarted);
    expect(await retailHistory(restartedApplication)).toMatchObject({ amount: 0.325 });
    restarted.close();

    const changed = structuredClone(OFFICIAL_PRICING_CATALOG) as RetailPriceCatalog;
    const short = changed.entries.find((entry) => entry.id === 'xai-grok-4.6-short-2026-08-12');
    if (!short) throw new Error('Expected xAI short-context catalog entry');
    short.ratesPerMillion.input = 200;
    const immutable = new SqliteUsageRepository(databasePath);
    const immutableApplication = application(immutable, changed);
    expect(await retailHistory(immutableApplication)).toMatchObject({
      amount: 0.325,
      priceSnapshots: [expect.objectContaining({ version: 'xai-2026-08-12' })]
    });
    immutable.close();
  });

  it('persists Claude cache-write TTL evidence for restart backfill and immutable price snapshots', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-claude-ttl-backfill-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');
    const seed = new SqliteUsageRepository(databasePath);
    seed.saveSnapshot(claudeSnapshot());
    expect(seed.getRetailPricingBackfillSnapshots()[0].usage[0]).toMatchObject({
      cacheWriteTokens: 30_000,
      cacheWriteTokenBreakdown: { fiveMinute: 10_000, oneHour: 20_000 }
    });
    seed.close();

    const restarted = new SqliteUsageRepository(databasePath);
    const restartedApplication = application(restarted);
    await restartedApplication.startBackgroundProcessing();
    const provider = (await restartedApplication.getOverview({ window: '30d', timeZone: 'UTC' }))
      .providers[0];
    const cost = provider.billingDomains[0].history.costs.find(
      (candidate) => candidate.kind === 'retail-equivalent'
    );
    expect(cost).toMatchObject({
      amount: 0.507,
      priceSnapshots: [
        expect.objectContaining({
          cacheWriteRatesPerMillion: { fiveMinute: 2.5, oneHour: 4 }
        })
      ]
    });
    restarted.close();
  });
});

function application(
  repository: SqliteUsageRepository,
  priceCatalog: RetailPriceCatalog = OFFICIAL_PRICING_CATALOG
): UsageApplication {
  return new UsageApplication({ repository, connectors: [], clock: () => NOW, priceCatalog });
}

async function retailHistory(application: UsageApplication) {
  await application.startBackgroundProcessing();
  const domain = (await application.getOverview({ window: '30d', timeZone: 'UTC' })).providers[0]
    .billingDomains[0];
  return domain.history.costs.find((cost) => cost.kind === 'retail-equivalent');
}

function usage(id: string, observedAt: string): UsageObservation {
  return {
    id,
    billingDomainId: 'xai-api',
    model: 'grok-4.6',
    observedAt,
    inputTokens: 100_000,
    outputTokens: 20_000,
    reasoningTokens: 5_000,
    cacheReadTokens: 10_000,
    cacheWriteTokens: 0,
    tokenSemantics: {
      reasoning: 'included-in-output',
      cacheRead: 'separate',
      cacheWrite: 'separate'
    },
    modelAttribution: 'known',
    timePrecision: 'event',
    usageScope: 'account-wide',
    aggregationTemporality: 'delta',
    authority: 'official-account'
  };
}

function snapshot(usageObservations: UsageObservation[]): ConnectorSnapshot {
  return {
    provider: { id: 'grok', displayName: 'Grok' },
    billingDomains: [{ id: 'xai-api', displayName: 'xAI API' }],
    quotaBuckets: [],
    usage: usageObservations,
    costs: [],
    observedAt: NOW.toISOString()
  };
}

function claudeSnapshot(): ConnectorSnapshot {
  return {
    provider: { id: 'claude-code', displayName: 'Claude Code' },
    billingDomains: [{ id: 'subscription', displayName: 'Claude subscription' }],
    quotaBuckets: [],
    usage: [
      {
        id: 'claude-cache-write',
        billingDomainId: 'subscription',
        model: 'claude-sonnet-5',
        observedAt: '2026-08-28T01:00:00.000Z',
        inputTokens: 100_000,
        outputTokens: 20_000,
        reasoningTokens: 0,
        cacheReadTokens: 10_000,
        cacheWriteTokens: 30_000,
        cacheWriteTokenBreakdown: { fiveMinute: 10_000, oneHour: 20_000 },
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
    observedAt: NOW.toISOString()
  };
}
