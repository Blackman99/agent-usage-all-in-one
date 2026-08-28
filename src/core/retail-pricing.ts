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
  ratesPerMillion: Record<RetailTokenKind, number | null>;
  source: {
    title: string;
    url: string;
    retrievedAt: string;
  };
}

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
  const activeEntries = modelEntries.filter(
    (entry) =>
      observation.observedAt >= entry.effectiveFrom &&
      (!entry.effectiveUntil || observation.observedAt < entry.effectiveUntil)
  );
  if (activeEntries.length === 0) return unavailable('price-not-effective');
  if (activeEntries.length > 1) return unavailable('pricing-tier-ambiguous');
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
      model: entry.canonicalModel,
      usageObservationId: observation.id,
      pricedTokens,
      lineItems,
      calculatedAt,
      priceSnapshot: {
        id: entry.id,
        version: entry.priceVersion,
        source: entry.source.title,
        effectiveAt: entry.effectiveFrom,
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

function preciseMoney(value: number): number {
  return Number(value.toFixed(12));
}
