import { describe, expect, it } from 'vitest';

import { ANTHROPIC_PRICING_CATALOG, deriveRetailEquivalentCosts } from '$core/retail-pricing.js';
import type { ConnectorSnapshot, UsageObservation } from '$core/types.js';

describe('API retail-equivalent pricing', () => {
  it('prices an eligible Fable observation into auditable non-overlapping line items', () => {
    const result = deriveRetailEquivalentCosts(snapshot(observation()));

    expect(result.decisions).toEqual([
      {
        observationId: 'fable-event',
        status: 'priced',
        reason: null,
        pricedTokens: 130_000
      }
    ]);
    expect(result.costs).toEqual([
      expect.objectContaining({
        id: 'retail-equivalent:fable-event:anthropic-fable-5-2026-06-09',
        sourceId: 'fable-event',
        billingDomainId: 'subscription',
        observedAt: '2026-08-28T01:00:00.000Z',
        kind: 'retail-equivalent',
        amount: 2.01,
        currency: 'USD',
        authority: 'estimate',
        model: 'claude-fable-5',
        usageObservationId: 'fable-event',
        pricedTokens: 130_000,
        priceSnapshot: {
          id: 'anthropic-fable-5-2026-06-09',
          version: 'anthropic-2026-06-09',
          source: 'Anthropic Claude API pricing',
          effectiveAt: '2026-06-09T00:00:00.000Z',
          sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
          contextTier: 'standard-api'
        },
        lineItems: [
          { tokenKind: 'input', tokens: 100_000, ratePerMillion: 10, amount: 1 },
          { tokenKind: 'output', tokens: 20_000, ratePerMillion: 50, amount: 1 },
          { tokenKind: 'cache-read', tokens: 10_000, ratePerMillion: 1, amount: 0.01 }
        ]
      })
    ]);
    expect(result.costs[0].lineItems?.reduce((total, lineItem) => total + lineItem.amount, 0)).toBe(
      result.costs[0].amount
    );
  });

  it('resolves the official display-name alias inside the Claude subscription scope', () => {
    const result = deriveRetailEquivalentCosts(snapshot(observation({ model: 'Claude Fable 5' })));

    expect(result.costs[0]).toMatchObject({ model: 'claude-fable-5', amount: 2.01 });
  });

  it('selects price versions by observation time and rejects pre-effective history', () => {
    const atBoundary = deriveRetailEquivalentCosts(
      snapshot(observation({ observedAt: '2026-06-09T00:00:00.000Z' }))
    );
    const beforeBoundary = deriveRetailEquivalentCosts(
      snapshot(observation({ observedAt: '2026-06-08T23:59:59.999Z' }))
    );

    expect(atBoundary.costs).toHaveLength(1);
    expect(beforeBoundary.costs).toEqual([]);
    expect(beforeBoundary.decisions).toEqual([
      expect.objectContaining({ status: 'unavailable', reason: 'price-not-effective' })
    ]);
  });

  it.each([
    ['unknown model', { model: 'claude-unknown' }, 'model-unrecognized'],
    ['unknown model attribution', { modelAttribution: 'unclassified' }, 'model-unclassified'],
    ['uncategorized remainder', { sourceReportedTotalTokens: 140_000 }, 'token-kinds-incomplete'],
    ['ambiguous cache write duration', { cacheWriteTokens: 1 }, 'pricing-tier-ambiguous']
  ])('fails closed for %s', (_label, overrides, reason) => {
    const result = deriveRetailEquivalentCosts(
      snapshot(observation(overrides as Partial<UsageObservation>))
    );

    expect(result.costs).toEqual([]);
    expect(result.decisions).toEqual([
      expect.objectContaining({ status: 'unavailable', reason, pricedTokens: 0 })
    ]);
  });

  it('scopes aliases by Provider and billing domain', () => {
    const wrongProvider = deriveRetailEquivalentCosts(
      snapshot(observation(), { providerId: 'grok' })
    );
    const wrongDomain = deriveRetailEquivalentCosts(
      snapshot(observation({ billingDomainId: 'xai-api' }), {
        domainId: 'xai-api',
        domainName: 'xAI API'
      })
    );

    expect(wrongProvider.costs).toEqual([]);
    expect(wrongDomain.costs).toEqual([]);
  });

  it('records the reviewed official source and context tier in the fixed catalog', () => {
    expect(ANTHROPIC_PRICING_CATALOG).toMatchObject({
      version: '2026-08-28',
      entries: [
        {
          providerId: 'claude-code',
          billingDomainId: 'subscription',
          canonicalModel: 'claude-fable-5',
          aliases: ['Claude Fable 5'],
          currency: 'USD',
          effectiveFrom: '2026-06-09T00:00:00.000Z',
          effectiveUntil: null,
          contextTier: 'standard-api',
          source: {
            url: 'https://platform.claude.com/docs/en/about-claude/pricing',
            retrievedAt: '2026-08-28'
          }
        }
      ]
    });
  });
});

function observation(overrides: Partial<UsageObservation> = {}): UsageObservation {
  return {
    id: 'fable-event',
    billingDomainId: 'subscription',
    model: 'claude-fable-5',
    observedAt: '2026-08-28T01:00:00.000Z',
    inputTokens: 100_000,
    outputTokens: 20_000,
    reasoningTokens: 5_000,
    cacheReadTokens: 10_000,
    cacheWriteTokens: 0,
    tokenSemantics: {
      reasoning: 'included-in-output',
      cacheRead: 'separate',
      cacheWrite: 'separate'
    },
    modelAttribution: 'known',
    timePrecision: 'event',
    usageScope: 'this-mac',
    aggregationTemporality: 'delta',
    authority: 'local-observation',
    ...overrides
  };
}

function snapshot(
  usage: UsageObservation,
  options: { providerId?: string; domainId?: string; domainName?: string } = {}
): ConnectorSnapshot {
  const providerId = options.providerId ?? 'claude-code';
  const domainId = options.domainId ?? 'subscription';
  return {
    provider: {
      id: providerId,
      displayName: providerId === 'claude-code' ? 'Claude Code' : 'Grok'
    },
    billingDomains: [{ id: domainId, displayName: options.domainName ?? 'Claude subscription' }],
    quotaBuckets: [],
    usage: [usage],
    costs: [],
    observedAt: '2026-08-28T01:00:00.000Z'
  };
}
