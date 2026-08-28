import type { WorkbenchTrendBucket, WorkbenchTrendSegment } from '$core/types.js';

export const MINIMUM_TREND_BUCKETS = 4;
export const TREND_CHART_HEIGHT_PX = 280;
export const TREND_GRID_TOP_PX = 16;
export const TREND_GRID_BOTTOM_PX = 12;
export const TREND_GRID_LEFT_PX = 12;
export const TREND_GRID_RIGHT_PX = 16;
export const TREND_LINE_WIDTH = 2.5;
export const TREND_AREA_TOP_ALPHA = '3d';
export const TREND_AREA_BOTTOM_ALPHA = '00';
export const TREND_REPORTED_DASH: [number, number] = [10, 7];
export const TREND_ISOLATED_SYMBOL_SIZE = 8;
export const TREND_GRID_LINE_FALLBACK = 'rgba(122, 136, 164, 0.16)';
export const TREND_AXIS_LABEL_FALLBACK = '#697386';
export const TREND_AXIS_FONT =
  'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export type TrendMetric = 'tokens' | 'retail-equivalent';
export type TrendCostPurpose = 'retail-equivalent' | 'reported-estimate';

export interface TrendSeriesIdentity {
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  costPurpose: TrendCostPurpose | null;
}

export interface TrendChartSeries extends TrendSeriesIdentity {
  key: string;
  values: Array<number | null>;
}

export interface TrendViewport {
  start: number;
  size: number;
}

const TREND_SEGMENT_COLORS: Record<string, string> = {
  codex: '#78a7ff',
  'claude-code': '#d69b73',
  opencode: '#55c89d',
  'opencode-go': '#73d4b2',
  'grok:grok-build-subscription': '#b28cff',
  'grok:xai-api': '#f07f9a'
};

export function trendSegmentColor(providerId: string, billingDomainId: string): string {
  return (
    TREND_SEGMENT_COLORS[`${providerId}:${billingDomainId}`] ??
    TREND_SEGMENT_COLORS[providerId] ??
    '#9aa5b8'
  );
}

export function trendViewportBounds(
  totalBuckets: number,
  viewportStart = 0,
  viewportSize: number | null = null
): TrendViewport {
  if (totalBuckets <= 0) return { start: 0, size: 0 };
  const minimumSize = Math.min(MINIMUM_TREND_BUCKETS, totalBuckets);
  const size = Math.max(minimumSize, Math.min(viewportSize ?? totalBuckets, totalBuckets));
  const start = Math.max(0, Math.min(viewportStart, totalBuckets - size));
  return { start, size };
}

export function nextTrendZoom(
  totalBuckets: number,
  viewportStart: number,
  viewportSize: number | null,
  direction: 'in' | 'out',
  anchorRatio = 0.5
): { start: number; size: number | null } {
  if (totalBuckets <= 1) return { start: viewportStart, size: viewportSize };
  const current = trendViewportBounds(totalBuckets, viewportStart, viewportSize);
  const minimumSize = Math.min(MINIMUM_TREND_BUCKETS, totalBuckets);
  const nextSize =
    direction === 'in'
      ? Math.max(minimumSize, Math.round(current.size * 0.7))
      : Math.min(totalBuckets, Math.ceil(current.size / 0.7));
  if (nextSize === current.size) {
    return { start: current.start, size: nextSize === totalBuckets ? null : nextSize };
  }
  const boundedAnchor = Math.max(0, Math.min(1, anchorRatio));
  const anchorBucket = current.start + boundedAnchor * Math.max(0, current.size - 1);
  const nextStart = Math.max(
    0,
    Math.min(
      totalBuckets - nextSize,
      Math.round(anchorBucket - boundedAnchor * Math.max(0, nextSize - 1))
    )
  );
  return { start: nextStart, size: nextSize === totalBuckets ? null : nextSize };
}

export function panTrendViewport(
  totalBuckets: number,
  viewportStart: number,
  viewportSize: number | null,
  bucketDelta: number
): number {
  const viewport = trendViewportBounds(totalBuckets, viewportStart, viewportSize);
  return Math.max(0, Math.min(totalBuckets - viewport.size, viewport.start + bucketDelta));
}

export function trendLegend(
  buckets: WorkbenchTrendBucket[],
  metric: TrendMetric
): TrendSeriesIdentity[] {
  const segments = buckets.flatMap((bucket) => bucket.segments);
  const identities =
    metric === 'tokens'
      ? segments.map((segment) => ({ ...segment, costPurpose: null as TrendCostPurpose | null }))
      : segments.flatMap((segment) => [
          ...(segment.retailEquivalent.amount === null
            ? []
            : [{ ...segment, costPurpose: 'retail-equivalent' as const }]),
          ...(segment.reportedEstimate?.amount == null
            ? []
            : [{ ...segment, costPurpose: 'reported-estimate' as const }])
        ]);
  return [
    ...new Map(
      identities.map((segment) => [
        `${segment.providerId}:${segment.billingDomainId}:${segment.costPurpose ?? 'tokens'}`,
        {
          providerId: segment.providerId,
          providerDisplayName: segment.providerDisplayName,
          billingDomainId: segment.billingDomainId,
          billingDomainDisplayName: segment.billingDomainDisplayName,
          includedInHeadline: segment.includedInHeadline,
          costPurpose: segment.costPurpose
        } satisfies TrendSeriesIdentity
      ])
    ).values()
  ];
}

export function trendSeriesValue(
  segment: WorkbenchTrendSegment | undefined,
  metric: TrendMetric,
  costPurpose: TrendCostPurpose | null
): number | null {
  if (!segment) return null;
  if (metric === 'tokens') return segment.recordedTokens;
  if (costPurpose === 'reported-estimate') return segment.reportedEstimate?.amount ?? null;
  return segment.retailEquivalent.amount;
}

