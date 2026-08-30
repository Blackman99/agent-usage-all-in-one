import { describe, expect, it } from 'vitest';

import type {
  PlanSubscription,
  WorkbenchMoneyMetric,
  WorkbenchPlanValue
} from '../../src/core/types.js';
import {
  PLAN_PERIOD_DAYS,
  SUBSCRIPTION_PLAN_CATALOG,
  billingPeriodContaining,
  buildWorkbenchPlanValue,
  planCatalogEntriesForDomain,
  proratePlanPrice,
  type PlanBillingPeriodSummary,
  type PlanValueDomainInput
} from '../../src/core/plan-pricing.js';
import {
  buildPlanValuePoints,
  buildPlanValueRanking,
  planValueIsoLines,
  type PlanValueFormatters
} from '../../src/lib/plan-value.js';

const START = '2026-08-01T00:00:00.000Z';
const END = '2026-08-31T00:00:00.000Z';

const formatters: PlanValueFormatters = {
  money: (amount) => (amount === null ? 'n/a' : `$${amount.toFixed(2)}`),
  tokens: (value) => (value === null ? 'n/a' : `${value} tokens`),
  ratio: (value, bound) =>
    value === null ? 'n/a' : `${bound === 'lower' ? '>=' : ''}${value.toFixed(1)}x`
};

function metric(overrides: Partial<WorkbenchMoneyMetric> = {}): WorkbenchMoneyMetric {
  return {
    purpose: 'retail-equivalent',
    status: 'available',
    amount: 180,
    comparisonCurrency: 'USD',
    nativeAmounts: [{ currency: 'USD', amount: 180, records: 1, knownRecords: 1 }],
    authorities: ['estimate'],
    observedAt: '2026-08-30T00:00:00.000Z',
    records: 1,
    knownRecords: 1,
    amountCoverage: 1,
    pricingCoverage: 1,
    pricedTokens: 20_000_000,
    recordedTokens: 20_000_000,
    conversionUnavailableReasons: [],
    exchangeRates: [],
    ...overrides
  };
}

function emptyMetric(purpose: WorkbenchMoneyMetric['purpose']): WorkbenchMoneyMetric {
  return metric({
    purpose,
    status: 'unavailable',
    amount: null,
    nativeAmounts: [],
    authorities: [],
    observedAt: null,
    records: 0,
    knownRecords: 0,
    amountCoverage: null,
    pricingCoverage: null,
    pricedTokens: 0
  });
}

function domain(overrides: Partial<PlanValueDomainInput> = {}): PlanValueDomainInput {
  return {
    providerId: 'claude-code',
    providerDisplayName: 'Claude Code',
    billingDomainId: 'subscription',
    billingDomainDisplayName: 'Claude subscription',
    includedInHeadline: true,
    recordedTokens: 20_000_000,
    observationCount: 12,
    retailEquivalent: metric(),
    actualCost: emptyMetric('actual'),
    authorities: ['local-observation'],
    lastObservedAt: '2026-08-30T00:00:00.000Z',
    ...overrides
  };
}

function subscription(overrides: Partial<PlanSubscription> = {}): PlanSubscription {
  return {
    providerId: 'claude-code',
    billingDomainId: 'subscription',
    planId: 'claude-max-20x',
    displayName: 'Claude Max 20x',
    amount: 200,
    currency: 'USD',
    billingPeriod: 'monthly',
    anchorDate: null,
    priceSource: 'catalog-preset',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  };
}

function planValueOf(
  domains: PlanValueDomainInput[],
  subscriptions: PlanSubscription[],
  overrides: Partial<Parameters<typeof buildWorkbenchPlanValue>[0]> = {}
): WorkbenchPlanValue {
  return buildWorkbenchPlanValue({
    domains,
    subscriptions,
    comparisonCurrency: 'USD',
    start: START,
    end: END,
    rates: [],
    ...overrides
  });
}

