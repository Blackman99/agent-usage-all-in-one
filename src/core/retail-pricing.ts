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
  cacheWriteRatesPerMillion?: {
    fiveMinute: number;
    oneHour: number;
  };
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
      cacheWriteRatesPerMillion: { fiveMinute: 12.5, oneHour: 20 },
      source: {
        title: 'Anthropic Claude API pricing',
        url: 'https://platform.claude.com/docs/en/about-claude/pricing',
        retrievedAt: '2026-08-28'
      }
    },
    anthropicEntry({
      id: 'anthropic-sonnet-5-2026-06-30',
      priceVersion: 'anthropic-2026-06-30',
      model: 'claude-sonnet-5',
      aliases: ['Claude Sonnet 5', 'claude-sonnet-5[1m]'],
      effectiveFrom: '2026-06-30T00:00:00.000Z',
      input: 2,
      output: 10,
      cacheRead: 0.2,
      sourceUrl: 'https://www.anthropic.com/news/claude-sonnet-5'
    }),
    anthropicEntry({
      id: 'anthropic-opus-5-2026-07-24',
      priceVersion: 'anthropic-2026-07-24',
      model: 'claude-opus-5',
      aliases: ['Claude Opus 5', 'claude-opus-5[1m]'],
      effectiveFrom: '2026-07-24T00:00:00.000Z',
      input: 5,
      output: 25,
      cacheRead: 0.5,
      sourceUrl: 'https://www.anthropic.com/news/claude-opus-5'
    }),
    anthropicEntry({
      id: 'anthropic-opus-4.8-2026-05-28',
      priceVersion: 'anthropic-2026-05-28',
      model: 'claude-opus-4-8',
      aliases: ['Claude Opus 4.8'],
      effectiveFrom: '2026-05-28T00:00:00.000Z',
      input: 5,
      output: 25,
      cacheRead: 0.5,
      sourceUrl: 'https://www.anthropic.com/news/claude-opus-4-8'
    }),
    anthropicEntry({
      id: 'anthropic-haiku-4.5-2025-10-01',
      priceVersion: 'anthropic-2025-10-01',
      model: 'claude-haiku-4-5-20251001',
      aliases: ['Claude Haiku 4.5', 'claude-haiku-4-5'],
      effectiveFrom: '2025-10-01T00:00:00.000Z',
      input: 1,
      output: 5,
      cacheRead: 0.1,
      sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing'
    })
  ]
};

