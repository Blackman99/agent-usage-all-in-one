<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { TreemapChart, type TreemapSeriesOption } from 'echarts/charts';
  import {
    AriaComponent,
    TitleComponent,
    TooltipComponent,
    type AriaComponentOption,
    type TitleComponentOption,
    type TooltipComponentOption
  } from 'echarts/components';
  import { init, use, type ComposeOption, type ECharts } from 'echarts/core';
  import { CanvasRenderer } from 'echarts/renderers';

  import type { DataAuthority, WorkbenchModelEntry } from '$core/types.js';
  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';
  import {
    buildModelBreakdownEntries,
    buildModelBreakdownOption,
    type ModelBreakdownMetric,
    type ModelBreakdownTheme
  } from '$lib/model-breakdown.js';
  import { THEME_EVENT } from '$lib/theme.js';
  import { trendSegmentColor } from '$lib/usage-trend.js';

  use([TreemapChart, TooltipComponent, TitleComponent, AriaComponent, CanvasRenderer]);

  type ModelBreakdownChartOption = ComposeOption<
    TreemapSeriesOption | TooltipComponentOption | TitleComponentOption | AriaComponentOption
  >;

  export let models: WorkbenchModelEntry[];
  export let metric: ModelBreakdownMetric;
  export let currency: string;
  export let locale: Locale = detectLocale('');
  export let formatUsageMetric: (
    value: number | null,
    currency: string,
    metric: ModelBreakdownMetric
  ) => string;
  export let formatPercent: (value: number | null) => string;
  export let displayAuthorities: (authorities: DataAuthority[] | undefined) => string;
  export let formatReset: (value: string | null) => string;
  export let onSelect: (modelId: string) => void;

  let chartEl: HTMLDivElement | null = null;
  let chartRoot: HTMLElement | null = null;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let theme: ModelBreakdownTheme = {
    text: '#f4f6fb',
    muted: '#9aa4b4',
    surface: '#171c25',
    border: '#2b3441'
  };

  $: entries = buildModelBreakdownEntries(
    models,
    metric,
    trendSegmentColor,
    (value) => formatUsageMetric(value, currency, metric),
    formatPercent,
    (model, selectedMetric) => {
      if (selectedMetric === 'tokens') {
        return `${t('source')}: ${displayAuthorities(model.authorities)} · ${formatReset(model.lastObservedAt)}`;
      }
      const cost =
        model.retailEquivalent.amount !== null ? model.retailEquivalent : model.reportedEstimate;
      return `${t('source')}: ${displayAuthorities(cost.authorities)} · ${formatReset(cost.observedAt)}`;
    }
  );
  $: chartOption = buildModelBreakdownOption(
    entries,
    theme,
    { notAvailable: t('notAvailable'), separateFromHeadline: t('separateFromHeadline') },
    !prefersReducedMotion()
  );
  $: if (chart) void renderChart(chartOption);

  function t(key: MessageKey): string {
    return translate(locale, key);
  }

  function prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function resolvedCssColor(source: HTMLElement, variable: string, fallback: string): string {
    const value = getComputedStyle(source).getPropertyValue(variable).trim();
    if (!value) return fallback;
    const probe = document.createElement('span');
    probe.style.color = value;
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    source.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved && resolved !== 'rgba(0, 0, 0, 0)' ? resolved : fallback;
  }

  function syncChartTheme(): void {
    const source = chartRoot ?? chartEl;
    if (!source) return;
    theme = {
      text: resolvedCssColor(source, '--text-strong', theme.text),
      muted: resolvedCssColor(source, '--muted', theme.muted),
      surface: resolvedCssColor(source, '--surface', theme.surface),
      border: resolvedCssColor(source, '--border', theme.border)
    };
  }

  async function renderChart(option: ReturnType<typeof buildModelBreakdownOption>) {
    if (!chart) return;
    chart.setOption(option as unknown as ModelBreakdownChartOption, {
      notMerge: true,
      lazyUpdate: false
    });
    await tick();
    chart.resize();
  }

  onMount(() => {
    if (!chartEl) return;
    syncChartTheme();
    chart = init(chartEl, undefined, { renderer: 'canvas', useDirtyRect: true });
    chart.on('click', (parameters) => {
      const data = parameters?.data;
      const modelId =
        data && typeof data === 'object' ? (data as { modelId?: unknown }).modelId : null;
      if (typeof modelId === 'string') onSelect(modelId);
    });
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(chartEl);
    window.addEventListener(THEME_EVENT, syncChartTheme);
    return () => {
      window.removeEventListener(THEME_EVENT, syncChartTheme);
      resizeObserver?.disconnect();
      resizeObserver = null;
      chart?.dispose();
      chart = null;
    };
  });
</script>

<div class="model-breakdown-treemap-root" bind:this={chartRoot}>
  <div
    class="model-breakdown-echarts"
    bind:this={chartEl}
    data-testid="model-breakdown-treemap"
    data-chart-engine="echarts"
    aria-label={t('modelBreakdownTreemap')}
  ></div>
</div>

<style>
  .model-breakdown-treemap-root {
    min-width: 0;
  }

  .model-breakdown-echarts {
    width: 100%;
    height: clamp(280px, 36vh, 420px);
  }

  @media (max-width: 680px) {
    .model-breakdown-echarts {
      height: 300px;
    }
  }
</style>
