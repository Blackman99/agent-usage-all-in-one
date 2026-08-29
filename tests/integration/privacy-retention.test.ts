import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorDefinition, SecretStore } from '$core/onboarding-types.js';
import type { ConnectorSnapshot } from '$core/types.js';
import { UsageApplication } from '$core/usage-application.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('privacy, export, and retention', () => {
  it('exports redacted windowed JSON and CSV with authority and isolated cost kinds', async () => {
    const { application, repository } = await fixture();

    const jsonArtifact = await application.exportUsage({
      format: 'json',
      window: '30d',
      timeZone: 'Asia/Shanghai'
    });
    expect(jsonArtifact).toMatchObject({
      format: 'json',
      contentType: 'application/json; charset=utf-8'
    });
    const exported = JSON.parse(jsonArtifact.body) as {
      query: { window: string; timeZone: string; start: string; end: string };
      privacy: { accountIdentifiersIncluded: boolean; secretsIncluded: boolean };
      rows: Array<Record<string, unknown>>;
    };
    expect(exported.query).toMatchObject({ window: '30d', timeZone: 'Asia/Shanghai' });
    expect(exported.query.start).toBe('2026-07-29T02:00:00.000Z');
    expect(exported.query.end).toBe('2026-08-28T02:00:00.000Z');
    expect(exported.privacy).toEqual({
      accountIdentifiersIncluded: false,
      secretsIncluded: false
    });
    expect(exported.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: 'tokens',
          provider: 'Privacy Agent',
          billingDomain: 'Subscription',
          authority: 'local-observation',
          totalTokens: 150
        }),
        expect.objectContaining({
          recordType: 'token-observation',
          model: 'recent-model',
          recordId: 'usage-observation-1',
          usageObservationId: 'usage-observation-1',
          observedAt: '2026-08-27T00:00:00.000Z',
          timePrecision: 'unknown',
          authority: 'local-observation',
          recordedTokens: 150,
          classifiedTokens: 125,
          unclassifiedTokens: 25,
          usageScopes: ['this-mac'],
          aggregationTemporalities: ['delta'],
          reasoningSemantics: 'included-in-output',
          cacheReadSemantics: 'separate',
          cacheWriteSemantics: 'separate'
        }),
        expect.objectContaining({
          recordType: 'cost',
          costKind: 'actual',
          authority: 'official-account',
          amount: 1.25,
          currency: 'USD',
          observedAt: '2026-08-27T01:00:00.000Z'
        }),
        expect.objectContaining({
          recordType: 'cost',
          costKind: 'reported-estimate',
          costPurpose: 'reported-estimate',
          legacyPurposeUnknown: false,
          authority: 'estimate',
          amount: 2.5,
          currency: 'USD'
        }),
        expect.objectContaining({
          recordType: 'cost-observation',
          costKind: 'actual',
          model: 'recent-model',
          usageObservationId: 'usage-observation-1',
          observedAt: '2026-08-27T01:00:00.000Z'
        }),
        expect.objectContaining({
          recordType: 'cost-observation',
          costKind: 'reported-estimate',
          model: 'recent-model',
          usageObservationId: 'usage-observation-1',
          observedAt: '2026-08-27T01:30:00.000Z'
        })
      ])
    );
    expect(
      exported.rows.filter(
        (row) =>
          row.recordType === 'token-observation' && row.usageObservationId === 'usage-observation-1'
      )
    ).toHaveLength(1);
    const exportedCostObservationIds = exported.rows
      .filter((row) => row.recordType === 'cost-observation')
      .map((row) => row.recordId);
    expect(exportedCostObservationIds).toHaveLength(2);
    expect(new Set(exportedCostObservationIds).size).toBe(2);
    expect(exportedCostObservationIds).toEqual([
      expect.stringMatching(/^cost-observation-\d+$/),
      expect.stringMatching(/^cost-observation-\d+$/)
    ]);
    const serialized = JSON.stringify(exported);
    for (const forbidden of [
      'account-private-123',
      'session-fake-secret',
      'connector:xai-api',
      'cookie-fake-secret',
      'oauth-fake-secret'
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const identifiedArtifact = await application.exportUsage({
      format: 'json',
      window: '30d',
      includeAccountIdentifiers: true
    });
    const identifiedExport = JSON.parse(identifiedArtifact.body) as {
      privacy: { accountIdentifiersIncluded: boolean; secretsIncluded: boolean };
      rows: Array<Record<string, unknown>>;
    };
    expect(identifiedExport.privacy).toEqual({
      accountIdentifiersIncluded: true,
      secretsIncluded: false
    });
    expect(identifiedExport.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountIdentifier: 'account-private-123' })
      ])
    );

    const csvArtifact = await application.exportUsage({ format: 'csv', window: '30d' });
    expect(csvArtifact.contentType).toBe('text/csv; charset=utf-8');
    expect(csvArtifact.body).toContain('window,windowStart,windowEnd');
    expect(csvArtifact.body.split('\n')[0]).toContain('model,usageObservationId');
    expect(csvArtifact.body).toContain('recent-model,usage-observation-1');
    expect(csvArtifact.body).toContain('local-observation');
    expect(csvArtifact.body).toContain(',actual,');
    expect(csvArtifact.body).toContain(',reported-estimate,');
    expect(csvArtifact.body).not.toContain('fake-secret');
    repository.close();
  });

  it('compacts old raw observations idempotently across restart and clears only scoped data', async () => {
    const setup = await fixture();
    const { application, databasePath, secretStore } = setup;

    expect(await application.getRetentionStatus()).toMatchObject({
      rawRetentionDays: 90,
      rawObservations: 2,
      dailyAggregates: 0
    });
    expect(await application.compactRetention()).toMatchObject({
      rawObservations: 1,
      dailyAggregates: 1,
      lastCompactedAt: '2026-08-28T02:00:00.000Z'
    });
    setup.repository.close();

    const restartedRepository = new SqliteUsageRepository(databasePath);
    const restarted = new UsageApplication({
      repository: restartedRepository,
      connectors: [],
      connectorDefinitions: definitions,
      secretStore,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    expect(await restarted.compactRetention()).toMatchObject({
      rawObservations: 1,
      dailyAggregates: 1
    });

    const result = await restarted.clearData({ deleteProductSecrets: true });
    expect(result).toEqual({ usageCleared: true, productSecretsDeleted: 1 });
    expect(secretStore.deleted).toEqual(['connector:xai-api']);
    expect((await restarted.getOverview()).providers).toEqual([]);
    expect(await restarted.getRetentionStatus()).toMatchObject({
      rawObservations: 0,
      dailyAggregates: 0
    });
    const statuses = restartedRepository.getConnectorStatuses();
    expect(statuses.find((status) => status.id === 'xai-api')).toMatchObject({
      state: 'discovered',
      secretReference: null
    });
    expect(statuses.find((status) => status.id === 'codex')).toMatchObject({
      state: 'connected',
      secretReference: 'official-client-owned-reference'
    });
    restartedRepository.close();
  });

  it('deletes only the requested provider and its connector state', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-provider-cleanup-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(snapshot());
    repository.saveSnapshot({
      ...snapshot(),
      provider: { id: 'demo', displayName: 'Demo Agent' }
    });
    for (const id of ['demo', 'codex']) {
      repository.saveConnectorStatus({
        id,
        state: 'connected',
        installed: true,
        binaryPath: null,
        officialCredentialPresent: true,
        errorCode: null,
        lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
        secretReference: null
      });
    }

    await repository.deleteDemoProviderDataAsync();

    expect(repository.getOverview(new Date('2026-08-28T02:00:00.000Z')).providers).toEqual([
      expect.objectContaining({ id: 'privacy', displayName: 'Privacy Agent' })
    ]);
    expect(repository.getConnectorStatuses().map((status) => status.id)).toEqual(['codex']);
    repository.close();
  });
});

