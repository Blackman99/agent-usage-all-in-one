import type {
  DataAuthority,
  ExchangeRateSnapshot,
  PlanBillingPeriod,
  PlanCatalog,
  PlanCatalogEntry,
  PlanSubscription,
  WorkbenchMoneyMetric,
  WorkbenchPlanBillingPeriod,
  WorkbenchPlanMoneyAmount,
  WorkbenchPlanValue,
  WorkbenchPlanValueEntry,
  WorkbenchPlanValueMeteredDomain,
  WorkbenchPlanValueUnconfiguredDomain
} from './types.js';

export type { PlanCatalog, PlanCatalogEntry };

/**
 * Average calendar lengths. A plan price is prorated over the average length of
 * its own billing period so a 30-day window is not silently charged a full
 * month.
 */
export const PLAN_PERIOD_DAYS: Record<PlanBillingPeriod, number> = {
  monthly: 365.25 / 12,
  annual: 365.25
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const STALE_RATE_MILLISECONDS = 7 * MILLISECONDS_PER_DAY;

/**
 * Preset subscription prices. Every entry cites the official page it was read
 * from; a plan whose official price could not be read is absent rather than
 * guessed, and the user enters it manually. Presets stay editable because
 * regional pricing, annual billing, and team seats are not represented here.
 */
export const SUBSCRIPTION_PLAN_CATALOG: PlanCatalog = {
  version: '2026-08-30',
  entries: [
    {
      id: 'claude-pro-monthly',
      providerId: 'claude-code',
      billingDomainId: 'subscription',
      displayName: 'Claude Pro',
      amount: 20,
      currency: 'USD',
      billingPeriod: 'monthly',
      source: {
        title: 'Claude plans and pricing',
        url: 'https://claude.com/pricing',
        retrievedAt: '2026-08-30'
      }
    },
    {
      id: 'claude-pro-annual',
      providerId: 'claude-code',
      billingDomainId: 'subscription',
      displayName: 'Claude Pro (annual billing)',
      amount: 17 * 12,
      currency: 'USD',
      billingPeriod: 'annual',
      source: {
        title: 'Claude plans and pricing',
        url: 'https://claude.com/pricing',
        retrievedAt: '2026-08-30'
      }
    },
    {
      id: 'claude-max-5x',
      providerId: 'claude-code',
      billingDomainId: 'subscription',
      displayName: 'Claude Max 5x',
      amount: 100,
      currency: 'USD',
      billingPeriod: 'monthly',
      source: {
        title: 'What is the Max plan?',
        url: 'https://support.claude.com/en/articles/11049741-what-is-the-max-plan',
        retrievedAt: '2026-08-30'
      }
    },
    {
      id: 'claude-max-20x',
      providerId: 'claude-code',
      billingDomainId: 'subscription',
      displayName: 'Claude Max 20x',
      amount: 200,
      currency: 'USD',
      billingPeriod: 'monthly',
      source: {
        title: 'What is the Max plan?',
        url: 'https://support.claude.com/en/articles/11049741-what-is-the-max-plan',
        retrievedAt: '2026-08-30'
      }
    },
    {
      id: 'chatgpt-plus',
      providerId: 'codex',
      billingDomainId: 'subscription',
      displayName: 'ChatGPT Plus',
      amount: 20,
      currency: 'USD',
      billingPeriod: 'monthly',
      source: {
        title: 'ChatGPT pricing',
        url: 'https://chatgpt.com/pricing/',
        retrievedAt: '2026-08-30'
      }
    },
    {
      id: 'chatgpt-pro-100',
      providerId: 'codex',
      billingDomainId: 'subscription',
      displayName: 'ChatGPT Pro (5x)',
      amount: 100,
      currency: 'USD',
      billingPeriod: 'monthly',
      source: {
        title: 'About ChatGPT Pro tiers',
        url: 'https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers',
        retrievedAt: '2026-08-30'
      }
    },
    {
      id: 'chatgpt-pro-200',
      providerId: 'codex',
      billingDomainId: 'subscription',
      displayName: 'ChatGPT Pro (20x)',
      amount: 200,
      currency: 'USD',
      billingPeriod: 'monthly',
      source: {
        title: 'About ChatGPT Pro tiers',
        url: 'https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers',
        retrievedAt: '2026-08-30'
      }
    },
    {
      id: 'chatgpt-business-seat',
      providerId: 'codex',
      billingDomainId: 'subscription',
      displayName: 'ChatGPT Business (one seat)',
      amount: 25,
      currency: 'USD',
      billingPeriod: 'monthly',
      source: {
        title: 'ChatGPT Business pricing',
        url: 'https://openai.com/business/chatgpt-pricing/',
        retrievedAt: '2026-08-30'
      }
    },
    {
      id: 'opencode-go-monthly',
      providerId: 'opencode-go',
      billingDomainId: 'go-subscription',
      displayName: 'OpenCode Go',
      amount: 10,
      currency: 'USD',
      billingPeriod: 'monthly',
      source: {
        title: 'OpenCode Go',
        url: 'https://opencode.ai/go',
        retrievedAt: '2026-08-30'
      }
    }
  ]
};

/**
 * Measures the subscription's own period to date against the whole period
 * price. Elapsed and total days travel with it so a cycle that has barely
 * started is never read as a poor result.
 */
function buildBillingPeriod(
  subscription: PlanSubscription,
  summary: PlanBillingPeriodSummary | undefined,
  comparisonCurrency: string,
  rates: ExchangeRateSnapshot[]
): WorkbenchPlanBillingPeriod | null {
  if (!summary) return null;
  const start = new Date(summary.start).getTime();
  const end = new Date(summary.end).getTime();
  const observedThrough = new Date(summary.observedThrough).getTime();
  const totalDays = (end - start) / MILLISECONDS_PER_DAY;
  const elapsedDays = Math.max(0, Math.min(observedThrough, end) - start) / MILLISECONDS_PER_DAY;
  const periodCost = planMoneyAmount(
    preciseAmount(subscription.amount),
    subscription.currency,
    comparisonCurrency,
    // The period's own rate evidence first, so a short rolling window cannot
    // leave a cycle amount unconverted.
    [...summary.retailEquivalent.exchangeRates, ...rates],
    summary.observedThrough
  );
  const retailAmount =
    summary.retailEquivalent.status === 'available' ? summary.retailEquivalent.amount : null;
  const breakEvenRatio =
    periodCost.amount !== null && periodCost.amount > 0 && retailAmount !== null
      ? preciseAmount(retailAmount / periodCost.amount)
      : null;
  return {
    start: summary.start,
    end: summary.end,
    elapsedDays: preciseAmount(elapsedDays),
    totalDays: preciseAmount(totalDays),
    progress: totalDays > 0 ? preciseAmount(Math.min(1, elapsedDays / totalDays)) : 0,
    periodCost,
    recordedTokens: summary.observationCount > 0 ? summary.recordedTokens : null,
    retailEquivalent: summary.retailEquivalent,
    breakEvenRatio,
    ratioBound: ratioBoundFor(breakEvenRatio, summary.retailEquivalent.pricingCoverage)
  };
}

export function planCatalogEntry(catalog: PlanCatalog, id: string): PlanCatalogEntry | null {
  return catalog.entries.find((entry) => entry.id === id) ?? null;
}

export function planCatalogEntriesForDomain(
  catalog: PlanCatalog,
  providerId: string,
  billingDomainId: string
): PlanCatalogEntry[] {
  return catalog.entries.filter(
    (entry) => entry.providerId === providerId && entry.billingDomainId === billingDomainId
  );
}

export function planCatalogDomains(
  catalog: PlanCatalog
): Array<{ providerId: string; billingDomainId: string }> {
  const seen = new Map<string, { providerId: string; billingDomainId: string }>();
  for (const entry of catalog.entries) {
    seen.set(`${entry.providerId}:${entry.billingDomainId}`, {
      providerId: entry.providerId,
      billingDomainId: entry.billingDomainId
    });
  }
  return [...seen.values()];
}

function addMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const shifted = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
  // A 31st anchor lands on the last day of a shorter month, the way billing
  // providers clamp it.
  const lastDayOfMonth = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDayOfMonth));
  return shifted;
}

