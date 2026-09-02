import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import type { Connector } from '$core/types.js';
import { startLocalServer, type LocalServer } from '$server/local-server.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';
import { CodexAppServerError } from '../../src/connectors/codex/stdio-codex-account-client.js';

const workspaces: string[] = [];
const servers: LocalServer[] = [];
const daemonPids: number[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const pid of daemonPids.splice(0)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The daemon may already have stopped after a failed assertion.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('agent-usage CLI', () => {
  it('prints the daemon overview as JSON from a real subprocess', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-usage-cli-'));
    workspaces.push(home);
    const repository = new SqliteUsageRepository(join(home, 'usage.sqlite'));
    const connector: Connector = {
      id: 'demo',
      async collect() {
        return {
          provider: { id: 'demo', displayName: 'Demo Agent' },
          billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
          quotaBuckets: [
            {
              id: 'five-hour',
              billingDomainId: 'subscription',
              label: '5 hour',
              usedPercent: 42,
              resetsAt: '2026-08-28T05:00:00.000Z',
              authority: 'official-account' as const
            }
          ],
          usage: [
            {
              id: 'demo-day',
              billingDomainId: 'subscription',
              model: null,
              observedAt: '2026-08-28T00:00:00.000Z',
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              sourceReportedTotalTokens: 100,
              modelAttribution: 'unclassified',
              timePrecision: 'day',
              usageScope: 'account-wide',
              authority: 'official-account' as const
            }
          ],
          costs: [
            cost('actual', 'actual', 1, 'official-account'),
            { ...cost('unknown-actual', 'actual', null, 'unavailable'), currency: 'JPY' },
            cost('subscription', 'subscription', 2, 'official-account'),
            cost('reported', 'reported-estimate', 3, 'local-observation'),
            {
              ...cost('retail', 'retail-equivalent', 4, 'estimate'),
              usageObservationId: 'demo-day',
              pricedTokens: 100,
              lineItems: [
                { tokenKind: 'input' as const, tokens: 100, ratePerMillion: 40_000, amount: 4 }
              ],
              priceSnapshot: {
                id: 'cli-retail-v1',
                version: '2026-08-01',
                source: 'CLI fixture retail price',
                canonicalModel: null,
                effectiveAt: '2026-08-01T00:00:00.000Z',
                effectiveUntil: null,
                currency: 'USD',
                ratesPerMillion: {
                  input: 40_000,
                  output: null,
                  reasoning: null,
                  'cache-read': null,
                  'cache-write': null
                }
              }
            }
          ],
          observedAt: '2026-08-28T02:00:00.000Z'
        };
      }
    };
    const failedCodex: Connector = {
      id: 'codex',
      displayName: 'Codex',
      async collect() {
        throw new CodexAppServerError(
          'codex-account-unavailable',
          'Codex account usage is unavailable.',
          'Run codex login, then refresh Agent Usage.'
        );
      }
    };
    const application = new UsageApplication({
      repository,
      connectors: [connector, failedCodex],
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    await application.refresh();
    const server = await startLocalServer({ application, apiToken: 'cli-token' });
    servers.push(server);
    await writeFile(
      join(home, 'daemon.json'),
      JSON.stringify({ pid: process.pid, origin: server.origin, apiToken: server.apiToken }),
      { mode: 0o600 }
    );

    const result = await runCli(['--home', home, 'status', '--json']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      globalSummary: {
        window: '24h',
        recordedTokens: 100,
        apiRetailEquivalent: { status: 'available', amount: 4 },
        tokenEvidence: { classifiedTokens: 0, unclassifiedTokens: 100 }
      },
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          health: { status: 'degraded', errorCode: 'codex-account-unavailable' }
        },
        { id: 'demo', displayName: 'Demo Agent', quotaBuckets: [{ usedPercent: 42 }] }
      ]
    });
    expect(result.stderr).toBe('');

    const textStatus = await runCli(['--home', home, 'status']);
    expect(textStatus.exitCode).toBe(0);
    expect(textStatus.stdout).toContain(
      '5 hour: 42% used (source official-account at 2026-08-28T02:00:00.000Z)'
    );
    expect(textStatus.stdout).toContain('source official-account at 2026-08-28T02:00:00.000Z');
    expect(textStatus.stdout).toContain(
      '0/100 classified; 100 unclassified; precision day; scope account-wide'
    );
    expect(textStatus.stdout).toContain(
      'Summary (24h): 100 recorded tokens (source official-account at 2026-08-28T00:00:00.000Z); API retail equivalent 4 USD (source estimate at 2026-08-28T00:00:00.000Z); 0/100 classified'
    );
    expect(textStatus.stdout).toContain(
      'most constrained Demo Agent · 5 hour (58% remaining; source official-account at 2026-08-28T02:00:00.000Z)'
    );
    expect(textStatus.stdout).toContain('actual 1 USD');
    expect(textStatus.stdout).toContain('actual unknown');
    expect(textStatus.stdout).toContain('subscription 2 USD');
    expect(textStatus.stdout).toContain('reported-estimate 3 USD');
    expect(textStatus.stdout).toContain('retail-equivalent 4 USD');

    const sevenDay = await runCli(['--home', home, 'status', '--json', '--window', '7d']);
    expect(sevenDay.exitCode).toBe(0);
    expect(JSON.parse(sevenDay.stdout)).toMatchObject({
      globalSummary: { window: '7d', recordedTokens: 100 },
      providers: [{ id: 'codex' }, { id: 'demo', billingDomains: [{ history: { window: '7d' } }] }]
    });

    const doctor = await runCli(['--home', home, 'doctor', '--json']);
    expect(doctor.exitCode).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      providers: [
        {
          id: 'codex',
          health: {
            status: 'degraded',
            recovery: 'Run codex login, then refresh Agent Usage.'
          }
        },
        { id: 'demo', health: { status: 'healthy' } }
      ]
    });
  });

  it('starts one background daemon and reuses it on subsequent default commands', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-usage-default-'));
    workspaces.push(home);

    const first = await runCli(['--home', home, '--no-open']);

    expect(first.exitCode).toBe(0);
    expect(first.stderr).toContain('Agent Usage: starting local web service…');
    expect(first.stderr).toContain(
      'Agent Usage: web service ready; usage data is updating in the background.'
    );
    expect(first.stdout.trim()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/launch\?token=/);
    const firstState = JSON.parse(await readFile(join(home, 'daemon.json'), 'utf8')) as {
      pid: number;
      origin: string;
      apiToken: string;
    };
    daemonPids.push(firstState.pid);

    const launchResponse = await fetch(first.stdout.trim(), { redirect: 'manual' });
    expect(launchResponse.status).toBe(303);

    const second = await runCli(['--home', home, '--no-open']);
    expect(second.exitCode).toBe(0);
    const secondState = JSON.parse(await readFile(join(home, 'daemon.json'), 'utf8')) as {
      pid: number;
    };
    expect(secondState.pid).toBe(firstState.pid);

    const status = await runCli(['--home', home, 'status', '--json']);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      providers: []
    });

    const discovery = await runCli(['--home', home, 'discover', '--json']);
    expect(discovery.exitCode).toBe(0);
    expect(JSON.parse(discovery.stdout).map((connector: { id: string }) => connector.id)).toEqual([
      'codex',
      'claude-code',
      'opencode-go',
      'grok',
      'xai-api',
      'dsh',
      'antigravity'
    ]);


    const monitoring = await runCli(['--home', home, 'monitoring', '--json']);
    expect(monitoring.exitCode).toBe(0);
    expect(JSON.parse(monitoring.stdout)).toMatchObject({
      settings: {
        backgroundCollectionEnabled: true,
        intervalMinutes: 5,
        notificationsEnabled: false,
        startAtLogin: false
      }
    });

    const telemetry = await runCli(['--home', home, 'telemetry-env']);
    expect(telemetry.exitCode).toBe(0);
    expect(telemetry.stdout).toContain('CLAUDE_CODE_ENABLE_TELEMETRY=1');
    expect(telemetry.stdout).toContain(`OTEL_EXPORTER_OTLP_ENDPOINT=${firstState.origin}`);
    expect(telemetry.stdout).toContain('Authorization=Bearer ');
    expect(telemetry.stdout).toContain('OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta');

    const grokTelemetry = await runCli(['--home', home, 'telemetry-env', '--provider', 'grok']);
    expect(grokTelemetry.exitCode).toBe(0);
    expect(grokTelemetry.stdout).toContain('GROK_EXTERNAL_OTEL=1');
    expect(grokTelemetry.stdout).toContain('OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf');
    expect(grokTelemetry.stdout).toContain(`OTEL_EXPORTER_OTLP_ENDPOINT=${firstState.origin}/grok`);
    expect(grokTelemetry.stdout).toContain(
      'OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta'
    );

    const exported = await runCli(['--home', home, 'export', '--format', 'csv', '--window', '7d']);
    expect(exported.exitCode).toBe(0);
    expect(exported.stdout).toContain('window,windowStart,windowEnd');
    expect(exported.stdout).not.toContain('connector:');

    const retention = await runCli(['--home', home, 'retention', '--json']);
    expect(retention.exitCode).toBe(0);
    expect(JSON.parse(retention.stdout)).toMatchObject({ rawRetentionDays: 90 });

    const clear = await runCli(['--home', home, 'clear', '--yes']);
    expect(clear.exitCode).toBe(0);
    expect(clear.stdout).toContain('deleted 0 product secret(s)');
    const clearedStatus = await runCli(['--home', home, 'status', '--json']);
    expect(JSON.parse(clearedStatus.stdout).providers).toEqual([]);
  }, 15_000);
});

function cost(
  id: string,
  kind: 'actual' | 'subscription' | 'reported-estimate' | 'retail-equivalent',
  amount: number | null,
  authority: 'official-account' | 'local-observation' | 'estimate' | 'unavailable'
) {
  return {
    id,
    billingDomainId: 'subscription',
    observedAt: '2026-08-28T00:00:00.000Z',
    kind,
    amount,
    currency: 'USD',
    authority
  };
}

async function runCli(arguments_: string[]): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...arguments_], {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
