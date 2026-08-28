import { normalizeTokenObservation } from './token-normalization.js';
import type {
  ConnectorSnapshot,
  CostRecord,
  RetailPriceLineItem,
  RetailTokenKind,
  UsageObservation
} from './types.js';

export interface RetailPriceCatalogEntry {
  id: string;
  priceVersion: string;
  providerId: string;
  billingDomainId: string;
  canonicalModel: string;
  aliases: string[];
  currency: 'USD';
  effectiveFrom: string;
  effectiveUntil: string | null;
  contextTier: string;
  contextRule?: RetailPriceContextRule;
  ratesPerMillion: Record<RetailTokenKind, number | null>;
  source: {
    title: string;
    url: string;
    retrievedAt: string;
  };
}

export type RetailPriceContextRule =
  | { kind: 'fixed' }
  | {
      kind: 'prompt-tokens';
      minimumExclusive?: number;
      maximumInclusive?: number;
    }
  | {
      kind: 'utc-schedule';
      weekdays: number[];
      ranges: Array<{ startHour: number; endHour: number }>;
      match: 'inside' | 'outside';
    };

export interface RetailPriceCatalog {
  version: string;
  entries: RetailPriceCatalogEntry[];
}

export type RetailPricingUnavailableReason =
  | 'model-unclassified'
  | 'model-unrecognized'
  | 'price-not-effective'
  | 'token-kinds-incomplete'
  | 'pricing-tier-ambiguous';

export interface RetailPricingDecision {
  observationId: string;
  status: 'priced' | 'unavailable';
  reason: RetailPricingUnavailableReason | null;
  pricedTokens: number;
}

export interface RetailPricingResult {
  costs: CostRecord[];
  decisions: RetailPricingDecision[];
}

export const ANTHROPIC_PRICING_CATALOG: RetailPriceCatalog = {
  version: '2026-08-28',
  entries: [
    {
      id: 'anthropic-fable-5-2026-06-09',
      priceVersion: 'anthropic-2026-06-09',
      providerId: 'claude-code',
      billingDomainId: 'subscription',
      canonicalModel: 'claude-fable-5',
      aliases: ['Claude Fable 5'],
      currency: 'USD',
      effectiveFrom: '2026-06-09T00:00:00.000Z',
      effectiveUntil: null,
      contextTier: 'standard-api',
      contextRule: { kind: 'fixed' },
      ratesPerMillion: {
        input: 10,
        output: 50,
        reasoning: null,
        'cache-read': 1,
        // Anthropic publishes different 5-minute and 1-hour write rates.
        'cache-write': null
      },
      source: {
        title: 'Anthropic Claude API pricing',
        url: 'https://platform.claude.com/docs/en/about-claude/pricing',
        retrievedAt: '2026-08-28'
      }
    }
  ]
};

const OPENCODE_GO_SOURCE = {
  title: 'OpenCode Go model pricing',
  url: 'https://dev.opencode.ai/docs/go/',
  retrievedAt: '2026-08-28'
};
const XAI_PRICING_SOURCE = {
  title: 'xAI API model pricing',
  url: 'https://docs.x.ai/developers/pricing',
  retrievedAt: '2026-08-28'
};
const OPEN_CODE_EFFECTIVE = '2026-08-28T00:00:00.000Z';
const OPEN_CODE_FLAT_MODELS: Array<
  [model: string, input: number, output: number, cacheRead: number, cacheWrite?: number]
> = [
  ['glm-5.3-flash', 0.15, 0.5, 0.03],
  ['glm-5.3', 1.4, 4.4, 0.26],
  ['glm-5.2', 1.4, 4.4, 0.26],
  ['glm-5.1', 1.4, 4.4, 0.26],
  ['kimi-k3', 3, 15, 0.3],
  ['kimi-k2.7-code', 0.95, 4, 0.19],
  ['kimi-k2.6', 0.95, 4, 0.16],
  ['longcat-2.0', 0.3, 1.2, 0.006],
  ['mimo-v2.5', 0.14, 0.28, 0.0028],
  ['mimo-v2.5-pro', 0.435, 0.87, 0.003625],
  ['minimax-m3', 0.3, 1.2, 0.06],
  ['minimax-m2.7', 0.3, 1.2, 0.06, 0.375],
  ['minimax-m2.5', 0.3, 1.2, 0.06, 0.375],
  ['muse-spark-1.2-contributor', 0.1, 0.2, 0.002],
  ['qwen3.8-max', 2, 6, 0.25, 2.5],
  ['qwen3.7-max', 2.5, 7.5, 0.5, 3.125],
  ['hy3', 0.14, 0.58, 0.035]
];
const OPEN_CODE_CONTEXT_MODELS: Array<
  [
    model: string,
    threshold: number,
    short: [input: number, output: number, cacheRead: number, cacheWrite: number | null],
    long: [input: number, output: number, cacheRead: number, cacheWrite: number | null]
  ]
