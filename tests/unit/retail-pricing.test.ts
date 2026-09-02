import { describe, expect, it } from 'vitest';

import {
  ANTHROPIC_PRICING_CATALOG,
  OFFICIAL_PRICING_CATALOG,
  deriveRetailEquivalentCosts
} from '$core/retail-pricing.js';
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
          canonicalModel: 'claude-fable-5',
          effectiveAt: '2026-06-09T00:00:00.000Z',
          effectiveUntil: null,
          currency: 'USD',
          sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
          contextTier: 'standard-api',
          ratesPerMillion: {
            input: 10,
            output: 50,
            reasoning: null,
            'cache-read': 1,
            'cache-write': null
          },
          cacheWriteRatesPerMillion: { fiveMinute: 12.5, oneHour: 20 }
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

    expect(result.costs[0]).toMatchObject({
      model: 'Claude Fable 5',
      amount: 2.01,
      priceSnapshot: { canonicalModel: 'claude-fable-5' }
    });
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

  it('prices Claude cache writes from transcript-provided 5-minute and 1-hour token splits', () => {
    const result = deriveRetailEquivalentCosts(
      snapshot(
        observation({
          id: 'sonnet-cache-write',
          model: 'claude-sonnet-5',
          cacheWriteTokens: 30_000,
          cacheWriteTokenBreakdown: { fiveMinute: 10_000, oneHour: 20_000 }
        })
      ),
      OFFICIAL_PRICING_CATALOG
    );

    expect(result.costs[0]).toMatchObject({
      amount: 0.507,
      pricedTokens: 160_000,
      priceSnapshot: {
        cacheWriteRatesPerMillion: { fiveMinute: 2.5, oneHour: 4 }
      },
      lineItems: expect.arrayContaining([
        { tokenKind: 'cache-write', tokens: 10_000, ratePerMillion: 2.5, amount: 0.025 },
        { tokenKind: 'cache-write', tokens: 20_000, ratePerMillion: 4, amount: 0.08 }
      ])
    });
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
    expect(ANTHROPIC_PRICING_CATALOG.version).toBe('2026-08-28');
    expect(
      ANTHROPIC_PRICING_CATALOG.entries.find((entry) => entry.canonicalModel === 'claude-fable-5')
    ).toMatchObject({
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
    });
    expect(ANTHROPIC_PRICING_CATALOG.entries.map((entry) => entry.canonicalModel).sort()).toEqual([
      'claude-fable-5',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-8',
      'claude-opus-5',
      'claude-sonnet-5'
    ]);
  });

  it('prices the exact Claude Haiku transcript model identifier', () => {
    const result = deriveRetailEquivalentCosts(
      snapshot(observation({ id: 'haiku', model: 'claude-haiku-4-5-20251001' })),
      OFFICIAL_PRICING_CATALOG
    );

    expect(result.costs[0]).toMatchObject({
      amount: 0.201,
      priceSnapshot: { id: 'anthropic-haiku-4.5-2025-10-01' }
    });
  });

  it.each([
    ['claude-sonnet-5', 0.402, 'anthropic-sonnet-5-2026-06-30'],
    ['claude-opus-4-8', 1.005, 'anthropic-opus-4.8-2026-05-28'],
    ['claude-opus-5', 1.005, 'anthropic-opus-5-2026-07-24']
  ])(
    'prices current Claude transcript model %s when cache-write duration is unambiguous',
    (model, amount, priceId) => {
      const result = deriveRetailEquivalentCosts(
        snapshot(observation({ id: model, model })),
        OFFICIAL_PRICING_CATALOG
      );

      expect(result.costs[0]).toMatchObject({
        amount,
        model,
        priceSnapshot: { id: priceId }
      });
    }
  );

  it.each([
    ['gpt-5.6-sol', 0.804, 'openai-gpt-5.6-sol-standard-2026-08-21'],
    ['gpt-5.6-terra', 0.442, 'openai-gpt-5.6-terra-standard-2026-07-30'],
    ['gpt-5.6-luna', 0.0442, 'openai-gpt-5.6-luna-standard-2026-07-30']
  ])('prices current Codex transcript model %s', (model, amount, priceId) => {
    const result = deriveRetailEquivalentCosts(
      snapshot(observation({ id: model, model }), {
        providerId: 'codex',
        domainId: 'subscription',
        domainName: 'Codex subscription'
      }),
      OFFICIAL_PRICING_CATALOG
    );

    expect(result.costs[0]).toMatchObject({
      amount,
      model,
      priceSnapshot: { id: priceId }
    });
  });

  it('selects the long-context Codex tier from event-level prompt evidence', () => {
    const result = deriveRetailEquivalentCosts(
      snapshot(
        observation({
          id: 'sol-long',
          model: 'gpt-5.6-sol',
          inputTokens: 300_000
        }),
        {
          providerId: 'codex',
          domainId: 'subscription',
          domainName: 'Codex subscription'
        }
      ),
      OFFICIAL_PRICING_CATALOG
    );

    expect(result.costs[0]).toMatchObject({
      amount: 3.008,
      priceSnapshot: { contextTier: 'prompt-above-272k' }
    });
  });

  it('selects xAI short and long context tiers only from event-level prompt evidence', () => {
    const short = deriveRetailEquivalentCosts(
      snapshot(observation({ model: 'grok-4.6', billingDomainId: 'xai-api' }), {
        providerId: 'grok',
        domainId: 'xai-api',
        domainName: 'xAI API'
      }),
      OFFICIAL_PRICING_CATALOG
    );
    const long = deriveRetailEquivalentCosts(
      snapshot(
        observation({
          id: 'grok-long',
          model: 'grok-4.6',
          billingDomainId: 'xai-api',
          inputTokens: 200_000
        }),
        { providerId: 'grok', domainId: 'xai-api', domainName: 'xAI API' }
      ),
      OFFICIAL_PRICING_CATALOG
    );
    const billingPeriod = deriveRetailEquivalentCosts(
      snapshot(
        observation({
          id: 'grok-invoice',
          model: 'grok-4.6',
          billingDomainId: 'xai-api',
          timePrecision: 'billing-period'
        }),
        { providerId: 'grok', domainId: 'xai-api', domainName: 'xAI API' }
      ),
      OFFICIAL_PRICING_CATALOG
    );

    expect(short.costs[0]).toMatchObject({
      amount: 0.325,
      model: 'grok-4.6',
      priceSnapshot: { contextTier: 'prompt-at-or-below-200k' }
    });
    expect(long.costs[0]).toMatchObject({
      amount: 1.05,
      priceSnapshot: { contextTier: 'prompt-above-200k' }
    });
    expect(billingPeriod.costs).toEqual([]);
    expect(billingPeriod.decisions[0]).toMatchObject({
      status: 'unavailable',
      reason: 'pricing-tier-ambiguous'
    });
  });

  it('keeps Grok Build pricing in the subscription domain and resolves the client model label', () => {
    const build = deriveRetailEquivalentCosts(
      snapshot(
        observation({
          id: 'grok-build-event',
          model: 'grok-build',
          billingDomainId: 'grok-build-subscription'
        }),
        {
          providerId: 'grok',
          domainId: 'grok-build-subscription',
          domainName: 'Build / SuperGrok'
        }
      ),
      OFFICIAL_PRICING_CATALOG
    );
    const wrongDomain = deriveRetailEquivalentCosts(
      snapshot(
        observation({ id: 'grok-build-api', model: 'grok-build', billingDomainId: 'xai-api' }),
        { providerId: 'grok', domainId: 'xai-api', domainName: 'xAI API' }
      ),
      OFFICIAL_PRICING_CATALOG
    );

    expect(build.costs[0]).toMatchObject({
      amount: 0.142,
      billingDomainId: 'grok-build-subscription',
      model: 'grok-build',
      priceSnapshot: { canonicalModel: 'grok-build-0.1' }
    });
    expect(wrongDomain.costs).toEqual([]);
  });

  it('prices flat OpenCode Go models and refuses a day bucket with peak/off-peak ambiguity', () => {
    const flat = deriveRetailEquivalentCosts(
      snapshot(
        observation({
          id: 'opencode-flat',
          model: 'opencode-go/glm-5.2',
          billingDomainId: 'go-subscription',
          tokenSemantics: {
            reasoning: 'separate',
            cacheRead: 'separate',
            cacheWrite: 'separate'
          }
        }),
        { providerId: 'opencode-go', domainId: 'go-subscription', domainName: 'OpenCode Go' }
      ),
      OFFICIAL_PRICING_CATALOG
    );
    const ambiguous = deriveRetailEquivalentCosts(
      snapshot(
        observation({
          id: 'opencode-day',
          model: 'opencode-go/deepseek-v4-flash',
          billingDomainId: 'go-subscription',
          timePrecision: 'day',
          tokenSemantics: {
            reasoning: 'separate',
            cacheRead: 'separate',
            cacheWrite: 'separate'
          }
        }),
        { providerId: 'opencode-go', domainId: 'go-subscription', domainName: 'OpenCode Go' }
      ),
      OFFICIAL_PRICING_CATALOG
    );

    expect(flat.costs[0]).toMatchObject({
      amount: 0.2526,
      model: 'opencode-go/glm-5.2',
      priceSnapshot: { canonicalModel: 'glm-5.2' }
    });
    expect(ambiguous.costs).toEqual([]);
    expect(ambiguous.decisions[0]).toMatchObject({ reason: 'pricing-tier-ambiguous' });
  });

  it('selects OpenCode Go peak and off-peak entries from exact UTC event time', () => {
    const pricedAt = (observedAt: string) =>
      deriveRetailEquivalentCosts(
        snapshot(
          observation({
            id: `deepseek-${observedAt}`,
            model: 'opencode-go/deepseek-v4-flash',
            billingDomainId: 'go-subscription',
            observedAt,
            tokenSemantics: {
              reasoning: 'separate',
              cacheRead: 'separate',
              cacheWrite: 'separate'
            }
          }),
          { providerId: 'opencode-go', domainId: 'go-subscription', domainName: 'OpenCode Go' }
        ),
        OFFICIAL_PRICING_CATALOG
      ).costs[0];

    expect(pricedAt('2026-08-28T02:00:00.000Z')).toMatchObject({
      amount: 0.07714,
      priceSnapshot: { contextTier: 'weekday-peak-utc' }
    });
    expect(pricedAt('2026-08-28T05:00:00.000Z')).toMatchObject({
      amount: 0.03857,
      priceSnapshot: { contextTier: 'off-peak-utc' }
    });
  });

  it('uses pinned OpenCode price history instead of the catalog retrieval date', () => {
    const price = (model: string, observedAt: string) =>
      deriveRetailEquivalentCosts(
        snapshot(
          observation({
            id: `${model}:${observedAt}`,
            model: `opencode-go/${model}`,
            billingDomainId: 'go-subscription',
            observedAt,
            inputTokens: 1_000_000,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            tokenSemantics: {
              reasoning: 'separate',
              cacheRead: 'separate',
              cacheWrite: 'separate'
            }
          }),
          { providerId: 'opencode-go', domainId: 'go-subscription', domainName: 'OpenCode Go' }
        ),
        OFFICIAL_PRICING_CATALOG
      );

    expect(price('kimi-k3', '2026-08-19T00:00:00.000Z').costs[0]).toMatchObject({
      amount: 3,
      priceSnapshot: { effectiveAt: '2026-07-16T23:20:17.000Z' }
    });
    expect(price('deepseek-v4-flash', '2026-08-17T00:00:00.000Z').costs[0]).toMatchObject({
      amount: 0.22,
      priceSnapshot: { effectiveAt: '2026-08-16T16:01:15.000Z' }
    });
    expect(
      price('deepseek-v4-flash-vision-exp', '2026-08-22T00:00:00.000Z').costs[0]
    ).toMatchObject({
      amount: 0.22,
      priceSnapshot: { effectiveAt: '2026-08-21T12:57:25.000Z' }
    });
    expect(price('deepseek-v4-flash', '2026-08-16T16:01:14.999Z').decisions[0]).toMatchObject({
      status: 'unavailable',
      reason: 'price-not-effective'
    });
  });

  it('publishes OpenCode Go cache writes as free when the provider does not bill them', () => {
    const result = deriveRetailEquivalentCosts(
      snapshot(
        observation({
          id: 'deepseek-cache-write-free',
          model: 'opencode-go/deepseek-v4-flash-vision-exp',
          billingDomainId: 'go-subscription',
          observedAt: '2026-08-27T00:30:00.000Z',
          inputTokens: 400_000,
          outputTokens: 100_000,
          reasoningTokens: 0,
          cacheReadTokens: 71_000,
          cacheWriteTokens: 500,
          tokenSemantics: {
            reasoning: 'separate',
            cacheRead: 'separate',
            cacheWrite: 'separate'
          }
        }),
        { providerId: 'opencode-go', domainId: 'go-subscription', domainName: 'OpenCode Go' }
      ),
      OFFICIAL_PRICING_CATALOG
    );

    expect(result.decisions[0]).toEqual({
      observationId: 'deepseek-cache-write-free',
      status: 'priced',
      reason: null,
      pricedTokens: 571_500
    });
    expect(result.costs[0]).toMatchObject({
      amount: 0.154497,
      pricedTokens: 571_500,
      lineItems: expect.arrayContaining([
        expect.objectContaining({
          tokenKind: 'cache-write',
          tokens: 500,
          ratePerMillion: 0,
          amount: 0
        })
      ])
    });
  });

  it('pins every supported OpenCode Go model to reviewed repository history', () => {
    const expectedModels = [
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
      'deepseek-v4-pro',
      'glm-5.1',
      'glm-5.2',
      'glm-5.3',
      'glm-5.3-flash',
      'gpt-5.6-luna',
      'grok-4.6',
      'hy3',
      'kimi-k2.6',
      'kimi-k2.7-code',
      'kimi-k3',
      'longcat-2.0',
      'mimo-v2.5',
      'mimo-v2.5-pro',
      'minimax-m2.5',
      'minimax-m2.7',
      'minimax-m3',
      'muse-spark-1.2-contributor',
      'qwen3.6-plus',
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3.8-max'
    ];
    const entries = OFFICIAL_PRICING_CATALOG.entries.filter(
      (entry) => entry.providerId === 'opencode-go'
    );

    expect([...new Set(entries.map((entry) => entry.canonicalModel))].sort()).toEqual(
      expectedModels
    );
    for (const entry of entries) {
      expect(entry.effectiveFrom).not.toBe('2026-08-28T00:00:00.000Z');
      expect(entry.source.url).toMatch(
        /^https:\/\/github\.com\/anomalyco\/opencode\/blob\/[0-9a-f]{40}\/packages\/web\/src\/content\/docs\/go\.mdx$/
      );
    }
  });

  it('prices Grok 4.6 Build subscription tokens independently from xAI API billing', () => {
    const result = deriveRetailEquivalentCosts(
      {
        provider: { id: 'grok', displayName: 'Grok' },
        billingDomains: [
          { id: 'grok-build-subscription', displayName: 'Grok Build / SuperGrok shared pool' }
        ],
        quotaBuckets: [],
        usage: [
          observation({
            id: 'grok-build-event',
            billingDomainId: 'grok-build-subscription',
            model: 'grok-4.6-build',
            inputTokens: 100_000,
            outputTokens: 100_000,
            cacheReadTokens: 100_000,
            observedAt: '2026-08-28T00:00:00.000Z'
          })
        ],
        costs: [],
        observedAt: '2026-08-28T00:00:00.000Z'
      },
      OFFICIAL_PRICING_CATALOG,
      '2026-08-28T01:00:00.000Z'
    );

    expect(result.costs[0]).toMatchObject({
      billingDomainId: 'grok-build-subscription',
      kind: 'retail-equivalent',
      amount: 0.85,
      priceSnapshot: {
        canonicalModel: 'grok-4.6',
        ratesPerMillion: { input: 2, output: 6, 'cache-read': 0.5 }
      }
    });
  });

  it.each([
    ['xai/grok-4.6', 0.325],
    ['openai/gpt-5.6-sol', 0.804],
    ['anthropic/claude-opus-5', 1.005],
    ['opencode-go/glm-5.2', 0.2306]
  ])(
    'prices OpenCode local-history model %s with its eligible official retail source',
    (model, amount) => {
      const result = deriveRetailEquivalentCosts(
        snapshot(
          observation({ id: `opencode:${model}`, model, billingDomainId: 'local-history' }),
          {
            providerId: 'opencode',
            domainId: 'local-history',
            domainName: 'Local history'
          }
        ),
        OFFICIAL_PRICING_CATALOG
      );

      expect(result.decisions[0]).toMatchObject({ status: 'priced', reason: null });
      expect(result.costs[0]).toMatchObject({
        amount,
        billingDomainId: 'local-history',
        model,
        priceSnapshot: { canonicalModel: model }
      });
    }
  );

  it('does not price a direct OpenCode model with an unrelated Go subscription price', () => {
    const result = deriveRetailEquivalentCosts(
      snapshot(
        observation({
          id: 'opencode:deepseek-direct',
          model: 'deepseek/deepseek-v4-pro',
          billingDomainId: 'local-history'
        }),
        { providerId: 'opencode', domainId: 'local-history', domainName: 'Local history' }
      ),
      OFFICIAL_PRICING_CATALOG
    );

    expect(result.costs).toEqual([]);
    expect(result.decisions[0]).toMatchObject({
      status: 'unavailable',
      reason: 'model-unrecognized'
    });
  });

  it('prices Antigravity Gemini 3.7 Flash and Claude Sonnet observations with source attribution', () => {
    const geminiObs = observation({
      id: 'agy-gemini',
      model: 'gemini-3.7-flash-high',
      billingDomainId: 'code-assist-subscription',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 200_000
    });
    const claudeObs = observation({
      id: 'agy-claude',
      model: 'claude-sonnet-4-6',
      billingDomainId: 'code-assist-subscription',
      inputTokens: 100_000,
      outputTokens: 20_000,
      cacheReadTokens: 10_000
    });

    const geminiResult = deriveRetailEquivalentCosts(
      snapshot(geminiObs, {
        providerId: 'antigravity',
        domainId: 'code-assist-subscription',
        domainName: 'Gemini Code Assist'
      }),
      OFFICIAL_PRICING_CATALOG
    );

    expect(geminiResult.decisions[0]).toEqual({
      observationId: 'agy-gemini',
      status: 'priced',
      reason: null,
      pricedTokens: 1_700_000
    });
    expect(geminiResult.costs[0]?.amount).toBeCloseTo(0.1 + 0.2 + 0.005, 4);

    const claudeResult = deriveRetailEquivalentCosts(
      snapshot(claudeObs, {
        providerId: 'antigravity',
        domainId: 'code-assist-subscription',
        domainName: 'Gemini Code Assist'
      }),
      OFFICIAL_PRICING_CATALOG
    );

    expect(claudeResult.decisions[0]).toEqual({
      observationId: 'agy-claude',
      status: 'priced',
      reason: null,
      pricedTokens: 130_000
    });
    expect(claudeResult.costs[0]?.amount).toBeCloseTo(0.3 + 0.3 + 0.003, 4);
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