function anthropicEntry(options: {
  id: string;
  priceVersion: string;
  model: string;
  aliases: string[];
  effectiveFrom: string;
  input: number;
  output: number;
  cacheRead: number;
  sourceUrl: string;
}): RetailPriceCatalogEntry {
  return {
    id: options.id,
    priceVersion: options.priceVersion,
    providerId: 'claude-code',
    billingDomainId: 'subscription',
    canonicalModel: options.model,
    aliases: options.aliases,
    currency: 'USD',
    effectiveFrom: options.effectiveFrom,
    effectiveUntil: null,
    contextTier: 'standard-api',
    contextRule: { kind: 'fixed' },
    ratesPerMillion: {
      input: options.input,
      output: options.output,
      reasoning: null,
      'cache-read': options.cacheRead,
      // Claude transcripts preserve total cache writes but pricing differs by cache lifetime.
      'cache-write': null
    },
    cacheWriteRatesPerMillion: {
      fiveMinute: options.input * 1.25,
      oneHour: options.input * 2
    },
    source: {
      title: 'Anthropic Claude API pricing',
      url: options.sourceUrl,
      retrievedAt: '2026-08-28'
    }
  };
}

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
const OPENAI_GPT_56_SOURCE = {
  title: 'OpenAI GPT-5.6 pricing',
  url: 'https://openai.com/index/gpt-5-6/',
  retrievedAt: '2026-08-28'
};
const OPEN_CODE_GO_SOURCE_PATH = 'packages/web/src/content/docs/go.mdx';
const openCodeHistory = (commit: string, effectiveFrom: string) => ({
  effectiveFrom,
  sourceUrl: `https://github.com/anomalyco/opencode/blob/${commit}/${OPEN_CODE_GO_SOURCE_PATH}`
});
const OPEN_CODE_BASE_HISTORY = openCodeHistory(
  '51213520f5f69ce2c6c741adcb2785e017488ade',
  '2026-07-16T23:20:17.000Z'
);
const OPEN_CODE_PRICE_HISTORY: Record<string, { effectiveFrom: string; sourceUrl: string }> = {
  'glm-5.3-flash': openCodeHistory(
    '830aaf2059e87eab3105dda4c19556206d60c443',
    '2026-08-26T13:49:06.000Z'
  ),
  'glm-5.3': openCodeHistory(
    'e23586af2623f1bc2e8e6965d2d7acf7bd03d5c3',
    '2026-08-14T05:48:32.000Z'
  ),
  'glm-5.2': OPEN_CODE_BASE_HISTORY,
  'glm-5.1': OPEN_CODE_BASE_HISTORY,
  'kimi-k3': OPEN_CODE_BASE_HISTORY,
  'kimi-k2.7-code': OPEN_CODE_BASE_HISTORY,
  'kimi-k2.6': OPEN_CODE_BASE_HISTORY,
  'longcat-2.0': openCodeHistory(
    '6bb772215b08b4b7d9243c27286950d85b9f678d',
    '2026-08-24T10:02:51.000Z'
  ),
  'mimo-v2.5': OPEN_CODE_BASE_HISTORY,
  'mimo-v2.5-pro': openCodeHistory(
    'be08207a88f3ae208b782832dc071863375cf734',
    '2026-07-17T15:15:48.000Z'
  ),
  'minimax-m3': OPEN_CODE_BASE_HISTORY,
  'minimax-m2.7': OPEN_CODE_BASE_HISTORY,
  'minimax-m2.5': OPEN_CODE_BASE_HISTORY,
  'muse-spark-1.2-contributor': openCodeHistory(
    'e2505d434a6d78904ecfe546c4a1980d26bd8cd1',
    '2026-08-19T19:03:41.000Z'
  ),
  'qwen3.8-max': openCodeHistory(
    'e9e747245681127c9f3e300aa8c46f2554fdb294',
    '2026-08-03T06:48:57.000Z'
  ),
  'qwen3.7-max': OPEN_CODE_BASE_HISTORY,
  'qwen3.7-plus': OPEN_CODE_BASE_HISTORY,
  'qwen3.6-plus': OPEN_CODE_BASE_HISTORY,
  hy3: openCodeHistory('411eff73f026d4950c07947c4d983788cb615baa', '2026-07-22T16:41:48.000Z'),
  'grok-4.6': openCodeHistory(
    'ac1c048e6420eb4c728fd3e343a1ba7b076cba92',
    '2026-08-25T17:27:48.000Z'
  ),
  'gpt-5.6-luna': openCodeHistory(
    'da59457ca4ff55aca0147d4ddb33c495dc72be31',
    '2026-07-31T05:23:25.000Z'
  ),
  'deepseek-v4-pro': openCodeHistory(
    'a0f8dccbfe139ffc7137d1eaf6fee6e4195af599',
    '2026-08-16T16:01:15.000Z'
  ),
  'deepseek-v4-flash': openCodeHistory(
    'a0f8dccbfe139ffc7137d1eaf6fee6e4195af599',
    '2026-08-16T16:01:15.000Z'
  ),
  'deepseek-v4-flash-vision-exp': openCodeHistory(
    '813e6f3cec1bfb2cec4f50ca6cb19e225e747e95',
    '2026-08-21T12:57:25.000Z'
  )
};
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

