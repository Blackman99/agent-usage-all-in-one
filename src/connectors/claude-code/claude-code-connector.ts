import type {
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  QuotaBucket
} from '../../core/types.js';
import type { ParsedClaudeQuota } from './claude-usage-screen-client.js';
import type { TranscriptUsageClient } from '../../server/local-transcript-usage-client.js';

export interface ClaudeQuotaClient {
  readQuota(): Promise<ParsedClaudeQuota[]>;
}

export interface ClaudeCodeConnectorOptions {
  quotaClient: ClaudeQuotaClient;
  historyClient?: TranscriptUsageClient;
  clock?: () => Date;
}

export class ClaudeCodeConnector implements Connector {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly consentId = 'claude-code';
  readonly #quotaClient: ClaudeQuotaClient;
  readonly #historyClient?: TranscriptUsageClient;
  readonly #clock: () => Date;

  constructor(options: ClaudeCodeConnectorOptions) {
    this.#quotaClient = options.quotaClient;
    this.#historyClient = options.historyClient;
    this.#clock = options.clock ?? (() => new Date());
  }

  async collect(options: { forceRebuild?: boolean } = {}): Promise<ConnectorSnapshot> {
    const observedAt = this.#clock().toISOString();
    let quota: ParsedClaudeQuota[] = [];
    const warnings: ConnectorFailure[] = [];
    try {
      quota = await this.#quotaClient.readQuota();
    } catch (error) {
      warnings.push(safeFailure(error));
    }
    const history = this.#historyClient
      ? await this.#historyClient.readUsage(options)
      : { usage: [], costs: [], complete: true };
    if (!history.complete) warnings.push(incompleteTranscriptFailure('Claude Code'));
    return {
      provider: { id: this.id, displayName: this.displayName },
      billingDomains: [{ id: 'subscription', displayName: 'Claude subscription' }],
      quotaBuckets: quota.map(mapQuota),
      usage: history.usage,
      ...(history.usage.length > 0 && history.complete
        ? {
            usageReconciliation: {
              authoritativeIdPrefix: 'claude-transcript:',
              retiredIdPrefixes: ['claude-otel:']
            }
          }
        : {}),
      costs: history.costs,
      warnings,
      observedAt
    };
  }
}

function incompleteTranscriptFailure(provider: string): ConnectorFailure {
  return {
    code: 'local-transcript-scan-incomplete',
    message: `Some local ${provider} history could not be read.`,
    recovery: 'Agent Usage will retry automatically without removing stored history.'
  };
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
