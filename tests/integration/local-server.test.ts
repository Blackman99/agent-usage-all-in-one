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
  it('reports authenticated process health without building the usage overview', async () => {
    let overviewCalls = 0;
    const application = {
      async getOverview() {
        overviewCalls += 1;
        await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
        throw new Error('The health endpoint must not build the usage overview');
      }
    } as unknown as UsageApplication;
    const server = await startLocalServer({ application, apiToken: 'health-token' });
    servers.push(server);

    expect((await fetch(`${server.origin}/api/health`)).status).toBe(401);
    const startedAt = performance.now();
    const response = await fetch(`${server.origin}/api/health`, {
      headers: { authorization: 'Bearer health-token' }
    });

    expect(response.status).toBe(204);
    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(overviewCalls).toBe(0);
  });

  it('answers a request whose payload cannot be encoded and stays available', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const application = {
      async getOverview() {
        return circular;
      },
      async getAgentProviderIndex() {
        return { generatedAt: '2026-08-28T02:00:00.000Z', providers: [] };
      }
    } as unknown as UsageApplication;
    const server = await startLocalServer({ application, apiToken: 'encode-token' });
    servers.push(server);

    const failed = await fetch(`${server.origin}/api/overview`, {
      headers: { authorization: 'Bearer encode-token' }
    });

    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ error: 'internal-error' });

    // The process that could not encode one response must still serve the next.
    const next = await fetch(`${server.origin}/api/overview/providers`, {
      headers: { authorization: 'Bearer encode-token' }
    });
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ providers: [] });
  });

  it('reports background processing and accepts a confirmed hard rebuild without waiting', async () => {
    let resolveRebuild!: () => void;
    const rebuildFinished = new Promise<void>((resolve) => {
      resolveRebuild = resolve;
    });
    const application = {
      getProcessingStatus() {
        return {
          startedAt: '2026-08-28T12:00:00.000Z',
          modules: {
            discovery: { state: 'ready' },
            usage: { state: 'running' },
            pricing: { state: 'pending' },
            retention: { state: 'ready' }
          }
        };
      },
      startHardRebuild() {
        return rebuildFinished;
      }
    } as unknown as UsageApplication;
    const server = await startLocalServer({ application, apiToken: 'processing-token' });
    servers.push(server);
    const headers = {
      authorization: 'Bearer processing-token',
      'content-type': 'application/json'
    };

    const status = await fetch(`${server.origin}/api/processing`, { headers });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ modules: { usage: { state: 'running' } } });

    const rejected = await fetch(`${server.origin}/api/rebuild`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirmExpensiveOperation: false })
    });
    expect(rejected.status).toBe(400);

    const startedAt = performance.now();
    const accepted = await fetch(`${server.origin}/api/rebuild`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirmExpensiveOperation: true })
    });
    expect(accepted.status).toBe(202);
    expect(performance.now() - startedAt).toBeLessThan(250);
    resolveRebuild();
  });

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

    const cliResponse = await fetch(`${server.origin}/api/overview?window=7d`, {
      headers: { authorization: 'Bearer cli-api-token' }
    });
    expect(cliResponse.status).toBe(200);
    expect(await cliResponse.json()).toMatchObject({
      globalSummary: {
        window: '7d',
        recordedTokens: null,
        apiRetailEquivalent: { status: 'unavailable', amount: null },
        contributions: []
      }
    });
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
    const manualRequest = () =>
      fetch(`${server.origin}/api/refresh`, {
        method: 'POST',
        headers: { authorization: 'Bearer manual-refresh-token' }
      });
    const automaticRequest = () =>
      fetch(`${server.origin}/api/refresh?mode=automatic`, {
        method: 'POST',
        headers: { authorization: 'Bearer manual-refresh-token' }
      });

    expect((await manualRequest()).status).toBe(204);
    expect((await automaticRequest()).status).toBe(204);
    expect(attempts).toBe(1);
    expect((await manualRequest()).status).toBe(204);

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
      expectedCoverage: ['actual-cost'],
      target: {
        provider: { id: 'managed-provider', displayName: 'Managed provider' },
        billingDomain: { id: 'api', displayName: 'API' }
      }
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
    expect(await discoverResponse.json()).toMatchObject([
      {
        id: 'managed',
        state: 'discovered',
        target: {
          provider: { id: 'managed-provider', displayName: 'Managed provider' },
          billingDomain: { id: 'api', displayName: 'API' }
        }
      }
    ]);

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
      workbench: {
        window: string;
        timeZone: string;
        comparisonCurrency: string;
        trend: { granularity: string; buckets: unknown[] };
        modelRanking: {
          byTokens: string[];
          entries: Array<{
            id: string;
            retailEquivalent: { status: string; amount: number | null };
          }>;
        };
      };
      providers: Array<{ billingDomains: Array<{ history: unknown }> }>;
    };
    expect(body.workbench).toMatchObject({
      window: '7d',
      timeZone: 'Asia/Shanghai',
      comparisonCurrency: 'CNY',
      trend: { granularity: 'day' }
    });
    expect(body.workbench.trend.buckets).toHaveLength(7);
    expect(body.workbench.modelRanking).toMatchObject({
      byTokens: ['history-api::api::model'],
      entries: [
        {
          id: 'history-api::api::model',
          retailEquivalent: { status: 'unavailable', amount: null }
        }
      ]
    });
    expect(body.providers[0].billingDomains[0].history).toMatchObject({
      window: '7d',
      timeZone: 'Asia/Shanghai',
      days: [{ day: '2026-08-28' }]
    });

    const usdResponse = await fetch(
      `${server.origin}/api/overview?window=24h&timeZone=UTC&currency=USD`,
      { headers: { authorization: 'Bearer history-token' } }
    );
    expect(usdResponse.status).toBe(200);
    expect(await usdResponse.json()).toMatchObject({
      workbench: {
        window: '24h',
        timeZone: 'UTC',
        comparisonCurrency: 'USD',
        trend: { granularity: 'hour' }
      }
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
                ...(['input', 'output', 'cacheRead', 'cacheCreation'] as const).map(
                  (type, index) => ({
                    name: 'claude_code.token.usage',
                    sum: {
                      aggregationTemporality: 'AGGREGATION_TEMPORALITY_DELTA',
                      dataPoints: [
                        {
                          timeUnixNano: '1787878800000000000',
                          asInt: [100, 25, 400, 50][index].toString(),
                          attributes: [
                            { key: 'type', value: { stringValue: type } },
                            { key: 'model', value: { stringValue: 'claude-fable-5' } }
                          ]
                        }
                      ]
                    }
                  })
                ),
                {
                  name: 'claude_code.cost.usage',
                  sum: {
                    aggregationTemporality: 'AGGREGATION_TEMPORALITY_DELTA',
                    dataPoints: [
                      {
                        timeUnixNano: '1787878800000000000',
                        asDouble: 0.42,
                        attributes: [{ key: 'model', value: { stringValue: 'claude-fable-5' } }]
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
    const duplicate = await fetch(`${server.origin}/v1/metrics`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer otlp-token',
        'content-type': 'application/json'
      },
      body
    });
    expect(duplicate.status).toBe(200);
    const cumulativePayload = JSON.parse(body) as {
      resourceMetrics: Array<{
        scopeMetrics: Array<{
          metrics: Array<{ sum: { aggregationTemporality: string } }>;
        }>;
      }>;
    };
    cumulativePayload.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.aggregationTemporality =
      'AGGREGATION_TEMPORALITY_CUMULATIVE';
    const rejected = await fetch(`${server.origin}/v1/metrics`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer otlp-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify(cumulativePayload)
    });
    expect(rejected.status).toBe(500);

    const overview = await fetch(`${server.origin}/api/overview`, {
      headers: { authorization: 'Bearer otlp-token' }
    });
    expect(await overview.json()).toMatchObject({
      providers: [
        {
          id: 'claude-code',
          coverage: { tokens: 'partial', history: 'partial' },
          tokenTotals: {
            total: 575,
            input: 100,
            output: 25,
            cacheRead: 400,
            cacheWrite: 50
          },
          tokenEvidence: {
            recordedTokens: 575,
            unclassifiedTokens: 0,
            totalDerivations: ['categorized'],
            timePrecisions: ['event'],
            usageScopes: ['this-mac'],
            aggregationTemporalities: ['delta']
          },
          tokenAuthority: 'local-observation',
          billingDomains: [
            {
              id: 'subscription',
              history: {
                tokenTotals: { total: 575 },
                days: [{ day: '2026-08-28', tokenTotals: { total: 575 } }],
                costs: [{ kind: 'reported-estimate', amount: 0.42 }]
              }
            }
          ]
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
    const grokPayload = {
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
                ...(['input', 'output', 'reasoning', 'cache_read'] as const).map((type, index) => ({
                  name: 'grok_code.token.usage',
                  sum: {
                    aggregationTemporality: 'AGGREGATION_TEMPORALITY_DELTA',
                    dataPoints: [
                      {
                        timeUnixNano: '1787878800000000000',
                        asInt: [100, 25, 12, 400][index].toString(),
                        attributes: [
                          { key: 'type', value: { stringValue: type } },
                          { key: 'model', value: { stringValue: 'grok-build' } },
                          { key: 'session.id', value: { stringValue: 'session-protobuf' } }
                        ]
                      }
                    ]
                  }
                }))
              ]
            }
          ]
        }
      ]
    };
    const encoded = encodeOtlpMetricsProtobuf(grokPayload);
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
    const duplicate = await fetch(`${server.origin}/grok/v1/metrics`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer grok-otlp-token',
        'content-type': 'application/x-protobuf'
      },
      body
    });
    expect(duplicate.status).toBe(200);
    const changedSchema = structuredClone(grokPayload);
    changedSchema.resourceMetrics[0].resource.attributes[0].value.stringValue = 'v2';
    const rejected = await fetch(`${server.origin}/grok/v1/metrics`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer grok-otlp-token',
        'content-type': 'application/x-protobuf'
      },
      body: Uint8Array.from(encodeOtlpMetricsProtobuf(changedSchema)).buffer
    });
    expect(rejected.status).toBe(500);

    const overview = await fetch(`${server.origin}/api/overview`, {
      headers: { authorization: 'Bearer grok-otlp-token' }
    });
    const serialized = JSON.stringify(await overview.json());
    expect(serialized).toContain('"id":"grok"');
    expect(serialized).toContain('"total":525');
    expect(serialized).toContain('"reasoning":12');
    expect(serialized).not.toContain('"total":537');
    expect(serialized).toContain('"aggregationTemporalities":["delta"]');
    expect(serialized).toContain('"tokens":"partial"');
    expect(serialized).toContain('"id":"grok-build-subscription"');
    expect(serialized).not.toContain('"id":"xai-api"');
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
