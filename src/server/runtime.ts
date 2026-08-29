import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UsageApplication } from '../core/usage-application.js';
import type { Connector } from '../core/types.js';
import { defaultConnectorDefinitions } from '../connectors/catalog.js';
import { ClaudeCodeConnector } from '../connectors/claude-code/claude-code-connector.js';
import { parseClaudeOtlpMetrics } from '../connectors/claude-code/claude-otlp.js';
import { ScreenReaderClaudeQuotaClient } from '../connectors/claude-code/claude-usage-screen-client.js';
import { CodexConnector } from '../connectors/codex/codex-connector.js';
import { StdioCodexAccountClient } from '../connectors/codex/stdio-codex-account-client.js';
import { OpenCodeLocalConnector } from '../connectors/opencode-local/opencode-local-connector.js';
import { CliOpenCodeLocalHistoryClient } from '../connectors/opencode-go/local-opencode-history-client.js';
import { OfficialOpenCodeGoClient } from '../connectors/opencode-go/official-opencode-go-client.js';
import { OpenCodeAuthFileReader } from '../connectors/opencode-go/opencode-auth-reader.js';
import { OpenCodeGoConnector } from '../connectors/opencode-go/opencode-go-connector.js';
import { GrokBuildConnector } from '../connectors/grok-build/grok-build-connector.js';
import { parseGrokOtlpMetrics } from '../connectors/grok-build/grok-telemetry.js';
import { StdioGrokBillingClient } from '../connectors/grok-build/stdio-grok-billing-client.js';
import {
  XaiApiConnector,
  XaiManagementApiClient
} from '../connectors/xai-api/xai-api-connector.js';
import { writeDaemonState } from './daemon-state.js';
import { CollectionScheduler } from './collection-scheduler.js';
import { EcbExchangeRateProvider } from './ecb-exchange-rate-provider.js';
import { MacOsKeychainSecretStore } from './keychain-secret-store.js';
import { MacOsNotifier } from './macos-notifier.js';
import { MacOsStartAtLoginManager } from './macos-start-at-login-manager.js';
import { startLocalServer } from './local-server.js';
import { PathDiscoveryProbe } from './path-discovery-probe.js';
import {
  LocalTranscriptUsageClient,
  type LocalTranscriptProvider
} from './local-transcript-usage-client.js';
import { SqliteUsageRepository } from './sqlite-usage-repository.js';