> = [
  ['grok-4.6', 200_000, [2, 6, 0.5, null], [4, 12, 1, null]],
  ['gpt-5.6-luna', 272_000, [0.2, 1.2, 0.02, 0.25], [0.4, 1.8, 0.04, 0.5]],
  ['qwen3.7-plus', 256_000, [0.4, 1.6, 0.04, 0.5], [1.2, 4.8, 0.12, 1.5]],
  ['qwen3.6-plus', 256_000, [0.5, 3, 0.05, 0.625], [2, 6, 0.2, 2.5]]
];
const DEEPSEEK_GO_MODELS: Array<[model: string, input: number, output: number, cacheRead: number]> =
  [
    ['deepseek-v4-pro', 0.66, 1.98, 0.022],
    ['deepseek-v4-flash', 0.22, 0.66, 0.007],
    ['deepseek-v4-flash-vision-exp', 0.22, 0.66, 0.007]
  ];
const WEEKDAY_PEAK_RANGES = [
  { startHour: 1, endHour: 4 },
  { startHour: 6, endHour: 10 }
];

export const OFFICIAL_PRICING_CATALOG: RetailPriceCatalog = {
  version: '2026-08-28',
  entries: [
    ...ANTHROPIC_PRICING_CATALOG.entries,
    ...OPEN_CODE_FLAT_MODELS.map(([model, input, output, cacheRead, cacheWrite]) =>
      openCodeGoEntry(model, 'standard', input, output, cacheRead, cacheWrite ?? null, {
        kind: 'fixed'
      })
    ),
    ...OPEN_CODE_CONTEXT_MODELS.flatMap(([model, threshold, short, long]) => [
      openCodeGoEntry(
        model,
        `prompt-at-or-below-${threshold / 1000}k`,
        short[0],
        short[1],
        short[2],
        short[3],
        { kind: 'prompt-tokens', maximumInclusive: threshold }
      ),
      openCodeGoEntry(
        model,
        `prompt-above-${threshold / 1000}k`,
        long[0],
        long[1],
        long[2],
        long[3],
        { kind: 'prompt-tokens', minimumExclusive: threshold }
      )
    ]),
    ...DEEPSEEK_GO_MODELS.flatMap(([model, input, output, cacheRead]) => [
      openCodeGoEntry(model, 'off-peak', input, output, cacheRead, null, {
        kind: 'utc-schedule',
        weekdays: [1, 2, 3, 4, 5],
        ranges: WEEKDAY_PEAK_RANGES,
        match: 'outside'
      }),
      openCodeGoEntry(model, 'peak', input * 2, output * 2, cacheRead * 2, null, {
        kind: 'utc-schedule',
        weekdays: [1, 2, 3, 4, 5],
        ranges: WEEKDAY_PEAK_RANGES,
        match: 'inside'
      })
    ]),
    xaiEntry({
      id: 'xai-grok-build-0.1-short-2026-05-19',
      priceVersion: 'xai-2026-05-19',
      billingDomainId: 'grok-build-subscription',
      model: 'grok-build-0.1',
      aliases: ['grok-build', 'grok-code-fast-1', 'grok-code-fast', 'grok-code-fast-1-0825'],
      effectiveFrom: '2026-05-19T00:00:00.000Z',
      contextTier: 'prompt-at-or-below-200k',
      input: 1,
      output: 2,
      cacheRead: 0.2,
      contextRule: { kind: 'prompt-tokens', maximumInclusive: 200_000 }
    }),
    xaiEntry({
      id: 'xai-grok-build-0.1-long-2026-05-19',
      priceVersion: 'xai-2026-05-19',
      billingDomainId: 'grok-build-subscription',
      model: 'grok-build-0.1',
      aliases: ['grok-build', 'grok-code-fast-1', 'grok-code-fast', 'grok-code-fast-1-0825'],
      effectiveFrom: '2026-05-19T00:00:00.000Z',
      contextTier: 'prompt-above-200k',
      input: 2,
      output: 4,
      cacheRead: 0.4,
      contextRule: { kind: 'prompt-tokens', minimumExclusive: 200_000 }
    }),
    xaiEntry({
      id: 'xai-grok-4.6-short-2026-08-12',
      priceVersion: 'xai-2026-08-12',
      billingDomainId: 'xai-api',
      model: 'grok-4.6',
      aliases: ['grok-4.6-latest'],
      effectiveFrom: '2026-08-12T00:00:00.000Z',
      contextTier: 'prompt-at-or-below-200k',
      input: 2,
      output: 6,
      cacheRead: 0.5,
      contextRule: { kind: 'prompt-tokens', maximumInclusive: 200_000 }
    }),
    xaiEntry({
      id: 'xai-grok-4.6-long-2026-08-12',
      priceVersion: 'xai-2026-08-12',
      billingDomainId: 'xai-api',
      model: 'grok-4.6',
      aliases: ['grok-4.6-latest'],
      effectiveFrom: '2026-08-12T00:00:00.000Z',
      contextTier: 'prompt-above-200k',
      input: 4,
      output: 12,
      cacheRead: 1,
      contextRule: { kind: 'prompt-tokens', minimumExclusive: 200_000 }
    })
  ]
};

