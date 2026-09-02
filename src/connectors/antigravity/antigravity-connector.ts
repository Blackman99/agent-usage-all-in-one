import type {
  BillingDomain,
  CollectionRequest,
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  QuotaBucket,
  UsageObservation
} from '../../core/types.js';
import type { AntigravitySqliteUsageClient } from '../../server/antigravity-sqlite-usage-client.js';
import { AntigravityQuotaClient } from '../../server/antigravity-quota-client.js';

export const ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID = 'code-assist-subscription';

export interface AntigravityQuotaLimits {
  rolling5hTokens?: number;
  weeklyTokens?: number;
}

export const DEFAULT_ANTIGRAVITY_QUOTA_LIMITS: Required<AntigravityQuotaLimits> = {
  rolling5hTokens: 15_000_000,
  weeklyTokens: 100_000_000
};

export interface AntigravityConnectorOptions {
  historyClient: AntigravitySqliteUsageClient;
  quotaClient?: AntigravityQuotaClient;
  clock?: () => Date;
  quotaLimits?: AntigravityQuotaLimits;
}

/**
 * Antigravity usage read from local conversation SQLite databases.
 *
 * Google Antigravity uses a dual-limit capacity model: a 5-hour rolling sprint
 * window and a weekly baseline limit. When official live quota is unavailable or
 * unwindowed, rolling 5-hour and weekly usage are derived from session observations.
 */
export class AntigravityConnector implements Connector {
  readonly id = 'antigravity';
  readonly displayName = 'Antigravity';
  readonly consentId = 'antigravity';
  readonly #historyClient: AntigravitySqliteUsageClient;
  readonly #quotaClient: AntigravityQuotaClient;
  readonly #clock: () => Date;
  readonly #quotaLimits: Required<AntigravityQuotaLimits>;

  constructor(options: AntigravityConnectorOptions) {
    this.#historyClient = options.historyClient;
    this.#quotaClient = options.quotaClient ?? new AntigravityQuotaClient();
    this.#clock = options.clock ?? (() => new Date());
    this.#quotaLimits = {
      rolling5hTokens:
        options.quotaLimits?.rolling5hTokens ?? DEFAULT_ANTIGRAVITY_QUOTA_LIMITS.rolling5hTokens,
      weeklyTokens:
        options.quotaLimits?.weeklyTokens ?? DEFAULT_ANTIGRAVITY_QUOTA_LIMITS.weeklyTokens
    };
  }

  async collect(options: CollectionRequest = { mode: 'incremental' }): Promise<ConnectorSnapshot> {
    const observedAt = this.#clock().toISOString();
    const nowMs = this.#clock().getTime();
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
    let quotaBuckets: QuotaBucket[] = [];

    try {
      const liveQuota = await this.#quotaClient.readQuota();
      if (liveQuota && liveQuota.length > 0) {
        quotaBuckets = [...liveQuota];
      }
    } catch {
      // Degrade gracefully to local observation buckets
    }

    const localBuckets = buildAntigravityQuotaBuckets(usage, nowMs, this.#quotaLimits);
    const has5h = quotaBuckets.some((b) => b.label === '5 hour' || b.id === 'gemini-5h');
    const hasWeekly = quotaBuckets.some((b) => b.label === 'Week' || b.id === 'gemini-weekly');

    if (!has5h || !hasWeekly) {
      for (const localBucket of localBuckets) {
        if (!quotaBuckets.some((b) => b.id === localBucket.id || b.label === localBucket.label)) {
          quotaBuckets.push(localBucket);
        }
      }
    }

    return {
      provider: { id: this.id, displayName: this.displayName },
      billingDomains: billingDomains(usage),
      quotaBuckets,
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

export function buildAntigravityQuotaBuckets(
  usage: UsageObservation[],
  nowMs: number,
  limits: Required<AntigravityQuotaLimits> = DEFAULT_ANTIGRAVITY_QUOTA_LIMITS
): QuotaBucket[] {
  const fiveHoursMs = 300 * 60 * 1000;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const cutoff5h = nowMs - fiveHoursMs;
  const cutoff7d = nowMs - sevenDaysMs;

  const obs5h: UsageObservation[] = [];
  const obs7d: UsageObservation[] = [];

  for (const obs of usage) {
    const t = new Date(obs.observedAt).getTime();
    if (t >= cutoff5h) obs5h.push(obs);
    if (t >= cutoff7d) obs7d.push(obs);
  }

  // 5-hour rolling sprint window
  const tokens5h = obs5h.reduce(
    (acc, obs) => acc + obs.inputTokens + obs.outputTokens + obs.cacheReadTokens,
    0
  );
  const usedPercent5h = Math.min(100, Math.round((tokens5h / limits.rolling5hTokens) * 100));

  let resetsAt5h: string;
  if (obs5h.length > 0) {
    const oldestMs = Math.min(...obs5h.map((o) => new Date(o.observedAt).getTime()));
    resetsAt5h = new Date(oldestMs + fiveHoursMs).toISOString();
  } else {
    resetsAt5h = new Date(nowMs + fiveHoursMs).toISOString();
  }

  // Weekly baseline quota window
  const tokens7d = obs7d.reduce(
    (acc, obs) => acc + obs.inputTokens + obs.outputTokens + obs.cacheReadTokens,
    0
  );
  const usedPercent7d = Math.min(100, Math.round((tokens7d / limits.weeklyTokens) * 100));

  let resetsAt7d: string;
  if (obs7d.length > 0) {
    const oldestMs = Math.min(...obs7d.map((o) => new Date(o.observedAt).getTime()));
    resetsAt7d = new Date(oldestMs + sevenDaysMs).toISOString();
  } else {
    resetsAt7d = new Date(nowMs + sevenDaysMs).toISOString();
  }

  return [
    {
      id: 'gemini-5h',
      billingDomainId: ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID,
      label: '5 hour',
      usedPercent: usedPercent5h,
      windowDurationMinutes: 300,
      resetsAt: resetsAt5h,
      authority: 'local-observation',
      scope: 'local-only'
    },
    {
      id: 'gemini-weekly',
      billingDomainId: ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID,
      label: 'Week',
      usedPercent: usedPercent7d,
      windowDurationMinutes: 10_080,
      resetsAt: resetsAt7d,
      authority: 'local-observation',
      scope: 'local-only'
    }
  ];
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
    recovery:
      'Agent Usage will retry automatically on the next scan without removing stored history.'
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