export async function runDaemon(home: string): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const repository = new SqliteUsageRepository(join(home, 'usage.sqlite'));
  const demoEnabled = process.env.AGENT_USAGE_DEMO === '1';
  const keychainService = process.env.AGENT_USAGE_KEYCHAIN_SERVICE;
  const launchAgentLabel = process.env.AGENT_USAGE_LAUNCH_AGENT_LABEL;
  const nodeImport = process.env.AGENT_USAGE_NODE_IMPORT;
  const secretStore = new MacOsKeychainSecretStore(undefined, {
    service: keychainService
  });
  const openCodeLocalHistoryClient = new CliOpenCodeLocalHistoryClient();
  const application = new UsageApplication({
    repository,
    connectors: [
      ...(demoEnabled ? [createDemoConnector()] : []),
      new CodexConnector(
        new StdioCodexAccountClient(),
        undefined,
        localTranscriptClient('codex', home)
      ),
      new ClaudeCodeConnector({
        quotaClient: new ScreenReaderClaudeQuotaClient(),
        historyClient: localTranscriptClient('claude-code', home)
      }),
      new OpenCodeGoConnector({
        accountClient: new OfficialOpenCodeGoClient({
          authReader: new OpenCodeAuthFileReader()
        }),
        localHistoryClient: openCodeLocalHistoryClient
      }),
      new OpenCodeLocalConnector({ localHistoryClient: openCodeLocalHistoryClient }),
      new GrokBuildConnector({
        billingClient: new StdioGrokBillingClient(),
        historyClient: localTranscriptClient('grok', home)
      }),
      new XaiApiConnector({ accountClient: new XaiManagementApiClient({ secretStore }) })
    ],
    connectorDefinitions: defaultConnectorDefinitions,
    discoveryProbe: new PathDiscoveryProbe(),
    secretStore,
    exchangeRateProvider: new EcbExchangeRateProvider(),
    notifier: new MacOsNotifier(),
    startAtLoginManager: new MacOsStartAtLoginManager({
      userHome: homedir(),
      executable: process.execPath,
      cliPath: process.argv[1],
      applicationHome: home,
      label: launchAgentLabel,
      nodeImport,
      environmentVariables: {
        AGENT_USAGE_DAEMON: '1',
        ...(keychainService ? { AGENT_USAGE_KEYCHAIN_SERVICE: keychainService } : {}),
        ...(launchAgentLabel ? { AGENT_USAGE_LAUNCH_AGENT_LABEL: launchAgentLabel } : {}),
        ...(nodeImport ? { AGENT_USAGE_NODE_IMPORT: nodeImport } : {}),
        ...(demoEnabled ? { AGENT_USAGE_DEMO: '1' } : {})
      }
    }),
    connectorPolicies: Object.fromEntries(
      ['codex', 'claude-code', 'opencode-go', 'opencode', 'grok', 'xai-api'].map((id) => [
        id,
        { minimumIntervalMs: 5 * 60 * 1000, timeoutMs: id === 'claude-code' ? 25_000 : 20_000 }
      ])
    ),
    telemetryIngestors: [
      {
        id: 'claude-code',
        consentId: 'claude-code',
        parse: parseClaudeOtlpMetrics
      },
      {
        id: 'grok',
        consentId: 'grok',
        parse: parseGrokOtlpMetrics
      }
    ]
  });
  process.stderr.write('Agent Usage: starting local web service…\n');
  const server = await startLocalServer({
    application,
    staticDirectory: locateStaticDirectory()
  });
  if (!demoEnabled) await repository.deleteDemoProviderDataAsync();
  await writeDaemonState(home, {
    pid: process.pid,
    origin: server.origin,
    apiToken: server.apiToken
  });
  process.stderr.write(`Agent Usage: web service ready at ${server.origin}\n`);
  process.stderr.write('Agent Usage: updating cached usage in the background…\n');
  void application.startBackgroundProcessing().then(() => {
    process.stderr.write('Agent Usage: background data update finished.\n');
  });
  const scheduler = new CollectionScheduler({ application });
  scheduler.start();

  await new Promise<void>((resolveStop) => {
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      scheduler.stop();
      await server.close();
      repository.close();
      await rm(join(home, 'daemon.json'), { force: true });
      resolveStop();
    };
    process.once('SIGTERM', () => void stop());
    process.once('SIGINT', () => void stop());
  });
}

function localTranscriptClient(
  provider: LocalTranscriptProvider,
  applicationHome: string
): LocalTranscriptUsageClient {
  return new LocalTranscriptUsageClient({
    provider,
    root: localTranscriptRoot(provider),
    cachePath: join(applicationHome, 'cache', `${provider}-transcripts.json`)
  });
}

function localTranscriptRoot(provider: LocalTranscriptProvider): string {
  if (provider === 'codex') {
    return join(resolveHomeOverride(process.env.CODEX_HOME, '.codex'), 'sessions');
  }
  if (provider === 'claude-code') {
    return join(resolveHomeOverride(process.env.CLAUDE_CONFIG_DIR, '.claude'), 'projects');
  }
  return join(resolveHomeOverride(process.env.GROK_HOME, '.grok'), 'sessions');
}

function resolveHomeOverride(value: string | undefined, fallback: string): string {
  const configured = value?.trim();
  if (!configured) return join(homedir(), fallback);
  if (configured === '~') return homedir();
  if (configured.startsWith('~/')) return join(homedir(), configured.slice(2));
  return isAbsolute(configured) ? configured : resolve(configured);
}

function createDemoConnector(): Connector {
  return {
    id: 'demo',
    async collect() {
      const now = new Date();
      const reset = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      return {
        provider: { id: 'demo', displayName: 'Demo Agent' },
        billingDomains: [{ id: 'subscription', displayName: 'Demo subscription' }],
        quotaBuckets: [
          {
            id: 'five-hour',
            billingDomainId: 'subscription',
            label: '5 hour',
            usedPercent: 42,
            resetsAt: reset.toISOString(),
            authority: 'official-account'
          }
        ],
        usage: [
          {
            id: 'demo-usage-v1',
            billingDomainId: 'subscription',
            model: 'demo-model',
            observedAt: now.toISOString(),
            inputTokens: 12_400,
            outputTokens: 3_100,
            cacheReadTokens: 8_000,
            cacheWriteTokens: 700,
            authority: 'official-account'
          }
        ],
        costs: [],
        observedAt: now.toISOString()
      };
    }
  };
}

function locateStaticDirectory(): string | undefined {
  const candidates = [
    fileURLToPath(new URL('./web', import.meta.url)),
    fileURLToPath(new URL('../../dist/web', import.meta.url))
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'index.html')));
}
