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

describe('diagnostics and recovery', () => {
  it('reports connector and billing-domain health, redacts secrets, and clears recovery state', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-diagnostics-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    let now = new Date('2026-08-28T02:00:00.000Z');
    let xaiHealthy = false;
    repository.saveConnectorStatus({
      id: 'grok',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/grok',
      officialCredentialPresent: true,
      errorCode: null,
      lastDiscoveredAt: now.toISOString(),
      secretReference: null
    });
    repository.saveConnectorStatus({
      id: 'xai-api',
      state: 'connected',
      installed: true,
      binaryPath: null,
      officialCredentialPresent: false,
      errorCode: null,
      lastDiscoveredAt: now.toISOString(),
      secretReference: 'connector:xai-api'
    });
    repository.saveConnectorStatus({
      id: 'codex',
      state: 'not-installed',
      installed: false,
      binaryPath: null,
      officialCredentialPresent: false,
      errorCode: null,
      lastDiscoveredAt: now.toISOString(),
      secretReference: null
    });
    const grok: Connector = {
      id: 'grok',
      consentId: 'grok',
      async collect() {
        return snapshot('grok-build-subscription', 'Build / SuperGrok', now);
      }
    };
    const xai: Connector = {
      id: 'xai-api',
      consentId: 'xai-api',
      async collect() {
        if (xaiHealthy) return snapshot('xai-api', 'xAI API', now);
        throw Object.assign(new Error('Bearer fake-super-secret-value was rejected'), {
          code: 'xai-api-permission-denied',
          recovery: 'Replace key fake-super-secret-value and retry.'
        });
      }
    };
    const application = new UsageApplication({
      repository,
      connectors: [grok, xai],
      connectorDefinitions: [
        {
          id: 'codex',
          displayName: 'Codex',
          command: 'codex',
          permissionDescription: 'Read Codex.',
          credentialOwner: 'official-client',
          experimental: false,
          expectedCoverage: ['quota', 'tokens'],
          target: {
            provider: { id: 'codex', displayName: 'Codex' },
            billingDomain: { id: 'subscription', displayName: 'Subscription' }
          }
        },
        {
          id: 'grok',
          displayName: 'Grok',
          command: 'grok',
          permissionDescription: 'Read Grok Build usage.',
          credentialOwner: 'official-client',
          experimental: true,
          expectedCoverage: ['quota', 'tokens', 'history'],
          target: {
            provider: { id: 'grok', displayName: 'Grok' },
            billingDomain: { id: 'grok-build-subscription', displayName: 'Build / SuperGrok' }
          }
        },
        {
          id: 'xai-api',
          displayName: 'xAI API (Grok)',
          command: null,
          permissionDescription: 'Read xAI API usage.',
          credentialOwner: 'agent-usage',
          experimental: false,
          expectedCoverage: ['tokens', 'actual-cost', 'history'],
          target: {
            provider: { id: 'grok', displayName: 'Grok' },
            billingDomain: { id: 'xai-api', displayName: 'xAI API' }
          }
        }
      ],
      clock: () => now,
      connectorPolicies: {
        grok: { minimumIntervalMs: 0, timeoutMs: 1_000 },
        'xai-api': { minimumIntervalMs: 0, timeoutMs: 1_000 }
      }
    });

    await application.refresh();
    const report = await application.getDiagnostics();
    expect(report).toMatchObject({
      daemon: { status: 'healthy' },
      database: { status: 'healthy' },
      connectors: expect.arrayContaining([
        expect.objectContaining({ id: 'codex', category: 'missing-binary' }),
        expect.objectContaining({
          id: 'grok',
          billingDomainId: 'grok-build-subscription',
          status: 'healthy'
        }),
        expect.objectContaining({
          id: 'xai-api',
          billingDomainId: 'xai-api',
          status: 'degraded',
          category: 'unauthorized',
          affectedCoverage: ['tokens', 'actual-cost', 'history']
        })
      ]),
      providers: [
        expect.objectContaining({
          id: 'grok',
          billingDomains: expect.arrayContaining([
            expect.objectContaining({ id: 'grok-build-subscription', status: 'healthy' }),
            expect.objectContaining({ id: 'xai-api', status: 'degraded' })
          ])
        })
      ]
    });
    expect(JSON.stringify(report)).not.toContain('fake-super-secret-value');
    expect((await application.getOverview()).providers[0].health.status).toBe('degraded');

    xaiHealthy = true;
    now = new Date('2026-08-28T02:01:01.000Z');
    await application.refresh();
    expect(await application.getDiagnostics()).toMatchObject({
      connectors: expect.arrayContaining([
        expect.objectContaining({ id: 'xai-api', status: 'healthy', category: null })
      ]),
      providers: [{ id: 'grok', status: 'healthy' }]
    });
    repository.close();
  });
});

function snapshot(billingDomainId: string, displayName: string, now: Date): ConnectorSnapshot {
  return {
    provider: { id: 'grok', displayName: 'Grok' },
    billingDomains: [{ id: billingDomainId, displayName }],
    quotaBuckets: [],
    usage: [],
    costs: [],
    observedAt: now.toISOString()
  };
}
