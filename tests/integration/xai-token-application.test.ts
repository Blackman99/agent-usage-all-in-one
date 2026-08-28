import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { XaiApiConnector } from '../../src/connectors/xai-api/xai-api-connector.js';
import { UsageApplication } from '$core/usage-application.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const NOW = new Date('2026-08-28T02:00:00.000Z');
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('xAI token application path', () => {
  it('keeps invoice tokens isolated, windowed, and idempotent across refresh and restart', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-xai-token-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');
    const firstRepository = new SqliteUsageRepository(databasePath);
    connectXai(firstRepository);
    const firstApplication = application(firstRepository);

    await firstApplication.refresh({ userInitiated: true });
    await firstApplication.refresh({ userInitiated: true });
    expect(await firstApplication.getRetentionStatus()).toMatchObject({ rawObservations: 1 });
    firstRepository.close();

    const restartedRepository = new SqliteUsageRepository(databasePath);
    const restarted = application(restartedRepository);
    await restarted.refresh({ userInitiated: true });

    const oneDay = (await restarted.getOverview({ window: '24h' })).providers[0];
    const oneDayDomain = oneDay.billingDomains[0];
    expect(oneDay.id).toBe('grok');
    expect(oneDay.billingDomains.map((domain) => domain.id)).toEqual(['xai-api']);
    expect(oneDay.coverage).toMatchObject({
      tokens: 'partial',
      actualCost: 'complete',
      history: 'partial'
    });
    expect(oneDay.tokenTotals).toMatchObject({ total: 1_742, reasoning: 42 });
    expect(oneDayDomain.history.tokenTotals.total).toBe(0);
    expect(oneDayDomain.history.models).toEqual([]);
    expect(oneDayDomain.history.days).toEqual([
      expect.objectContaining({
        day: '2026-08-28',
        tokenTotals: expect.objectContaining({ total: 0 })
      })
    ]);
    expect(oneDayDomain.history.costs).toEqual([
      expect.objectContaining({ kind: 'actual', currency: 'USD', amount: 2.5 })
    ]);

    const thirtyDays = (await restarted.getOverview({ window: '30d' })).providers[0];
    const xai = thirtyDays.billingDomains[0];
    expect(xai.tokenTotals).toMatchObject({
      total: 1_742,
      input: 908,
      output: 534,
      reasoning: 42,
      cacheRead: 300,
      cacheWrite: 0
    });
    expect(xai.tokenEvidence).toMatchObject({
      recordedTokens: 1_742,
      unclassifiedTokens: 0,
      totalDerivations: ['categorized'],
      timePrecisions: ['billing-period'],
      usageScopes: ['account-wide'],
      aggregationTemporalities: ['delta']
    });
    expect(xai.history.models).toEqual([
      expect.objectContaining({
        model: 'grok-4.6',
        tokenTotals: expect.objectContaining({ total: 1_742 })
      })
    ]);
    expect(xai.costs).toEqual([
      expect.objectContaining({
        billingDomainId: 'xai-api',
        kind: 'actual',
        amount: 2.5,
        model: 'grok-4.6',
        sourceId: 'team-123:Chat grok-4.6:2026-08-28T00:00:00.000Z'
      })
    ]);
    expect(xai.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ billingDomainId: 'xai-api', kind: 'prepaid', amount: 45 }),
        expect.objectContaining({
          billingDomainId: 'xai-api',
          kind: 'spending-limit',
          amount: 200
        }),
        expect.objectContaining({ billingDomainId: 'xai-api', kind: 'current-invoice', amount: 25 })
      ])
    );
    expect(xai.invoices).toEqual([
      expect.objectContaining({ billingDomainId: 'xai-api', id: 'invoice-1', amount: 25 })
    ]);

    const exported = JSON.parse(
      (await restarted.exportUsage({ format: 'json', window: '30d', timeZone: 'UTC' })).body
    ) as { rows: Array<Record<string, unknown>> };
    expect(exported.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: 'tokens',
          billingDomain: 'xAI API',
          totalTokens: 1_742,
          timePrecisions: ['billing-period'],
          usageScopes: ['account-wide'],
          aggregationTemporalities: ['delta']
        }),
        expect.objectContaining({
          recordType: 'cost',
          billingDomain: 'xAI API',
          costKind: 'actual',
          amount: 2.5,
          currency: 'USD'
        })
      ])
    );
    expect(await restarted.compactRetention()).toMatchObject({
      rawObservations: 1,
      dailyAggregates: 0
    });
    restartedRepository.close();
  });
});

function application(repository: SqliteUsageRepository): UsageApplication {
  return new UsageApplication({
    repository,
    connectors: [new XaiApiConnector({ accountClient: fixtureAccountClient(), clock: () => NOW })],
    clock: () => NOW
  });
}

function connectXai(repository: SqliteUsageRepository): void {
  repository.saveConnectorStatus({
    id: 'xai-api',
    state: 'connected',
    installed: true,
    binaryPath: null,
    officialCredentialPresent: true,
    errorCode: null,
    lastDiscoveredAt: NOW.toISOString(),
    secretReference: 'connector:xai-api'
  });
}

function fixtureAccountClient() {
  return {
    async readAccount() {
      return {
        teamId: 'team-123',
        usage: {
          timeSeries: [
            {
              group: ['Chat grok-4.6'],
              groupLabels: ['Chat grok-4.6'],
              dataPoints: [{ timestamp: '2026-08-28T00:00:00.000Z', values: [2.5] }]
            }
          ],
          limitReached: false
        },
        balanceCents: -4_500,
        spendingLimitCents: 20_000,
        currentInvoiceCents: 2_500,
        invoices: [
          {
            teamId: 'team-123',
            invoiceId: 'invoice-1',
            invoiceNumber: 'INV-001',
            createTime: '2026-08-01T00:00:00.000Z',
            invoiceStatus: 'PAID',
            subtotal: 2_500,
            tax: 0,
            total: 2_500,
            lines: [
              { description: 'Chat grok-4.6', unitType: 'Prompt text tokens', numUnits: 908 },
              { description: 'Chat grok-4.6', unitType: 'Completion text tokens', numUnits: 534 },
              {
                description: 'Chat grok-4.6',
                unitType: 'Cached prompt text tokens',
                numUnits: 300
              },
              { description: 'Chat grok-4.6', unitType: 'Reasoning tokens', numUnits: 42 }
            ]
          }
        ],
        warnings: []
      };
    }
  };
}
