import type {
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  CostRecord,
  QuotaBucket,
  UsageObservation
} from '../../core/types.js';
import type { OpenCodeGoUsageResponse } from './official-opencode-go-client.js';

export interface OpenCodeGoAccountClient {
  readUsage(): Promise<OpenCodeGoUsageResponse>;
}

export interface OpenCodeLocalSession {
  id: string;
  model: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  observedAtMs: number;
}

export interface OpenCodeGoLocalHistoryClient {
  readHistory(): Promise<OpenCodeLocalSession[]>;
}

export interface OpenCodeGoConnectorOptions {
  accountClient: OpenCodeGoAccountClient;
  localHistoryClient: OpenCodeGoLocalHistoryClient;
  clock?: () => Date;
}

const LIMITS = {
  rolling: { label: '5 hour', amount: 12 },
  weekly: { label: 'Week', amount: 30 },
  monthly: { label: 'Month', amount: 60 }
} as const;

export class OpenCodeGoConnector implements Connector {
  readonly id = 'opencode-go';
  readonly displayName = 'OpenCode Go';
  readonly consentId = 'opencode-go';
  readonly #accountClient: OpenCodeGoAccountClient;
  readonly #localHistoryClient: OpenCodeGoLocalHistoryClient;
  readonly #clock: () => Date;

  constructor(options: OpenCodeGoConnectorOptions) {
    this.#accountClient = options.accountClient;
    this.#localHistoryClient = options.localHistoryClient;
    this.#clock = options.clock ?? (() => new Date());
  }

  async collect(): Promise<ConnectorSnapshot> {
    const observedAt = this.#clock().toISOString();
    const [accountResult, localResult] = await Promise.allSettled([
      this.#accountClient.readUsage(),
      this.#localHistoryClient.readHistory()
    ]);
    const warnings: ConnectorFailure[] = [];
    if (accountResult.status === 'rejected') warnings.push(safeFailure(accountResult.reason));
    if (localResult.status === 'rejected') warnings.push(safeFailure(localResult.reason));

    const account = accountResult.status === 'fulfilled' ? accountResult.value : null;
    const local = localResult.status === 'fulfilled' ? localResult.value : [];
    return {
      provider: { id: this.id, displayName: this.displayName },
      billingDomains: [{ id: 'go-subscription', displayName: 'OpenCode Go subscription' }],
      quotaBuckets: account ? mapQuota(account) : [],
      usage: local.map(mapLocalUsage),
      costs: [
        ...(account ? mapQuotaEstimates(account, observedAt) : []),
        ...local.map(mapLocalCost)
      ],
      warnings,
      observedAt
    };
  }
}

function mapQuota(response: OpenCodeGoUsageResponse): QuotaBucket[] {
  return (Object.keys(LIMITS) as Array<keyof typeof LIMITS>).map((id) => ({
    id,
    billingDomainId: 'go-subscription',
    label: LIMITS[id].label,
    usedPercent: response.usage[id].percent,
    resetsAt: response.usage[id].resetsAt,
    authority: 'official-account',
    scope: 'account-wide',
    status: response.usage[id].status,
    limitAmount: LIMITS[id].amount,
    limitCurrency: 'USD',
    fallbackStatus: 'unknown'
  }));
}

function mapQuotaEstimates(response: OpenCodeGoUsageResponse, observedAt: string): CostRecord[] {
  return (Object.keys(LIMITS) as Array<keyof typeof LIMITS>).map((id) => ({
    id: `opencode-quota-estimate:${id}`,
    sourceId: `opencode-go-plan-window:${id}`,
    billingDomainId: 'go-subscription',
    observedAt,
    kind: 'estimate',
    amount: (LIMITS[id].amount * response.usage[id].percent) / 100,
    currency: 'USD',
    authority: 'estimate',
    priceSnapshot: {
      id: 'opencode-go-plan-limits-v1',
      version: '2026-08-28',
      source: 'Documented OpenCode Go plan window limits',
      effectiveAt: '2026-08-28T00:00:00.000Z'
    }
  }));
}

function mapLocalUsage(session: OpenCodeLocalSession): UsageObservation {
  return {
    id: `opencode-session:${session.id}`,
    billingDomainId: 'go-subscription',
    model: session.model,
    observedAt: new Date(session.observedAtMs).toISOString(),
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    reasoningTokens: session.reasoningTokens,
    cacheReadTokens: session.cacheReadTokens,
    cacheWriteTokens: session.cacheWriteTokens,
    tokenSemantics: {
      reasoning: 'separate',
      cacheRead: 'separate',
      cacheWrite: 'separate'
    },
    modelAttribution: 'known',
    timePrecision: 'day',
    usageScope: 'this-mac',
    authority: 'local-observation'
  };
}

function mapLocalCost(session: OpenCodeLocalSession): CostRecord {
  return {
    id: `opencode-session-cost:${session.id}`,
    billingDomainId: 'go-subscription',
    observedAt: new Date(session.observedAtMs).toISOString(),
    kind: 'estimate',
    amount: session.cost,
    currency: 'USD',
    authority: 'local-observation',
    priceSnapshot: {
      id: 'opencode-export-reported-cost-v1',
      version: '2026-08-28',
      source: 'OpenCode local session export reported cost',
      effectiveAt: '2026-08-28T00:00:00.000Z'
    }
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
    code: 'opencode-go-refresh-failed',
    message: 'OpenCode Go coverage is incomplete.',
    recovery: 'Run agent-usage doctor, then retry refresh.'
  };
}
