import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorSnapshot, CostRecord, UsageObservation } from '$core/types.js';
import { UsageApplication } from '$core/usage-application.js';
import { defaultConnectorDefinitions } from '../../src/connectors/catalog.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const NOW = new Date('2026-08-28T02:00:00.000Z');
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('subscription plan value', () => {
  it('compares a declared plan price with the retail equivalent of the same window', async () => {
    const repository = await fixture();
    repository.savePlanSubscription({
      providerId: 'claude-code',
      billingDomainId: 'subscription',
      planId: 'claude-max-20x',
      displayName: 'Claude Max 20x',
      amount: 200,
      currency: 'USD',
      billingPeriod: 'monthly',
      anchorDate: null,
      priceSource: 'catalog-preset',
      updatedAt: '2026-08-01T00:00:00.000Z'
    });

    const planValue = repository.getOverview(NOW, {
      window: '24h',
      timeZone: 'UTC',
      comparisonCurrency: 'USD'
    }).workbench.planValue;

    const dailyPlanCost = 200 / (365.25 / 12);
    expect(planValue.windowDays).toBeCloseTo(1, 6);
    expect(planValue.entries).toHaveLength(1);
    expect(planValue.entries[0]).toMatchObject({
      providerId: 'claude-code',
      billingDomainId: 'subscription',
      ratioBound: 'exact',
      status: 'available',
      plan: expect.objectContaining({
        displayName: 'Claude Max 20x',
        priceSource: 'catalog-preset'
      })
    });
    expect(planValue.entries[0].windowPlanCost.amount).toBeCloseTo(dailyPlanCost, 6);
    expect(planValue.entries[0].valueRatio).toBeCloseTo(24 / dailyPlanCost, 6);
    expect(planValue.entries[0].recordedTokens).toBe(1_000_000);

    // A subscription price is a declaration, never a cost record: no workbench
    // money metric moves because a plan was declared.
    const workbench = repository.getOverview(NOW, {
      window: '24h',
      comparisonCurrency: 'USD'
    }).workbench;
    expect(workbench.costs.actual.records).toBe(0);
    expect(workbench.costs.retailEquivalent.amount).toBeCloseTo(24, 6);
    expect(workbench.recordedTokens).toBe(1_000_000);

    repository.close();
  });

  it('measures each subscription over its own billing period, not the shared window', async () => {
    const repository = await fixture();
    // Claude sits late in its cycle, Codex has just renewed. Both are read over
    // the same 24-hour rolling window.
    repository.saveSnapshot(
      snapshot(
        'codex',
        'Codex',
        'subscription',
        'Codex subscription',
        [usage('codex-usage', 'subscription', '2026-08-27T12:00:00.000Z', 'gpt-5.6-sol')],
        [
          {
            ...cost(
              'codex-retail',
              'subscription',
              '2026-08-27T12:00:00.000Z',
              'retail-equivalent',
              6
            ),
            authority: 'estimate',
            usageObservationId: 'codex-usage',
            pricedTokens: 1_000_000
          }
        ]
      )
    );
    // Earlier Claude usage sits inside the Claude cycle but outside the window.
    repository.saveSnapshot(
      snapshot(
        'claude-code',
        'Claude Code',
        'subscription',
        'Claude subscription',
        [usage('claude-early', 'subscription', '2026-08-14T09:00:00.000Z', 'claude-opus-5')],
        [
          {
            ...cost(
              'claude-early-retail',
              'subscription',
              '2026-08-14T09:00:00.000Z',
              'retail-equivalent',
              96
            ),
            authority: 'estimate',
            usageObservationId: 'claude-early',
            pricedTokens: 1_000_000
          }
        ]
      )
    );
    for (const [providerId, anchorDate, amount] of [
      ['claude-code', '2026-08-02', 200],
      ['codex', '2026-08-26', 20]
    ] as const) {
      repository.savePlanSubscription({
        providerId,
        billingDomainId: 'subscription',
        planId: null,
        displayName: '',
        amount,
        currency: 'USD',
        billingPeriod: 'monthly',
        anchorDate,
        priceSource: 'user-entered',
        updatedAt: '2026-08-01T00:00:00.000Z'
      });
    }

    const planValue = repository.getOverview(NOW, {
      window: '24h',
      timeZone: 'UTC',
      comparisonCurrency: 'USD'
    }).workbench.planValue;
    const byProvider = new Map(planValue.entries.map((entry) => [entry.providerId, entry]));

    const claude = byProvider.get('claude-code')!;
    expect(claude.billingPeriod).toMatchObject({
      start: '2026-08-02T00:00:00.000Z',
      end: '2026-09-02T00:00:00.000Z'
    });
    expect(claude.billingPeriod?.totalDays).toBeCloseTo(31, 6);
    expect(claude.billingPeriod?.elapsedDays).toBeCloseTo(26 + 2 / 24, 6);
    // The cycle reaches usage the 24-hour window cannot see.
    expect(claude.billingPeriod?.retailEquivalent.amount).toBeCloseTo(120, 6);
    expect(claude.retailEquivalent.amount).toBeCloseTo(24, 6);
    expect(claude.billingPeriod?.breakEvenRatio).toBeCloseTo(120 / 200, 6);

    const codex = byProvider.get('codex')!;
    expect(codex.billingPeriod).toMatchObject({
      start: '2026-08-26T00:00:00.000Z',
      end: '2026-09-26T00:00:00.000Z'
    });
    expect(codex.billingPeriod?.elapsedDays).toBeCloseTo(2 + 2 / 24, 6);
    expect(codex.billingPeriod?.breakEvenRatio).toBeCloseTo(6 / 20, 6);
    // Two subscriptions, two different cycle positions, both readable.
    expect(claude.billingPeriod!.progress).toBeGreaterThan(codex.billingPeriod!.progress);

    repository.close();
  });

  it('keeps metered billing domains out of the map and lists undeclared domains separately', async () => {
    const repository = await fixture();
    repository.saveSnapshot(
      snapshot(
        'grok',
        'Grok',
        'xai-api',
        'xAI API',
        [usage('xai-usage', 'xai-api', '2026-08-28T01:10:00.000Z', 'grok-4.6')],
        [cost('xai-actual', 'xai-api', '2026-08-28T01:10:00.000Z', 'actual', 0.3)]
      )
    );

    const planValue = repository.getOverview(NOW, { window: '24h', comparisonCurrency: 'USD' })
      .workbench.planValue;

    expect(planValue.entries).toHaveLength(0);
    expect(planValue.meteredDomains.map((entry) => entry.billingDomainId)).toEqual(['xai-api']);
    expect(planValue.meteredDomains[0].actualCost.amount).toBeCloseTo(0.3, 6);
    expect(planValue.unconfiguredDomains.map((entry) => entry.providerId)).toEqual(['claude-code']);

    repository.close();
  });

  it('upgrades a plan table written before billing periods without losing its rows', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-plan-migration-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');

    const before = new SqliteUsageRepository(databasePath);
    before.savePlanSubscription({
      providerId: 'codex',
      billingDomainId: 'subscription',
      planId: 'chatgpt-plus',
      displayName: 'ChatGPT Plus',
      amount: 20,
      currency: 'USD',
      billingPeriod: 'monthly',
      anchorDate: null,
      priceSource: 'catalog-preset',
      updatedAt: '2026-08-01T00:00:00.000Z'
    });
    before.close();

    // Reproduce the pre-billing-period schema on disk.
    const stripped = new SqliteUsageRepository(databasePath);
    stripped.close();
    const { DatabaseSync } = createRequire(import.meta.url)(
      'node:sqlite'
    ) as typeof import('node:sqlite');
    const raw = new DatabaseSync(databasePath);
    raw.exec(`
      CREATE TABLE plan_subscriptions_old (
        provider_id TEXT NOT NULL,
        billing_domain_id TEXT NOT NULL,
        plan_id TEXT,
        display_name TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        billing_period TEXT NOT NULL,
        price_source TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, billing_domain_id)
      );
      INSERT INTO plan_subscriptions_old
        SELECT provider_id, billing_domain_id, plan_id, display_name, amount, currency,
               billing_period, price_source, updated_at
        FROM plan_subscriptions;
      DROP TABLE plan_subscriptions;
      ALTER TABLE plan_subscriptions_old RENAME TO plan_subscriptions;
    `);
    raw.close();

    const upgraded = new SqliteUsageRepository(databasePath);
    expect(upgraded.getPlanSubscriptions()).toEqual([
      expect.objectContaining({ providerId: 'codex', amount: 20, anchorDate: null })
    ]);
    upgraded.savePlanSubscription({
      providerId: 'codex',
      billingDomainId: 'subscription',
      planId: 'chatgpt-plus',
      displayName: 'ChatGPT Plus',
      amount: 20,
      currency: 'USD',
      billingPeriod: 'monthly',
      anchorDate: '2026-08-26',
      priceSource: 'catalog-preset',
      updatedAt: '2026-08-28T00:00:00.000Z'
    });
    expect(upgraded.getPlanSubscriptions()[0].anchorDate).toBe('2026-08-26');
    upgraded.close();
  });

  it('resolves presets, records overrides as user-entered, and clears a plan', async () => {
    const repository = await fixture();
    const application = new UsageApplication({
      repository,
      connectors: [],
      connectorDefinitions: defaultConnectorDefinitions,
      clock: () => NOW
    });

    const initial = await application.getPlanSettings();
    expect(initial.subscriptions).toEqual([]);
    expect(initial.domains.map((domain) => domain.billingDomainId)).not.toContain('xai-api');
    expect(
      initial.domains.find((domain) => domain.providerId === 'claude-code')?.presets.length
    ).toBeGreaterThan(0);

    const preset = await application.updatePlanSubscription({
      providerId: 'claude-code',
      billingDomainId: 'subscription',
      plan: { planId: 'claude-max-5x' }
    });
    expect(preset.subscriptions[0]).toMatchObject({
      planId: 'claude-max-5x',
      displayName: 'Claude Max 5x',
      amount: 100,
      currency: 'USD',
      billingPeriod: 'monthly',
      priceSource: 'catalog-preset'
    });

    const overridden = await application.updatePlanSubscription({
      providerId: 'claude-code',
      billingDomainId: 'subscription',
      plan: { planId: 'claude-max-5x', amount: 720, currency: 'CNY' }
    });
    expect(overridden.subscriptions[0]).toMatchObject({
      planId: 'claude-max-5x',
      amount: 720,
      currency: 'CNY',
      priceSource: 'user-entered'
    });

    const custom = await application.updatePlanSubscription({
      providerId: 'grok',
      billingDomainId: 'grok-build-subscription',
      plan: { planId: null, amount: 30, currency: 'usd', billingPeriod: 'monthly' }
    });
    expect(custom.subscriptions).toHaveLength(2);
    expect(
      custom.subscriptions.find((subscription) => subscription.providerId === 'grok')
    ).toMatchObject({ planId: null, amount: 30, currency: 'USD', priceSource: 'user-entered' });

    await expect(
      application.updatePlanSubscription({
        providerId: 'grok',
        billingDomainId: 'xai-api',
        plan: { planId: null, amount: 10 }
      })
    ).rejects.toThrow(/Unknown subscription billing domain/);
    await expect(
      application.updatePlanSubscription({
        providerId: 'claude-code',
        billingDomainId: 'subscription',
        plan: { planId: null, amount: 0 }
      })
    ).rejects.toThrow(/positive amount/);
    await expect(
      application.updatePlanSubscription({
        providerId: 'claude-code',
        billingDomainId: 'subscription',
        plan: { planId: 'opencode-go-monthly' }
      })
    ).rejects.toThrow(/another billing domain/);

    const cleared = await application.updatePlanSubscription({
      providerId: 'claude-code',
      billingDomainId: 'subscription',
      plan: null
    });
    expect(cleared.subscriptions.map((subscription) => subscription.providerId)).toEqual(['grok']);

    repository.close();
  });
});

async function fixture(): Promise<SqliteUsageRepository> {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-plan-value-'));
  workspaces.push(workspace);
  const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
  repository.saveSnapshot(
    snapshot(
      'claude-code',
      'Claude Code',
      'subscription',
      'Claude subscription',
      [usage('claude-usage', 'subscription', '2026-08-28T01:00:00.000Z', 'claude-opus-5')],
      [
        {
          ...cost(
            'claude-retail',
            'subscription',
            '2026-08-28T01:00:00.000Z',
            'retail-equivalent',
            24
          ),
          authority: 'estimate',
          usageObservationId: 'claude-usage',
          pricedTokens: 1_000_000
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
  model: string
): UsageObservation {
  return {
    id,
    billingDomainId,
    model,
    observedAt,
    inputTokens: 800_000,
    outputTokens: 200_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelAttribution: 'known',
    timePrecision: 'event',
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
