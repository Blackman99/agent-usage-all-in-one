import type {
  WorkbenchPlanBillingPeriod,
  WorkbenchPlanValue,
  WorkbenchPlanValueEntry
} from '$core/types.js';

export interface PlanValueTheme {
  text: string;
  muted: string;
  surface: string;
  border: string;
}

export interface PlanValueFormatters {
  money: (amount: number | null) => string;
  tokens: (value: number | null) => string;
  ratio: (value: number | null, bound: WorkbenchPlanValueEntry['ratioBound']) => string;
}

export interface PlanValueLabels {
  paid: string;
  worth: string;
  ratio: string;
  tokens: string;
  effectiveUnitPrice: string;
  retailUnitPrice: string;
  perMillion: string;
  partial: string;
  empty: string;
}

export interface PlanValuePoint {
  key: string;
  name: string;
  shortName: string;
  planLabel: string;
  color: string;
  paid: number;
  worth: number;
  tokens: number;
  ratio: number | null;
  bound: WorkbenchPlanValueEntry['ratioBound'];
  effectiveUnitPrice: number | null;
  retailUnitPrice: number | null;
}

export interface PlanValueRankingRow {
  key: string;
  name: string;
  planLabel: string;
  color: string;
  ratio: number | null;
  bound: WorkbenchPlanValueEntry['ratioBound'];
  ratioLabel: string;
  meterPercent: number;
  breakEvenPercent: number;
  beatsBreakEven: boolean;
  paidLabel: string;
  worthLabel: string;
  tokensLabel: string;
  effectiveUnitPriceLabel: string;
  retailUnitPriceLabel: string;
  savingsLabel: string | null;
  savingsIsLoss: boolean;
  period: PlanValuePeriodRow | null;
}

export interface PlanValuePeriodRow {
  start: string;
  end: string;
  elapsedDays: number;
  totalDays: number;
  /** Where the cycle currently stands, drawn as the pacing marker. */
  elapsedPercent: number;
  /** How much of the period price the cycle has earned back so far. */
  earnedPercent: number;
  onPace: boolean;
  earnedLabel: string;
  periodCostLabel: string;
  bound: WorkbenchPlanValueEntry['ratioBound'];
}

function buildPeriodRow(
  period: WorkbenchPlanBillingPeriod | null,
  formatters: PlanValueFormatters
): PlanValuePeriodRow | null {
  if (!period) return null;
  const earned =
    period.retailEquivalent.status === 'available' ? period.retailEquivalent.amount : null;
  const elapsedPercent = Math.min(100, Math.max(0, period.progress * 100));
  const earnedPercent =
    period.breakEvenRatio === null ? 0 : Math.min(100, Math.max(0, period.breakEvenRatio * 100));
  return {
    start: period.start,
    end: period.end,
    elapsedDays: period.elapsedDays,
    totalDays: period.totalDays,
    elapsedPercent,
    earnedPercent,
    // Ahead of the marker means the cycle is on track to pay for itself.
    onPace: period.breakEvenRatio !== null && period.breakEvenRatio >= period.progress,
    earnedLabel: formatters.money(earned),
    periodCostLabel: formatters.money(period.periodCost.amount),
    bound: period.ratioBound
  };
}

const ISO_RATIOS = [1, 2, 5, 10, 20, 50];
const MINIMUM_SYMBOL = 14;
const MAXIMUM_SYMBOL = 46;

/**
 * The map has room for a short label. A Provider name is enough whenever only
 * one of its billing domains is plotted; otherwise the domain disambiguates it.
 */
export function planPointLabels(entries: WorkbenchPlanValueEntry[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.providerDisplayName, (counts.get(entry.providerDisplayName) ?? 0) + 1);
  }
  return new Map(
    entries.map((entry) => [
      `${entry.providerId}:${entry.billingDomainId}`,
      (counts.get(entry.providerDisplayName) ?? 0) > 1
        ? planEntryName(entry)
        : entry.providerDisplayName
    ])
  );
}

