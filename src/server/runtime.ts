import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UsageApplication } from '../core/usage-application.js';
import type { Connector } from '../core/types.js';
import { defaultConnectorDefinitions } from '../connectors/catalog.js';
import { ClaudeCodeConnector } from '../connectors/claude-code/claude-code-connector.js';
import { parseClaudeOtlpMetrics } from '../connectors/claude-code/claude-otlp.js';
import { ScreenReaderClaudeQuotaClient } from '../connectors/claude-code/claude-usage-screen-client.js';
import { CodexConnector } from '../connectors/codex/codex-connector.js';
import { StdioCodexAccountClient } from '../connectors/codex/stdio-codex-account-client.js';
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
import { SqliteUsageRepository } from './sqlite-usage-repository.js';

export async function runDaemon(home: string): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const repository = new SqliteUsageRepository(join(home, 'usage.sqlite'));
  const secretStore = new MacOsKeychainSecretStore();
  const application = new UsageApplication({
    repository,
    connectors: [
      ...(process.env.AGENT_USAGE_DEMO === '1' ? [createDemoConnector()] : []),
      new CodexConnector(new StdioCodexAccountClient()),
      new ClaudeCodeConnector({ quotaClient: new ScreenReaderClaudeQuotaClient() }),
      new OpenCodeGoConnector({
        accountClient: new OfficialOpenCodeGoClient({
          authReader: new OpenCodeAuthFileReader()
        }),
        localHistoryClient: new CliOpenCodeLocalHistoryClient()
      }),
      new GrokBuildConnector({ billingClient: new StdioGrokBillingClient() }),
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
      applicationHome: home
    }),
    connectorPolicies: Object.fromEntries(
      ['codex', 'claude-code', 'opencode-go', 'grok', 'xai-api'].map((id) => [
        id,
        { minimumIntervalMs: 5 * 60 * 1000, timeoutMs: 20_000 }
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
  await application.refresh();
  await application.discoverConnectors();
  const server = await startLocalServer({
    application,
    staticDirectory: locateStaticDirectory()
  });
  await writeDaemonState(home, {
    pid: process.pid,
    origin: server.origin,
    apiToken: server.apiToken
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