describe('plan price proration', () => {
  it('spreads one plan price over the average length of its own billing period', () => {
    expect(proratePlanPrice(200, 'monthly', PLAN_PERIOD_DAYS.monthly)).toBeCloseTo(200, 10);
    expect(proratePlanPrice(200, 'monthly', 30)).toBeCloseTo((200 * 30) / (365.25 / 12), 10);
    expect(proratePlanPrice(204, 'annual', 365.25)).toBeCloseTo(204, 10);
    expect(proratePlanPrice(204, 'annual', 30)).toBeCloseTo((204 * 30) / 365.25, 10);
  });

  it('only offers presets that belong to the requested billing domain', () => {
    const presets = planCatalogEntriesForDomain(
      SUBSCRIPTION_PLAN_CATALOG,
      'claude-code',
      'subscription'
    );
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every((entry) => entry.providerId === 'claude-code')).toBe(true);
    expect(planCatalogEntriesForDomain(SUBSCRIPTION_PLAN_CATALOG, 'grok', 'xai-api')).toHaveLength(
      0
    );
    expect(
      SUBSCRIPTION_PLAN_CATALOG.entries.every(
        (entry) => entry.source.url.length > 0 && entry.source.retrievedAt.length > 0
      )
    ).toBe(true);
  });
});