export function planEntryName(entry: WorkbenchPlanValueEntry): string {
  return entry.providerDisplayName === entry.billingDomainDisplayName
    ? entry.providerDisplayName
    : `${entry.providerDisplayName} · ${entry.billingDomainDisplayName}`;
}

export function planLabel(entry: WorkbenchPlanValueEntry, customLabel: string): string {
  return entry.plan.displayName || customLabel;
}

/**
 * Only entries with a converted plan cost and an available retail equivalent can
 * be placed on the map. Everything else stays in the ranking with an explicit
 * unavailable state instead of being drawn at zero.
 */
export function buildPlanValuePoints(
  planValue: WorkbenchPlanValue,
  colorFor: (providerId: string, billingDomainId: string) => string,
  customLabel: string
): PlanValuePoint[] {
  const shortNames = planPointLabels(planValue.entries);
  return planValue.entries.flatMap((entry) => {
    const paid = entry.windowPlanCost.amount;
    const worth =
      entry.retailEquivalent.status === 'available' ? entry.retailEquivalent.amount : null;
    if (paid === null || worth === null) return [];
    return [
      {
        key: `${entry.providerId}:${entry.billingDomainId}`,
        name: planEntryName(entry),
        shortName:
          shortNames.get(`${entry.providerId}:${entry.billingDomainId}`) ?? planEntryName(entry),
        planLabel: planLabel(entry, customLabel),
        color: colorFor(entry.providerId, entry.billingDomainId),
        paid,
        worth,
        tokens: entry.recordedTokens ?? 0,
        ratio: entry.valueRatio,
        bound: entry.ratioBound,
        effectiveUnitPrice: entry.effectiveUnitPrice,
        retailUnitPrice: entry.retailUnitPrice
      }
    ];
  });
}

function symbolSizeFor(tokens: number, maximumTokens: number): number {
  if (maximumTokens <= 0 || tokens <= 0) return MINIMUM_SYMBOL;
  const scaled = Math.sqrt(tokens / maximumTokens);
  return MINIMUM_SYMBOL + (MAXIMUM_SYMBOL - MINIMUM_SYMBOL) * scaled;
}

interface IsoLine {
  ratio: number;
  points: Array<[number, number]>;
}

/**
 * Iso-value lines run through the origin with slope `ratio`. Only the ones that
 * stay visible inside the plotted area are drawn, so the break-even reference
 * never turns into a wall of overlapping lines.
 */
export function planValueIsoLines(xMax: number, yMax: number): IsoLine[] {
  if (xMax <= 0 || yMax <= 0) return [];
  const lineFor = (ratio: number): IsoLine => {
    const endX = Math.min(xMax, yMax / ratio);
    return {
      ratio,
      points: [
        [0, 0],
        [endX, endX * ratio]
      ]
    };
  };
  // Break-even is the reference the whole map is read against, so it is drawn
  // even when every plan sits far below it.
  // The steepest visible lines are the useful references: drawing 2x beside a
  // 35x point only crowds the x-axis.
  const others = ISO_RATIOS.filter((ratio) => ratio !== 1)
    .map(lineFor)
    .filter((line) => line.points[1][0] >= xMax * 0.2)
    .slice(-3);
  return [lineFor(1), ...others];
}

