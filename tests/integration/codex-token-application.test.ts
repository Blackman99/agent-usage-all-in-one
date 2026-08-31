import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CodexConnector } from '../../src/connectors/codex/codex-connector.js';
import { UsageApplication } from '$core/usage-application.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('Codex token application path', () => {
  it('keeps daily account totals unclassified and respects the half-open rolling window', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-codex-token-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveConnectorStatus({
      id: 'codex',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/codex',
      officialCredentialPresent: true,
      errorCode: null,
      lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
      secretReference: null
    });
    const connector = new CodexConnector(
      {
        async readAccount() {
          return {
            rateLimits: {
              rateLimits: {
                limitId: 'codex',
                limitName: 'Codex',
                primary: null,
                secondary: null
              },
              rateLimitsByLimitId: null
            },
            tokenUsage: {
              summary: {
                lifetimeTokens: 1_500,
                peakDailyTokens: 1_000,
                longestRunningTurnSec: null,
                currentStreakDays: 2,
                longestStreakDays: 2
              },
              dailyUsageBuckets: [
                { startDate: '2026-08-27', tokens: 1_000 },
                { startDate: '2026-08-28', tokens: 500 }
              ]
            }
          };
        }
      },
      // Reading as 2026-08-28 closes settles that bucket and puts its start on the inclusive edge
      // of the 24h window, while the previous day sits just outside it.
      () => new Date('2026-08-29T00:00:00.000Z')
    );
    const application = new UsageApplication({
      repository,
      connectors: [connector],
      clock: () => new Date('2026-08-29T00:00:00.000Z')
    });

    await application.refresh({ userInitiated: true });
    await application.refresh({ userInitiated: true });

    const oneDay = (await application.getOverview({ window: '24h' })).providers[0].billingDomains[0]
      .history;
    expect(oneDay.tokenTotals).toMatchObject({
      total: 500,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0
    });
    expect(oneDay.tokenEvidence).toMatchObject({
      recordedTokens: 500,
      sourceReportedTokens: 500,
      observationCount: 1,
      unclassifiedTokens: 500,
      classifiedTokens: 0,
      classificationCoverage: 0,
      totalDerivations: ['source-reported'],
      timePrecisions: ['day'],
      usageScopes: ['account-wide']
    });
    expect(oneDay.models).toEqual([]);
    expect(oneDay.costs).toEqual([]);
    const exported = JSON.parse(
      (await application.exportUsage({ format: 'json', window: '24h', timeZone: 'UTC' })).body
    ) as { rows: Array<Record<string, unknown>> };
    expect(exported.rows[0]).toMatchObject({
      recordType: 'tokens',
      recordedTokens: 500,
      unclassifiedTokens: 500,
      timePrecisions: ['day'],
      usageScopes: ['account-wide'],
      amount: null
    });

    const sevenDays = (await application.getOverview({ window: '7d' })).providers[0]
      .billingDomains[0].history;
    expect(sevenDays.tokenTotals.total).toBe(1_500);
    expect(sevenDays.tokenEvidence.observationCount).toBe(2);
    repository.close();
  });
});