async function fixture(): Promise<{
  application: UsageApplication;
  repository: SqliteUsageRepository;
  databasePath: string;
  secretStore: MemorySecretStore;
}> {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-privacy-'));
  workspaces.push(workspace);
  const databasePath = join(workspace, 'usage.sqlite');
  const repository = new SqliteUsageRepository(databasePath);
  repository.saveSnapshot(snapshot());
  repository.saveConnectorStatus({
    id: 'xai-api',
    state: 'connected',
    installed: true,
    binaryPath: null,
    officialCredentialPresent: false,
    errorCode: null,
    lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
    secretReference: 'connector:xai-api'
  });
  repository.saveConnectorStatus({
    id: 'codex',
    state: 'connected',
    installed: true,
    binaryPath: '/usr/local/bin/codex',
    officialCredentialPresent: true,
    errorCode: null,
    lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
    secretReference: 'official-client-owned-reference'
  });
  const secretStore = new MemorySecretStore();
  return {
    application: new UsageApplication({
      repository,
      connectors: [],
      connectorDefinitions: definitions,
      secretStore,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    }),
    repository,
    databasePath,
    secretStore
  };
}

const definitions: ConnectorDefinition[] = [
  {
    id: 'xai-api',
    displayName: 'xAI API',
    command: null,
    permissionDescription: 'Store a product key.',
    credentialOwner: 'agent-usage',
    experimental: false,
    expectedCoverage: ['tokens', 'actual-cost', 'history'],
    target: {
      provider: { id: 'grok', displayName: 'Grok' },
      billingDomain: { id: 'xai-api', displayName: 'xAI API' }
    }
  },
  {
    id: 'codex',
    displayName: 'Codex',
    command: 'codex',
    permissionDescription: 'Use the official client credential in place.',
    credentialOwner: 'official-client',
    experimental: false,
    expectedCoverage: ['quota', 'tokens', 'history'],
    target: {
      provider: { id: 'codex', displayName: 'Codex' },
      billingDomain: { id: 'subscription', displayName: 'Subscription' }
    }
  }
];

