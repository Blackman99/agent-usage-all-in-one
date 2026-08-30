import type { DataAuthority } from '$core/types.js';

export type ModelBreakdownMetric = 'tokens' | 'retail-equivalent';

export interface ModelBreakdownSource {
  id: string;
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  model: string;
  tokenTotals: { total: number };
  retailEquivalent: {
    amount: number | null;
    authorities: DataAuthority[];
    observedAt: string | null;
  };
  reportedEstimate: {
    amount: number | null;
    authorities: DataAuthority[];
    observedAt: string | null;
  };
  authorities: DataAuthority[];
  lastObservedAt: string | null;
}

export interface ModelBreakdownEntry {
  modelId: string;
  name: string;
  providerDisplayName: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  value: number;
  share: number;
  color: string;
  formattedValue: string;
  formattedShare: string;
  formattedEvidence: string;
}

export interface ModelBreakdownTheme {
  text: string;
  muted: string;
  surface: string;
  border: string;
}

export interface ModelBreakdownLabels {
  notAvailable: string;
  separateFromHeadline: string;
}

export function modelBreakdownCost(source: ModelBreakdownSource): number | null {
  if (source.retailEquivalent.amount !== null) return source.retailEquivalent.amount;
  return source.reportedEstimate.amount;
}

export function buildModelBreakdownEntries(
  models: ModelBreakdownSource[],
  metric: ModelBreakdownMetric,
  colorFor: (providerId: string, billingDomainId: string) => string,
  formatValue: (value: number) => string,
  formatShare: (share: number) => string,
  formatEvidence: (model: ModelBreakdownSource, metric: ModelBreakdownMetric) => string
): ModelBreakdownEntry[] {
  const chartable = models.flatMap((model) => {
    const value = metric === 'tokens' ? model.tokenTotals.total : modelBreakdownCost(model);
    if (value === null || value <= 0) return [];
    return [
      {
        modelId: model.id,
        model,
        value,
        providerDisplayName: model.providerDisplayName,
        billingDomainDisplayName: model.billingDomainDisplayName,
        includedInHeadline: model.includedInHeadline
      }
    ];
  });

  const total = chartable.reduce((sum, entry) => sum + entry.value, 0) || 1;
  const counts = new Map<string, number>();
  for (const entry of chartable) {
    counts.set(entry.model.model, (counts.get(entry.model.model) ?? 0) + 1);
  }
  const usedNames = new Set<string>();
  const resolveName = (model: ModelBreakdownSource): string => {
    if ((counts.get(model.model) ?? 0) === 1) return model.model;
    const candidate = `${model.model} · ${model.providerDisplayName}`;
    if (!usedNames.has(candidate)) return candidate;
    const fallback = `${model.model} · ${model.providerDisplayName} · ${model.billingDomainDisplayName}`;
    if (!usedNames.has(fallback)) return fallback;
    let suffix = 2;
    let next = `${fallback} #${suffix}`;
    while (usedNames.has(next)) next = `${fallback} #${++suffix}`;
    return next;
  };

  return chartable.map((entry) => {
    const name = resolveName(entry.model);
    usedNames.add(name);
    return {
      modelId: entry.model.id,
      name,
      providerDisplayName: entry.providerDisplayName,
      billingDomainDisplayName: entry.billingDomainDisplayName,
      includedInHeadline: entry.includedInHeadline,
      value: entry.value,
      share: entry.value / total,
      color: colorFor(entry.model.providerId, entry.model.billingDomainId),
      formattedValue: formatValue(entry.value),
      formattedShare: formatShare(entry.value / total),
      formattedEvidence: formatEvidence(entry.model, metric)
    };
  });
}

export function buildModelBreakdownOption(
  entries: ModelBreakdownEntry[],
  theme: ModelBreakdownTheme,
  labels: ModelBreakdownLabels = {
    notAvailable: 'Unavailable',
    separateFromHeadline: 'Separate domain · not included in headline'
  },
  animate = true
) {
  return {
    animation: animate,
    animationDuration: animate ? 320 : 0,
    animationEasing: 'cubicOut',
    aria: {
      enabled: true,
      decal: { show: false }
    },
    title: {
      show: entries.length === 0,
      text: labels.notAvailable,
      left: 'center',
      top: '46%',
      textStyle: {
        color: theme.muted,
        fontSize: 12,
        fontWeight: 500
      }
    },
    tooltip: {
      show: true,
      trigger: 'item',
      renderMode: 'html',
      confine: true,
      className: 'model-breakdown-tooltip',
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      padding: [10, 12],
      textStyle: { color: theme.text, fontSize: 11 },
      extraCssText: 'border-radius: 10px; box-shadow: 0 14px 34px rgba(0,0,0,.22);',
      formatter: (parameters: unknown) =>
        formatTreemapTooltip(parameters, theme, labels, labels.notAvailable)
    },
    series: [
      {
        type: 'treemap',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        roam: false,
        nodeClick: false,
        squareRatio: 1,
        gapWidth: 2,
        breadcrumb: { show: false },
        upperLabel: { show: false },
        label: {
          show: true,
          color: theme.text,
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 16,
          overflow: 'truncate',
          ellipsis: '…',
          formatter: (parameters: unknown) => formatTreemapLabel(parameters)
        },
        itemStyle: {
          borderColor: theme.surface,
          borderWidth: 2,
          gapWidth: 2
        },
        emphasis: {
          label: { show: true, fontWeight: 700 },
          itemStyle: { borderColor: theme.border, borderWidth: 3 }
        },
        data: entries.map((entry) => ({
          name: entry.name,
          value: entry.value,
          modelId: entry.modelId,
          formattedValue: entry.formattedValue,
          formattedShare: entry.formattedShare,
          formattedEvidence: entry.formattedEvidence,
          providerDisplayName: entry.providerDisplayName,
          billingDomainDisplayName: entry.billingDomainDisplayName,
          includedInHeadline: entry.includedInHeadline,
          itemStyle: { color: entry.color }
        }))
      }
    ]
  };
}

function formatTreemapLabel(parameters: unknown): string {
  if (!parameters || typeof parameters !== 'object' || !('data' in parameters)) return '';
  const data = parameters.data;
  if (!data || typeof data !== 'object') return '';
  const name = (data as { name?: unknown }).name;
  const formattedValue = (data as { formattedValue?: unknown }).formattedValue;
  const label = [name, formattedValue].filter((part) => typeof part === 'string').join('\n');
  return label;
}

function formatTreemapTooltip(
  parameters: unknown,
  theme: ModelBreakdownTheme,
  labels: ModelBreakdownLabels,
  emptyLabel: string
): string {
  if (!parameters || typeof parameters !== 'object' || !('data' in parameters)) return emptyLabel;
  const data = parameters.data;
  if (!data || typeof data !== 'object') return emptyLabel;
  const entry = data as ModelBreakdownEntry;
  const lines = [
    `<strong>${escapeHtml(entry.name)}</strong>`,
    `<span style="color:${escapeHtml(theme.muted)}">${escapeHtml(
      entry.providerDisplayName
    )} · ${escapeHtml(entry.billingDomainDisplayName)}</span>`,
    `<span>${escapeHtml(entry.formattedValue)} · ${escapeHtml(entry.formattedShare)}</span>`
  ];
  if (!entry.includedInHeadline) {
    lines.push(
      `<span style="color:${escapeHtml(theme.muted)}">${escapeHtml(labels.separateFromHeadline)}</span>`
    );
  }
  lines.push(
    `<span style="color:${escapeHtml(theme.muted)}">${escapeHtml(entry.formattedEvidence)}</span>`
  );
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