export function buildPlanValueScatterOption(
  points: PlanValuePoint[],
  theme: PlanValueTheme,
  labels: PlanValueLabels,
  formatters: PlanValueFormatters,
  animate = true
) {
  const xMax = Math.max(...points.map((point) => point.paid), 0) * 1.25;
  const yMax = Math.max(...points.map((point) => point.worth), 0) * 1.25;
  const maximumTokens = Math.max(...points.map((point) => point.tokens), 0);
  const isoLines = planValueIsoLines(xMax, yMax);

  return {
    animation: animate,
    animationDuration: animate ? 320 : 0,
    animationEasing: 'cubicOut',
    aria: { enabled: true, decal: { show: false } },
    title: {
      show: points.length === 0,
      text: labels.empty,
      left: 'center',
      top: '44%',
      textStyle: { color: theme.muted, fontSize: 12, fontWeight: 500 }
    },
    grid: { top: 34, right: 26, bottom: 46, left: 62, containLabel: true },
    xAxis: {
      type: 'value',
      show: points.length > 0,
      min: 0,
      max: xMax || undefined,
      name: labels.paid,
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { color: theme.muted, fontSize: 11 },
      axisLabel: {
        color: theme.muted,
        fontSize: 10,
        formatter: (value: number) => formatters.money(value)
      },
      axisLine: { lineStyle: { color: theme.border } },
      splitLine: { lineStyle: { color: theme.border, opacity: 0.35 } }
    },
    yAxis: {
      type: 'value',
      show: points.length > 0,
      min: 0,
      max: yMax || undefined,
      name: labels.worth,
      nameLocation: 'end',
      nameGap: 14,
      nameTextStyle: { color: theme.muted, fontSize: 11, align: 'left' },
      axisLabel: {
        color: theme.muted,
        fontSize: 10,
        formatter: (value: number) => formatters.money(value)
      },
      axisLine: { lineStyle: { color: theme.border } },
      splitLine: { lineStyle: { color: theme.border, opacity: 0.35 } }
    },
    tooltip: {
      show: points.length > 0,
      trigger: 'item',
      renderMode: 'html',
      confine: true,
      className: 'plan-value-tooltip',
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      padding: [10, 12],
      textStyle: { color: theme.text, fontSize: 11 },
      extraCssText: 'border-radius: 10px; box-shadow: 0 14px 34px rgba(0,0,0,.22);',
      formatter: (parameters: unknown) => formatPointTooltip(parameters, theme, labels, formatters)
    },
    series: [
      ...isoLines.map((line) => ({
        type: 'line',
        silent: true,
        symbol: 'none',
        data: line.points,
        lineStyle: {
          color: theme.muted,
          width: line.ratio === 1 ? 1.4 : 1,
          type: line.ratio === 1 ? 'dashed' : 'dotted',
          opacity: line.ratio === 1 ? 0.85 : 0.45
        },
        endLabel: {
          show: true,
          color: theme.muted,
          fontSize: 10,
          formatter: () => `${line.ratio}x`
        },
        emphasis: { disabled: true },
        animation: false,
        z: 1
      })),
      {
        type: 'scatter',
        z: 3,
        symbolSize: (_value: unknown, parameters: { data?: { tokens?: number } }) =>
          symbolSizeFor(parameters.data?.tokens ?? 0, maximumTokens),
        label: {
          show: true,
          position: 'top',
          distance: 6,
          color: theme.text,
          fontSize: 10,
          fontWeight: 600,
          formatter: (parameters: { data?: { shortName?: string } }) =>
            parameters.data?.shortName ?? ''
        },
        emphasis: { scale: 1.08, focus: 'self' },
        data: points.map((point) => ({
          value: [point.paid, point.worth],
          name: point.name,
          shortName: point.shortName,
          planLabel: point.planLabel,
          tokens: point.tokens,
          ratio: point.ratio,
          bound: point.bound,
          effectiveUnitPrice: point.effectiveUnitPrice,
          retailUnitPrice: point.retailUnitPrice,
          itemStyle: {
            color: point.color,
            opacity: 0.85,
            borderColor: theme.surface,
            borderWidth: 1.5
          }
        }))
      }
    ]
  };
}

