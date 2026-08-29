import type { DataAuthority } from '$core/types.js';

export type ProviderShareMetric = 'tokens' | 'retail-equivalent';

export interface ProviderShareSource {
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  recordedTokens: number | null;
  tokenShare: number | null;
  authorities: DataAuthority[];
  lastObservedAt: string | null;
  retailEquivalent: {
    amount: number | null;
    authorities: DataAuthority[];
    observedAt: string | null;
  };
  retailShare: number | null;
}

export interface ProviderShareEntry {
  key: string;
  name: string;
  billingDomainDisplayName: string;
  value: number;
  share: number;
  color: string;
  formattedValue: string;
  formattedShare: string;
  formattedEvidence: string;
}

export interface ProviderShareTheme {
  text: string;
  muted: string;
  surface: string;
  border: string;
}

export function buildProviderShareEntries(
  providers: ProviderShareSource[],
  metric: ProviderShareMetric,
  colorFor: (providerId: string, billingDomainId: string) => string,
  formatValue: (value: number) => string,
  formatShare: (share: number) => string,
  formatEvidence: (provider: ProviderShareSource, metric: ProviderShareMetric) => string
): ProviderShareEntry[] {
  return providers.flatMap((provider) => {
    const value = metric === 'tokens' ? provider.recordedTokens : provider.retailEquivalent.amount;
    const share = metric === 'tokens' ? provider.tokenShare : provider.retailShare;
    if (
      provider.includedInHeadline === false ||
      value === null ||
      share === null ||
      value <= 0 ||
      share <= 0
    ) {
      return [];
    }
    return [
      {
        key: `${provider.providerId}:${provider.billingDomainId}`,
        name: provider.providerDisplayName,
        billingDomainDisplayName: provider.billingDomainDisplayName,
        value,
        share,
        color: colorFor(provider.providerId, provider.billingDomainId),
        formattedValue: formatValue(value),
        formattedShare: formatShare(share),
        formattedEvidence: formatEvidence(provider, metric)
      }
    ];
  });
}

export function buildProviderShareChartOption(
  entries: ProviderShareEntry[],
  theme: ProviderShareTheme,
  emptyLabel = 'Unavailable',
  animate = true
) {
  return {
    animation: animate,
    animationDuration: animate ? 360 : 0,
    animationEasing: 'cubicOut',
    aria: {
      enabled: true,
      decal: { show: false }
    },
    title: {
      show: entries.length === 0,
      text: emptyLabel,
      left: 'center',
      top: '38%',
      textStyle: {
        color: theme.muted,
        fontSize: 12,
        fontWeight: 500
      }
    },
    legend: {
      show: entries.length > 0,
      type: 'scroll',
      left: 'center',
      right: 'center',
      bottom: 0,
      orient: 'horizontal',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 16,
      pageButtonGap: 7,
      pageIconSize: 9,
      pageIconColor: theme.text,
      pageIconInactiveColor: theme.border,
      pageTextStyle: { color: theme.muted, fontSize: 10 },
      textStyle: { color: theme.muted, fontSize: 11 },
      formatter: (name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name)
    },
    tooltip: {
      show: true,
      trigger: 'item',
      renderMode: 'html',
      confine: true,
      className: 'provider-share-tooltip',
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      padding: [10, 12],
      textStyle: { color: theme.text, fontSize: 11 },
      extraCssText: 'border-radius: 10px; box-shadow: 0 14px 34px rgba(0,0,0,.22);',
      formatter: (parameters: unknown) => {
        const data = tooltipEntry(parameters);
        if (!data) return emptyLabel;
        return [
          `<strong>${escapeHtml(data.name)}</strong>`,
          `<span style="color:${escapeHtml(theme.muted)}">${escapeHtml(data.billingDomainDisplayName)}</span>`,
          `<span>${escapeHtml(data.formattedValue)} · ${escapeHtml(data.formattedShare)}</span>`,
          `<span style="color:${escapeHtml(theme.muted)}">${escapeHtml(data.formattedEvidence)}</span>`
        ].join('<br>');
      }
    },
    series: [
      {
        type: 'pie',
        radius: ['48%', '70%'],
        center: ['50%', '42%'],
        minAngle: 2,
        avoidLabelOverlap: true,
        padAngle: 1.5,
        itemStyle: {
          borderColor: theme.surface,
          borderWidth: 3,
          borderRadius: 5
        },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 7,
          itemStyle: {
            shadowBlur: 14,
            shadowColor: 'rgba(0, 0, 0, 0.22)'
          }
        },
        data: entries.map((entry) => ({
          ...entry,
          itemStyle: { color: entry.color }
        }))
      }
    ]
  };
}

function tooltipEntry(parameters: unknown): ProviderShareEntry | null {
  if (!parameters || typeof parameters !== 'object' || !('data' in parameters)) return null;
  const data = parameters.data;
  if (!data || typeof data !== 'object') return null;
  return data as ProviderShareEntry;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ??
      character
  );
}
