import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OpenCodeLocalConnector } from '../../src/connectors/opencode-local/opencode-local-connector.js';
import { OpenCodeGoConnector } from '../../src/connectors/opencode-go/opencode-go-connector.js';
import type { RetailPriceCatalog } from '$core/retail-pricing.js';
import type { UsageOverview } from '$core/types.js';
import { UsageApplication } from '$core/usage-application.js';
import { startLocalServer, type LocalServer } from '$server/local-server.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];
const servers: LocalServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true }))
  );
});

describe('OpenCode Go application path', () => {
  it('keeps Go quota and idempotent OpenCode local history separate through the HTTP API', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'opencode-go-application-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveConnectorStatus({
      id: 'opencode-go',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/opencode',
      officialCredentialPresent: true,
      errorCode: null,
      lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
      secretReference: null
    });
    const localHistoryClient = {
      async readHistory() {
        return [
          {
            id: '2026-08-28:opencode-go/deepseek-v4-flash',
            providerId: 'opencode-go',
            model: 'opencode-go/deepseek-v4-flash',
            cost: 0.42,
            inputTokens: 700,
            outputTokens: 250,
            reasoningTokens: 50,
            cacheReadTokens: 200,
            cacheWriteTokens: 0,
            observedAtMs: Date.parse('2026-08-28T00:00:00.000Z')
          },
          {
            id: '2026-08-28:anthropic/claude-sonnet-4',
            providerId: 'anthropic',
            model: 'anthropic/claude-sonnet-4',
            cost: null,
            inputTokens: 300,
            outputTokens: 100,
            reasoningTokens: 0,
            cacheReadTokens: 100,
            cacheWriteTokens: 0,
            observedAtMs: Date.parse('2026-08-28T01:00:00.000Z')
          }
        ];
      }
    };
    const connector = new OpenCodeGoConnector({
      accountClient: {
        async readUsage() {
          return {
            usage: {
              rolling: {
                status: 'ok',
                percent: 25,
                resetsAt: '2026-08-28T05:00:00.000Z'
              },
              weekly: {
                status: 'ok',
                percent: 40,
                resetsAt: '2026-09-01T00:00:00.000Z'
              },
              monthly: {
                status: 'ok',
                percent: 50,
                resetsAt: '2026-09-28T00:00:00.000Z'
              }
            }
          };
        }
      },
      localHistoryClient,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    const localConnector = new OpenCodeLocalConnector({
      localHistoryClient,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    const application = new UsageApplication({
      repository,
      connectors: [connector, localConnector],
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    const server = await startLocalServer({ application, apiToken: 'test-token' });
    servers.push(server);

    for (let index = 0; index < 2; index += 1) {
      const refresh = await fetch(`${server.origin}/api/refresh`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' }
      });
      expect(refresh.status).toBe(204);
    }
    const response = await fetch(`${server.origin}/api/overview`, {
      headers: { authorization: 'Bearer test-token' }
    });
    const overview = (await response.json()) as UsageOverview;
    const go = overview.providers.find((provider) => provider.id === 'opencode-go')!;
    expect(go).toMatchObject({
      health: { status: 'healthy' },
      coverage: { tokens: 'unavailable', history: 'unavailable' },
      tokenTotals: { total: 0 },
      quotaBuckets: [
        expect.objectContaining({ id: 'monthly', limitAmount: 60 }),
        expect.objectContaining({ id: 'rolling', label: '5 hour' }),
        expect.objectContaining({ id: 'weekly', label: 'Week' })
      ]
    });
    const local = overview.providers.find((provider) => provider.id === 'opencode')!;
    expect(local).toMatchObject({
      displayName: 'OpenCode',
      coverage: { tokens: 'partial', history: 'partial' },
      tokenTotals: { total: 1700, input: 1000, output: 350, reasoning: 50, cacheRead: 300 },
      billingDomains: [
        {
          id: 'local-history',
          costs: [
            expect.objectContaining({
              kind: 'reported-estimate',
              amount: 0.42,
              model: 'opencode-go/deepseek-v4-flash'
            })
          ]
        }
      ]
    });
    expect(overview.workbench.recordedTokens).toBe(1700);
    repository.close();
  });

  it('retires legacy Go-attributed aggregates and keeps request-level local usage idempotent', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'opencode-go-request-pricing-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveConnectorStatus({
      id: 'opencode-go',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/opencode',
      officialCredentialPresent: true,
      errorCode: null,
      lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
      secretReference: null
    });
    repository.saveSnapshot({
      provider: { id: 'opencode-go', displayName: 'OpenCode Go' },
      billingDomains: [{ id: 'go-subscription', displayName: 'OpenCode Go subscription' }],
      quotaBuckets: [],
      usage: [
        {
          id: 'opencode-session:2026-08-27:opencode-go/deepseek-v4-flash',
          billingDomainId: 'go-subscription',
          model: 'opencode-go/deepseek-v4-flash',
          observedAt: '2026-08-27T00:00:00.000Z',
          inputTokens: 999,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          modelAttribution: 'known',
          timePrecision: 'day',
          usageScope: 'this-mac',
          aggregationTemporality: 'cumulative',
          authority: 'local-observation'
        }
      ],
      costs: [
        {
          id: 'opencode-session-cost:2026-08-27:opencode-go/deepseek-v4-flash',
          sourceId: 'opencode-session:2026-08-27:opencode-go/deepseek-v4-flash',
          billingDomainId: 'go-subscription',
          observedAt: '2026-08-27T00:00:00.000Z',
          kind: 'reported-estimate',
          amount: 9.99,
          currency: 'USD',
          authority: 'local-observation',
          model: 'opencode-go/deepseek-v4-flash',
          usageObservationId: 'opencode-session:2026-08-27:opencode-go/deepseek-v4-flash'
        }
      ],
      observedAt: '2026-08-28T01:00:00.000Z'
    });
    const localHistoryClient = {
      async readHistory() {
        return [
          {
            id: 'v2:off-peak-request',
            providerId: 'opencode-go',
            model: 'opencode-go/deepseek-v4-flash',
            cost: 0.22,
            inputTokens: 1_000_000,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            observedAtMs: Date.parse('2026-08-27T00:30:00.000Z')
          },
          {
            id: 'v2:peak-request',
            providerId: 'deepseek',
            model: 'deepseek/deepseek-v4-flash',
            cost: 0.22,
            inputTokens: 1_000_000,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            observedAtMs: Date.parse('2026-08-27T01:30:00.000Z')
          }
        ];
      }
    };
    const goConnector = new OpenCodeGoConnector({
      accountClient: {
        async readUsage() {
          return {
            usage: {
              rolling: { status: 'ok', percent: 25, resetsAt: '2026-08-28T05:00:00.000Z' },
              weekly: { status: 'ok', percent: 40, resetsAt: '2026-09-01T00:00:00.000Z' },
              monthly: { status: 'ok', percent: 50, resetsAt: '2026-09-28T00:00:00.000Z' }
            }
          };
        }
      },
      localHistoryClient,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    const localConnector = new OpenCodeLocalConnector({
      localHistoryClient,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    const application = new UsageApplication({
      repository,
      connectors: [goConnector, localConnector],
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    await application.refresh({ userInitiated: true });
    await application.refresh({ userInitiated: true });

    const overview = await application.getOverview({ window: '7d', comparisonCurrency: 'USD' });
    const provider = overview.providers.find((candidate) => candidate.id === 'opencode')!;
    const domain = provider.billingDomains[0];
    expect(provider.tokenTotals.total).toBe(2_000_000);
    expect(provider.tokenEvidence).toMatchObject({
      observationCount: 2,
      timePrecisions: ['event'],
      aggregationTemporalities: ['delta']
    });
    expect(domain.costs.filter((cost) => cost.kind === 'reported-estimate')).toHaveLength(2);
    expect(domain.history.costs.find((cost) => cost.kind === 'reported-estimate')).toMatchObject({
      amount: 0.44
    });
    expect(
      overview.providers.find((candidate) => candidate.id === 'opencode-go')?.tokenTotals.total
    ).toBe(0);
    expect(overview.workbench.costs.reportedEstimate).toMatchObject({ amount: 0.44 });
    expect(await application.getRetentionStatus()).toMatchObject({ rawObservations: 2 });
    repository.close();
  });

  it('preserves an existing immutable price snapshot across authoritative refresh', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'opencode-go-immutable-price-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveConnectorStatus({
      id: 'opencode-go',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/opencode',
      officialCredentialPresent: true,
      errorCode: null,
      lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
      secretReference: null
    });
    const connector = new OpenCodeLocalConnector({
      localHistoryClient: {
        async readHistory() {
          return [
            {
              id: 'v2:immutable-request',
              providerId: 'opencode-go',
              model: 'opencode-go/deepseek-v4-flash',
              cost: 0.22,
              inputTokens: 1_000_000,
              outputTokens: 0,
              reasoningTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              observedAtMs: Date.parse('2026-08-27T00:30:00.000Z')
            }
          ];
        }
      },
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    await new UsageApplication({
      repository,
      connectors: [connector],
      priceCatalog: fixedOpenCodeCatalog(0.22),
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    }).refresh({ userInitiated: true });
    const restarted = new UsageApplication({
      repository,
      connectors: [connector],
      priceCatalog: fixedOpenCodeCatalog(9),
      clock: () => new Date('2026-08-28T03:00:00.000Z')
    });
    await restarted.refresh({ userInitiated: true });

    const retailCosts = (await restarted.getOverview({ window: '7d' })).providers
      .find((provider) => provider.id === 'opencode')!
      .billingDomains[0].costs.filter((cost) => cost.kind === 'retail-equivalent');
    expect(retailCosts).toHaveLength(1);
    expect(retailCosts[0]).toMatchObject({
      amount: 0.22,
      priceSnapshot: { id: 'immutable-price-entry', ratesPerMillion: { input: 0.22 } }
    });
    repository.close();
  });
});

function fixedOpenCodeCatalog(inputRate: number): RetailPriceCatalog {
  return {
    version: 'immutable-price-catalog',
    entries: [
      {
        id: 'immutable-price-entry',
        priceVersion: 'immutable-price-v1',
        providerId: 'opencode',
        billingDomainId: 'local-history',
        canonicalModel: 'deepseek-v4-flash',
        aliases: ['opencode-go/deepseek-v4-flash'],
        currency: 'USD',
        effectiveFrom: '2026-08-01T00:00:00.000Z',
        effectiveUntil: null,
        contextTier: 'fixed-test',
        contextRule: { kind: 'fixed' },
        ratesPerMillion: {
          input: inputRate,
          output: null,
          reasoning: null,
          'cache-read': null,
          'cache-write': null
        },
        source: {
          title: 'Immutable price fixture',
          url: 'https://example.com/immutable-price',
          retrievedAt: '2026-08-28'
        }
      }
    ]
  };
}