function formatPointTooltip(
  parameters: unknown,
  theme: PlanValueTheme,
  labels: PlanValueLabels,
  formatters: PlanValueFormatters
): string {
  if (!parameters || typeof parameters !== 'object' || !('data' in parameters)) return labels.empty;
  const data = parameters.data;
  if (!data || typeof data !== 'object') return labels.empty;
  const point = data as {
    name?: string;
    planLabel?: string;
    value?: [number, number];
    tokens?: number;
    ratio?: number | null;
    bound?: WorkbenchPlanValueEntry['ratioBound'];
    effectiveUnitPrice?: number | null;
    retailUnitPrice?: number | null;
  };
  const lines = [
    `<strong>${escapeHtml(point.name ?? '')}</strong>`,
    `<span style="color:${escapeHtml(theme.muted)}">${escapeHtml(point.planLabel ?? '')}</span>`,
    `<span>${escapeHtml(labels.ratio)} · ${escapeHtml(
      formatters.ratio(point.ratio ?? null, point.bound ?? 'unavailable')
    )}</span>`,
    `<span>${escapeHtml(labels.paid)} · ${escapeHtml(formatters.money(point.value?.[0] ?? null))}</span>`,
    `<span>${escapeHtml(labels.worth)} · ${escapeHtml(formatters.money(point.value?.[1] ?? null))}</span>`,
    `<span>${escapeHtml(labels.tokens)} · ${escapeHtml(formatters.tokens(point.tokens ?? null))}</span>`,
    `<span>${escapeHtml(labels.effectiveUnitPrice)} · ${escapeHtml(
      formatters.money(point.effectiveUnitPrice ?? null)
    )} ${escapeHtml(labels.perMillion)}</span>`,
    `<span>${escapeHtml(labels.retailUnitPrice)} · ${escapeHtml(
      formatters.money(point.retailUnitPrice ?? null)
    )} ${escapeHtml(labels.perMillion)}</span>`
  ];
  if (point.bound === 'lower') {
    lines.push(
      `<span style="color:${escapeHtml(theme.muted)}">${escapeHtml(labels.partial)}</span>`
    );
  }
  return lines.join('<br>');
}

export function buildPlanValueRanking(
  planValue: WorkbenchPlanValue,
  colorFor: (providerId: string, billingDomainId: string) => string,
  formatters: PlanValueFormatters,
  customLabel: string
): PlanValueRankingRow[] {
  const ratios = planValue.entries
    .map((entry) => entry.valueRatio)
    .filter((ratio): ratio is number => ratio !== null);
  const maximum = Math.max(...ratios, 1);
  return planValue.entries.map((entry) => {
    const savings =
      entry.retailUnitPrice !== null && entry.effectiveUnitPrice !== null
        ? entry.retailUnitPrice - entry.effectiveUnitPrice
        : null;
    return {
      key: `${entry.providerId}:${entry.billingDomainId}`,
      name: planEntryName(entry),
      planLabel: planLabel(entry, customLabel),
      color: colorFor(entry.providerId, entry.billingDomainId),
      ratio: entry.valueRatio,
      bound: entry.ratioBound,
      ratioLabel: formatters.ratio(entry.valueRatio, entry.ratioBound),
      meterPercent:
        entry.valueRatio === null ? 0 : Math.min(100, (entry.valueRatio / maximum) * 100),
      breakEvenPercent: Math.min(100, (1 / maximum) * 100),
      beatsBreakEven: entry.valueRatio !== null && entry.valueRatio >= 1,
      paidLabel: formatters.money(entry.windowPlanCost.amount),
      worthLabel: formatters.money(
        entry.retailEquivalent.status === 'available' ? entry.retailEquivalent.amount : null
      ),
      tokensLabel: formatters.tokens(entry.recordedTokens),
      effectiveUnitPriceLabel: formatters.money(entry.effectiveUnitPrice),
      retailUnitPriceLabel: formatters.money(entry.retailUnitPrice),
      // A negative saving is money lost, not a saving: it is reported with its
      // own label and a positive amount.
      savingsLabel: savings === null ? null : formatters.money(Math.abs(savings)),
      savingsIsLoss: savings !== null && savings < 0,
      period: buildPeriodRow(entry.billingPeriod, formatters)
    };
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ??
      character
  );
}
