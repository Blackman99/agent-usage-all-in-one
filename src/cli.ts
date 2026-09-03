#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { connect as tcpConnect } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { Command } from 'commander';
import open from 'open';

import type { CustomModelRate, DoctorReport, UsageOverview } from './core/types.js';
import { publicErrorMessage } from './core/redaction.js';
import { readDaemonState, type DaemonState } from './server/daemon-state.js';

const program = new Command();
program
  .name('agent-usage')
  .description('View local coding-agent quota, token, and cost usage')
  .option('--home <directory>', 'application data directory', defaultHome())
  .option('--no-open', 'start the dashboard without opening a browser');

program
  .command('status')
  .description('print the current provider overview')
  .option('--json', 'emit machine-readable JSON')
  .option('--window <window>', 'history window: 24h, 7d, or 30d', '24h')
  .action(async (options: { json?: boolean; window: string }) => {
    const home = resolve(program.opts<{ home: string }>().home);
    const state = await requireDaemonState(home);
    if (!['24h', '7d', '30d'].includes(options.window)) {
      throw new Error('Unsupported history window. Use 24h, 7d, or 30d.');
    }
    const response = await fetch(`${state.origin}/api/overview?window=${options.window}`, {
      headers: { authorization: `Bearer ${state.apiToken}` }
    });
    if (!response.ok) {
      throw new Error(`Daemon returned HTTP ${response.status}`);
    }
    const overview = (await response.json()) as UsageOverview;
    process.stdout.write(options.json ? `${JSON.stringify(overview)}\n` : formatOverview(overview));
  });

program
  .command('telemetry-env')
  .description('print opt-in provider OTLP environment variables')
  .option('--provider <provider>', 'claude-code or grok', 'claude-code')
  .action(async (options: { provider: string }) => {
    const home = resolve(program.opts<{ home: string }>().home);
    const state = await requireDaemonState(home);
    if (options.provider === 'grok') {
      process.stdout.write(
        [
          'export GROK_EXTERNAL_OTEL=1',
          'export OTEL_METRICS_EXPORTER=otlp',
          'export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
          `export OTEL_EXPORTER_OTLP_ENDPOINT=${state.origin}/grok`,
          `export OTEL_EXPORTER_OTLP_HEADERS='Authorization=Bearer ${state.apiToken}'`,
          'export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta'
        ].join('\n') + '\n'
      );
      return;
    }
    if (options.provider !== 'claude-code') {
      throw new Error('Unsupported telemetry provider. Use claude-code or grok.');
    }
    process.stdout.write(
      [
        'export CLAUDE_CODE_ENABLE_TELEMETRY=1',
        'export OTEL_METRICS_EXPORTER=otlp',
        'export OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
        `export OTEL_EXPORTER_OTLP_ENDPOINT=${state.origin}`,
        `export OTEL_EXPORTER_OTLP_HEADERS='Authorization=Bearer ${state.apiToken}'`,
        'export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta'
      ].join('\n') + '\n'
    );
  });

program
  .command('doctor')
  .description('print connector discovery and provider health diagnostics')
  .option('--json', 'emit machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const home = resolve(program.opts<{ home: string }>().home);
    const state = await requireDaemonState(home);
    const response = await fetch(`${state.origin}/api/doctor`, {
      headers: { authorization: `Bearer ${state.apiToken}` }
    });
    if (!response.ok) throw new Error('Daemon diagnostics are unavailable');
    const report = (await response.json()) as DoctorReport;
    process.stdout.write(
      options.json ? `${JSON.stringify(report)}\n` : `${formatDoctor(report)}\n`
    );
  });

program
  .command('export')
  .description('export redacted usage and cost rows')
  .option('--format <format>', 'json or csv', 'json')
  .option('--window <window>', 'history window: 24h, 7d, or 30d', '24h')
  .option('--include-account-identifiers', 'include available provider account identifiers')
  .action(
    async (options: { format: string; window: string; includeAccountIdentifiers?: boolean }) => {
      if (!['json', 'csv'].includes(options.format)) throw new Error('Use json or csv.');
      if (!['24h', '7d', '30d'].includes(options.window)) {
        throw new Error('Unsupported history window. Use 24h, 7d, or 30d.');
      }
      const home = resolve(program.opts<{ home: string }>().home);
      const state = await requireDaemonState(home);
      const parameters = new URLSearchParams({
        format: options.format,
        window: options.window,
        includeAccountIdentifiers: String(Boolean(options.includeAccountIdentifiers))
      });
      const response = await fetch(`${state.origin}/api/export?${parameters}`, {
        headers: { authorization: `Bearer ${state.apiToken}` }
      });
      if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);
      process.stdout.write(`${await response.text()}\n`);
    }
  );

