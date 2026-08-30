<script lang="ts">
  import { onMount } from 'svelte';
  import { BarChart, type BarSeriesOption } from 'echarts/charts';
  import {
    AriaComponent,
    GridComponent,
    LegendComponent,
    TooltipComponent,
    type AriaComponentOption,
    type GridComponentOption,
    type LegendComponentOption,
    type TooltipComponentOption
  } from 'echarts/components';
  import { init, use, type ComposeOption, type ECharts } from 'echarts/core';
  import { CanvasRenderer } from 'echarts/renderers';

  import type { WorkbenchModelEntry } from '$core/types.js';
  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';
  import { trendSegmentColor } from '$lib/usage-trend.js';

  use([BarChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, CanvasRenderer]);

  type ChartOption = ComposeOption<
    | BarSeriesOption
    | GridComponentOption
    | TooltipComponentOption
    | LegendComponentOption
    | AriaComponentOption
  >;

  export let models: WorkbenchModelEntry[];
  export let metric: 'tokens' | 'retail-equivalent';
  export let currency: string;
  export let locale: Locale = detectLocale('');
  export let formatUsageMetric: (
    value: number | null,
    currency: string,
    metric: 'tokens' | 'retail-equivalent'
  ) => string;
  export let onSelect: (modelId: string) => void;

  let chartEl: HTMLDivElement | null = null;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;

  $: labels = models[0]?.trend.map((bucket) => bucket.label) ?? [];
  $: names = uniqueModelNames(models);
  $: option = buildOption(models, names, labels);
  $: if (chart) chart.setOption(option, { notMerge: true, lazyUpdate: false });

  function t(key: MessageKey): string {
    return translate(locale, key);
  }

  function uniqueModelNames(entries: WorkbenchModelEntry[]): string[] {
    const counts: Record<string, number> = {};
    for (const entry of entries) counts[entry.model] = (counts[entry.model] ?? 0) + 1;
    return entries.map((entry) =>
      (counts[entry.model] ?? 0) > 1 ? `${entry.model} · ${entry.providerDisplayName}` : entry.model
    );
  }

  function valueFor(model: WorkbenchModelEntry, index: number): number | null {
    const bucket = model.trend[index];
    if (!bucket || bucket.gap) return null;
    if (metric === 'tokens') return bucket.tokenTotals.total;
    return bucket.retailEquivalent.amount;
  }

  function buildOption(
    entries: WorkbenchModelEntry[],
    modelNames: string[],
    bucketLabels: string[]
  ): ChartOption {
    const series: BarSeriesOption[] = entries.map((model, index) => ({
      name: modelNames[index],
      type: 'bar',
      stack: 'total',
      barMaxWidth: 34,
      emphasis: { focus: 'series' },
      itemStyle: { color: trendSegmentColor(model.providerId, model.billingDomainId) },
      data: bucketLabels.map((_, bucketIndex) => valueFor(model, bucketIndex))
    }));
    return {
      animation: !prefersReducedMotion(),
      animationDuration: 280,
      aria: { enabled: true, decal: { show: false } },
      legend: {
        type: 'scroll',
        bottom: 4,
        left: 8,
        right: 8,
        textStyle: { color: '#697386', fontSize: 9 },
        data: modelNames
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        confine: true,
        formatter: (raw) => {
          const parameters = Array.isArray(raw) ? raw : [raw];
          const first = parameters[0] as { axisValue?: unknown } | undefined;
          const label = typeof first?.axisValue === 'string' ? first.axisValue : '';
          const lines = parameters.flatMap((parameter) => {
            const value = typeof parameter.value === 'number' ? parameter.value : null;
            return value === null
              ? []
              : `${parameter.marker ?? ''} ${parameter.seriesName}: ${formatUsageMetric(value, currency, metric)}`;
          });
          return [label, ...lines].join('<br/>');
        }
      },
      grid: { left: 48, right: 48, top: 18, bottom: 46, containLabel: true },
      xAxis: {
        type: 'category',
        data: bucketLabels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#dce1e9' } },
        axisLabel: { color: '#697386', fontSize: 9, hideOverlap: true }
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLabel: {
          color: '#697386',
          fontSize: 9,
          formatter: (value: number) => formatUsageMetric(value, currency, metric)
        },
        splitLine: { lineStyle: { color: '#dce1e9', opacity: 0.65 } }
      },
      series
    };
  }

  function prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  onMount(() => {
    if (!chartEl) return;
    chart = init(chartEl, undefined, { renderer: 'canvas', useDirtyRect: true });
    chart.on('click', (parameters) => {
      const index = typeof parameters.seriesIndex === 'number' ? parameters.seriesIndex : -1;
      const model = models[index];
      if (model) onSelect(model.id);
    });
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(chartEl);
    return () => {
      resizeObserver?.disconnect();
      chart?.dispose();
      chart = null;
    };
  });
</script>

<div
  class="model-trend-stacked-root"
  bind:this={chartEl}
  data-testid="model-trend-stacked"
  aria-label={t('modelTrendStacked')}
></div>

<style>
  .model-trend-stacked-root {
    width: 100%;
    height: clamp(280px, 36vh, 420px);
    min-width: 0;
  }

  @media (max-width: 680px) {
    .model-trend-stacked-root {
      height: 320px;
    }
  }
</style>
