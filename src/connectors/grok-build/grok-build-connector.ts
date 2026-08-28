import { z } from 'zod';

import type {
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  QuotaBucket
} from '../../core/types.js';
import type { TranscriptUsageClient } from '../../server/local-transcript-usage-client.js';

const centSchema = z.object({ val: z.number().default(0) }).passthrough();
const usagePeriodSchema = z
  .object({
    type: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional()
  })
  .passthrough();
const billingConfigSchema = z
  .object({
    creditUsagePercent: z.number().min(0).max(100).optional(),
    currentPeriod: usagePeriodSchema.optional(),
    monthlyLimit: centSchema.optional(),
    used: centSchema.optional(),
    billingPeriodStart: z.string().optional(),
    billingPeriodEnd: z.string().optional(),
    isUnifiedBillingUser: z.boolean().optional()
  })
  .passthrough();

export const grokBillingResponseSchema = z
  .object({
    config: billingConfigSchema.nullable(),
    onDemandEnabled: z.boolean().nullable().optional(),
    subscriptionTier: z.string().optional(),
    sourceObservedAt: z.string().datetime({ offset: true }).optional()
  })
  .passthrough();

export type GrokBuildBilling = z.infer<typeof grokBillingResponseSchema>;

export interface GrokBuildBillingClient {
  readBilling(): Promise<GrokBuildBilling>;
}

export interface GrokBuildConnectorOptions {
  billingClient: GrokBuildBillingClient;
  historyClient?: TranscriptUsageClient;
  clock?: () => Date;
}

export class GrokBuildConnector implements Connector {
  readonly id = 'grok';
  readonly displayName = 'Grok';
  readonly consentId = 'grok';
  readonly #billingClient: GrokBuildBillingClient;
  readonly #historyClient?: TranscriptUsageClient;
  readonly #clock: () => Date;

  constructor(options: GrokBuildConnectorOptions) {
    this.#billingClient = options.billingClient;
    this.#historyClient = options.historyClient;
    this.#clock = options.clock ?? (() => new Date());
  }

  async collect(options: { forceRebuild?: boolean } = {}): Promise<ConnectorSnapshot> {
    const warnings: ConnectorFailure[] = [];
    let quotaBuckets: QuotaBucket[] = [];
    let observedAt = this.#clock().toISOString();
    try {
      const billing = await this.#billingClient.readBilling();
      observedAt = billing.sourceObservedAt ?? observedAt;
      quotaBuckets = mapBillingQuota(billing);
      if (quotaBuckets.length === 0) {
        warnings.push({
          code: 'grok-subscription-quota-unavailable',
          message: 'Grok Build subscription quota is unavailable.',
          recovery: 'Open Grok Build and run /usage, then retry refresh.'
        });
      }
    } catch (error) {
      warnings.push(safeFailure(error));
    }
    const history = this.#historyClient
      ? await this.#historyClient.readUsage(options)
      : { usage: [], costs: [], complete: true };
    if (!history.complete) warnings.push(incompleteTranscriptFailure());

    return {
      provider: { id: this.id, displayName: this.displayName },
      billingDomains: [grokBuildBillingDomain()],
      quotaBuckets,
      usage: history.usage,
      ...(history.usage.length > 0 && history.complete
        ? {
            usageReconciliation: {
              authoritativeIdPrefix: 'grok-transcript:',
              retiredIdPrefixes: ['grok-otel:', 'grok-headless:']
            }
          }
        : {}),
      costs: history.costs,
      warnings,
      observedAt
    };
  }
}

function incompleteTranscriptFailure(): ConnectorFailure {
  return {
    code: 'local-transcript-scan-incomplete',
    message: 'Some local Grok history could not be read.',
    recovery: 'Agent Usage will retry automatically without removing stored history.'
  };
}

export function grokBuildBillingDomain(): { id: string; displayName: string } {
  return {
    id: 'grok-build-subscription',
    displayName: 'Grok Build / SuperGrok shared pool'
  };
}

function mapBillingQuota(billing: GrokBuildBilling): QuotaBucket[] {
  const config = billing.config;
  if (!config) return [];

  const usedPercent =
    config.creditUsagePercent ?? derivePercent(config.used?.val, config.monthlyLimit?.val);
  if (usedPercent === null) return [];

  const periodType = config.currentPeriod?.type;
  const period = nativePeriod(periodType, config.currentPeriod ? undefined : 'monthly');
  const resetsAt = config.currentPeriod?.end ?? config.billingPeriodEnd ?? null;

  return [
    {
      id: `grok-build:${period.id}`,
      billingDomainId: 'grok-build-subscription',
      label: period.label,
      usedPercent,
      resetsAt,
      authority: 'official-client',
      scope: 'account-wide',
      status: billing.subscriptionTier ?? null
    }
  ];
}

function nativePeriod(
  type: string | undefined,
  fallback?: 'monthly'
): {
  id: string;
  label: string;
} {
  if (type === 'USAGE_PERIOD_TYPE_WEEKLY') return { id: 'weekly', label: 'Weekly limit' };
  if (type === 'USAGE_PERIOD_TYPE_MONTHLY' || fallback === 'monthly') {
    return { id: 'monthly', label: 'Monthly limit' };
  }
  return { id: 'usage', label: 'Usage' };
}

function derivePercent(used: number | undefined, limit: number | undefined): number | null {
  if (used === undefined || limit === undefined || limit <= 0) return null;
  return Math.min(100, Math.max(0, (used / limit) * 100));
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
    code: 'grok-billing-adapter-failed',
    message: 'Grok Build subscription quota is unavailable.',
    recovery: 'Open Grok Build and run /usage, then update Grok Build before retrying.'
  };
}
