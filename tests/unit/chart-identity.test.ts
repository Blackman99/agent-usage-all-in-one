import { describe, expect, it } from 'vitest';

import { chartIdentityKey, qualifyChartNames } from '../../src/lib/chart-identity.js';

describe('chart identity', () => {
  it('keeps Provider, billing domain, and model in the series key', () => {
    expect(chartIdentityKey('grok', 'xai-api', 'grok-4.6')).toBe('grok:xai-api:grok-4.6:tokens');
    expect(chartIdentityKey('grok', 'custom', 'grok-4.6', 'retail-equivalent')).toBe(
      'grok:custom:grok-4.6:retail-equivalent'
    );
    expect(chartIdentityKey('codex', 'subscription', null)).toBe('codex:subscription::tokens');
  });

  it('qualifies matching model names with agent and billing domain', () => {
    expect(
      qualifyChartNames([
        {
          model: 'shared-model',
          providerDisplayName: 'Codex',
          billingDomainDisplayName: 'Subscription'
        },
        {
          model: 'fable-model',
          providerDisplayName: 'Claude Code',
          billingDomainDisplayName: 'Subscription'
        },
        {
          model: 'shared-model',
          providerDisplayName: 'Grok',
          billingDomainDisplayName: 'xAI API'
        }
      ])
    ).toEqual(['shared-model · Codex', 'fable-model', 'shared-model · Grok']);
  });
});
