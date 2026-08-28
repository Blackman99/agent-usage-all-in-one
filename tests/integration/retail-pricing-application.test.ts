import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import type { Connector } from '$core/types.js';
import { startLocalServer, type LocalServer } from '$server/local-server.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const NOW = new Date('2026-08-28T02:00:00.000Z');
const workspaces: string[] = [];
const servers: LocalServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('retail-equivalent application tracer', () => {
  it('derives, persists, windows, and restarts one auditable model-level amount', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-retail-tracer-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');
    const firstRepository = new SqliteUsageRepository(databasePath);
    const first = application(firstRepository);

    await first.refresh({ userInitiated: true });
    await first.refresh({ userInitiated: true });
    firstRepository.close();

    const restartedRepository = new SqliteUsageRepository(databasePath);
    const restarted = application(restartedRepository);
    await restarted.refresh({ userInitiated: true });

    const overview = await restarted.getOverview({ window: '24h', comparisonCurrency: 'USD' });
    const provider = overview.providers.find((candidate) => candidate.id === 'claude-code')!;
    const domain = provider.billingDomains[0];
    expect(domain.tokenTotals.total).toBe(200_000);
    expect(domain.costs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'estimate', amount: 0.42 }),
        expect.objectContaining({
          id: 'retail-equivalent:fable-event:anthropic-fable-5-2026-06-09',
          kind: 'retail-equivalent',
          amount: 2.01,
          currency: 'USD',
          authority: 'estimate',
          model: 'claude-fable-5',
          usageObservationId: 'fable-event',
          pricedTokens: 130_000,
          calculatedAt: NOW.toISOString(),
          lineItems: [
            { tokenKind: 'input', tokens: 100_000, ratePerMillion: 10, amount: 1 },
            { tokenKind: 'output', tokens: 20_000, ratePerMillion: 50, amount: 1 },
            { tokenKind: 'cache-read', tokens: 10_000, ratePerMillion: 1, amount: 0.01 }
          ]
        })
      ])
    );
    expect(domain.history.costs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'retail-equivalent',
          amount: 2.01,
          currency: 'USD',
          pricingEvidence: {
            pricedTokens: 130_000,
            unpricedTokens: 70_000,
            recordedTokens: 200_000,
            pricingCoverage: 0.65
          },
          priceSnapshots: [
            expect.objectContaining({
              id: 'anthropic-fable-5-2026-06-09',
              version: 'anthropic-2026-06-09'
            })
          ]
        })
      ])
    );
    expect(overview.globalSummary.apiRetailEquivalent).toEqual({
      status: 'available',
      amount: 2.01,
      currency: 'USD',
      pricingCoverage: 0.65
    });
    expect(await restarted.getRetentionStatus()).toMatchObject({ rawObservations: 2 });

    const exported = JSON.parse(
      (await restarted.exportUsage({ format: 'json', window: '24h', timeZone: 'UTC' })).body
    ) as { rows: Array<Record<string, unknown>> };
    expect(exported.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: 'cost',
          costKind: 'retail-equivalent',
          amount: 2.01,
          currency: 'USD',
          pricedTokens: 130_000,
          recordedTokens: 200_000,
          pricingCoverage: 0.65,
          priceVersions: ['anthropic-2026-06-09']
        })
      ])
    );
    restartedRepository.close();
  });

  it('applies the same tracer to opt-in telemetry ingestion', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-retail-telemetry-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const application = new UsageApplication({
      repository,
      connectors: [],
      telemetryIngestors: [
        {
          id: 'claude-pricing-telemetry',
          parse() {
            return {
              provider: { id: 'claude-code', displayName: 'Claude Code' },
              billingDomains: [{ id: 'subscription', displayName: 'Claude subscription' }],
              quotaBuckets: [],
              usage: [
                {
                  id: 'telemetry-fable-event',
                  billingDomainId: 'subscription',
                  model: 'claude-fable-5',
                  observedAt: '2026-08-28T01:00:00.000Z',
                  inputTokens: 100_000,
                  outputTokens: 0,
                  reasoningTokens: 0,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
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
        }
      ],
      clock: () => NOW
    });

    application.ingestTelemetry('claude-pricing-telemetry', {});

    expect((await application.getOverview({ window: '24h' })).globalSummary).toMatchObject({
      apiRetailEquivalent: { status: 'available', amount: 1, pricingCoverage: 1 }
    });
    repository.close();
  });

  it('exposes retail amount, pricing coverage, and price evidence over authenticated HTTP', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-retail-http-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const usage = application(repository);
    await usage.refresh({ userInitiated: true });
    const server = await startLocalServer({ application: usage, apiToken: 'retail-http-token' });
    servers.push(server);

    const response = await fetch(`${server.origin}/api/overview?window=24h&currency=USD`, {
      headers: { authorization: 'Bearer retail-http-token' }
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      globalSummary: unknown;
      providers: Array<{
        id: string;
        billingDomains: Array<{ costs: unknown[]; history: { costs: unknown[] } }>;
      }>;
    };
    expect(body).toMatchObject({
      globalSummary: {
        apiRetailEquivalent: { status: 'available', amount: 2.01, pricingCoverage: 0.65 }
      }
    });
    const domain = body.providers.find((provider) => provider.id === 'claude-code')!
      .billingDomains[0];
    expect(domain.costs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'retail-equivalent',
          model: 'claude-fable-5',
          usageObservationId: 'fable-event',
          pricedTokens: 130_000,
          priceSnapshot: expect.objectContaining({
            version: 'anthropic-2026-06-09',
            contextTier: 'standard-api'
          })
        })
      ])
    );
    expect(domain.history.costs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'retail-equivalent',
          pricingEvidence: expect.objectContaining({ pricingCoverage: 0.65 })
        })
      ])
    );
    repository.close();
  });
});