function openCodeGoEntry(
  model: string,
  tier: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number | null,
  contextRule: RetailPriceContextRule
): RetailPriceCatalogEntry {
  return {
    id: `opencode-go-${model}-${tier}-2026-08-28`,
    priceVersion: 'opencode-go-2026-08-28',
    providerId: 'opencode-go',
    billingDomainId: 'go-subscription',
    canonicalModel: model,
    aliases: [`opencode-go/${model}`],
    currency: 'USD',
    effectiveFrom: OPEN_CODE_EFFECTIVE,
    effectiveUntil: null,
    contextTier: tier === 'peak' ? 'weekday-peak-utc' : tier === 'off-peak' ? 'off-peak-utc' : tier,
    contextRule,
    ratesPerMillion: {
      input,
      output,
      reasoning: output,
      'cache-read': cacheRead,
      'cache-write': cacheWrite
    },
    source: OPENCODE_GO_SOURCE
  };
}

function xaiEntry(options: {
  id: string;
  priceVersion: string;
  billingDomainId: string;
  model: string;
  aliases: string[];
  effectiveFrom: string;
  contextTier: string;
  input: number;
  output: number;
  cacheRead: number;
  contextRule: RetailPriceContextRule;
}): RetailPriceCatalogEntry {
  return {
    id: options.id,
    priceVersion: options.priceVersion,
    providerId: 'grok',
    billingDomainId: options.billingDomainId,
    canonicalModel: options.model,
    aliases: options.aliases,
    currency: 'USD',
    effectiveFrom: options.effectiveFrom,
    effectiveUntil: null,
    contextTier: options.contextTier,
    contextRule: options.contextRule,
    ratesPerMillion: {
      input: options.input,
      output: options.output,
      reasoning: options.output,
      'cache-read': options.cacheRead,
      'cache-write': null
    },
    source: XAI_PRICING_SOURCE
  };
}

export function deriveRetailEquivalentCosts(
  snapshot: ConnectorSnapshot,
  catalog: RetailPriceCatalog = ANTHROPIC_PRICING_CATALOG,
  calculatedAt = snapshot.observedAt
): RetailPricingResult {
  const costs: CostRecord[] = [];
  const decisions: RetailPricingDecision[] = [];
  for (const observation of snapshot.usage) {
    const result = priceObservation(snapshot.provider.id, observation, catalog, calculatedAt);
    decisions.push(result.decision);
    if (result.cost) costs.push(result.cost);
  }
  return { costs, decisions };
}

