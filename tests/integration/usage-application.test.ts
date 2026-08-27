import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import type { Connector, ConnectorSnapshot } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('UsageApplication', () => {
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
          quotaBuckets: [{ id: 'five-hour', usedPercent: 42 }],
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
    const observedAt = '2026-08-28T02:00:00.000Z';
    repository.saveSnapshot({
      provider: { id: 'grok', displayName: 'Grok' },
      billingDomains: [{ id: 'grok-build-subscription', displayName: 'Build / SuperGrok' }],
      quotaBuckets: [],
      usage: [
        {
          id: 'build-session',
          billingDomainId: 'grok-build-subscription',
          model: 'grok-code-fast-1',
          observedAt,
          inputTokens: 100,
          outputTokens: 25,
          cacheReadTokens: 400,
          cacheWriteTokens: 0,
          authority: 'local-observation'
        }
      ],
      costs: [],
      observedAt
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
          observedAt,
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
          observedAt,
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
          observedAt,
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
          createdAt: observedAt,
          number: 'INV-1',
          status: 'paid',
          amount: 25,
          currency: 'USD',
          authority: 'official-account'
        }
      ],
      observedAt
    });

    const overview = repository.getOverview(new Date(observedAt));
    expect(overview.providers[0].billingDomains).toMatchObject([
      {
        id: 'grok-build-subscription',
        tokenTotals: { total: 525 },
        costs: [],
        balances: [],
        invoices: []
      },
      {
        id: 'xai-api',
        tokenTotals: { total: 1_742 },
        costs: [{ amount: 2.5, sourceId: 'analytics:2026-08-28' }],
        balances: [{ amount: 45, sourceId: 'prepaid' }],
        invoices: [{ number: 'INV-1', amount: 25 }]
      }
    ]);
    expect(overview.providers[0].tokenTotals.total).toBe(2_267);
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
