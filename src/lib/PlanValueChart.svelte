<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    LineChart,
    ScatterChart,
    type LineSeriesOption,
    type ScatterSeriesOption
  } from 'echarts/charts';
  import {
    AriaComponent,
    GridComponent,
    TitleComponent,
    TooltipComponent,
    type AriaComponentOption,
    type GridComponentOption,
    type TitleComponentOption,
    type TooltipComponentOption
  } from 'echarts/components';
  import { init, use, type ComposeOption, type ECharts } from 'echarts/core';
  import { CanvasRenderer } from 'echarts/renderers';

  import type { WorkbenchPlanValue } from '$core/types.js';
  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';
  import { THEME_EVENT } from '$lib/theme.js';
  import {
    buildPlanValuePoints,
    buildPlanValueScatterOption,
    type PlanValueFormatters,
    type PlanValueTheme
  } from '$lib/plan-value.js';
  import { trendSegmentColor } from '$lib/usage-trend.js';

  use([
    ScatterChart,
    LineChart,
    GridComponent,
    TooltipComponent,
    TitleComponent,
    AriaComponent,
    CanvasRenderer
  ]);

  type PlanValueChartOption = ComposeOption<
    | ScatterSeriesOption
    | LineSeriesOption
    | GridComponentOption
    | TooltipComponentOption
    | TitleComponentOption
    | AriaComponentOption
  >;

  export let planValue: WorkbenchPlanValue;
  export let locale: Locale = detectLocale('');
  export let formatters: PlanValueFormatters;

  let chartEl: HTMLDivElement | null = null;
  let chartRoot: HTMLElement | null = null;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let theme: PlanValueTheme = {
    text: '#f4f6fb',
    muted: '#9aa4b4',
    surface: '#171c25',
    border: '#2b3441'
  };

  $: points = buildPlanValuePoints(planValue, trendSegmentColor, t('planCustom'));
  $: chartOption = buildPlanValueScatterOption(
    points,
    theme,
    {
      paid: t('planValuePaid'),
      worth: t('planValueWorth'),
      ratio: t('planValueRatio'),
      tokens: t('tokens'),
      effectiveUnitPrice: t('planValueEffectiveUnitPrice'),
      retailUnitPrice: t('planValueRetailUnitPrice'),
      perMillion: t('planValuePerMillion'),
      partial: t('planValuePartial'),
      empty: t('planValueEmpty')
    },
    formatters,
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
      surface: resolvedCssColor(source, '--surface-subtle', theme.surface),
      border: resolvedCssColor(source, '--border', theme.border)
    };
  }

  async function renderChart(option: ReturnType<typeof buildPlanValueScatterOption>) {
    if (!chart) return;
    chart.setOption(option as unknown as PlanValueChartOption, {
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
    chart.getDom().setAttribute('aria-hidden', 'true');
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

<div class="plan-value-chart-root" bind:this={chartRoot}>
  <div
    class="plan-value-echarts"
    bind:this={chartEl}
    data-testid="plan-value-chart"
    data-chart-engine="echarts"
  ></div>
  <div class="plan-value-data">
    <table aria-label={t('planValueChartLabel')}>
      <thead>
        <tr>
          <th>{t('plans')}</th>
          <th>{t('planValuePaid')}</th>
          <th>{t('planValueWorth')}</th>
          <th>{t('planValueRatio')}</th>
          <th>{t('tokens')}</th>
        </tr>
      </thead>
      <tbody>
        {#each points as point (point.key)}
          <tr>
            <td>{point.name} · {point.planLabel}</td>
            <td>{formatters.money(point.paid)}</td>
            <td>{formatters.money(point.worth)}</td>
            <td>{formatters.ratio(point.ratio, point.bound)}</td>
            <td>{formatters.tokens(point.tokens)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .plan-value-chart-root {
    min-width: 0;
  }

  .plan-value-echarts {
    width: 100%;
    height: 320px;
  }

  .plan-value-data {
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
    .plan-value-echarts {
      height: 300px;
    }
  }
</style>