function priceObservation(
  providerId: string,
  observation: UsageObservation,
  catalog: RetailPriceCatalog,
  calculatedAt: string
): { cost: CostRecord | null; decision: RetailPricingDecision } {
  const unavailable = (reason: RetailPricingUnavailableReason) => ({
    cost: null,
    decision: {
      observationId: observation.id,
      status: 'unavailable' as const,
      reason,
      pricedTokens: 0
    }
  });
  const normalized = normalizeTokenObservation(observation);
  if (normalized.modelAttribution !== 'known' || !normalized.model) {
    return unavailable('model-unclassified');
  }
  const normalizedModel = normalized.model.trim().toLowerCase();
  const modelEntries = catalog.entries.filter(
    (entry) =>
      entry.providerId === providerId &&
      entry.billingDomainId === observation.billingDomainId &&
      [entry.canonicalModel, ...entry.aliases].some(
        (model) => model.trim().toLowerCase() === normalizedModel
      )
  );
  if (modelEntries.length === 0) return unavailable('model-unrecognized');
  const timeActiveEntries = modelEntries.filter(
    (entry) =>
      observation.observedAt >= entry.effectiveFrom &&
      (!entry.effectiveUntil || observation.observedAt < entry.effectiveUntil)
  );
  if (timeActiveEntries.length === 0) return unavailable('price-not-effective');
  const contextMatches = timeActiveEntries.map((entry) => ({
    entry,
    match: matchContext(entry.contextRule ?? { kind: 'fixed' }, normalized)
  }));
  if (contextMatches.some((candidate) => candidate.match === 'unknown')) {
    return unavailable('pricing-tier-ambiguous');
  }
  const activeEntries = contextMatches
    .filter((candidate) => candidate.match === 'match')
    .map((candidate) => candidate.entry);
  if (activeEntries.length !== 1) return unavailable('pricing-tier-ambiguous');
  if (normalized.unclassifiedTokens > 0) return unavailable('token-kinds-incomplete');

  const entry = activeEntries[0];
  const billableTokens: Array<{ tokenKind: RetailTokenKind; tokens: number }> = [
    { tokenKind: 'input', tokens: normalized.inputTokens },
    { tokenKind: 'output', tokens: normalized.outputTokens },
    {
      tokenKind: 'reasoning',
      tokens: normalized.tokenSemantics.reasoning === 'separate' ? normalized.reasoningTokens : 0
    },
    {
      tokenKind: 'cache-read',
      tokens: normalized.tokenSemantics.cacheRead === 'separate' ? normalized.cacheReadTokens : 0
    },
    {
      tokenKind: 'cache-write',
      tokens: normalized.tokenSemantics.cacheWrite === 'separate' ? normalized.cacheWriteTokens : 0
    }
  ];
  const nonZero = billableTokens.filter((item) => item.tokens > 0);
  if (nonZero.some((item) => entry.ratesPerMillion[item.tokenKind] === null)) {
    return unavailable(
      normalized.cacheWriteTokens > 0 ? 'pricing-tier-ambiguous' : 'token-kinds-incomplete'
    );
  }
  const lineItems: RetailPriceLineItem[] = nonZero.map((item) => {
    const ratePerMillion = entry.ratesPerMillion[item.tokenKind]!;
    return {
      ...item,
      ratePerMillion,
      amount: preciseMoney((item.tokens * ratePerMillion) / 1_000_000)
    };
  });
  const pricedTokens = lineItems.reduce((total, item) => total + item.tokens, 0);
  if (pricedTokens !== normalized.recordedTokens) return unavailable('token-kinds-incomplete');
  const amount = preciseMoney(lineItems.reduce((total, item) => total + item.amount, 0));
  return {
    cost: {
      id: `retail-equivalent:${observation.id}:${entry.id}`,
      sourceId: observation.id,
      billingDomainId: observation.billingDomainId,
      observedAt: observation.observedAt,
      kind: 'retail-equivalent',
      amount,
      currency: entry.currency,
      authority: 'estimate',
      model: observation.model?.trim() || entry.canonicalModel,
      usageObservationId: observation.id,
      pricedTokens,
      lineItems,
      calculatedAt,
      priceSnapshot: {
        id: entry.id,
        version: entry.priceVersion,
        source: entry.source.title,
        canonicalModel: entry.canonicalModel,
        effectiveAt: entry.effectiveFrom,
        effectiveUntil: entry.effectiveUntil,
        currency: entry.currency,
        ratesPerMillion: { ...entry.ratesPerMillion },
        sourceUrl: entry.source.url,
        contextTier: entry.contextTier
      }
    },
    decision: {
      observationId: observation.id,
      status: 'priced',
      reason: null,
      pricedTokens
    }
  };
}

function matchContext(
  rule: RetailPriceContextRule,
  observation: ReturnType<typeof normalizeTokenObservation>
): 'match' | 'no-match' | 'unknown' {
  if (rule.kind === 'fixed') return 'match';
  if (observation.timePrecision !== 'event') return 'unknown';
  if (rule.kind === 'prompt-tokens') {
    if (observation.aggregationTemporality !== 'delta') return 'unknown';
    const promptTokens = observation.inputTokens + observation.cacheReadTokens;
    if (rule.minimumExclusive !== undefined && promptTokens <= rule.minimumExclusive) {
      return 'no-match';
    }
    if (rule.maximumInclusive !== undefined && promptTokens > rule.maximumInclusive) {
      return 'no-match';
    }
    return 'match';
  }
  const observedAt = new Date(observation.observedAt);
  if (Number.isNaN(observedAt.getTime())) return 'unknown';
  const inWeekday = rule.weekdays.includes(observedAt.getUTCDay());
  const hour = observedAt.getUTCHours();
  const inRange = inWeekday
    ? rule.ranges.some((range) => hour >= range.startHour && hour < range.endHour)
    : false;
  return (rule.match === 'inside' ? inRange : !inRange) ? 'match' : 'no-match';
}

function preciseMoney(value: number): number {
  return Number(value.toFixed(12));
}