describe('billing period boundaries', () => {
  const at = new Date('2026-08-28T02:00:00.000Z');

  it('resolves the period containing the moment from any past or future renewal date', () => {
    const past = billingPeriodContaining('2026-06-12', 'monthly', at);
    expect(past?.start.toISOString()).toBe('2026-08-12T00:00:00.000Z');
    expect(past?.end.toISOString()).toBe('2026-09-12T00:00:00.000Z');

    // A person may enter their next renewal instead of the current start.
    const future = billingPeriodContaining('2026-09-12', 'monthly', at);
    expect(future?.start.toISOString()).toBe('2026-08-12T00:00:00.000Z');
    expect(future?.end.toISOString()).toBe('2026-09-12T00:00:00.000Z');
  });

  it('clamps a month-end renewal into shorter months', () => {
    const february = billingPeriodContaining(
      '2026-01-31',
      'monthly',
      new Date('2026-02-15T00:00:00.000Z')
    );
    expect(february?.start.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(february?.end.toISOString()).toBe('2026-02-28T00:00:00.000Z');

    const march = billingPeriodContaining(
      '2026-01-31',
      'monthly',
      new Date('2026-03-10T00:00:00.000Z')
    );
    expect(march?.start.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(march?.end.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('steps annual plans by whole years and rejects a date it cannot read', () => {
    const annual = billingPeriodContaining('2024-03-05', 'annual', at);
    expect(annual?.start.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(annual?.end.toISOString()).toBe('2027-03-05T00:00:00.000Z');
    expect(billingPeriodContaining('not-a-date', 'monthly', at)).toBeNull();
  });
});

describe('plan value read model', () => {
  it('divides the retail equivalent by the prorated plan cost of the same window', () => {
    const planValue = planValueOf([domain()], [subscription()]);
    const entry = planValue.entries[0];
    const expectedPlanCost = (200 * 30) / (365.25 / 12);

    expect(entry.windowPlanCost).toMatchObject({
      status: 'available',
      nativeCurrency: 'USD',
      comparisonCurrency: 'USD',
      conversionUnavailableReason: null
    });
    expect(entry.windowPlanCost.amount).toBeCloseTo(expectedPlanCost, 6);
    expect(entry.valueRatio).toBeCloseTo(180 / expectedPlanCost, 6);
    expect(entry.ratioBound).toBe('exact');
    expect(entry.status).toBe('available');
    expect(entry.effectiveUnitPrice).toBeCloseTo(expectedPlanCost / 20, 6);
    expect(entry.retailUnitPrice).toBeCloseTo(9, 6);
    expect(planValue.windowDays).toBeCloseTo(30, 6);
  });

  it('treats partly priced Tokens as a lower bound instead of an exact multiple', () => {
    const planValue = planValueOf(
      [
        domain({
          retailEquivalent: metric({ pricingCoverage: 0.4, pricedTokens: 8_000_000 })
        })
      ],
      [subscription()]
    );

    expect(planValue.entries[0]).toMatchObject({ ratioBound: 'lower', status: 'partial' });
    expect(planValue.entries[0].valueRatio).not.toBeNull();
  });

  it('keeps the multiple unavailable when the retail equivalent is unknown', () => {
    const planValue = planValueOf(
      [domain({ retailEquivalent: emptyMetric('retail-equivalent') })],
      [subscription()]
    );

    expect(planValue.entries[0]).toMatchObject({
      valueRatio: null,
      ratioBound: 'unavailable',
      status: 'unavailable'
    });
    expect(planValue.entries[0].windowPlanCost.status).toBe('available');
  });

  it('converts the plan price with the comparison rate and stays unavailable without one', () => {
    const rate = {
      id: 'usd-cny',
      baseCurrency: 'USD',
      quoteCurrency: 'CNY',
      rate: 7.2,
      observedAt: '2026-08-30T00:00:00.000Z',
      source: 'Test rate'
    };
    const converted = planValueOf(
      [domain({ retailEquivalent: metric({ amount: 1296 }) })],
      [subscription()],
      {
        comparisonCurrency: 'CNY',
        rates: [rate]
      }
    );
    expect(converted.entries[0].windowPlanCost.amount).toBeCloseTo(
      ((200 * 30) / (365.25 / 12)) * 7.2,
      6
    );
    expect(converted.entries[0].windowPlanCost.exchangeRates).toEqual([rate]);

    const missing = planValueOf([domain()], [subscription()], { comparisonCurrency: 'CNY' });
    expect(missing.entries[0].windowPlanCost).toMatchObject({
      status: 'unavailable',
      amount: null,
      nativeCurrency: 'USD',
      conversionUnavailableReason: 'missing-rate'
    });
    expect(missing.entries[0].valueRatio).toBeNull();

    const stale = planValueOf([domain()], [subscription()], {
      comparisonCurrency: 'CNY',
      rates: [{ ...rate, observedAt: '2026-07-01T00:00:00.000Z' }]
    });
    expect(stale.entries[0].windowPlanCost.conversionUnavailableReason).toBe('stale-rate');
  });

  it('separates metered domains and domains with no declared plan price', () => {
    const planValue = planValueOf(
      [
        domain(),
        domain({
          providerId: 'grok',
          providerDisplayName: 'Grok',
          billingDomainId: 'xai-api',
          billingDomainDisplayName: 'xAI API',
          includedInHeadline: false,
          actualCost: metric({ purpose: 'actual', amount: 12 })
        }),
        domain({
          providerId: 'codex',
          providerDisplayName: 'Codex',
          billingDomainId: 'subscription',
          billingDomainDisplayName: 'Codex subscription',
          recordedTokens: 5_000_000
        })
      ],
      [subscription()]
    );

    expect(planValue.entries.map((entry) => entry.providerId)).toEqual(['claude-code']);
    expect(planValue.meteredDomains.map((entry) => entry.billingDomainId)).toEqual(['xai-api']);
    expect(planValue.meteredDomains[0].actualCost.amount).toBe(12);
    expect(planValue.unconfiguredDomains.map((entry) => entry.providerId)).toEqual(['codex']);
  });

  it('ranks the highest multiple first and keeps unavailable multiples last', () => {
    const planValue = planValueOf(
      [
        domain({ retailEquivalent: metric({ amount: 90 }) }),
        domain({
          providerId: 'codex',
          providerDisplayName: 'Codex',
          billingDomainDisplayName: 'Codex subscription',
          retailEquivalent: metric({ amount: 400 })
        }),
        domain({
          providerId: 'opencode-go',
          providerDisplayName: 'OpenCode Go',
          billingDomainId: 'go-subscription',
          billingDomainDisplayName: 'OpenCode Go',
          retailEquivalent: emptyMetric('retail-equivalent')
        })
      ],
      [
        subscription(),
        subscription({ providerId: 'codex', planId: 'chatgpt-pro-200' }),
        subscription({
          providerId: 'opencode-go',
          billingDomainId: 'go-subscription',
          planId: 'opencode-go-monthly',
          amount: 10
        })
      ]
    );

    expect(planValue.entries.map((entry) => entry.providerId)).toEqual([
      'codex',
      'claude-code',
      'opencode-go'
    ]);
  });
});

describe('subscription billing period', () => {
  function periodSummary(
    overrides: Partial<PlanBillingPeriodSummary> = {}
  ): Map<string, PlanBillingPeriodSummary> {
    return new Map([
      [
        'claude-code:subscription',
        {
          start: '2026-08-12T00:00:00.000Z',
          end: '2026-09-12T00:00:00.000Z',
          observedThrough: '2026-08-28T00:00:00.000Z',
          recordedTokens: 12_000_000,
          observationCount: 8,
          retailEquivalent: metric({ amount: 150, pricedTokens: 12_000_000 }),
          ...overrides
        }
      ]
    ]);
  }

  it('measures the cycle to date against the whole period price and keeps its progress visible', () => {
    const planValue = planValueOf([domain()], [subscription({ anchorDate: '2026-08-12' })], {
      billingPeriods: periodSummary()
    });
    const period = planValue.entries[0].billingPeriod;

    expect(period).toMatchObject({
      start: '2026-08-12T00:00:00.000Z',
      end: '2026-09-12T00:00:00.000Z',
      ratioBound: 'exact'
    });
    expect(period?.totalDays).toBeCloseTo(31, 6);
    expect(period?.elapsedDays).toBeCloseTo(16, 6);
    expect(period?.progress).toBeCloseTo(16 / 31, 6);
    // Break-even compares the cycle so far with the entire period price, never a
    // prorated slice of it.
    expect(period?.periodCost.amount).toBe(200);
    expect(period?.breakEvenRatio).toBeCloseTo(150 / 200, 6);
  });

  it('stays absent until a renewal date is declared', () => {
    expect(planValueOf([domain()], [subscription()]).entries[0].billingPeriod).toBeNull();
    expect(
      planValueOf([domain()], [subscription({ anchorDate: '2026-08-12' })]).entries[0].billingPeriod
    ).toBeNull();
  });

  it('keeps the cycle multiple a lower bound when part of the cycle is unpriced', () => {
    const planValue = planValueOf([domain()], [subscription({ anchorDate: '2026-08-12' })], {
      billingPeriods: periodSummary({
        retailEquivalent: metric({ amount: 150, pricingCoverage: 0.5, pricedTokens: 6_000_000 })
      })
    });
    expect(planValue.entries[0].billingPeriod?.ratioBound).toBe('lower');
  });
});

describe('plan value chart and ranking', () => {
  it('plots only entries with both a plan cost and a retail equivalent', () => {
    const planValue = planValueOf(
      [
        domain(),
        domain({
          providerId: 'codex',
          providerDisplayName: 'Codex',
          billingDomainDisplayName: 'Codex subscription',
          retailEquivalent: emptyMetric('retail-equivalent')
        })
      ],
      [subscription(), subscription({ providerId: 'codex', planId: 'chatgpt-plus', amount: 20 })]
    );

    const points = buildPlanValuePoints(planValue, () => '#7aa2f7', 'Custom');
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      name: 'Claude Code · Claude subscription',
      shortName: 'Claude Code',
      worth: 180
    });
  });

  it('draws the break-even line and only iso-lines that stay inside the plotted area', () => {
    const lines = planValueIsoLines(200, 1800);
    expect(lines[0].ratio).toBe(1);
    expect(lines.map((line) => line.ratio)).toEqual([1, 5, 10, 20]);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(planValueIsoLines(0, 0)).toEqual([]);
    expect(planValueIsoLines(200, 300).map((line) => line.ratio)).toEqual([1, 2, 5]);
    expect(planValueIsoLines(200, 10).map((line) => line.ratio)).toEqual([1]);
  });

  it('scales the ranking meter against the best multiple and marks break-even', () => {
    const planValue = planValueOf(
      [
        domain({ retailEquivalent: metric({ amount: 400 }) }),
        domain({
          providerId: 'codex',
          providerDisplayName: 'Codex',
          billingDomainDisplayName: 'Codex subscription',
          retailEquivalent: metric({ amount: 100 })
        })
      ],
      [subscription(), subscription({ providerId: 'codex', planId: 'chatgpt-pro-200' })]
    );

    const rows = buildPlanValueRanking(planValue, () => '#7aa2f7', formatters, 'Custom');
    expect(rows[0].meterPercent).toBe(100);
    expect(rows[1].meterPercent).toBeCloseTo(25, 6);
    expect(rows[0].breakEvenPercent).toBeCloseTo(100 / rows[0].ratio!, 6);
    expect(rows[0].beatsBreakEven).toBe(true);
    expect(rows[1].beatsBreakEven).toBe(false);
    expect(rows[0].savingsLabel).not.toBeNull();
    expect(rows[0].savingsIsLoss).toBe(false);
    // Paying more per Token than the list price is a loss, reported as a
    // positive amount under its own label.
    expect(rows[1].savingsIsLoss).toBe(true);
    expect(rows[1].savingsLabel?.startsWith('-')).toBe(false);
  });
});
