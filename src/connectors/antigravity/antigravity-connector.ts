import type {
  BillingDomain,
  CollectionRequest,
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  UsageObservation
} from '../../core/types.js';
import type { AntigravitySqliteUsageClient } from '../../server/antigravity-sqlite-usage-client.js';

export const ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID = 'code-assist-subscription';

export interface AntigravityConnectorOptions {
  historyClient: AntigravitySqliteUsageClient;
  clock?: () => Date;
}

/**
 * Antigravity usage read from local conversation SQLite databases.
 *
 * Google Antigravity publishes no local CLI quota query surface, so the
 * Provider contributes token evidence, turn history, and versioned API
 * retail equivalent from local SQLite generation records.
 */
export class AntigravityConnector implements Connector {
  readonly id = 'antigravity';
  readonly displayName = 'Antigravity';
  readonly consentId = 'antigravity';
  readonly #historyClient: AntigravitySqliteUsageClient;
  readonly #clock: () => Date;

  constructor(options: AntigravityConnectorOptions) {
    this.#historyClient = options.historyClient;
    this.#clock = options.clock ?? (() => new Date());
  }

  async collect(options: CollectionRequest = { mode: 'incremental' }): Promise<ConnectorSnapshot> {
    const observedAt = this.#clock().toISOString();
    const warnings: ConnectorFailure[] = [];
    let history: Awaited<ReturnType<AntigravitySqliteUsageClient['readUsage']>> | null = null;

    try {
      history = await this.#historyClient.readUsage(options);
    } catch {
      warnings.push(safeFailure());
    }


    if (history && !history.complete) {
      warnings.push(incompleteSessionScanFailure());
    }

    const usage = history?.usage ?? [];

    return {
      provider: { id: this.id, displayName: this.displayName },
      billingDomains: billingDomains(usage),
      quotaBuckets: [],
      usage,
      ...(usage.length > 0 && history?.complete
        ? {
            usageReconciliation: {
              authoritativeIdPrefixes: ['antigravity:'],
              retiredIdPrefixes: []
            }
          }
        : {}),
      costs: history?.costs ?? [],
      warnings,
      observedAt
    };
  }
}

function billingDomains(usage: UsageObservation[]): BillingDomain[] {
  const primary: BillingDomain = {
    id: ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID,
    displayName: 'Gemini Code Assist'
  };
  const observedRoutes = [...new Set(usage.map((obs) => obs.billingDomainId))]
    .filter((id) => id !== primary.id)
    .sort();

  return [primary, ...observedRoutes.map((id) => ({ id, displayName: id }))];
}

function incompleteSessionScanFailure(): ConnectorFailure {
  return {
    code: 'antigravity-session-scan-incomplete',
    message: 'Some local Antigravity conversation databases could not be read.',
    recovery: 'Agent Usage will retry automatically on the next scan without removing stored history.'
  };
}

function safeFailure(): ConnectorFailure {
  return {
    code: 'antigravity-sqlite-read-failed',
    message: 'Failed to read local Antigravity conversation stores.',
    recovery:
      'Check read permissions for ~/.gemini/antigravity-cli and ~/.gemini/antigravity directories.'
  };
}



