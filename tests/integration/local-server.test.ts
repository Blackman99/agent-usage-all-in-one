import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import type { ConnectorDefinition, DiscoveryProbe, SecretStore } from '$core/onboarding-types.js';
import type { Connector } from '$core/types.js';
import { startLocalServer, type LocalServer } from '$server/local-server.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';
import { parseClaudeOtlpMetrics } from '../../src/connectors/claude-code/claude-otlp.js';
import { parseGrokOtlpMetrics } from '../../src/connectors/grok-build/grok-telemetry.js';
import { encodeOtlpMetricsProtobuf } from '../../src/server/otlp-protobuf.js';

const workspaces: string[] = [];
const servers: LocalServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('local HTTP server', () => {
  it('redacts credentials from adapter error responses', async () => {
    const application = {
      async getOverview() {
        throw new Error('upstream rejected Bearer secret-access-token and api key xai-private-key');
      }
    } as unknown as UsageApplication;
    const server = await startLocalServer({ application, apiToken: 'redaction-token' });
    servers.push(server);

    const response = await fetch(`${server.origin}/api/overview`, {
      headers: { authorization: 'Bearer redaction-token' }
    });
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('[REDACTED]');
    expect(body).not.toContain('secret-access-token');
    expect(body).not.toContain('xai-private-key');
  });

  it('exchanges a one-time launch token for a protected browser session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-server-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const application = new UsageApplication({ repository, connectors: [] });
    const server = await startLocalServer({
      application,
      host: '127.0.0.1',
      port: 0,
      launchToken: 'single-use-launch-token',
      apiToken: 'cli-api-token'
    });
    servers.push(server);

    expect(server.host).toBe('127.0.0.1');
    expect((await fetch(`${server.origin}/api/overview`)).status).toBe(401);

    const launchResponse = await fetch(`${server.origin}/launch?token=single-use-launch-token`, {
      redirect: 'manual'
    });
    expect(launchResponse.status).toBe(303);
    expect(launchResponse.headers.get('location')).toBe('/');
    const cookie = launchResponse.headers.getSetCookie()[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    expect(
      (
        await fetch(`${server.origin}/launch?token=single-use-launch-token`, {
          redirect: 'manual'
        })
      ).status
    ).toBe(403);

    const overviewResponse = await fetch(`${server.origin}/api/overview`, {
      headers: { cookie }
    });
    expect(overviewResponse.status).toBe(200);
    expect(await overviewResponse.json()).toMatchObject({ providers: [] });

    expect(
      (
        await fetch(`${server.origin}/api/refresh`, {
          method: 'POST',
          headers: { cookie }
        })
      ).status
    ).toBe(403);
    expect(
      (
        await fetch(`${server.origin}/api/refresh`, {
          method: 'POST',
          headers: { cookie, origin: server.origin }
        })
      ).status
    ).toBe(204);

    const cliResponse = await fetch(`${server.origin}/api/overview`, {
      headers: { authorization: 'Bearer cli-api-token' }
    });
    expect(cliResponse.status).toBe(200);
    const doctorResponse = await fetch(`${server.origin}/api/doctor`, {
      headers: { authorization: 'Bearer cli-api-token' }
    });
    expect(doctorResponse.status).toBe(200);
    expect(await doctorResponse.json()).toMatchObject({
      daemon: { status: 'healthy' },
      database: { status: 'healthy' },
      connectors: []
    });
  });

  it('lets a user-initiated refresh retry a connector during automatic backoff', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-manual-refresh-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    let attempts = 0;
    const connector: Connector = {
      id: 'grok',
      displayName: 'Grok',
      async collect() {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary billing failure');
        return {
          provider: { id: 'grok', displayName: 'Grok' },
          billingDomains: [
            { id: 'grok-build-subscription', displayName: 'Grok Build / SuperGrok' }
          ],
          quotaBuckets: [
            {
              id: 'grok-build:weekly',
              billingDomainId: 'grok-build-subscription',
              label: 'Weekly limit',
              usedPercent: 41,
              resetsAt: '2026-09-03T09:38:55.682Z',
              authority: 'official-client'
            }
          ],
          usage: [],
          costs: [],
          observedAt: '2026-08-28T02:37:06.249Z'
        };
      }
    };
    const application = new UsageApplication({
      repository,
      connectors: [connector],
      clock: () => new Date('2026-08-28T03:00:00.000Z'),
      connectorPolicies: { grok: { minimumIntervalMs: 5 * 60 * 1000, timeoutMs: 5_000 } }
    });
    const server = await startLocalServer({ application, apiToken: 'manual-refresh-token' });
    servers.push(server);
    const request = () =>
      fetch(`${server.origin}/api/refresh`, {
        method: 'POST',
        headers: { authorization: 'Bearer manual-refresh-token' }
      });

    expect((await request()).status).toBe(204);
    expect((await request()).status).toBe(204);

    expect(attempts).toBe(2);
    expect(await application.getOverview()).toMatchObject({
      providers: [
        {
          id: 'grok',
          health: { status: 'healthy' },
          quotaBuckets: [{ usedPercent: 41 }]
        }
      ]
    });
  });

  it('exposes protected onboarding actions without returning managed secret values', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-onboarding-api-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const definition: ConnectorDefinition = {
      id: 'managed',
      displayName: 'Managed provider',
      command: 'managed',
      permissionDescription: 'Store a managed API key.',
      credentialOwner: 'agent-usage',
      experimental: false,
      expectedCoverage: ['actual-cost']
    };
    const probe: DiscoveryProbe = {
      async inspect() {
        return {
          installed: true,
          binaryPath: '/usr/local/bin/managed',
          officialCredentialPresent: false
        };
      }
    };
    const secretStore = new ApiMemorySecretStore();
    const application = new UsageApplication({
      repository,
      connectors: [],
      connectorDefinitions: [definition],
      discoveryProbe: probe,
      secretStore
    });
    const server = await startLocalServer({ application, apiToken: 'api-token' });
    servers.push(server);
    const authorization = { authorization: 'Bearer api-token' };

    const discoverResponse = await fetch(`${server.origin}/api/connectors/discover`, {
      method: 'POST',
      headers: authorization
    });
    expect(discoverResponse.status).toBe(200);
    expect(await discoverResponse.json()).toMatchObject([{ id: 'managed', state: 'discovered' }]);

    const connectResponse = await fetch(`${server.origin}/api/connectors/managed/action`, {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'connect', secret: 'api-fake-secret' })
    });
    expect(connectResponse.status).toBe(200);
    const serialized = JSON.stringify(await connectResponse.json());
    expect(serialized).toContain('"secretConfigured":true');
    expect(serialized).not.toContain('api-fake-secret');
    expect(secretStore.values.get('connector:managed')).toBe('api-fake-secret');

    const doctorResponse = await fetch(`${server.origin}/api/doctor`, {
      headers: authorization
    });
    expect(doctorResponse.status).toBe(200);
    const doctor = JSON.stringify(await doctorResponse.json());
    expect(doctor).toContain('"id":"managed"');
    expect(doctor).not.toContain('api-fake-secret');
  });

  it('exposes the selected history window and timezone through the protected overview API', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-history-api-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot({
      provider: { id: 'history-api', displayName: 'History API' },
      billingDomains: [{ id: 'api', displayName: 'API' }],
      quotaBuckets: [],
      usage: [
        {
          id: 'observation',
          billingDomainId: 'api',
          model: 'model',
          observedAt: '2026-08-27T16:30:00.000Z',
          inputTokens: 10,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          authority: 'official-account'
        }
      ],
      costs: [],
      observedAt: '2026-08-28T01:00:00.000Z'
    });
    const application = new UsageApplication({
      repository,
      connectors: [],
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    const server = await startLocalServer({ application, apiToken: 'history-token' });
    servers.push(server);

    const response = await fetch(
      `${server.origin}/api/overview?window=7d&timeZone=Asia%2FShanghai&currency=CNY`,
      { headers: { authorization: 'Bearer history-token' } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      providers: Array<{ billingDomains: Array<{ history: unknown }> }>;
    };
    expect(body.providers[0].billingDomains[0].history).toMatchObject({
      window: '7d',
      timeZone: 'Asia/Shanghai',
      days: [{ day: '2026-08-28' }]
    });

    const exportResponse = await fetch(
      `${server.origin}/api/export?format=csv&window=7d&timeZone=Asia%2FShanghai`,
      { headers: { authorization: 'Bearer history-token' } }
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get('content-disposition')).toContain('agent-usage-7d-');
    expect(await exportResponse.text()).toContain('official-account');

    const retentionResponse = await fetch(`${server.origin}/api/retention`, {
      headers: { authorization: 'Bearer history-token' }
    });
    expect(retentionResponse.status).toBe(200);
    expect(await retentionResponse.json()).toMatchObject({
      rawRetentionDays: 90,
      rawObservations: 1
    });

    const clearResponse = await fetch(`${server.origin}/api/data`, {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer history-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ deleteProductSecrets: false })
    });
    expect(clearResponse.status).toBe(200);
    expect(await clearResponse.json()).toEqual({
      usageCleared: true,
      productSecretsDeleted: 0
    });
    expect((await application.getOverview()).providers).toEqual([]);
  });

  it('accepts opt-in authenticated Claude OTLP metrics and rejects anonymous ingestion', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-claude-otlp-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveConnectorStatus({
      id: 'claude-code',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/claude',
      officialCredentialPresent: false,
      errorCode: null,
      lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
      secretReference: null
    });
    const application = new UsageApplication({
      repository,
      connectors: [],
      clock: () => new Date('2026-08-28T02:00:00.000Z'),
      telemetryIngestors: [
        { id: 'claude-code', consentId: 'claude-code', parse: parseClaudeOtlpMetrics }
      ]
    });
    const server = await startLocalServer({ application, apiToken: 'otlp-token' });
    servers.push(server);
    const body = JSON.stringify({
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'claude_code.token.usage',
                  sum: {
                    dataPoints: [
                      {
                        timeUnixNano: '1756346400000000000',
                        asInt: '125',
                        attributes: [
                          { key: 'type', value: { stringValue: 'input' } },
                          { key: 'model', value: { stringValue: 'claude-fable-5' } }
                        ]
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      ]
    });

    expect(
      (
        await fetch(`${server.origin}/v1/metrics`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body
        })
      ).status
    ).toBe(401);
    const ingest = await fetch(`${server.origin}/v1/metrics`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer otlp-token',
        'content-type': 'application/json'
      },
      body
    });
    expect(ingest.status).toBe(200);
    expect(await ingest.json()).toEqual({ partialSuccess: {} });

    const overview = await fetch(`${server.origin}/api/overview`, {
      headers: { authorization: 'Bearer otlp-token' }
    });
    expect(await overview.json()).toMatchObject({
      providers: [
        {
          id: 'claude-code',
          tokenTotals: { total: 125, input: 125 },
          tokenAuthority: 'local-observation'
        }
      ]
    });
    repository.close();
  });

  it('accepts official Grok Build OTLP protobuf on its isolated billing-domain route', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-grok-otlp-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveConnectorStatus({
      id: 'grok',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/grok',
      officialCredentialPresent: true,
      errorCode: null,
      lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
      secretReference: null
    });
    const application = new UsageApplication({
      repository,
      connectors: [],
      clock: () => new Date('2026-08-28T02:00:00.000Z'),
      telemetryIngestors: [{ id: 'grok', consentId: 'grok', parse: parseGrokOtlpMetrics }]
    });
    const server = await startLocalServer({ application, apiToken: 'grok-otlp-token' });
    servers.push(server);
    const encoded = encodeOtlpMetricsProtobuf({
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: 'grok_code.schema.version', value: { stringValue: 'v1' } },
              { key: 'user.id', value: { stringValue: 'private-user' } }
            ]
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'grok_code.token.usage',
                  sum: {
                    aggregationTemporality: 'AGGREGATION_TEMPORALITY_DELTA',
                    dataPoints: [
                      {
                        timeUnixNano: '1756346400000000000',
                        asInt: '125',
                        attributes: [
                          { key: 'type', value: { stringValue: 'input' } },
                          { key: 'model', value: { stringValue: 'grok-build' } },
                          { key: 'session.id', value: { stringValue: 'session-protobuf' } }
                        ]
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      ]
    });
    const body = Uint8Array.from(encoded).buffer;

    const anonymous = await fetch(`${server.origin}/grok/v1/metrics`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf' },
      body
    });
    expect(anonymous.status).toBe(401);

    const ingest = await fetch(`${server.origin}/grok/v1/metrics`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer grok-otlp-token',
        'content-type': 'application/x-protobuf'
      },
      body
    });
    expect(ingest.status).toBe(200);
    expect(ingest.headers.get('content-type')).toContain('application/x-protobuf');

    const overview = await fetch(`${server.origin}/api/overview`, {
      headers: { authorization: 'Bearer grok-otlp-token' }
    });
    const serialized = JSON.stringify(await overview.json());
    expect(serialized).toContain('"id":"grok"');
    expect(serialized).toContain('"total":125');
    expect(serialized).not.toContain('private-user');
    repository.close();
  });
});

class ApiMemorySecretStore implements SecretStore {
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