function snapshot(): ConnectorSnapshot {
  return {
    provider: {
      id: 'privacy',
      displayName: 'Privacy Agent',
      accountIdentifier: 'account-private-123'
    },
    billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
    quotaBuckets: [],
    usage: [
      {
        id: 'old-observation',
        billingDomainId: 'subscription',
        model: 'old-model',
        sessionId: 'session-fake-secret',
        observedAt: '2026-05-01T00:00:00.000Z',
        inputTokens: 50,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        authority: 'official-account'
      },
      {
        id: 'grok-headless:session-fake-secret:request:recent-model',
        billingDomainId: 'subscription',
        model: 'recent-model',
        sessionId: 'account-private-123',
        observedAt: '2026-08-27T00:00:00.000Z',
        sourceReportedTotalTokens: 150,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        usageScope: 'this-mac',
        aggregationTemporality: 'delta',
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        authority: 'local-observation'
      }
    ],
    costs: [
      {
        id: 'actual',
        sourceId: 'cookie-fake-secret',
        billingDomainId: 'subscription',
        observedAt: '2026-08-27T01:00:00.000Z',
        kind: 'actual',
        amount: 1.25,
        currency: 'USD',
        authority: 'official-account',
        model: 'recent-model',
        usageObservationId: 'grok-headless:session-fake-secret:request:recent-model'
      },
      {
        id: 'estimate',
        sourceId: 'oauth-fake-secret',
        billingDomainId: 'subscription',
        observedAt: '2026-08-27T01:30:00.000Z',
        kind: 'reported-estimate',
        amount: 2.5,
        currency: 'USD',
        authority: 'estimate',
        model: 'recent-model',
        usageObservationId: 'grok-headless:session-fake-secret:request:recent-model'
      }
    ],
    observedAt: '2026-08-28T01:00:00.000Z'
  };
}

class MemorySecretStore implements SecretStore {
  deleted: string[] = [];

  async set(): Promise<void> {}
  async has(): Promise<boolean> {
    return true;
  }
  async get(): Promise<string | null> {
    return 'unused-fake-secret';
  }
  async delete(reference: string): Promise<void> {
    this.deleted.push(reference);
  }
}
