import { describe, expect, it } from 'vitest';

import {
  buildProviderShareChartOption,
  buildProviderShareEntries,
  type ProviderShareSource
} from '../../src/lib/provider-share.js';

describe('Provider share chart', () => {
  const providers: ProviderShareSource[] = [
    {
      providerId: 'codex',
      providerDisplayName: 'Codex',
      billingDomainId: 'subscription',
      billingDomainDisplayName: 'Subscription',
      includedInHeadline: true,
      recordedTokens: 750,
      tokenShare: 0.75,
      authorities: ['local-observation'],
      lastObservedAt: '2026-08-28T10:00:00.000Z',
      retailEquivalent: {
        amount: 15,
        authorities: ['estimate'],
        observedAt: '2026-08-28T10:05:00.000Z'
      },
      retailShare: 0.6
    },
    {
      providerId: 'claude-code',
      providerDisplayName: 'Claude Code',
      billingDomainId: 'subscription',
      billingDomainDisplayName: 'Subscription',
      includedInHeadline: true,
      recordedTokens: 250,
      tokenShare: 0.25,
      authorities: ['official-client'],
      lastObservedAt: '2026-08-28T10:10:00.000Z',
      retailEquivalent: {
        amount: 10,
        authorities: ['estimate'],
        observedAt: '2026-08-28T10:15:00.000Z'
      },
      retailShare: 0.4
    },
    {
      providerId: 'opencode',
      providerDisplayName: 'OpenCode',
      billingDomainId: 'local-history',
      billingDomainDisplayName: 'Local history',
      includedInHeadline: true,
      recordedTokens: 50,
      tokenShare: 0.05,
      authorities: ['local-observation'],
      lastObservedAt: '2026-08-28T10:20:00.000Z',
      retailEquivalent: { amount: null, authorities: [], observedAt: null },
      retailShare: null
    }
  ];

  it('keeps only chartable values for the selected metric', () => {
    const entries = buildProviderShareEntries(
      providers,
      'retail-equivalent',
      (providerId) => (providerId === 'codex' ? '#111111' : '#222222'),
      (value) => `$${value}`,
      (share) => `${share * 100}%`
    );

    expect(entries).toEqual([
      expect.objectContaining({
        name: 'Codex',
        value: 15,
        share: 0.6,
        color: '#111111'
      }),
      expect.objectContaining({ name: 'Claude Code', value: 10, share: 0.4, color: '#222222' })
    ]);
  });

  it('uses ECharts pie, legend, tooltip, and theme tokens without an external legend model', () => {
    const entries = buildProviderShareEntries(
      providers,
      'tokens',
      () => '#7788ff',
      (value) => `${value} Tokens`,
      (share) => `${share * 100}%`
    );
    const option = buildProviderShareChartOption(entries, {
      text: '#ffffff',
      muted: '#999999',
      surface: '#111111',
      border: '#333333'
    });

    expect(option.legend).toMatchObject({ show: true, type: 'scroll' });
    expect(option.tooltip).toMatchObject({ show: true, trigger: 'item', renderMode: 'html' });
    expect(option.series).toEqual([
      expect.objectContaining({ type: 'pie', radius: ['48%', '70%'] })
    ]);
    expect(option.series[0].data).toHaveLength(3);
  });

  it('shows the matching Provider tooltip when hovering a built-in legend item', () => {
    const entries = buildProviderShareEntries(
      providers,
      'tokens',
      () => '#7788ff',
      (value) => `${value} Tokens`,
      (share) => `${share * 100}%`
    );
    const option = buildProviderShareChartOption(entries, {
      text: '#ffffff',
      muted: '#999999',
      surface: '#111111',
      border: '#333333'
    });
    const legend = option.legend as typeof option.legend & {
      tooltip?: { show?: boolean; formatter?: (parameters: { name: string }) => string };
    };

    expect(legend.tooltip).toMatchObject({ show: true });
    expect(legend.tooltip?.formatter?.({ name: 'Claude Code' })).toContain('250 Tokens');
    expect(legend.tooltip?.formatter?.({ name: 'Claude Code' })).toContain('25%');
    expect(legend.tooltip?.formatter?.({ name: 'Claude Code' })).not.toContain('official-client');
  });

  it('includes OpenCode in the cost donut when local-history has retail-equivalent evidence', () => {
    const pricedProviders: ProviderShareSource[] = providers.map((provider) =>
      provider.providerId === 'opencode'
        ? {
            ...provider,
            retailEquivalent: {
              amount: 5,
              authorities: ['estimate'],
              observedAt: '2026-08-28T10:25:00.000Z'
            },
            retailShare: 1 / 6
          }
        : provider
    );
    const entries = buildProviderShareEntries(
      pricedProviders,
      'retail-equivalent',
      () => '#7788ff',
      (value) => `$${value}`,
      (share) => `${share * 100}%`
    );

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'OpenCode',
          billingDomainDisplayName: 'Local history',
          value: 5,
          share: 1 / 6
        })
      ])
    );
  });
});
