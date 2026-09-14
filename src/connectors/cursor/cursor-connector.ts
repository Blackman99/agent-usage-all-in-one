import type {
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  QuotaBucket
} from '../../core/types.js';
import { clampPercent } from '../../core/quota-normalization.js';
import type { ParsedCursorUsage } from './cursor-usage-screen-client.js';

export const CURSOR_BILLING_DOMAIN_ID = 'cursor-subscription';
export const CURSOR_BILLING_DOMAIN_NAME = 'Cursor subscription';

export interface CursorQuotaClient {
  readUsage(): Promise<ParsedCursorUsage>;
}

export interface CursorAccountClient {
  readAccountIdentifier(): Promise<string | null>;
}

export interface CursorConnectorOptions {
  quotaClient: CursorQuotaClient;
  accountClient?: CursorAccountClient;
  clock?: () => Date;
}

export class CursorConnector implements Connector {
  readonly id = 'cursor';
  readonly displayName = 'Cursor';
  readonly consentId = 'cursor';
  readonly #quotaClient: CursorQuotaClient;
  readonly #accountClient?: CursorAccountClient;
  readonly #clock: () => Date;

  constructor(options: CursorConnectorOptions) {
    this.#quotaClient = options.quotaClient;
    this.#accountClient = options.accountClient;
    this.#clock = options.clock ?? (() => new Date());
  }

  async collect(): Promise<ConnectorSnapshot> {
    const observedAt = this.#clock().toISOString();
    const warnings: ConnectorFailure[] = [];
    let quotaBuckets: QuotaBucket[] = [];
    let completeQuotaBillingDomainIds: string[] | undefined;
    try {
      const usage = await this.#quotaClient.readUsage();
      completeQuotaBillingDomainIds = [CURSOR_BILLING_DOMAIN_ID];
      quotaBuckets = mapUsage(usage, observedAt);
    } catch (error) {
      warnings.push(safeFailure(error));
    }
    let accountIdentifier: string | null = null;
    if (this.#accountClient) {
      try {
        accountIdentifier = await this.#accountClient.readAccountIdentifier();
      } catch {
        accountIdentifier = null;
      }
    }
    return {
      provider: {
        id: this.id,
        displayName: this.displayName,
        accountIdentifier
      },
      billingDomains: [{ id: CURSOR_BILLING_DOMAIN_ID, displayName: CURSOR_BILLING_DOMAIN_NAME }],
      quotaBuckets,
      completeQuotaBillingDomainIds,
      usage: [],
      costs: [],
      warnings,
      observedAt
    };
  }
}

function mapUsage(usage: ParsedCursorUsage, observedAt: string): QuotaBucket[] {
  if (usage.kind === 'unmetered') return [];
  const buckets: QuotaBucket[] = [
    {
      id: 'included',
      billingDomainId: CURSOR_BILLING_DOMAIN_ID,
      label: 'Included',
      usedPercent: clampPercent(usage.included.usedPercent),
      resetsAt: null,
      resetLabel: usage.resetLabel,
      authority: 'official-client',
      observedAt,
      scope: 'account-wide'
    }
  ];
  if (usage.onDemand?.kind === 'fixed') {
    buckets.push({
      id: 'on-demand',
      billingDomainId: CURSOR_BILLING_DOMAIN_ID,
      label: 'On-Demand',
      usedPercent: usage.onDemand.usedPercent,
      usedAmount: usage.onDemand.usedAmount,
      limitAmount: usage.onDemand.limitAmount,
      limitCurrency: usage.onDemand.currency,
      resetsAt: null,
      resetLabel: usage.resetLabel,
      authority: 'official-client',
      observedAt,
      scope: 'account-wide',
      fallbackStatus: 'enabled'
    });
  } else if (usage.onDemand?.kind === 'unlimited') {
    buckets.push({
      id: 'on-demand',
      billingDomainId: CURSOR_BILLING_DOMAIN_ID,
      label: 'On-Demand',
      usedPercent: null,
      usedAmount: usage.onDemand.usedAmount,
      limitCurrency: usage.onDemand.currency,
      resetsAt: null,
      resetLabel: usage.resetLabel,
      authority: 'official-client',
      observedAt,
      scope: 'account-wide',
      fallbackStatus: 'enabled'
    });
  } else if (usage.onDemand?.kind === 'disabled') {
    buckets.push({
      id: 'on-demand',
      billingDomainId: CURSOR_BILLING_DOMAIN_ID,
      label: 'On-Demand',
      usedPercent: null,
      resetsAt: null,
      resetLabel: usage.resetLabel,
      authority: 'official-client',
      observedAt,
      scope: 'account-wide',
      fallbackStatus: 'disabled'
    });
  }
  return buckets;
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
    code: 'cursor-quota-adapter-failed',
    message: 'Cursor subscription quota is unavailable.',
    recovery: 'Open agent, run /usage, then retry.'
  };
}
