import type {
  BillingDomain,
  CollectionRequest,
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  UsageObservation
} from '../../core/types.js';
import {
  DSH_PRIMARY_BILLING_DOMAIN_ID,
  type TranscriptUsageClient
} from '../../server/local-transcript-usage-client.js';

export interface DshConnectorOptions {
  historyClient: TranscriptUsageClient;
  clock?: () => Date;
}

/**
 * dsh (DeepSeek Harness) usage read from its local session logs.
 *
 * dsh answers through pay-as-you-go provider routes rather than a subscription,
 * so it publishes no quota window: the Provider contributes token evidence and
 * history, and money arrives only as the versioned API retail equivalent. A
 * TUI layer composed on dsh — codsh, for example — keeps its conversations in
 * the same logs and is counted here rather than as a Provider of its own.
 */
export class DshConnector implements Connector {
  readonly id = 'dsh';
  readonly displayName = 'dsh';
  readonly consentId = 'dsh';
  readonly #historyClient: TranscriptUsageClient;
  readonly #clock: () => Date;

  constructor(options: DshConnectorOptions) {
    this.#historyClient = options.historyClient;
    this.#clock = options.clock ?? (() => new Date());
  }

  async collect(options: CollectionRequest = { mode: 'incremental' }): Promise<ConnectorSnapshot> {
    const observedAt = this.#clock().toISOString();
    const warnings: ConnectorFailure[] = [];
    let history: Awaited<ReturnType<TranscriptUsageClient['readUsage']>> | null = null;
    try {
      history = await this.#historyClient.readUsage(options);
    } catch (error) {
      // The failure is already named; adding a second warning about the gap it
      // caused would report one problem twice.
      warnings.push(safeFailure(error));
    }
    if (history?.unsupportedFormat) warnings.push(unsupportedFormatFailure());
    else if (history && !history.complete) warnings.push(incompleteSessionLogFailure());
    const usage = history?.usage ?? [];
    return {
      provider: { id: this.id, displayName: this.displayName },
      billingDomains: billingDomains(usage),
      quotaBuckets: [],
      usage,
      ...(usage.length > 0 && history?.complete
        ? {
            usageReconciliation: {
              authoritativeIdPrefixes: ['dsh-transcript:'],
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

/**
 * The billing domains this snapshot describes.
 *
 * A dsh billing domain is one of its provider route keys. The deployment
 * default is always present so the Provider keeps a domain to summarize even
 * before any request is observed, and it stays first because the Provider
 * headline follows the first declared domain. Any other route that actually
 * answered is added under its own key rather than folded into DeepSeek's.
 * @param usage - observations this collection produced.
 */
function billingDomains(usage: UsageObservation[]): BillingDomain[] {
  const primary = { id: DSH_PRIMARY_BILLING_DOMAIN_ID, displayName: 'DeepSeek API' };
  const observedRoutes = [...new Set(usage.map((observation) => observation.billingDomainId))]
    .filter((id) => id !== primary.id)
    .sort();
  // An unknown route names itself: inventing a product name for it would state
  // more than the log does.
  return [primary, ...observedRoutes.map((id) => ({ id, displayName: id }))];
}

function incompleteSessionLogFailure(): ConnectorFailure {
  return {
    code: 'dsh-session-log-scan-incomplete',
    message: 'Some local dsh session history could not be read.',
    recovery: 'Agent Usage will retry automatically without removing stored history.'
  };
}

function unsupportedFormatFailure(): ConnectorFailure {
  return {
    code: 'dsh-session-format-unsupported',
    message: 'A dsh session log declares an on-disk format this version does not read.',
    recovery: 'Update Agent Usage; stored dsh history from earlier scans is retained.'
  };
}

function safeFailure(error: unknown): ConnectorFailure {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    'recovery' in error &&
    typeof error.recovery === 'string'
  ) {
    return { code: error.code, message: error.message, recovery: error.recovery };
  }
  return {
    code: 'dsh-session-log-read-failed',
    message: 'Local dsh session history is unavailable.',
    recovery: 'Run agent-usage doctor, then retry refresh.'
  };
}