export function buildTrendChartSeries(
  buckets: WorkbenchTrendBucket[],
  metric: TrendMetric
): TrendChartSeries[] {
  return trendLegend(buckets, metric).map((identity) => ({
    ...identity,
    key: `${identity.providerId}:${identity.billingDomainId}:${identity.costPurpose ?? 'tokens'}`,
    values: buckets.map((bucket) => {
      if (bucket.gap) return null;
      const segment = bucket.segments.find(
        (candidate) =>
          candidate.providerId === identity.providerId &&
          candidate.billingDomainId === identity.billingDomainId
      );
      return trendSeriesValue(segment, metric, identity.costPurpose);
    })
  }));
}

export function trendMaximum(series: TrendChartSeries[]): number | null {
  const values = series.flatMap((item) =>
    item.values.filter((value): value is number => value !== null)
  );
  return values.length > 0 ? Math.max(...values) : null;
}

export function isolatedTrendPoint(values: Array<number | null>, index: number): boolean {
  return values[index] != null && values[index - 1] == null && values[index + 1] == null;
}

export function trendTooltipPosition(index: number, visibleBuckets: number): number {
  if (visibleBuckets <= 1) return 50;
  return Math.max(8, Math.min(92, (index / (visibleBuckets - 1)) * 100));
}

export interface TrendChartTheme {
  gridLine: string;
  label: string;
}

export interface TrendAreaFill {
  type: 'linear';
  x: 0;
  y: 0;
  x2: 0;
  y2: 1;
  colorStops: Array<{ offset: number; color: string }>;
}

export interface TrendChartLineModel {
  id: string;
  name: string;
  type: 'line';
  data: Array<number | null>;
  connectNulls: false;
  silent: true;
  showSymbol: boolean;
  symbol: 'circle';
  symbolSize: (value: unknown, params: { dataIndex: number }) => number;
  lineStyle: {
    width: number;
    color: string;
    type: 'solid' | [number, number];
    cap: 'round';
    join: 'round';
  };
  itemStyle: {
    color: string;
    borderColor: string;
    borderWidth: number;
  };
  areaStyle?: { color: TrendAreaFill };
  emphasis: { disabled: true };
  z: number;
  clip: true;
}

export interface TrendChartOptionModel {
  animation: boolean;
  animationDuration: number;
  backgroundColor: 'transparent';
  grid: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    containLabel: true;
  };
  xAxis: {
    type: 'category';
    data: string[];
    boundaryGap: false;
    axisLine: { show: false };
    axisTick: { show: false };
    axisLabel: {
      show: true;
      hideOverlap: true;
      color: string;
      fontFamily: string;
      fontSize: number;
      margin: number;
    };
    splitLine: { show: false };
  };
  yAxis: {
    type: 'value';
    min: 0;
    max: number;
    interval: number;
    axisLine: { show: false };
    axisTick: { show: false };
    axisLabel: {
      show: true;
      color: string;
      fontFamily: string;
      fontSize: number;
      margin: number;
      formatter: (value: number) => string;
    };
    splitLine: {
      show: true;
      lineStyle: { color: string; width: 1 };
    };
  };
  series: TrendChartLineModel[];
}

export function trendSeriesLineModel(series: TrendChartSeries): TrendChartLineModel {
  const color = trendSegmentColor(series.providerId, series.billingDomainId);
  const reported = series.costPurpose === 'reported-estimate';
  return {
    id: series.key,
    name: series.key,
    type: 'line',
    data: series.values,
    connectNulls: false,
    silent: true,
    showSymbol: series.values.some((_, index) => isolatedTrendPoint(series.values, index)),
    symbol: 'circle',
    symbolSize: (_value, params) =>
      isolatedTrendPoint(series.values, params.dataIndex) ? TREND_ISOLATED_SYMBOL_SIZE : 0,
    lineStyle: {
      width: TREND_LINE_WIDTH,
      color,
      type: reported ? TREND_REPORTED_DASH : 'solid',
      cap: 'round',
      join: 'round'
    },
    itemStyle: reported
      ? { color: 'transparent', borderColor: color, borderWidth: 2 }
      : { color, borderColor: color, borderWidth: 0 },
    areaStyle: reported
      ? undefined
      : {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${color}${TREND_AREA_TOP_ALPHA}` },
              { offset: 1, color: `${color}${TREND_AREA_BOTTOM_ALPHA}` }
            ]
          }
        },
    emphasis: { disabled: true },
    z: reported ? 3 : 2,
    clip: true
  };
}

export function buildTrendChartOption(
  labels: string[],
  seriesList: TrendChartSeries[],
  maximum: number | null,
  theme: TrendChartTheme,
  animate: boolean,
  formatYAxis: (value: number) => string = (value) => String(value)
): TrendChartOptionModel {
  const yMax = Math.max(1, maximum ?? 0);
  const axisLabel = {
    color: theme.label,
    fontFamily: TREND_AXIS_FONT,
    fontSize: 10
  };
  return {
    animation: animate,
    animationDuration: animate ? 240 : 0,
    backgroundColor: 'transparent',
    grid: {
      left: TREND_GRID_LEFT_PX,
      right: TREND_GRID_RIGHT_PX,
      top: TREND_GRID_TOP_PX,
      bottom: TREND_GRID_BOTTOM_PX,
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        ...axisLabel,
        show: true,
        hideOverlap: true,
        margin: 10
      },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: yMax,
      interval: yMax / 2,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        ...axisLabel,
        show: true,
        margin: 8,
        formatter: formatYAxis
      },
      splitLine: {
        show: true,
        lineStyle: { color: theme.gridLine, width: 1 }
      }
    },
    series: seriesList.map(trendSeriesLineModel)
  };
}
