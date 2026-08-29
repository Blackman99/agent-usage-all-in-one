import { describe, expect, it } from 'vitest';

import {
  buildProviderShareChartOption,
  buildProviderShareEntries
} from '../../src/lib/provider-share.js';

describe('Provider share chart', () => {
  const providers = [
    {
      providerId: 'codex',
      providerDisplayName: 'Codex',
      billingDomainId: 'subscription',
      billingDomainDisplayName: 'Subscription',
      includedInHeadline: true,
      recordedTokens: 750,
      tokenShare: 0.75,
      retailEquivalent: { amount: 15 },
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
      retailEquivalent: { amount: 10 },
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
      retailEquivalent: { amount: null },
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
      expect.objectContaining({ name: 'Codex', value: 15, share: 0.6, color: '#111111' }),
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
});
