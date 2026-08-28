import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import type { ConnectorDefinition, DiscoveryProbe, SecretStore } from '$core/onboarding-types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('provider discovery and onboarding', () => {
  it('isolates discovery failures and persists independent connect and skip decisions', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-onboarding-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');
    let claudeAttempts = 0;
    const probe: DiscoveryProbe = {
      async inspect(definition) {
        if (definition.id === 'claude-code' && claudeAttempts++ === 0)
          throw new Error('probe failed');
        return {
          installed: definition.id !== 'opencode-go',
          binaryPath:
            definition.id === 'opencode-go' ? null : `/usr/local/bin/${definition.command}`,
          officialCredentialPresent: definition.id === 'codex'
        };
      }
    };
    const secretStore = new MemorySecretStore();
    const firstRepository = new SqliteUsageRepository(databasePath);
    const firstApplication = new UsageApplication({
      repository: firstRepository,
      connectors: [],
      connectorDefinitions: definitions,
      discoveryProbe: probe,
      secretStore,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    expect(await firstApplication.discoverConnectors()).toMatchObject([
      { id: 'codex', state: 'discovered', installed: true, officialCredentialPresent: true },
      { id: 'claude-code', state: 'error', errorCode: 'discovery-failed' },
      { id: 'opencode-go', state: 'not-installed', installed: false },
      {
        id: 'grok',
        state: 'discovered',
        installed: true,
        target: {
          provider: { id: 'grok', displayName: 'Grok' },
          billingDomain: { id: 'grok-build-subscription', displayName: 'Build / SuperGrok' }
        }
      },
      { id: 'managed-test', state: 'discovered', installed: true }
    ]);

    await firstApplication.configureConnector('codex', { action: 'skip' });
    await firstApplication.configureConnector('grok', { action: 'connect' });
    expect(
      await firstApplication.configureConnector('claude-code', { action: 'retry' })
    ).toMatchObject({
      state: 'discovered',
      installed: true
    });
    await firstApplication.configureConnector('managed-test', {
      action: 'connect',
      secret: 'fake-super-secret-value'
    });

    expect(secretStore.values.get('connector:managed-test')).toBe('fake-super-secret-value');
    firstRepository.close();

    const secondRepository = new SqliteUsageRepository(databasePath);
    const secondApplication = new UsageApplication({
      repository: secondRepository,
      connectors: [],
      connectorDefinitions: definitions,
      discoveryProbe: probe,
      secretStore
    });
    expect(await secondApplication.getConnectorStatuses()).toMatchObject([
      { id: 'codex', state: 'skipped' },
      { id: 'claude-code', state: 'discovered' },
      { id: 'opencode-go', state: 'not-installed' },
      { id: 'grok', state: 'connected' },
      { id: 'managed-test', state: 'connected', secretConfigured: true }
    ]);
    secondRepository.close();

    const databaseBytes = await readFile(databasePath);
    expect(databaseBytes.toString('utf8')).not.toContain('fake-super-secret-value');
  });

  it('refreshes newly connected usage before the action completes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-connect-refresh-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    let collections = 0;
    const application = new UsageApplication({
      repository,
      connectors: [
        {
          id: 'grok-build',
          displayName: 'Grok Build',
          consentId: 'grok',
          async collect() {
            collections += 1;
            return {
              provider: { id: 'grok', displayName: 'Grok' },
              billingDomains: [{ id: 'grok-build-subscription', displayName: 'Build / SuperGrok' }],
              quotaBuckets: [
                {
                  id: 'weekly',
                  billingDomainId: 'grok-build-subscription',
                  label: 'Weekly limit',
                  usedPercent: 21,
                  resetsAt: '2026-09-01T00:00:00.000Z',
                  authority: 'official-client' as const
                }
              ],
              usage: [],
              costs: [],
              observedAt: '2026-08-28T02:00:00.000Z'
            };
          }
        }
      ],
      connectorDefinitions: [definitions.find((definition) => definition.id === 'grok')!],
      discoveryProbe: {
        async inspect() {
          return {
            installed: true,
            binaryPath: '/usr/local/bin/grok',
            officialCredentialPresent: true
          };
        }
      },
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    await application.discoverConnectors();
    await application.configureConnector('grok', { action: 'connect' });

    expect(collections).toBe(1);
    expect(await application.getOverview()).toMatchObject({
      providers: [
        {
          id: 'grok',
          quotaBuckets: [{ billingDomainId: 'grok-build-subscription', usedPercent: 21 }]
        }
      ]
    });
    repository.close();
  });

  it('refreshes after every recovery action and replaces a connected managed credential', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-recovery-refresh-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const secretStore = new MemorySecretStore();
    let collections = 0;
    const application = new UsageApplication({
      repository,
      connectors: [
        {
          id: 'always-on',
          async collect() {
            collections += 1;
            return {
              provider: { id: 'always-on', displayName: 'Always on' },
              billingDomains: [{ id: 'local', displayName: 'Local' }],
              quotaBuckets: [],
              usage: [],
              costs: [],
              observedAt: '2026-08-28T02:00:00.000Z'
            };
          }
        }
      ],
      connectorDefinitions: [definitions.find((definition) => definition.id === 'managed-test')!],
      discoveryProbe: {
        async inspect() {
          return {
            installed: true,
            binaryPath: '/usr/local/bin/managed-test',
            officialCredentialPresent: false
          };
        }
      },
      secretStore,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    await application.discoverConnectors();
    await application.configureConnector('managed-test', {
      action: 'connect',
      secret: 'first-managed-secret'
    });
    await application.configureConnector('managed-test', {
      action: 'connect',
      secret: 'replacement-managed-secret'
    });
    expect(await application.configureConnector('managed-test', { action: 'retry' })).toMatchObject(
      {
        state: 'connected'
      }
    );
    await application.configureConnector('managed-test', { action: 'skip' });

    expect(collections).toBe(4);
    expect(secretStore.values.get('connector:managed-test')).toBe('replacement-managed-secret');
    repository.close();
  });
});

const definitions: ConnectorDefinition[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    command: 'codex',
    permissionDescription: 'Read usage from the official Codex client.',
    credentialOwner: 'official-client',
    experimental: false,
    expectedCoverage: ['quota', 'tokens'],
    target: {
      provider: { id: 'codex', displayName: 'Codex' },
      billingDomain: { id: 'subscription', displayName: 'Subscription' }
    }
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    command: 'claude',
    permissionDescription: 'Read opt-in telemetry and official client usage.',
    credentialOwner: 'official-client',
    experimental: true,
    expectedCoverage: ['quota', 'tokens'],
    target: {
      provider: { id: 'claude-code', displayName: 'Claude Code' },
      billingDomain: { id: 'subscription', displayName: 'Subscription' }
    }
  },
  {
    id: 'opencode-go',
    displayName: 'OpenCode Go',
    command: 'opencode',
    permissionDescription: 'Read account quota and local session exports.',
    credentialOwner: 'official-client',
    experimental: false,
    expectedCoverage: ['quota', 'tokens', 'history'],
    target: {
      provider: { id: 'opencode-go', displayName: 'OpenCode Go' },
      billingDomain: { id: 'go-subscription', displayName: 'OpenCode Go' }
    }
  },
  {
    id: 'grok',
    displayName: 'Grok',
    command: 'grok',
    permissionDescription: 'Read Grok Build telemetry and usage.',
    credentialOwner: 'official-client',
    experimental: true,
    expectedCoverage: ['quota', 'tokens'],
    target: {
      provider: { id: 'grok', displayName: 'Grok' },
      billingDomain: { id: 'grok-build-subscription', displayName: 'Build / SuperGrok' }
    }
  },
  {
    id: 'managed-test',
    displayName: 'Managed test',
    command: 'managed-test',
    permissionDescription: 'Store a product-owned test credential.',
    credentialOwner: 'agent-usage',
    experimental: false,
    expectedCoverage: ['actual-cost'],
    target: {
      provider: { id: 'managed-test', displayName: 'Managed test' },
      billingDomain: { id: 'api', displayName: 'API' }
    }
  }
];

class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();

  async set(reference: string, value: string): Promise<void> {
    this.values.set(reference, value);
  }

  async has(reference: string): Promise<boolean> {
    return this.values.has(reference);
  }

  async get(reference: string): Promise<string | null> {
    return this.values.get(reference) ?? null;
  }

  async delete(reference: string): Promise<void> {
    this.values.delete(reference);
  }
}
