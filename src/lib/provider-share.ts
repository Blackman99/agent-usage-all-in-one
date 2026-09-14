import type { DataAuthority } from '$core/types.js';
import { qualifyChartNames } from '$lib/chart-identity.js';

export type ProviderShareMetric = 'tokens' | 'retail-equivalent';

export interface ProviderShareSource {
  id: string;
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  model: string;
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
  reportedEstimate?: {
    amount: number | null;
    authorities: DataAuthority[];
    observedAt: string | null;
  };
  retailShare: number | null;
}

export interface ProviderShareEntry {
  key: string;
  name: string;
  model: string;
  providerDisplayName: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  value: number;
  share: number;
  color: string;
  formattedValue: string;
  formattedShare: string;
}

export interface ProviderShareTheme {
  text: string;
  muted: string;
  surface: string;
  border: string;
}

export function buildProviderShareEntries(
  models: ProviderShareSource[],
  metric: ProviderShareMetric,
  colorFor: (providerId: string, billingDomainId: string, model: string) => string,
  formatValue: (value: number) => string,
  formatShare: (share: number) => string
): ProviderShareEntry[] {
  const chartable = models.flatMap((model) => {
    const value =
      metric === 'tokens'
        ? model.recordedTokens
        : (model.retailEquivalent.amount ?? model.reportedEstimate?.amount ?? null);
    if (value === null || value <= 0) return [];
    return [{ model, value }];
  });
  const total = chartable.reduce((sum, entry) => sum + entry.value, 0) || 1;
  const names = qualifyChartNames(
    chartable.map(({ model }) => ({
      model: model.model,
      providerDisplayName: model.providerDisplayName,
      billingDomainDisplayName: model.billingDomainDisplayName
    }))
  );
  return chartable.map((entry, index) => ({
    key: entry.model.id,
    name: names[index] ?? entry.model.model,
    model: entry.model.model,
    providerDisplayName: entry.model.providerDisplayName,
    billingDomainDisplayName: entry.model.billingDomainDisplayName,
    includedInHeadline: entry.model.includedInHeadline,
    value: entry.value,
    share: entry.value / total,
    color: colorFor(entry.model.providerId, entry.model.billingDomainId, entry.model.model),
    formattedValue: formatValue(entry.value),
    formattedShare: formatShare(entry.value / total)
  }));
}

export function buildProviderShareChartOption(
  entries: ProviderShareEntry[],
  theme: ProviderShareTheme,
  emptyLabel = 'Unavailable',
  animate = true,
  separateFromHeadline = 'Separate domain · not included in headline'
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
      formatter: (name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name),
      tooltip: {
        show: true,
        formatter: (parameters: unknown) =>
          formatTooltip(
            legendTooltipEntry(parameters, entries),
            theme,
            emptyLabel,
            separateFromHeadline
          )
      }
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
      formatter: (parameters: unknown) =>
        formatTooltip(tooltipEntry(parameters), theme, emptyLabel, separateFromHeadline)
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

function legendTooltipEntry(
  parameters: unknown,
  entries: ProviderShareEntry[]
): ProviderShareEntry | null {
  if (!parameters || typeof parameters !== 'object' || !('name' in parameters)) return null;
  const name = parameters.name;
  return typeof name === 'string' ? (entries.find((entry) => entry.name === name) ?? null) : null;
}

function formatTooltip(
  data: ProviderShareEntry | null,
  theme: ProviderShareTheme,
  emptyLabel: string,
  separateFromHeadline: string
): string {
  if (!data) return emptyLabel;
  const lines = [
    `<strong>${escapeHtml(data.name)}</strong>`,
    `<span style="color:${escapeHtml(theme.muted)}">${escapeHtml(data.providerDisplayName)} · ${escapeHtml(data.billingDomainDisplayName)}</span>`,
    `<span>${escapeHtml(data.formattedValue)} · ${escapeHtml(data.formattedShare)}</span>`
  ];
  if (!data.includedInHeadline) {
    lines.push(
      `<span style="color:${escapeHtml(theme.muted)}">${escapeHtml(separateFromHeadline)}</span>`
    );
  }
  return lines.join('<br>');
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ??
      character
  );
}
