import { describe, expect, it } from 'vitest';

import type { WorkbenchTrendBucket } from '../../src/core/types.js';
import {
  MINIMUM_TREND_BUCKETS,
  TREND_AREA_BOTTOM_ALPHA,
  TREND_AREA_TOP_ALPHA,
  TREND_GRID_BOTTOM_PX,
  TREND_GRID_LEFT_PX,
  TREND_GRID_TOP_PX,
  TREND_ISOLATED_SYMBOL_SIZE,
  TREND_LINE_WIDTH,
  TREND_REPORTED_DASH,
  buildTrendChartOption,
  buildTrendChartSeries,
  isolatedTrendPoint,
  nextTrendZoom,
  panTrendViewport,
  trendMaximum,
  trendSegmentColor,
  trendTooltipPosition,
  trendViewportBounds
} from '../../src/lib/usage-trend.js';

function bucket(
  label: string,
  options: {
    gap?: boolean;
    tokens?: number;
    retail?: number | null;
    reported?: number | null;
    providerId?: string;
  } = {}
): WorkbenchTrendBucket {
  const providerId = options.providerId ?? 'codex';
  return {
    start: `${label}-start`,
    end: `${label}-end`,
    label,
    gap: options.gap ?? false,
    segments: options.gap
      ? []
      : [
          {
            providerId,
            providerDisplayName: 'Codex',
            billingDomainId: 'chatgpt-plus',
            billingDomainDisplayName: 'ChatGPT Plus',
            includedInHeadline: true,
            recordedTokens: options.tokens ?? 100,
            observationCount: 1,
            timePrecisions: ['day'],
            retailEquivalent: {
              status: options.retail === null ? 'unavailable' : 'available',
              amount: options.retail === undefined ? 1.25 : options.retail,
              currency: 'USD'
            },
            reportedEstimate: {
              status: options.reported == null ? 'unavailable' : 'available',
              amount: options.reported ?? null,
              currency: 'USD'
            }
          }
        ]
  };
}

describe('usage trend viewport', () => {
  it('defaults to the full range and clamps start/size', () => {
    expect(trendViewportBounds(7)).toEqual({ start: 0, size: 7 });
    expect(trendViewportBounds(7, 4, 8)).toEqual({ start: 0, size: 7 });
    expect(trendViewportBounds(7, 5, 3)).toEqual({ start: 3, size: 4 });
    expect(trendViewportBounds(2, 0, 1)).toEqual({ start: 0, size: 2 });
    expect(trendViewportBounds(0)).toEqual({ start: 0, size: 0 });
  });

  it('zooms around an anchor and pans without leaving the range', () => {
    const zoomed = nextTrendZoom(10, 0, null, 'in', 0.5);
    expect(zoomed.size).toBe(Math.max(MINIMUM_TREND_BUCKETS, Math.round(10 * 0.7)));
    expect(zoomed.start).toBeGreaterThanOrEqual(0);
    const restored = nextTrendZoom(10, zoomed.start, zoomed.size, 'out', 0.5);
    expect(restored.size).toBeNull();
    expect(restored.start).toBe(0);
    expect(panTrendViewport(10, 2, 4, 3)).toBe(5);
    expect(panTrendViewport(10, 2, 4, -9)).toBe(0);
  });
});