function application(repository: SqliteUsageRepository): UsageApplication {
  const connector: Connector = {
    id: 'claude-pricing-fixture',
    async collect() {
      return {
        provider: { id: 'claude-code', displayName: 'Claude Code' },
        billingDomains: [{ id: 'subscription', displayName: 'Claude subscription' }],
        quotaBuckets: [],
        usage: [
          {
            id: 'fable-event',
            billingDomainId: 'subscription',
            model: 'claude-fable-5',
            observedAt: '2026-08-28T01:00:00.000Z',
            inputTokens: 100_000,
            outputTokens: 20_000,
            reasoningTokens: 5_000,
            cacheReadTokens: 10_000,
            cacheWriteTokens: 0,
            tokenSemantics: {
              reasoning: 'included-in-output' as const,
              cacheRead: 'separate' as const,
              cacheWrite: 'separate' as const
            },
            modelAttribution: 'known' as const,
            timePrecision: 'event' as const,
            usageScope: 'this-mac' as const,
            aggregationTemporality: 'delta' as const,
            authority: 'local-observation' as const
          },
          {
            id: 'unknown-event',
            billingDomainId: 'subscription',
            model: 'claude-unknown',
            observedAt: '2026-08-28T01:30:00.000Z',
            inputTokens: 50_000,
            outputTokens: 20_000,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            tokenSemantics: {
              reasoning: 'included-in-output' as const,
              cacheRead: 'separate' as const,
              cacheWrite: 'separate' as const
            },
            modelAttribution: 'known' as const,
            timePrecision: 'event' as const,
            usageScope: 'this-mac' as const,
            aggregationTemporality: 'delta' as const,
            authority: 'local-observation' as const
          }
        ],
        costs: [
          {
            id: 'claude-reported-estimate',
            sourceId: 'fable-event',
            billingDomainId: 'subscription',
            observedAt: '2026-08-28T01:00:00.000Z',
            kind: 'estimate' as const,
            amount: 0.42,
            currency: 'USD',
            authority: 'estimate' as const
          }
        ],
        observedAt: NOW.toISOString()
      };
    }
  };
  return new UsageApplication({ repository, connectors: [connector], clock: () => NOW });
}
