import type {
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  QuotaBucket
} from '../../core/types.js';
import type { ParsedClaudeQuota } from './claude-usage-screen-client.js';

export interface ClaudeQuotaClient {
  readQuota(): Promise<ParsedClaudeQuota[]>;
}

export interface ClaudeCodeConnectorOptions {
  quotaClient: ClaudeQuotaClient;
  clock?: () => Date;
}

export class ClaudeCodeConnector implements Connector {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly consentId = 'claude-code';
  readonly #quotaClient: ClaudeQuotaClient;
  readonly #clock: () => Date;

  constructor(options: ClaudeCodeConnectorOptions) {
    this.#quotaClient = options.quotaClient;
    this.#clock = options.clock ?? (() => new Date());
  }

  async collect(): Promise<ConnectorSnapshot> {
    const observedAt = this.#clock().toISOString();
    let quota: ParsedClaudeQuota[] = [];
    const warnings: ConnectorFailure[] = [];
    try {
      quota = await this.#quotaClient.readQuota();
    } catch (error) {
      warnings.push(safeFailure(error));
    }
    return {
      provider: { id: this.id, displayName: this.displayName },
      billingDomains: [{ id: 'subscription', displayName: 'Claude subscription' }],
      quotaBuckets: quota.map(mapQuota),
      usage: [],
      costs: [],
      warnings,
      observedAt
    };
  }
}

function mapQuota(quota: ParsedClaudeQuota): QuotaBucket {
  return {
    id: quota.id,
    billingDomainId: 'subscription',
    label: quota.label,
    usedPercent: quota.usedPercent,
    resetsAt: quota.resetsAt,
    authority: 'official-client',
    scope: 'account-wide'
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
    code: 'claude-quota-adapter-failed',
    message: 'Claude Code subscription quota is unavailable.',
    recovery: 'Open Claude Code, run /usage, and update Claude Code before retrying.'
  };
}
