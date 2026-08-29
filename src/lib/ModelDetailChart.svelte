<script lang="ts">
  import { onMount } from 'svelte';
  import { LineChart, PieChart, type LineSeriesOption, type PieSeriesOption } from 'echarts/charts';
  import {
    AriaComponent,
    GridComponent,
    LegendComponent,
    TitleComponent,
    TooltipComponent,
    type AriaComponentOption,
    type GridComponentOption,
    type LegendComponentOption,
    type TitleComponentOption,
    type TooltipComponentOption
  } from 'echarts/components';
  import { init, use, type ComposeOption, type ECharts } from 'echarts/core';
  import { CanvasRenderer } from 'echarts/renderers';

  import type { TokenTotals, WorkbenchModelTrendBucket } from '$core/types.js';
  import { translate, type Locale, type MessageKey } from '$lib/i18n.js';

  const THEME_EVENT = 'agent-usage:theme-changed';

  use([
    PieChart,
    LineChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    TitleComponent,
    AriaComponent,
    CanvasRenderer
  ]);

  type ModelDetailOption = ComposeOption<
    | PieSeriesOption
    | LineSeriesOption
    | GridComponentOption
    | TooltipComponentOption
    | LegendComponentOption
    | TitleComponentOption
    | AriaComponentOption
  >;

  type TrendEvidence = {
    recordedTokens: number | null;
    timePrecision: string;
    costAmount: number | null;
    costCurrency: string;
    costPurpose: string;
    costAuthorities: WorkbenchModelTrendBucket['authorities'];
    costObservedAt: string | null | undefined;
  };

  type ChartTheme = {
    text: string;
    muted: string;
    surface: string;
    border: string;
    primary: string;
    cost: string;
  };

  type CompositionEntry = {
    name: string;
    value: number;
    itemStyle: { color: string };
  };

  type BuildOptionInput = {
    composition: CompositionEntry[];
    trend: WorkbenchModelTrendBucket[];
    trendEvidence: TrendEvidence[];
    compact: boolean;
    colors: ChartTheme;
    locale: Locale;
    formatNumber: (value: number) => string;
    formatMoney: (amount: number | null, currency: string) => string;
    displayAuthorities: (authorities: WorkbenchModelTrendBucket['authorities']) => string;
    formatObservedAt: (value: string | null | undefined) => string;
    aggregateAuthorities: WorkbenchModelTrendBucket['authorities'];
    aggregateObservedAt: string | null;
  };

  export let compositionTotals: TokenTotals;
  export let unclassifiedTokens: number;
  export let trend: WorkbenchModelTrendBucket[];
  export let trendEvidence: TrendEvidence[];
  export let locale: Locale;
  export let formatNumber: (value: number) => string;
  export let formatMoney: (amount: number | null, currency: string) => string;
  export let displayAuthorities: (authorities: WorkbenchModelTrendBucket['authorities']) => string;
  export let formatObservedAt: (value: string | null | undefined) => string;
  export let aggregateAuthorities: WorkbenchModelTrendBucket['authorities'];
  export let aggregateObservedAt: string | null;

  let chartEl: HTMLDivElement | null = null;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeFrame = 0;
  let shellFrame = 0;
  let chartFrame = 0;
  let chartReady = false;
  let compact = false;
  let theme: ChartTheme = {
    text: '#10131a',
    muted: '#697386',
    surface: '#ffffff',
    border: '#dce1e9',
    primary: '#647cf0',
    cost: '#9b7cf4'
  };

  const tokenKinds: Array<{ key: keyof TokenTotals; label: MessageKey; color: string }> = [
    { key: 'input', label: 'input', color: '#6f8ff7' },
    { key: 'output', label: 'output', color: '#e19a6c' },
    { key: 'reasoning', label: 'reasoning', color: '#9b7cf4' },
    { key: 'cacheRead', label: 'cacheRead', color: '#52c5a4' },
    { key: 'cacheWrite', label: 'cacheWrite', color: '#e0b84f' }
  ];

  $: composition = tokenKinds
    .map((kind) => ({
      name: t(kind.label),
      value: compositionTotals[kind.key],
      itemStyle: { color: kind.color }
    }))
    .filter((entry) => entry.value > 0)
    .concat(
      unclassifiedTokens > 0
        ? [{ name: t('unclassified'), value: unclassifiedTokens, itemStyle: { color: '#8b94a5' } }]
        : []
    );
  $: option = buildOption({
    composition,
    trend,
    trendEvidence,
    compact,
    colors: theme,
    locale,
    formatNumber,
    formatMoney,
    displayAuthorities,
    formatObservedAt,
    aggregateAuthorities,
    aggregateObservedAt
  });
  $: if (chart) render(option);

  function t(key: MessageKey): string {
    return translate(locale, key);
  }

  function buildOption(input: BuildOptionInput): ModelDetailOption {
    const {
      composition,
      trend,
      trendEvidence,
      compact,
      colors,
      locale,
      formatNumber,
      formatMoney,
      displayAuthorities,
      formatObservedAt,
      aggregateAuthorities,
      aggregateObservedAt
    } = input;
    const label = (key: MessageKey) => translate(locale, key);
    const aggregateProvenance = `${displayAuthorities(aggregateAuthorities)} · ${formatObservedAt(aggregateObservedAt)}`;
    const recordedLabel = label('recordedTotal');
    const costLabel = label('cost');
    const costCurrency =
      trendEvidence.find((evidence) => evidence.costAmount !== null)?.costCurrency ?? 'USD';

    return {
      animation: !prefersReducedMotion(),
      animationDuration: 320,
      aria: { enabled: true, decal: { show: false } },
      title: [
        {
          text: label('tokenBreakdown'),
          subtext: aggregateProvenance,
          left: compact ? 16 : '3%',
          top: compact ? 8 : 10,
          textStyle: { color: colors.text, fontSize: 12, fontWeight: 600 },
          subtextStyle: { color: colors.muted, fontSize: 9 }
        },
        {
          text: label('modelTrend'),
          subtext: aggregateProvenance,
          left: compact ? 16 : '47%',
          top: compact ? '53%' : 10,
          textStyle: { color: colors.text, fontSize: 12, fontWeight: 600 },
          subtextStyle: { color: colors.muted, fontSize: 9 }
        }
      ],
      legend: [
        {
          type: 'scroll',
          orient: 'horizontal',
          left: compact ? 12 : '2%',
          right: compact ? 12 : '55%',
          top: compact ? 230 : 228,
          data: composition.map((entry) => entry.name),
          textStyle: { color: colors.muted, fontSize: 9 },
          itemWidth: 9,
          itemHeight: 9
        },
        {
          left: compact ? 12 : '47%',
          top: compact ? '62%' : 50,
          data: [recordedLabel, costLabel],
          textStyle: { color: colors.muted, fontSize: 9 },
          itemWidth: 14,
          itemHeight: 8
        }
      ],
      tooltip: {
        trigger: 'item',
        confine: true,
        renderMode: 'richText',
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        padding: [9, 11],
        textStyle: { color: colors.text, fontSize: 11 },
        formatter: (raw) => {
          const parameter = Array.isArray(raw) ? raw[0] : raw;
          const dataIndex = typeof parameter.dataIndex === 'number' ? parameter.dataIndex : -1;
          const value = typeof parameter.value === 'number' ? parameter.value : 0;
          if (parameter.seriesType === 'pie') {
            return `${parameter.name}\n${formatNumber(value)} ${label('tokens')}\n${aggregateProvenance}`;
          }
          const bucket = trend[dataIndex];
          const evidence = trendEvidence[dataIndex];
          if (!bucket || !evidence) return `${formatNumber(value)} ${label('tokens')}`;
          if (parameter.seriesName === costLabel) {
            return `${bucket.label}\n${formatMoney(evidence.costAmount, evidence.costCurrency)} · ${evidence.costPurpose}\n${displayAuthorities(evidence.costAuthorities)} · ${formatObservedAt(evidence.costObservedAt)}\n${label('timePrecision')}: ${evidence.timePrecision}`;
          }
          return `${bucket.label}\n${formatNumber(value)} ${label('tokens')}\n${displayAuthorities(bucket.authorities)} · ${formatObservedAt(bucket.lastObservedAt)}\n${label('timePrecision')}: ${evidence.timePrecision}`;
        }
      },
      grid: {
        left: compact ? 48 : '47%',
        right: compact ? 48 : 48,
        top: compact ? '68%' : 82,
        bottom: compact ? 34 : 38,
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: trend.map((bucket) => bucket.label),
        axisLine: { lineStyle: { color: colors.border } },
        axisTick: { show: false },
        axisLabel: { color: colors.muted, fontSize: 9, hideOverlap: true, interval: 'auto' }
      },
      yAxis: [
        {
          type: 'value',
          min: 0,
          splitNumber: 3,
          axisLabel: {
            color: colors.muted,
            fontSize: 9,
            formatter: (value: number) => compactNumber(value, locale)
          },
          splitLine: { lineStyle: { color: colors.border, opacity: 0.65 } }
        },
        {
          type: 'value',
          min: 0,
          position: 'right',
          splitNumber: 3,
          axisLabel: {
            color: colors.cost,
            fontSize: 9,
            formatter: (value: number) => compactMoney(value, costCurrency, locale)
          },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: label('tokenBreakdown'),
          type: 'pie',
          center: compact ? ['50%', '31%'] : ['23%', '50%'],
          radius: compact ? ['20%', '34%'] : ['34%', '54%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: colors.surface, borderWidth: 3, borderRadius: 4 },
          label: { show: false },
          emphasis: { focus: 'self', scaleSize: 5 },
          data: composition
        },
        {
          name: recordedLabel,
          type: 'line',
          yAxisIndex: 0,
          smooth: 0.28,
          showSymbol: trend.length <= 14,
          symbolSize: 6,
          connectNulls: false,
          data: trendEvidence.map((evidence) => evidence.recordedTokens),
          lineStyle: { width: 2.5, color: colors.primary },
          itemStyle: { color: colors.primary },
          areaStyle: { color: colors.primary, opacity: 0.12 },
          emphasis: { focus: 'series' }
        },
        {
          name: costLabel,
          type: 'line',
          yAxisIndex: 1,
          smooth: 0.28,
          showSymbol: trend.length <= 14,
          symbolSize: 6,
          connectNulls: false,
          data: trendEvidence.map((evidence) => evidence.costAmount),
          lineStyle: { width: 2, type: 'dashed', color: colors.cost },
          itemStyle: { color: colors.cost },
          emphasis: { focus: 'series' }
        }
      ]
    };
  }

  function compactNumber(value: number, numberLocale: Locale): string {
    return new Intl.NumberFormat(numberLocale, {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(value);
  }

  function compactMoney(value: number, currency: string, numberLocale: Locale): string {
    return new Intl.NumberFormat(numberLocale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(value);
  }

  function prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function resolvedCssColor(variable: string, fallback: string): string {
    if (!chartEl) return fallback;
    const value = getComputedStyle(chartEl).getPropertyValue(variable).trim();
    return value || fallback;
  }

  function syncTheme(): void {
    theme = {
      text: resolvedCssColor('--text-strong', theme.text),
      muted: resolvedCssColor('--muted', theme.muted),
      surface: resolvedCssColor('--surface', theme.surface),
      border: resolvedCssColor('--border', theme.border),
      primary: resolvedCssColor('--primary', theme.primary),
      cost: resolvedCssColor('--warning', theme.cost)
    };
  }

  function render(next: ModelDetailOption): void {
    chart?.setOption(next, { notMerge: true, lazyUpdate: false });
  }

  onMount(() => {
    if (!chartEl) return;
    shellFrame = requestAnimationFrame(() => {
      chartFrame = requestAnimationFrame(() => {
        if (!chartEl) return;
        syncTheme();
        compact = chartEl.clientWidth < 660;
        chart = init(chartEl, undefined, { renderer: 'canvas', useDirtyRect: true });
        chart.getDom().setAttribute('aria-hidden', 'true');
        render(option);
        resizeObserver = new ResizeObserver(([entry]) => {
          const nextCompact = entry.contentRect.width < 660;
          if (nextCompact !== compact) compact = nextCompact;
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => chart?.resize());
        });
        resizeObserver.observe(chartEl);
        chartReady = true;
      });
    });
    window.addEventListener(THEME_EVENT, syncTheme);
    return () => {
      window.removeEventListener(THEME_EVENT, syncTheme);
      cancelAnimationFrame(shellFrame);
      cancelAnimationFrame(chartFrame);
      cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      chart?.dispose();
      chart = null;
    };
  });
</script>

<div
  class="model-detail-visual"
  bind:this={chartEl}
  data-testid="model-detail-visual"
  data-chart-engine="echarts"
  class:chart-pending={!chartReady}
  aria-busy={!chartReady}
  aria-label={`${t('tokenBreakdown')} · ${t('modelTrend')}`}
></div>

<div class="model-detail-data">
  <table aria-label={t('tokenBreakdown')}>
    <thead>
      <tr>
        <th>{t('tokens')}</th><th>{t('total')}</th><th>{t('providerEvidence')}</th>
      </tr>
    </thead>
    <tbody>
      {#each composition as entry (entry.name)}
        <tr>
          <td>{entry.name}</td>
          <td>{formatNumber(entry.value)}</td>
          <td>
            {displayAuthorities(aggregateAuthorities)} · {formatObservedAt(aggregateObservedAt)}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <table aria-label={t('modelTrend')}>
    <thead>
      <tr>
        <th>{t('interval')}</th>
        <th>{t('tokens')}</th>
        <th>{t('cost')}</th>
        <th>{t('source')}</th>
        <th>{t('providerEvidence')}</th>
        <th>{t('latestData')}</th>
        <th>{t('timePrecision')}</th>
      </tr>
    </thead>
    <tbody>
      {#each trend as bucket, index (bucket.start)}
        {@const evidence = trendEvidence[index]}
        <tr>
          <td>{bucket.label}</td>
          <td>
            {bucket.gap || evidence?.recordedTokens === null
              ? t('gap')
              : formatNumber(evidence.recordedTokens)}
          </td>
          <td>
            {evidence?.costAmount === null
              ? t('notAvailable')
              : formatMoney(evidence.costAmount, evidence.costCurrency)}
          </td>
          <td>{evidence?.costPurpose ?? t('notAvailable')}</td>
          <td>
            {displayAuthorities(bucket.authorities)} · {formatObservedAt(bucket.lastObservedAt)};
            {displayAuthorities(evidence?.costAuthorities)} · {formatObservedAt(
              evidence?.costObservedAt
            )}
          </td>
          <td>{formatObservedAt(bucket.lastObservedAt)}</td>
          <td>{evidence?.timePrecision ?? t('unknown')}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .model-detail-visual {
    width: 100%;
    height: clamp(400px, 46vh, 520px);
    min-width: 0;
  }

  .chart-pending {
    background: linear-gradient(
      100deg,
      transparent 20%,
      color-mix(in srgb, var(--border) 42%, transparent) 42%,
      transparent 64%
    );
    background-size: 220% 100%;
    animation: chart-loading 1.1s ease-in-out infinite;
    border-radius: 12px;
  }

  @keyframes chart-loading {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  .model-detail-data {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    border: 0;
    white-space: nowrap;
  }

  @media (max-width: 680px) {
    .model-detail-visual {
      height: 500px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .chart-pending {
      animation: none;
    }
  }
</style>