program
  .command('retention')
  .description('show raw-observation retention and daily aggregation status')
  .option('--json', 'emit machine-readable JSON')
  .option('--compact', 'run compaction before showing status')
  .action(async (options: { json?: boolean; compact?: boolean }) => {
    const home = resolve(program.opts<{ home: string }>().home);
    const state = await requireDaemonState(home);
    const response = await fetch(
      `${state.origin}/api/retention${options.compact ? '/compact' : ''}`,
      {
        method: options.compact ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${state.apiToken}` }
      }
    );
    if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);
    const status = (await response.json()) as Record<string, unknown>;
    process.stdout.write(
      options.json
        ? `${JSON.stringify(status)}\n`
        : `${Object.entries(status)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join('\n')}\n`
    );
  });

program
  .command('clear')
  .description('clear local usage data and optionally product-owned Keychain entries')
  .option('--yes', 'confirm the destructive operation')
  .option('--include-product-secrets', 'also delete Agent Usage Keychain entries')
  .action(async (options: { yes?: boolean; includeProductSecrets?: boolean }) => {
    if (!options.yes) throw new Error('Refusing to clear data without --yes.');
    const home = resolve(program.opts<{ home: string }>().home);
    const state = await requireDaemonState(home);
    const response = await fetch(`${state.origin}/api/data`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${state.apiToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ deleteProductSecrets: Boolean(options.includeProductSecrets) })
    });
    if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);
    const result = (await response.json()) as { productSecretsDeleted: number };
    process.stdout.write(
      `Cleared local usage data; deleted ${result.productSecretsDeleted} product secret(s).\n`
    );
  });

program
  .command('discover')
  .description('discover supported local agent clients')
  .option('--json', 'emit machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const home = resolve(program.opts<{ home: string }>().home);
    const state = await requireDaemonState(home);
    const response = await fetch(`${state.origin}/api/connectors/discover`, {
      method: 'POST',
      headers: { authorization: `Bearer ${state.apiToken}` }
    });
    if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);
    const connectors = (await response.json()) as Array<{
      displayName: string;
      state: string;
      installed: boolean;
    }>;
    if (options.json) process.stdout.write(`${JSON.stringify(connectors)}\n`);
    else {
      process.stdout.write(
        `${connectors
          .map(
            (connector) =>
              `${connector.displayName} — ${connector.state}${connector.installed ? '' : ' (not installed)'}`
          )
          .join('\n')}\n`
      );
    }
  });

program
  .command('monitoring')
  .description('show background collection, notification, and start-at-login settings')
  .option('--json', 'emit machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const home = resolve(program.opts<{ home: string }>().home);
    const state = await requireDaemonState(home);
    const response = await fetch(`${state.origin}/api/monitoring`, {
      headers: { authorization: `Bearer ${state.apiToken}` }
    });
    if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);
    const status = (await response.json()) as {
      settings: Record<string, unknown>;
      connectors: unknown[];
    };
    process.stdout.write(
      options.json
        ? `${JSON.stringify(status)}\n`
        : `${Object.entries(status.settings)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join('\n')}\n`
    );
  });

program
  .command('start-at-login <action>')
  .description('enable, disable, or show start-at-login state')
  .action(async (action: string) => {
    if (!['enable', 'disable', 'status'].includes(action)) {
      throw new Error('Use enable, disable, or status.');
    }
    const home = resolve(program.opts<{ home: string }>().home);
    const state = await requireDaemonState(home);
    if (action !== 'status') {
      const response = await fetch(`${state.origin}/api/monitoring/settings`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${state.apiToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ startAtLogin: action === 'enable' })
      });
      if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);
    }
    const response = await fetch(`${state.origin}/api/monitoring`, {
      headers: { authorization: `Bearer ${state.apiToken}` }
    });
    if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);
    const status = (await response.json()) as { settings: { startAtLogin: boolean } };
    process.stdout.write(`${status.settings.startAtLogin ? 'enabled' : 'disabled'}\n`);
  });

const ratesCommand = program
  .command('rates')
  .description('view and manage custom model rates for custom endpoints');

ratesCommand
  .command('list')
  .description('list configured custom model rates')
  .option('--json', 'emit machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const home = resolve(program.opts<{ home: string }>().home);
    const state = await requireDaemonState(home);
    const response = await fetch(`${state.origin}/api/custom-rates`, {
      headers: { authorization: `Bearer ${state.apiToken}` }
    });
    if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);
    const data = (await response.json()) as { rates: CustomModelRate[] };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(data.rates, null, 2)}\n`);
      return;
    }
    if (data.rates.length === 0) {
      process.stdout.write('No custom model rates configured.\n');
      return;
    }
    for (const rate of data.rates) {
      const domain = rate.billingDomainId ?? '*';
      process.stdout.write(
        `${rate.id} | ${rate.providerId} | domain: ${domain} | model: ${rate.model} | in: $${rate.ratesPerMillion.input}/M | out: $${rate.ratesPerMillion.output}/M | cache: $${rate.ratesPerMillion.cacheRead}/M\n`
      );
    }
  });