/**
 * The billing period that contains `at`, derived by stepping a declared renewal
 * date forward or backward by whole periods. Any past or future renewal date
 * therefore resolves the same current period.
 */
export function billingPeriodContaining(
  anchorDate: string,
  billingPeriod: PlanBillingPeriod,
  at: Date
): { start: Date; end: Date } | null {
  const anchor = new Date(anchorDate.length === 10 ? `${anchorDate}T00:00:00.000Z` : anchorDate);
  if (Number.isNaN(anchor.getTime())) return null;
  const step = billingPeriod === 'monthly' ? 1 : 12;
  const monthsApart =
    (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (at.getUTCMonth() - anchor.getUTCMonth());
  let index = Math.floor(monthsApart / step);
  let start = addMonths(anchor, index * step);
  while (start.getTime() > at.getTime()) {
    index -= 1;
    start = addMonths(anchor, index * step);
  }
  let end = addMonths(anchor, (index + 1) * step);
  while (end.getTime() <= at.getTime()) {
    index += 1;
    start = end;
    end = addMonths(anchor, (index + 1) * step);
  }
  return { start, end };
}

export function windowDays(start: string, end: string): number {
  const span = new Date(end).getTime() - new Date(start).getTime();
  return span > 0 ? span / MILLISECONDS_PER_DAY : 0;
}

/**
 * The share of one plan price that the selected window covers. It is a
 * comparison denominator computed at read time and never a stored cost record.
 */
export function proratePlanPrice(
  amount: number,
  billingPeriod: PlanBillingPeriod,
  days: number
): number {
  return (amount * days) / PLAN_PERIOD_DAYS[billingPeriod];
}

interface ConvertedPlanAmount {
  amount: number | null;
  reason: WorkbenchPlanMoneyAmount['conversionUnavailableReason'];
  rate: ExchangeRateSnapshot | null;
}

function convertPlanAmount(
  amount: number,
  currency: string,
  comparisonCurrency: string,
  rates: ExchangeRateSnapshot[],
  end: string
): ConvertedPlanAmount {
  if (currency.toUpperCase() === comparisonCurrency.toUpperCase()) {
    return { amount, reason: null, rate: null };
  }
  const rate = rates.find(
    (candidate) =>
      candidate.baseCurrency.toUpperCase() === currency.toUpperCase() &&
      candidate.quoteCurrency.toUpperCase() === comparisonCurrency.toUpperCase()
  );
  if (!rate) return { amount: null, reason: 'missing-rate', rate: null };
  if (new Date(end).getTime() - new Date(rate.observedAt).getTime() > STALE_RATE_MILLISECONDS) {
    return { amount: null, reason: 'stale-rate', rate };
  }
  return { amount: amount * rate.rate, reason: null, rate };
}

function preciseAmount(value: number): number {
  return Number(value.toPrecision(12));
}

function planMoneyAmount(
  nativeAmount: number,
  nativeCurrency: string,
  comparisonCurrency: string,
  rates: ExchangeRateSnapshot[],
  end: string
): WorkbenchPlanMoneyAmount {
  const converted = convertPlanAmount(nativeAmount, nativeCurrency, comparisonCurrency, rates, end);
  return {
    status: converted.amount === null ? 'unavailable' : 'available',
    amount: converted.amount === null ? null : preciseAmount(converted.amount),
    nativeAmount,
    nativeCurrency,
    comparisonCurrency,
    conversionUnavailableReason: converted.reason,
    exchangeRates: converted.rate ? [converted.rate] : []
  };
}

/**
 * Partly priced Tokens can only prove a floor: the ratio is reported as a lower
 * bound rather than an exact multiple.
 */
function ratioBoundFor(
  ratio: number | null,
  pricingCoverage: number | null
): WorkbenchPlanValueEntry['ratioBound'] {
  if (ratio === null) return 'unavailable';
  return pricingCoverage !== null && pricingCoverage < 0.999 ? 'lower' : 'exact';
}

function unitPricePerMillion(amount: number | null, tokens: number): number | null {
  if (amount === null || tokens <= 0) return null;
  return preciseAmount(amount / (tokens / 1_000_000));
}

export interface PlanBillingPeriodSummary {
  start: string;
  end: string;
  observedThrough: string;
  recordedTokens: number;
  observationCount: number;
  retailEquivalent: WorkbenchMoneyMetric;
}

export interface PlanValueDomainInput {
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  recordedTokens: number;
  observationCount: number;
  retailEquivalent: WorkbenchMoneyMetric;
  actualCost: WorkbenchMoneyMetric;
  authorities: DataAuthority[];
  lastObservedAt: string | null;
}

export interface BuildPlanValueOptions {
  domains: PlanValueDomainInput[];
  subscriptions: PlanSubscription[];
  comparisonCurrency: string;
  start: string;
  end: string;
  rates: ExchangeRateSnapshot[];
  /** Cycle-to-date evidence keyed by `providerId:billingDomainId`. */
  billingPeriods?: Map<string, PlanBillingPeriodSummary>;
}

/**
 * Compares what one subscription costs for the selected window against the API
 * retail equivalent of the Tokens it produced. The two amounts keep their
 * separate purposes: the result is a ratio, never a combined total.
 */
export function buildWorkbenchPlanValue(options: BuildPlanValueOptions): WorkbenchPlanValue {
  const { comparisonCurrency, start, end, rates } = options;
  const days = windowDays(start, end);
  const subscriptionByDomain = new Map(
    options.subscriptions.map((subscription) => [
      `${subscription.providerId}:${subscription.billingDomainId}`,
      subscription
    ])
  );

  const entries: WorkbenchPlanValueEntry[] = [];
  const metered: WorkbenchPlanValueMeteredDomain[] = [];
  const unconfigured: WorkbenchPlanValueUnconfiguredDomain[] = [];

  for (const domain of options.domains) {
    const subscription = subscriptionByDomain.get(`${domain.providerId}:${domain.billingDomainId}`);
    if (!subscription) {
      if (domain.actualCost.records > 0) {
        metered.push({
          providerId: domain.providerId,
          providerDisplayName: domain.providerDisplayName,
          billingDomainId: domain.billingDomainId,
          billingDomainDisplayName: domain.billingDomainDisplayName,
          recordedTokens: domain.observationCount > 0 ? domain.recordedTokens : null,
          actualCost: domain.actualCost,
          retailEquivalent: domain.retailEquivalent
        });
        continue;
      }
      if (domain.observationCount > 0) {
        unconfigured.push({
          providerId: domain.providerId,
          providerDisplayName: domain.providerDisplayName,
          billingDomainId: domain.billingDomainId,
          billingDomainDisplayName: domain.billingDomainDisplayName,
          recordedTokens: domain.recordedTokens
        });
      }
      continue;
    }

    const windowPlanCost = planMoneyAmount(
      preciseAmount(proratePlanPrice(subscription.amount, subscription.billingPeriod, days)),
      subscription.currency,
      comparisonCurrency,
      rates,
      end
    );

    const retail = domain.retailEquivalent;
    const retailAmount = retail.status === 'available' ? retail.amount : null;
    const valueRatio =
      windowPlanCost.amount !== null && windowPlanCost.amount > 0 && retailAmount !== null
        ? preciseAmount(retailAmount / windowPlanCost.amount)
        : null;
    const ratioBound = ratioBoundFor(valueRatio, retail.pricingCoverage);
    const billingPeriod = buildBillingPeriod(
      subscription,
      options.billingPeriods?.get(`${domain.providerId}:${domain.billingDomainId}`),
      comparisonCurrency,
      rates
    );

    entries.push({
      providerId: domain.providerId,
      providerDisplayName: domain.providerDisplayName,
      billingDomainId: domain.billingDomainId,
      billingDomainDisplayName: domain.billingDomainDisplayName,
      includedInHeadline: domain.includedInHeadline,
      plan: {
        planId: subscription.planId,
        displayName: subscription.displayName,
        amount: subscription.amount,
        currency: subscription.currency,
        billingPeriod: subscription.billingPeriod,
        anchorDate: subscription.anchorDate,
        priceSource: subscription.priceSource,
        updatedAt: subscription.updatedAt
      },
      windowDays: preciseAmount(days),
      windowPlanCost,
      billingPeriod,
      recordedTokens: domain.observationCount > 0 ? domain.recordedTokens : null,
      retailEquivalent: retail,
      valueRatio,
      ratioBound,
      status:
        valueRatio === null ? 'unavailable' : ratioBound === 'lower' ? 'partial' : 'available',
      effectiveUnitPrice: unitPricePerMillion(windowPlanCost.amount, domain.recordedTokens),
      retailUnitPrice: unitPricePerMillion(retailAmount, retail.pricedTokens),
      pricingCoverage: retail.pricingCoverage,
      authorities: domain.authorities,
      lastObservedAt: domain.lastObservedAt
    });
  }

  const rank = (entry: WorkbenchPlanValueEntry): number => entry.valueRatio ?? -1;
  entries.sort(
    (left, right) =>
      rank(right) - rank(left) ||
      `${left.providerId}:${left.billingDomainId}`.localeCompare(
        `${right.providerId}:${right.billingDomainId}`
      )
  );
  metered.sort((left, right) =>
    `${left.providerId}:${left.billingDomainId}`.localeCompare(
      `${right.providerId}:${right.billingDomainId}`
    )
  );
  unconfigured.sort(
    (left, right) =>
      right.recordedTokens - left.recordedTokens ||
      `${left.providerId}:${left.billingDomainId}`.localeCompare(
        `${right.providerId}:${right.billingDomainId}`
      )
  );

  return {
    windowDays: preciseAmount(days),
    comparisonCurrency,
    catalogVersion: SUBSCRIPTION_PLAN_CATALOG.version,
    entries,
    meteredDomains: metered,
    unconfiguredDomains: unconfigured
  };
}