describe('usage trend series', () => {
  it('uses provider brand colors and keeps retail vs reported series separate', () => {
    expect(trendSegmentColor('codex', 'chatgpt-plus')).toBe('#78a7ff');
    expect(trendSegmentColor('grok', 'xai-api')).toBe('#f07f9a');
    expect(trendSegmentColor('unknown', 'other')).toBe('#9aa5b8');

    const buckets = [
      bucket('1', { tokens: 10, retail: 2, reported: 3 }),
      bucket('2', { gap: true }),
      bucket('3', { tokens: 20, retail: null, reported: 4 })
    ];
    const cost = buildTrendChartSeries(buckets, 'retail-equivalent');
    expect(cost.map((series) => series.costPurpose).sort()).toEqual([
      'reported-estimate',
      'retail-equivalent'
    ]);
    const retail = cost.find((series) => series.costPurpose === 'retail-equivalent');
    const reported = cost.find((series) => series.costPurpose === 'reported-estimate');
    expect(retail?.values).toEqual([2, null, null]);
    expect(reported?.values).toEqual([3, null, 4]);
    expect(trendMaximum(cost)).toBe(4);

    const tokens = buildTrendChartSeries(buckets, 'tokens');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.values).toEqual([10, null, 20]);
    expect(isolatedTrendPoint([2, null, 4], 0)).toBe(true);
    expect(isolatedTrendPoint([2, 3, 4], 1)).toBe(false);
  });

  it('builds an echarts option that preserves gaps, dash language, and plot geometry', () => {
    const buckets = [
      bucket('1', { tokens: 10, retail: 2, reported: 3 }),
      bucket('2', { gap: true }),
      bucket('3', { tokens: 20, retail: null, reported: 4 })
    ];
    const series = buildTrendChartSeries(buckets, 'retail-equivalent');
    const option = buildTrendChartOption(
      buckets.map((item) => item.label),
      series,
      trendMaximum(series),
      { gridLine: 'rgba(122, 136, 164, 0.16)', label: '#697386' },
      false,
      (value) => `¥${value}`
    );

    expect(option.animation).toBe(false);
    expect(option.grid).toMatchObject({
      left: TREND_GRID_LEFT_PX,
      top: TREND_GRID_TOP_PX,
      bottom: TREND_GRID_BOTTOM_PX,
      containLabel: true
    });
    expect(option.xAxis.boundaryGap).toBe(false);
    expect(option.xAxis.axisLabel.show).toBe(true);
    expect(option.yAxis.max).toBe(4);
    expect(option.yAxis.axisLabel.show).toBe(true);
    expect(option.yAxis.axisLabel.formatter(4)).toBe('¥4');
    expect(option.yAxis.splitLine.lineStyle.color).toBe('rgba(122, 136, 164, 0.16)');

    const retail = option.series.find((item) => item.id.endsWith('retail-equivalent'));
    const reported = option.series.find((item) => item.id.endsWith('reported-estimate'));
    expect(retail?.data).toEqual([2, null, null]);
    expect(retail?.connectNulls).toBe(false);
    expect(retail?.lineStyle).toMatchObject({
      width: TREND_LINE_WIDTH,
      color: '#78a7ff',
      type: 'solid',
      cap: 'round'
    });
    expect(retail?.areaStyle).toEqual({
      color: {
        type: 'linear',
        x: 0,
        y: 0,
        x2: 0,
        y2: 1,
        colorStops: [
          { offset: 0, color: `#78a7ff${TREND_AREA_TOP_ALPHA}` },
          { offset: 1, color: `#78a7ff${TREND_AREA_BOTTOM_ALPHA}` }
        ]
      }
    });
    expect(retail?.itemStyle.color).toBe('#78a7ff');
    expect(retail?.symbolSize(2, { dataIndex: 0 })).toBe(TREND_ISOLATED_SYMBOL_SIZE);

    expect(reported?.data).toEqual([3, null, 4]);
    expect(reported?.lineStyle.type).toEqual(TREND_REPORTED_DASH);
    expect(reported?.areaStyle).toBeUndefined();
    expect(reported?.itemStyle).toMatchObject({
      color: 'transparent',
      borderColor: '#78a7ff',
      borderWidth: 2
    });
    expect(reported?.showSymbol).toBe(true);
    expect(reported?.symbolSize(3, { dataIndex: 0 })).toBe(TREND_ISOLATED_SYMBOL_SIZE);
    expect(reported?.symbolSize(4, { dataIndex: 2 })).toBe(TREND_ISOLATED_SYMBOL_SIZE);
  });

  it('clamps tooltip anchors so hover cards stay inside the plot', () => {
    expect(trendTooltipPosition(0, 1)).toBe(50);
    expect(trendTooltipPosition(0, 7)).toBe(8);
    expect(trendTooltipPosition(6, 7)).toBe(92);
    expect(trendTooltipPosition(3, 7)).toBe(50);
  });
});
