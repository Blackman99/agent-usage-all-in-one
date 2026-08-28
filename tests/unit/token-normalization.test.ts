import { describe, expect, it } from 'vitest';

import { normalizeTokenObservation } from '$core/token-normalization.js';
import type { UsageObservation } from '$core/types.js';

describe('token normalization', () => {
  it('counts separate reasoning and cache categories exactly once', () => {
    const normalized = normalizeTokenObservation(
      observation({
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 20,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        tokenSemantics: {
          reasoning: 'separate',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        timePrecision: 'event'
      })
    );

    expect(normalized).toMatchObject({
      recordedTokens: 185,
      sourceReportedTotalTokens: null,
      unclassifiedTokens: 0,
      totalDerivation: 'categorized',
      modelAttribution: 'known',
      timePrecision: 'event'
    });
  });

  it('does not add reasoning or cache fields already included by the source', () => {
    const normalized = normalizeTokenObservation(
      observation({
        inputTokens: 110,
        outputTokens: 70,
        reasoningTokens: 20,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'included-in-input',
          cacheWrite: 'included-in-input'
        }
      })
    );

    expect(normalized.recordedTokens).toBe(180);
    expect(normalized.unclassifiedTokens).toBe(0);
  });

  it('preserves a source total and exposes the uncategorized remainder', () => {
    const normalized = normalizeTokenObservation(
      observation({
        sourceReportedTotalTokens: 250,
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 0,
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        timePrecision: 'hour'
      })
    );

    expect(normalized).toMatchObject({
      recordedTokens: 250,
      sourceReportedTotalTokens: 250,
      unclassifiedTokens: 90,
      totalDerivation: 'source-reported',
      timePrecision: 'hour'
    });
  });

  it('keeps total-only aggregate usage without pretending it belongs to a model', () => {
    const normalized = normalizeTokenObservation(
      observation({
        model: null,
        sourceReportedTotalTokens: 1_250,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        modelAttribution: 'unclassified',
        timePrecision: 'billing-period'
      })
    );

    expect(normalized).toMatchObject({
      model: null,
      modelAttribution: 'unclassified',
      recordedTokens: 1_250,
      unclassifiedTokens: 1_250,
      totalDerivation: 'source-reported',
      timePrecision: 'billing-period'
    });
  });

  it('keeps a reconciled account remainder distinct from source-reported evidence', () => {
    const normalized = normalizeTokenObservation(
      observation({
        model: null,
        reconciledRemainderTokens: 879,
        modelAttribution: 'unclassified',
        usageScope: 'account-wide',
        authority: 'estimate'
      })
    );

    expect(normalized).toMatchObject({
      recordedTokens: 879,
      sourceReportedTotalTokens: null,
      reconciledRemainderTokens: 879,
      unclassifiedTokens: 879,
      totalDerivation: 'reconciled-remainder',
      authority: 'estimate'
    });
  });

  it('does not let an explicit attribution turn an aggregate placeholder into a model', () => {
    const normalized = normalizeTokenObservation(
      observation({
        model: 'all-models',
        modelAttribution: 'known',
        sourceReportedTotalTokens: 25
      })
    );

    expect(normalized.modelAttribution).toBe('unclassified');
    expect(normalized.unclassifiedTokens).toBe(25);
  });

  it('treats provider unknown-model placeholders as unclassified', () => {
    const normalized = normalizeTokenObservation(
      observation({
        model: 'unknown-model',
        modelAttribution: 'known',
        sourceReportedTotalTokens: 25
      })
    );

    expect(normalized.modelAttribution).toBe('unclassified');
  });

  it('rejects a source total smaller than its non-overlapping categories', () => {
    expect(() =>
      normalizeTokenObservation(
        observation({
          sourceReportedTotalTokens: 99,
          inputTokens: 100,
          outputTokens: 25
        })
      )
    ).toThrow('sourceReportedTotalTokens must be greater than or equal to categorized tokens');
  });
});

function observation(overrides: Partial<UsageObservation>): UsageObservation {
  return {
    id: 'observation',
    billingDomainId: 'subscription',
    model: 'known-model',
    observedAt: '2026-08-28T02:00:00.000Z',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    authority: 'official-account',
    ...overrides
  };
}
