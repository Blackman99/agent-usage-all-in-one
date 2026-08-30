import { describe, expect, it } from 'vitest';

import {
  buildModelBreakdownEntries,
  buildModelBreakdownOption,
  type ModelBreakdownSource
} from '../../src/lib/model-breakdown.js';

describe('Model breakdown treemap', () => {
  const models: ModelBreakdownSource[] = [
    {
      id: 'fable-model',
      providerId: 'claude-code',
      providerDisplayName: 'Claude Code',
      billingDomainId: 'subscription',
      billingDomainDisplayName: 'Subscription',
      includedInHeadline: true,
      model: 'fable-model',
      tokenTotals: { total: 750 },
      retailEquivalent: {
        amount: 15,
        authorities: ['estimate'],
        observedAt: '2026-08-28T10:05:00.000Z'
      },
      reportedEstimate: {
        amount: 9,
        authorities: ['estimate'],
        observedAt: '2026-08-28T10:04:00.000Z'
      },
      authorities: ['local-observation'],
      lastObservedAt: '2026-08-28T10:00:00.000Z'
    },
    {
      id: 'shared-model',
      providerId: 'codex',
      providerDisplayName: 'Codex',
      billingDomainId: 'subscription',
      billingDomainDisplayName: 'Subscription',
      includedInHeadline: true,
      model: 'shared-model',
      tokenTotals: { total: 250 },
      retailEquivalent: {
        amount: 10,
        authorities: ['official-client'],
        observedAt: '2026-08-28T10:10:00.000Z'
      },
      reportedEstimate: {
        amount: 8,
        authorities: ['official-client'],
        observedAt: '2026-08-28T10:09:00.000Z'
      },
      authorities: ['official-client'],
      lastObservedAt: '2026-08-28T10:10:00.000Z'
    },
    {
      id: 'shared-model-grok',
      providerId: 'grok',
      providerDisplayName: 'Grok',
      billingDomainId: 'xai-api',
      billingDomainDisplayName: 'xAI API',
      includedInHeadline: false,
      model: 'shared-model',
      tokenTotals: { total: 50 },
      retailEquivalent: {
        amount: null,
        authorities: [],
        observedAt: null
      },
      reportedEstimate: {
        amount: 3,
        authorities: ['estimate'],
        observedAt: '2026-08-28T10:12:00.000Z'
      },
      authorities: ['estimate'],
      lastObservedAt: '2026-08-28T10:12:00.000Z'
    },
    {
      id: 'empty-model',
      providerId: 'opencode',
      providerDisplayName: 'OpenCode',
      billingDomainId: 'local-history',
      billingDomainDisplayName: 'Local history',
      includedInHeadline: true,
      model: 'empty-model',
      tokenTotals: { total: 0 },
      retailEquivalent: { amount: null, authorities: [], observedAt: null },
      reportedEstimate: { amount: null, authorities: [], observedAt: null },
      authorities: [],
      lastObservedAt: null
    }
  ];

  it('keeps only positive chartable values and computes treemap share', () => {
    const entries = buildModelBreakdownEntries(
      models,
      'tokens',
      (providerId) => (providerId === 'codex' ? '#111111' : '#222222'),
      (value) => `${value} Tokens`,
      (share) => `${Math.round(share * 100)}%`
    );

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.name)).toEqual([
      'fable-model',
      'shared-model · Codex',
      'shared-model · Grok'
    ]);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        modelId: 'fable-model',
        value: 750,
        share: 750 / 1050,
        formattedValue: '750 Tokens',
        formattedShare: '71%',
        color: '#222222'
      })
    );
  });

  it('falls back to the reported estimate for the cost metric', () => {
    const entries = buildModelBreakdownEntries(
      models,
      'retail-equivalent',
      () => '#7788ff',
      (value) => `$${value}`,
      (share) => `${share * 100}%`
    );

    expect(entries).toEqual([
      expect.objectContaining({ name: 'fable-model', value: 15 }),
      expect.objectContaining({ name: 'shared-model · Codex', value: 10 }),
      expect.objectContaining({
        name: 'shared-model · Grok',
        value: 3,
        includedInHeadline: false
      })
    ]);
  });

  it('builds an ECharts treemap option with themed tooltip and click payloads', () => {
    const entries = buildModelBreakdownEntries(
      models,
      'tokens',
      () => '#7788ff',
      (value) => `${value} Tokens`,
      (share) => `${share * 100}%`
    );
    const option = buildModelBreakdownOption(entries, {
      text: '#ffffff',
      muted: '#999999',
      surface: '#111111',
      border: '#333333'
    });

    expect(option.tooltip).toMatchObject({ show: true, trigger: 'item', renderMode: 'html' });
    expect(option.series).toEqual([
      expect.objectContaining({ type: 'treemap', nodeClick: false, roam: false })
    ]);
    expect(option.series[0].data).toHaveLength(3);
    expect(option.series[0].data[0]).toEqual(
      expect.objectContaining({ name: 'fable-model', value: 750, modelId: 'fable-model' })
    );
  });

  it('renders an empty-state title when nothing is chartable', () => {
    const option = buildModelBreakdownOption([], {
      text: '#ffffff',
      muted: '#999999',
      surface: '#111111',
      border: '#333333'
    });

    expect(option.title).toMatchObject({ show: true, text: 'Unavailable' });
  });
});