const DIRECT_OFFICIAL_PRICING_CATALOG: RetailPriceCatalog = {
  version: '2026-08-28-grok-4.6-build',
  entries: [
    ...ANTHROPIC_PRICING_CATALOG.entries,
    ...openAiGpt56Entries('gpt-5.6-sol', [
      ['2026-07-09T00:00:00.000Z', '2026-08-21T00:00:00.000Z', 5, 30],
      ['2026-08-21T00:00:00.000Z', null, 4, 20]
    ]),
    ...openAiGpt56Entries('gpt-5.6-terra', [
      ['2026-07-09T00:00:00.000Z', '2026-07-30T00:00:00.000Z', 2.5, 15],
      ['2026-07-30T00:00:00.000Z', null, 2, 12]
    ]),
    ...openAiGpt56Entries('gpt-5.6-luna', [
      ['2026-07-09T00:00:00.000Z', '2026-07-30T00:00:00.000Z', 1, 6],
      ['2026-07-30T00:00:00.000Z', null, 0.2, 1.2]
    ]),
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
      id: 'xai-grok-4.6-build-short-2026-08-12',
      priceVersion: 'xai-2026-08-12',
      billingDomainId: 'grok-build-subscription',
      model: 'grok-4.6',
      aliases: ['grok-4.6-build', 'grok-4.6-latest'],
      effectiveFrom: '2026-08-12T00:00:00.000Z',
      contextTier: 'prompt-at-or-below-200k',
      input: 2,
      output: 6,
      cacheRead: 0.5,
      contextRule: { kind: 'prompt-tokens', maximumInclusive: 200_000 }
    }),
    xaiEntry({
      id: 'xai-grok-4.6-build-long-2026-08-12',
      priceVersion: 'xai-2026-08-12',
      billingDomainId: 'grok-build-subscription',
      model: 'grok-4.6',
      aliases: ['grok-4.6-build', 'grok-4.6-latest'],
      effectiveFrom: '2026-08-12T00:00:00.000Z',
      contextTier: 'prompt-above-200k',
      input: 4,
      output: 12,
      cacheRead: 1,
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

export const OFFICIAL_PRICING_CATALOG: RetailPriceCatalog = {
  version: '2026-08-29-opencode-local-history',
  entries: [
    ...DIRECT_OFFICIAL_PRICING_CATALOG.entries,
    ...openCodeLocalHistoryEntries(DIRECT_OFFICIAL_PRICING_CATALOG.entries)
  ]
};

type OpenAiPricePeriod = [
  effectiveFrom: string,
  effectiveUntil: string | null,
  input: number,
  output: number
];

function openAiGpt56Entries(
  model: string,
  periods: OpenAiPricePeriod[]
): RetailPriceCatalogEntry[] {
  return periods.flatMap(([effectiveFrom, effectiveUntil, input, output]) => {
    const versionDate = effectiveFrom.slice(0, 10);
    const entry = (tier: 'standard' | 'prompt-above-272k'): RetailPriceCatalogEntry => {
      const long = tier === 'prompt-above-272k';
      const tierInput = long ? input * 2 : input;
      const tierOutput = long ? output * 1.5 : output;
      return {
        id: `openai-${model}-${tier}-${versionDate}`,
        priceVersion: `openai-gpt-5.6-${versionDate}`,
        providerId: 'codex',
        billingDomainId: 'subscription',
        canonicalModel: model,
        aliases: [],
        currency: 'USD',
        effectiveFrom,
        effectiveUntil,
        contextTier: tier,
        contextRule: long
          ? { kind: 'prompt-tokens', minimumExclusive: 272_000 }
          : { kind: 'prompt-tokens', maximumInclusive: 272_000 },
        ratesPerMillion: {
          input: tierInput,
          output: tierOutput,
          reasoning: tierOutput,
          'cache-read': tierInput * 0.1,
          'cache-write': tierInput * 1.25
        },
        source: OPENAI_GPT_56_SOURCE
      };
    };
    return [entry('standard'), entry('prompt-above-272k')];
  });
}

function openCodeGoEntry(
  model: string,
  tier: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number | null,
  contextRule: RetailPriceContextRule
): RetailPriceCatalogEntry {
  const history = OPEN_CODE_PRICE_HISTORY[model];
  if (!history) throw new Error(`Missing pinned OpenCode Go price history for ${model}.`);
  const effectiveFrom = history.effectiveFrom;
  const versionDate = effectiveFrom.slice(0, 10);
  return {
    id: `opencode-go-${model}-${tier}-${versionDate}`,
    priceVersion: `opencode-go-${versionDate}`,
    providerId: 'opencode-go',
    billingDomainId: 'go-subscription',
    canonicalModel: model,
    aliases: [`opencode-go/${model}`],
    currency: 'USD',
    effectiveFrom,
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
    source: { ...OPENCODE_GO_SOURCE, url: history.sourceUrl }
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

function openCodeLocalHistoryEntries(
  entries: RetailPriceCatalogEntry[]
): RetailPriceCatalogEntry[] {
  return entries.flatMap((entry) => {
    const modelPrefix = openCodeLocalModelPrefix(entry);
    if (!modelPrefix) return [];
    const localModel = (model: string) => (model.includes('/') ? model : `${modelPrefix}/${model}`);
    const canonicalModel = localModel(entry.canonicalModel);
    return [
      {
        ...entry,
        id: `opencode-local-${entry.id}`,
        providerId: 'opencode',
        billingDomainId: 'local-history',
        canonicalModel,
        aliases: [
          ...new Set(
            [entry.canonicalModel, ...entry.aliases]
              .map(localModel)
              .filter((model) => model !== canonicalModel)
          )
        ]
      }
    ];
  });
}

function openCodeLocalModelPrefix(entry: RetailPriceCatalogEntry): string | null {
  if (entry.providerId === 'claude-code' && entry.billingDomainId === 'subscription') {
    return 'anthropic';
  }
  if (entry.providerId === 'codex' && entry.billingDomainId === 'subscription') {
    return 'openai';
  }
  if (entry.providerId === 'grok' && entry.billingDomainId === 'xai-api') return 'xai';
  if (entry.providerId === 'opencode-go' && entry.billingDomainId === 'go-subscription') {
    return 'opencode-go';
  }
  return null;
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
    }
  ];
  const cacheWriteTokens =
    normalized.tokenSemantics.cacheWrite === 'separate' ? normalized.cacheWriteTokens : 0;
  const exactCacheWriteItems =
    cacheWriteTokens > 0 && normalized.cacheWriteTokenBreakdown && entry.cacheWriteRatesPerMillion
      ? [
          {
            tokenKind: 'cache-write' as const,
            tokens: normalized.cacheWriteTokenBreakdown.fiveMinute,
            ratePerMillion: entry.cacheWriteRatesPerMillion.fiveMinute
          },
          {
            tokenKind: 'cache-write' as const,
            tokens: normalized.cacheWriteTokenBreakdown.oneHour,
            ratePerMillion: entry.cacheWriteRatesPerMillion.oneHour
          }
        ].filter((item) => item.tokens > 0)
      : null;
  // A null cache-write rate with no explicit write tiers means the provider does
  // not bill cache writes at all (for example OpenCode Go DeepSeek V4, which
  // documents Cached Write as not charged). Treat those tokens as free instead
  // of refusing the whole observation. Models with tiered cache-write rates stay
  // ambiguous until the transcript provides the 5-minute / 1-hour split.
  const cacheWriteFree =
    cacheWriteTokens > 0 &&
    !exactCacheWriteItems &&
    entry.ratesPerMillion['cache-write'] === null &&
    !entry.cacheWriteRatesPerMillion;
  const cacheWriteBillable = cacheWriteTokens > 0 && !exactCacheWriteItems && !cacheWriteFree;
  if (cacheWriteBillable) {
    billableTokens.push({ tokenKind: 'cache-write', tokens: cacheWriteTokens });
  }
  const nonZero = billableTokens.filter((item) => item.tokens > 0);
  if (nonZero.some((item) => entry.ratesPerMillion[item.tokenKind] === null)) {
    return unavailable(
      normalized.cacheWriteTokens > 0 && !cacheWriteFree
        ? 'pricing-tier-ambiguous'
        : 'token-kinds-incomplete'
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
  if (exactCacheWriteItems) {
    lineItems.push(
      ...exactCacheWriteItems.map((item) => ({
        ...item,
        amount: preciseMoney((item.tokens * item.ratePerMillion) / 1_000_000)
      }))
    );
  }
  if (cacheWriteFree) {
    lineItems.push({
      tokenKind: 'cache-write',
      tokens: cacheWriteTokens,
      ratePerMillion: 0,
      amount: 0
    });
  }
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
        ...(entry.cacheWriteRatesPerMillion
          ? { cacheWriteRatesPerMillion: { ...entry.cacheWriteRatesPerMillion } }
          : {}),
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