ratesCommand
  .command('set <model>')
  .description('set custom model rate')
  .requiredOption('--provider <provider>', 'provider id (e.g. dsh)')
  .option('--domain <domain>', 'billing domain id (omit for wildcard across all routes)')
  .requiredOption('--input <rate>', 'input rate in USD per million tokens', parseFloat)
  .requiredOption('--output <rate>', 'output rate in USD per million tokens', parseFloat)
  .option('--cache-read <rate>', 'cache read rate in USD per million tokens', parseFloat, 0)
  .action(
    async (
      model: string,
      options: { provider: string; domain?: string; input: number; output: number; cacheRead: number }
    ) => {
      const home = resolve(program.opts<{ home: string }>().home);
      const state = await requireDaemonState(home);
      const response = await fetch(`${state.origin}/api/custom-rates`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${state.apiToken}`,
          'content-type': 'application/json',
          origin: state.origin
        },
        body: JSON.stringify({
          providerId: options.provider,
          billingDomainId: options.domain || null,
          model,
          inputRate: options.input,
          outputRate: options.output,
          cacheReadRate: options.cacheRead
        })
      });
      if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);
      const data = (await response.json()) as { rate: CustomModelRate };
      process.stdout.write(`Custom model rate configured for ${data.rate.model} (ID: ${data.rate.id})\n`);
    }
  );

ratesCommand
  .command('delete <id>')
  .description('delete custom model rate by ID')
  .action(async (id: string) => {
    const home = resolve(program.opts<{ home: string }>().home);
    const state = await requireDaemonState(home);
    const response = await fetch(`${state.origin}/api/custom-rates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${state.apiToken}`,
        origin: state.origin
      }
    });
    if (!response.ok) throw new Error(`Daemon returned HTTP ${response.status}`);
    process.stdout.write(`Deleted custom model rate ${id}\n`);
  });

program
  .command('serve')
  .description('run the internal local daemon')
  .action(async () => {
    const home = resolve(program.opts<{ home: string }>().home);
    const { runDaemon } = await import('./server/runtime.js');
    await runDaemon(home);
  });

program.action(async () => {
  const options = program.opts<{ home: string; open: boolean }>();
  const home = resolve(options.home);
  const state = await ensureDaemon(home);
  const response = await fetch(`${state.origin}/api/launch-token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${state.apiToken}` }
  });
  if (!response.ok)
    throw new Error(`Unable to create dashboard launch URL (HTTP ${response.status})`);
  const body = (await response.json()) as { url: string };
  if (options.open) {
    await open(body.url);
  }
  process.stdout.write(`${body.url}\n`);
});

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = publicErrorMessage(error);
  process.stderr.write(`agent-usage: ${message}\n`);
  process.exitCode = 1;
});

async function requireDaemonState(home: string): Promise<DaemonState> {
  try {
    const state = await readDaemonState(home);
    if (await isHealthy(state)) return state;
  } catch {
    // Normalize missing, malformed, and stale state into one actionable message.
  }
  throw new Error('Local daemon is not running');
}

async function ensureDaemon(home: string): Promise<DaemonState> {
  try {
    return await requireDaemonState(home);
  } catch {
    process.stderr.write('Agent Usage: starting local web service…\n');
    const child = spawn(
      process.execPath,
      [...process.execArgv, process.argv[1], '--home', home, 'serve'],
      {
        detached: true,
        env: { ...process.env, AGENT_USAGE_DAEMON: '1' },
        stdio: 'ignore'
      }
    );
    child.unref();
  }

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const state = await readDaemonState(home);
      if (await isHealthy(state)) {
        process.stderr.write(
          'Agent Usage: web service ready; usage data is updating in the background.\n'
        );
        return state;
      }
    } catch {
      // The child has not written a valid state file yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('Local daemon did not become ready');
}

async function isHealthy(state: DaemonState): Promise<boolean> {
  if (!(await originIsListening(state.origin))) return false;
  try {
    const response = await fetch(`${state.origin}/api/health`, {
      headers: { authorization: `Bearer ${state.apiToken}` },
      signal: AbortSignal.timeout(5_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

// A daemon that is still starting is looked for over a plain socket rather than with a request
// abandoned half a second later. Waiting for a cold start asks well over a hundred times, and a
// request torn down mid-connect can throw from inside Node's own socket callbacks, past the
// `try` around it, ending the command instead of starting the dashboard.
async function originIsListening(origin: string): Promise<boolean> {
  const { hostname, port } = new URL(origin);
  return await new Promise((resolveListening) => {
    const socket = tcpConnect({ host: hostname, port: Number(port) });
    const settle = (listening: boolean) => {
      socket.destroy();
      resolveListening(listening);
    };
    socket.setTimeout(500, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

function formatOverview(overview: UsageOverview): string {
  const summary = formatGlobalSummary(overview);
  if (overview.providers.length === 0) {
    return `${summary}No providers have reported usage yet.\n`;
  }
  const recommendation = overview.riskSummary.recommendation
    ? `Recommendation: ${overview.riskSummary.recommendation.displayName} · ${overview.riskSummary.recommendation.billingDomainId} — ${overview.riskSummary.recommendation.reasonKeys
        .map((reason) =>
          reason === 'forecast-lasts-until-reset'
            ? 'forecast lasts through reset'
            : 'highest safe capacity among fresh providers'
        )
        .join('; ')} (${formatEvidence(
        overview.riskSummary.recommendation.evidence.authority ?? 'unavailable',
        overview.riskSummary.recommendation.evidence.observedAt
      )}; advice only)\n`
    : '';
  return `${summary}${recommendation}${overview.providers
    .map((provider) => {
      const quota = provider.quotaBuckets
        .map(
          (bucket) =>
            `${bucket.label}: ${bucket.usedPercent ?? '?'}% used (${formatEvidence(
              bucket.authority,
              bucket.observedAt ?? provider.freshness.lastSuccessAt
            )})`
        )
        .join(', ');
      const diagnostic =
        provider.health.status === 'degraded'
          ? ` — degraded: ${provider.health.message} ${provider.health.recovery}`
          : '';
      const domains = provider.billingDomains
        .map((domain) => {
          const costs = domain.history.costs
            .map(
              (cost) =>
                `${cost.kind} ${
                  cost.amount === null ? 'unknown' : `${cost.amount} ${cost.currency}`
                } (${formatEvidence(
                  cost.authorities?.join('+') ?? 'unavailable',
                  cost.observedAt
                )})`
            )
            .join(', ');
          return `${domain.displayName}: ${domain.history.window} ${domain.history.tokenTotals.total} tokens (${formatEvidence(
            domain.history.authorities?.join('+') ?? domain.tokenAuthority ?? 'unavailable',
            domain.history.lastObservedAt ??
              domain.freshness?.lastSuccessAt ??
              provider.freshness.lastSuccessAt
          )}; ${formatTokenEvidence(domain.history.tokenEvidence)})${costs ? `; ${costs}` : ''}`;
        })
        .join(' | ');
      return `${provider.displayName} — ${quota || 'quota unavailable'}${domains ? ` — ${domains}` : ''}${diagnostic}`;
    })
    .join('\n')}\n`;
}

function formatGlobalSummary(overview: UsageOverview): string {
  const summary = overview.globalSummary;
  const tokenAuthorities = [
    ...new Set(
      overview.providers.flatMap((provider) =>
        provider.billingDomains
          .filter((domain) => domain.id === provider.summaryBillingDomainId)
          .flatMap((domain) => domain.history.authorities ?? [])
      )
    )
  ].sort();
  const tokenObservedAt = overview.providers
    .flatMap((provider) =>
      provider.billingDomains
        .filter((domain) => domain.id === provider.summaryBillingDomainId)
        .flatMap((domain) => (domain.history.lastObservedAt ? [domain.history.lastObservedAt] : []))
    )
    .sort((left, right) => right.localeCompare(left))[0];
  const tokenEvidence = formatEvidence(
    tokenAuthorities.join('+') || 'unavailable',
    tokenObservedAt
  );
  const tokens =
    summary.recordedTokens === null
      ? 'recorded tokens unavailable'
      : `${summary.recordedTokens} recorded tokens (${tokenEvidence})`;
  const retailMetric = overview.workbench.costs.retailEquivalent;
  const retail =
    summary.apiRetailEquivalent.status === 'available' &&
    summary.apiRetailEquivalent.amount !== null
      ? `${summary.apiRetailEquivalent.amount} ${summary.apiRetailEquivalent.currency} (${formatEvidence(
          retailMetric.authorities.join('+') || 'unavailable',
          retailMetric.observedAt
        )})`
      : 'unavailable';
  const constrained = summary.mostConstrained
    ? `${summary.mostConstrained.displayName} · ${summary.mostConstrained.label} (${summary.mostConstrained.remainingPercent}% remaining; ${formatEvidence(
        summary.mostConstrained.authority ?? 'unavailable',
        summary.mostConstrained.observedAt
      )})`
    : 'unavailable';
  return `Summary (${summary.window}): ${tokens}; API retail equivalent ${retail}; ${summary.tokenEvidence.classifiedTokens}/${summary.tokenEvidence.recordedTokens} classified; precision ${summary.tokenEvidence.timePrecisions.join('+') || 'unavailable'}; most constrained ${constrained}; latest observed ${summary.latestObservedAt ?? 'unavailable'}; generated ${summary.generatedAt}\n`;
}

function formatTokenEvidence(
  evidence: UsageOverview['providers'][number]['tokenEvidence']
): string {
  const precisions =
    evidence.timePrecisions.length > 0 ? evidence.timePrecisions.join('+') : 'unknown';
  const scopes = evidence.usageScopes.length > 0 ? evidence.usageScopes.join('+') : 'unknown';
  const temporalities =
    evidence.aggregationTemporalities.length > 0
      ? evidence.aggregationTemporalities.join('+')
      : 'unknown';
  return `${evidence.classifiedTokens}/${evidence.recordedTokens} classified; ${evidence.unclassifiedTokens} unclassified; precision ${precisions}; scope ${scopes}; temporality ${temporalities}`;
}

function formatEvidence(authority: string, observedAt: string | null | undefined): string {
  return `source ${authority} at ${observedAt ?? 'unknown time'}`;
}

function formatDoctor(report: DoctorReport): string {
  const providerLines = report.providers.map((provider) =>
    provider.status === 'degraded'
      ? `${provider.displayName} — degraded${provider.health.errorCode ? ` (${provider.health.errorCode})` : ''}: ${provider.health.recovery ?? 'Run refresh and inspect connector diagnostics.'}`
      : `${provider.displayName} — healthy`
  );
  const connectorLines = report.connectors.map((connector) =>
    connector.status === 'degraded'
      ? `${connector.id} connection — ${connector.category}: ${connector.recovery}`
      : `${connector.id} connection — healthy`
  );
  return [
    `Daemon — ${report.daemon.status}`,
    `Database — ${report.database.status}`,
    ...providerLines,
    ...connectorLines
  ].join('\n');
}

function defaultHome(): string {
  return join(homedir(), 'Library', 'Application Support', 'Agent Usage');
}
