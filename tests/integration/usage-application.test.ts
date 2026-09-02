import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import type { Connector, ConnectorSnapshot } from '$core/types.js';
import { buildUsageExport } from '$core/usage-export.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('UsageApplication', () => {
  it('reports independent background processing progress while cached reads stay available', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-processing-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');
    const repository = new SqliteUsageRepository(databasePath);
    let database = new DatabaseSync(databasePath);
    const indexNames = () =>
      (
        database.prepare("PRAGMA index_list('usage_observations')").all() as Array<{
          name: string;
        }>
      ).map((index) => index.name);
    expect(indexNames()).not.toContain('usage_provider_model_time_idx');
    database.close();
    let releaseCollection!: () => void;
    const collectionGate = new Promise<void>((resolve) => {
      releaseCollection = resolve;
    });
    const connector: Connector = {
      id: 'slow',
      async collect() {
        await collectionGate;
        return {
          provider: { id: 'slow', displayName: 'Slow Agent' },
          billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
          quotaBuckets: [],
          usage: [],
          costs: [],
          observedAt: '2026-08-28T02:00:00.000Z'
        };
      }
    };
    const application = new UsageApplication({ repository, connectors: [connector] });

    const processing = application.startBackgroundProcessing();
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    expect(application.getProcessingStatus()).toMatchObject({
      modules: {
        discovery: { state: 'ready' },
        usage: { state: 'running' },
        pricing: { state: 'pending' }
      }
    });
    expect(await application.getOverview()).toMatchObject({ providers: [] });
    database = new DatabaseSync(databasePath);
    expect(indexNames()).not.toContain('usage_provider_model_time_idx');
    database.close();

    releaseCollection();
    await processing;
    expect(application.getProcessingStatus()).toMatchObject({
      modules: {
        discovery: { state: 'ready' },
        usage: { state: 'ready' },
        pricing: { state: 'ready' },
        retention: { state: 'ready' }
      }
    });
    database = new DatabaseSync(databasePath);
    expect(indexNames()).toContain('usage_provider_model_time_idx');
    expect(indexNames()).toContain('usage_provider_time_id_idx');
    database.close();
    repository.close();
  });

  it('collects again for a user-initiated background refresh inside the connector interval', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-interval-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    let collections = 0;
    const connector: Connector = {
      id: 'codex',
      async collect() {
        collections += 1;
        return {
          provider: { id: 'codex', displayName: 'Codex' },
          billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
          quotaBuckets: [],
          usage: [],
          costs: [],
          observedAt: '2026-08-30T02:00:00.000Z'
        };
      }
    };
    const application = new UsageApplication({
      repository,
      connectors: [connector],
      connectorPolicies: { codex: { minimumIntervalMs: 5 * 60 * 1000, timeoutMs: 20_000 } }
    });

    await application.startBackgroundProcessing();
    expect(collections).toBe(1);

    // An automatic recovery pass stays under the Provider's collection interval.
    await application.startBackgroundProcessing();
    expect(collections).toBe(1);

    // Asking for a refresh collects now instead of waiting out the interval.
    await application.startBackgroundProcessing({ userInitiated: true });
    expect(collections).toBe(2);
  });

  it('queues a user-initiated collection behind an in-flight scheduled run', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-queued-user-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    let collections = 0;
    let releaseCollection!: () => void;
    const collectionGate = new Promise<void>((resolve) => {
      releaseCollection = resolve;
    });
    const connector: Connector = {
      id: 'codex',
      async collect() {
        collections += 1;
        if (collections === 1) await collectionGate;
        return {
          provider: { id: 'codex', displayName: 'Codex' },
          billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
          quotaBuckets: [],
          usage: [],
          costs: [],
          observedAt: '2026-08-30T02:00:00.000Z'
        };
      }
    };
    const application = new UsageApplication({
      repository,
      connectors: [connector],
      connectorPolicies: { codex: { minimumIntervalMs: 5 * 60 * 1000, timeoutMs: 20_000 } }
    });

    const scheduled = application.startBackgroundProcessing();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const requested = application.startBackgroundProcessing({ userInitiated: true });
    releaseCollection();
    await scheduled;
    await requested;

    expect(collections).toBe(2);
  });

  it('queues hard collection behind an in-flight incremental refresh', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-hard-refresh-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    let releaseIncremental!: () => void;
    const incrementalGate = new Promise<void>((resolve) => {
      releaseIncremental = resolve;
    });
    const modes: string[] = [];
    const connector: Connector = {
      id: 'mode-aware',
      async collect(request) {
        modes.push(request?.mode ?? 'incremental');
        if (request?.mode !== 'hard-rebuild') await incrementalGate;
        return {
          provider: { id: 'mode-aware', displayName: 'Mode Aware' },
          billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
          quotaBuckets: [],
          usage: [],
          costs: [],
          observedAt: '2026-08-28T02:00:00.000Z'
        };
      }
    };
    const application = new UsageApplication({ repository, connectors: [connector] });

    const incremental = application.refresh();
    const hardRebuild = application.startHardRebuild();
    releaseIncremental();
    await Promise.all([incremental, hardRebuild]);

    expect(modes).toEqual(['incremental', 'hard-rebuild']);
    repository.close();
  });

  it('runs a queued hard collection even when the incremental refresh rejects', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-failed-incremental-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const getConnectorRuntimeStates = repository.getConnectorRuntimeStates.bind(repository);
    let runtimeReads = 0;
    repository.getConnectorRuntimeStates = () => {
      runtimeReads += 1;
      if (runtimeReads === 1) throw new Error('incremental preflight failed');
      return getConnectorRuntimeStates();
    };
    const modes: string[] = [];
    const connector: Connector = {
      id: 'mode-aware',
      async collect(request) {
        modes.push(request?.mode ?? 'incremental');
        return {
          provider: { id: 'mode-aware', displayName: 'Mode Aware' },
          billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
          quotaBuckets: [],
          usage: [],
          costs: [],
          observedAt: '2026-08-28T02:00:00.000Z'
        };
      }
    };
    const application = new UsageApplication({ repository, connectors: [connector] });

    const incremental = application.refresh();
    const hardRebuild = application.startHardRebuild();

    await expect(incremental).rejects.toThrow('incremental preflight failed');
    await expect(hardRebuild).resolves.toBeUndefined();
    expect(modes).toEqual(['hard-rebuild']);
    repository.close();
  });

  it('serializes manual compaction and connector snapshot writes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-maintenance-queue-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    let releaseMaintenance!: () => void;
    const maintenanceGate = new Promise<void>((resolve) => {
      releaseMaintenance = resolve;
    });
    const getRetentionStatus = repository.getRetentionStatus.bind(repository);
    repository.maintainUsageHistory = async () => {
      await maintenanceGate;
      return getRetentionStatus();
    };
    const collected: string[] = [];
    const connector: Connector = {
      id: 'queued-writer',
      async collect() {
        collected.push('collected');
        return {
          provider: { id: 'queued-writer', displayName: 'Queued Writer' },
          billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
          quotaBuckets: [],
          usage: [],
          costs: [],
          observedAt: '2026-08-28T02:00:00.000Z'
        };
      }
    };
    const application = new UsageApplication({ repository, connectors: [connector] });

    const compaction = application.compactRetention();
    const refresh = application.refresh({ userInitiated: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    expect(collected).toEqual([]);

    releaseMaintenance();
    await Promise.all([compaction, refresh]);
    expect(collected).toEqual(['collected']);
    repository.close();
  });

  it('persists an idempotent provider summary across application restarts', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');
    const observedAt = new Date('2026-08-28T02:00:00.000Z');
    const connector = new StaticConnector({
      provider: {
        id: 'demo',
        displayName: 'Demo Agent'
      },
      billingDomains: [
        {
          id: 'subscription',
          displayName: 'Demo subscription'
        }
      ],
      quotaBuckets: [
        {
          id: 'five-hour',
          billingDomainId: 'subscription',
          label: '5 hour',
          usedPercent: 42,
          windowDurationMinutes: 300,
          resetsAt: '2026-08-28T05:00:00.000Z',
          authority: 'official-account'
        }
      ],
      usage: [
        {
          id: 'demo-usage-1',
          billingDomainId: 'subscription',
          model: 'demo-model',
          observedAt: observedAt.toISOString(),
          inputTokens: 100,
          outputTokens: 25,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          authority: 'official-account'
        }
      ],
      costs: [],
      observedAt: observedAt.toISOString()
    });

    const firstRepository = new SqliteUsageRepository(databasePath);
    const firstApplication = new UsageApplication({
      repository: firstRepository,
      connectors: [connector],
      clock: () => observedAt
    });

    await firstApplication.refresh();
    await firstApplication.refresh();

    expect(await firstApplication.getOverview()).toMatchObject({
      providers: [
        {
          id: 'demo',
          displayName: 'Demo Agent',
          freshness: {
            lastSuccessAt: observedAt.toISOString(),
            status: 'fresh'
          },
          coverage: {
            quota: 'complete',
            tokens: 'complete'
          },
          quotaBuckets: [{ id: 'five-hour', usedPercent: 42, windowDurationMinutes: 300 }],
          tokenTotals: {
            total: 125,
            input: 100,
            output: 25,
            cacheRead: 0,
            cacheWrite: 0
          }
        }
      ]
    });
    firstRepository.close();

    const secondRepository = new SqliteUsageRepository(databasePath);
    const secondApplication = new UsageApplication({
      repository: secondRepository,
      connectors: [],
      clock: () => observedAt
    });

    expect(await secondApplication.getOverview()).toMatchObject({
      providers: [
        {
          id: 'demo',
          tokenTotals: {
            total: 125,
            input: 100,
            output: 25
          }
        }
      ]
    });
    secondRepository.close();
  });

  it('does not collect an official-client connector until the user connects it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-consent-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    let collectionCount = 0;
    const connector: Connector = {
      id: 'codex',
      consentId: 'codex',
      async collect() {
        collectionCount += 1;
        throw new Error('not needed for this assertion');
      }
    };
    const application = new UsageApplication({ repository, connectors: [connector] });

    await application.refresh();
    expect(collectionCount).toBe(0);

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
    await application.refresh();
    expect(collectionCount).toBe(1);
    repository.close();
  });

  it('keeps Grok Build and xAI API usage in separate billing-domain summaries', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-domains-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const buildObservedAt = '2026-08-28T01:00:00.000Z';
    const xaiObservedAt = '2026-08-28T02:00:00.000Z';
    repository.saveSnapshot({
      provider: { id: 'grok', displayName: 'Grok' },
      billingDomains: [{ id: 'grok-build-subscription', displayName: 'Build / SuperGrok' }],
      quotaBuckets: [
        {
          id: 'grok-build:weekly',
          billingDomainId: 'grok-build-subscription',
          label: 'Weekly limit',
          usedPercent: 40,
          resetsAt: '2026-09-01T00:00:00.000Z',
          authority: 'official-client'
        }
      ],
      usage: [
        {
          id: 'build-session',
          billingDomainId: 'grok-build-subscription',
          model: 'grok-code-fast-1',
          observedAt: buildObservedAt,
          inputTokens: 100,
          outputTokens: 25,
          cacheReadTokens: 400,
          cacheWriteTokens: 0,
          authority: 'local-observation'
        }
      ],
      costs: [],
      observedAt: buildObservedAt
    });
    repository.saveSnapshot({
      provider: { id: 'grok', displayName: 'Grok' },
      billingDomains: [{ id: 'xai-api', displayName: 'xAI API' }],
      quotaBuckets: [],
      usage: [
        {
          id: 'invoice-1-prompt',
          billingDomainId: 'xai-api',
          model: 'invoice',
          observedAt: xaiObservedAt,
          inputTokens: 1_742,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          authority: 'official-account'
        }
      ],
      costs: [
        {
          id: 'usage-day-1',
          sourceId: 'analytics:2026-08-28',
          billingDomainId: 'xai-api',
          observedAt: xaiObservedAt,
          kind: 'actual',
          amount: 2.5,
          currency: 'USD',
          authority: 'official-account'
        }
      ],
      balances: [
        {
          id: 'prepaid-current',
          sourceId: 'prepaid',
          billingDomainId: 'xai-api',
          observedAt: xaiObservedAt,
          kind: 'prepaid',
          amount: 45,
          currency: 'USD',
          authority: 'official-account'
        }
      ],
      invoices: [
        {
          id: 'invoice-1',
          billingDomainId: 'xai-api',
          createdAt: xaiObservedAt,
          number: 'INV-1',
          status: 'paid',
          amount: 25,
          currency: 'USD',
          authority: 'official-account'
        }
      ],
      observedAt: xaiObservedAt
    });
    repository.saveConnectorDiagnostic({
      id: 'xai-api',
      providerId: 'grok',
      billingDomainId: 'xai-api',
      status: 'degraded',
      category: 'unauthorized',
      message: 'xAI API key rejected.',
      recovery: 'Replace the xAI API key.',
      affectedCoverage: ['tokens', 'actual-cost'],
      lastAttemptAt: xaiObservedAt,
      lastSuccessAt: null
    });

    const overview = repository.getOverview(new Date(xaiObservedAt), { auditEvidence: true });
    expect(overview.providers[0].billingDomains).toMatchObject([
      {
        id: 'grok-build-subscription',
        freshness: { status: 'stale', lastSuccessAt: buildObservedAt },
        health: { status: 'healthy' },
        coverage: { quota: 'complete', actualCost: 'unavailable' },
        tokenTotals: { total: 525 },
        costs: [],
        balances: [],
        invoices: []
      },
      {
        id: 'xai-api',
        freshness: { status: 'fresh', lastSuccessAt: xaiObservedAt },
        health: { status: 'degraded', errorCode: 'unauthorized' },
        coverage: { quota: 'unavailable', actualCost: 'complete' },
        tokenTotals: { total: 1_742 },
        costs: [{ amount: 2.5, sourceId: 'analytics:2026-08-28' }],
        balances: [{ amount: 45, sourceId: 'prepaid' }],
        invoices: [{ number: 'INV-1', amount: 25 }]
      }
    ]);
    expect(overview.providers[0]).toMatchObject({
      summaryBillingDomainId: 'grok-build-subscription',
      freshness: { status: 'stale', lastSuccessAt: buildObservedAt },
      health: { status: 'healthy' },
      coverage: { quota: 'complete', actualCost: 'unavailable' },
      tokenTotals: { total: 525 }
    });
    const exported = JSON.parse(
      buildUsageExport(overview, { format: 'json', window: '24h' }).body
    ) as { rows: Array<Record<string, unknown>> };
    expect(
      exported.rows
        .filter((row) => row.recordType === 'tokens')
        .map((row) => [row.billingDomain, row.freshness, row.lastSuccessAt])
    ).toEqual([
      ['Build / SuperGrok', 'stale', buildObservedAt],
      ['xAI API', 'fresh', xaiObservedAt]
    ]);
    repository.close();
  });
});

class StaticConnector implements Connector {
  readonly id = 'demo';

  constructor(private readonly snapshot: ConnectorSnapshot) {}

  async collect(): Promise<ConnectorSnapshot> {
    return this.snapshot;
  }
}
