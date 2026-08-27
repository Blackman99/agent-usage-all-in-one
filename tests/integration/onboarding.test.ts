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
      { id: 'grok', state: 'discovered', installed: true },
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
});

const definitions: ConnectorDefinition[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    command: 'codex',
    permissionDescription: 'Read usage from the official Codex client.',
    credentialOwner: 'official-client',
    experimental: false,
    expectedCoverage: ['quota', 'tokens']
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    command: 'claude',
    permissionDescription: 'Read opt-in telemetry and official client usage.',
    credentialOwner: 'official-client',
    experimental: true,
    expectedCoverage: ['quota', 'tokens']
  },
  {
    id: 'opencode-go',
    displayName: 'OpenCode Go',
    command: 'opencode',
    permissionDescription: 'Read account quota and local session exports.',
    credentialOwner: 'official-client',
    experimental: false,
    expectedCoverage: ['quota', 'tokens', 'history']
  },
  {
    id: 'grok',
    displayName: 'Grok',
    command: 'grok',
    permissionDescription: 'Read Grok Build telemetry and usage.',
    credentialOwner: 'official-client',
    experimental: true,
    expectedCoverage: ['quota', 'tokens']
  },
  {
    id: 'managed-test',
    displayName: 'Managed test',
    command: 'managed-test',
    permissionDescription: 'Store a product-owned test credential.',
    credentialOwner: 'agent-usage',
    experimental: false,
    expectedCoverage: ['actual-cost']
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
