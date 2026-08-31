import type {
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  QuotaBucket
} from '../../core/types.js';
import type { OpenCodeGoUsageResponse } from './official-opencode-go-client.js';

export interface OpenCodeGoAccountClient {
  readUsage(): Promise<OpenCodeGoUsageResponse>;
}

export interface OpenCodeLocalRequest {
  id: string;
  providerId: string;
  model: string;
  cost: number | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  observedAtMs: number;
}

export interface OpenCodeGoLocalHistoryClient {
  readHistory(): Promise<OpenCodeLocalRequest[]>;
}

export interface OpenCodeGoConnectorOptions {
  accountClient: OpenCodeGoAccountClient;
  localHistoryClient: OpenCodeGoLocalHistoryClient;
  clock?: () => Date;
}

const LIMITS = {
  rolling: { label: '5 hour', amount: 12, windowDurationMinutes: 300 },
  weekly: { label: 'Week', amount: 30, windowDurationMinutes: 10_080 },
  monthly: { label: 'Month', amount: 60, windowDurationMinutes: 43_200 }
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
    return {
      provider: { id: this.id, displayName: this.displayName },
      billingDomains: [{ id: 'go-subscription', displayName: 'OpenCode Go subscription' }],
      quotaBuckets: account ? mapQuota(account) : [],
      usage: [],
      ...(localResult.status === 'fulfilled'
        ? {
            usageReconciliation: {
              authoritativeIdPrefixes: ['opencode-request:'],
              retiredIdPrefixes: ['opencode-session:']
            }
          }
        : {}),
      costs: [],
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
    windowDurationMinutes: LIMITS[id].windowDurationMinutes,
    resetsAt: response.usage[id].resetsAt,
    authority: 'official-account',
    scope: 'account-wide',
    status: response.usage[id].status,
    limitAmount: LIMITS[id].amount,
    limitCurrency: 'USD',
    fallbackStatus: 'unknown'
  }));
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
