<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { PieChart, type PieSeriesOption } from 'echarts/charts';
  import {
    AriaComponent,
    LegendComponent,
    TitleComponent,
    TooltipComponent,
    type AriaComponentOption,
    type LegendComponentOption,
    type TitleComponentOption,
    type TooltipComponentOption
  } from 'echarts/components';
  import { init, use, type ComposeOption, type ECharts } from 'echarts/core';
  import { CanvasRenderer } from 'echarts/renderers';

  import type { WorkbenchProviderSummary } from '$core/types.js';
  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';
  import {
    buildProviderShareChartOption,
    buildProviderShareEntries,
    type ProviderShareMetric,
    type ProviderShareTheme
  } from '$lib/provider-share.js';
  import { trendSegmentColor } from '$lib/usage-trend.js';

  use([PieChart, LegendComponent, TooltipComponent, TitleComponent, AriaComponent, CanvasRenderer]);

  type ProviderChartOption = ComposeOption<
    | PieSeriesOption
    | LegendComponentOption
    | TooltipComponentOption
    | TitleComponentOption
    | AriaComponentOption
  >;

  export let providers: WorkbenchProviderSummary[];
  export let metric: ProviderShareMetric;
  export let currency: string;
  export let locale: Locale = detectLocale('');
  export let formatUsageMetric: (
    value: number | null,
    currency: string,
    metric: ProviderShareMetric
  ) => string;
  export let formatPercent: (value: number | null) => string;

  let chartEl: HTMLDivElement | null = null;
  let chartRoot: HTMLElement | null = null;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let colorScheme: MediaQueryList | null = null;
  let theme: ProviderShareTheme = {
    text: '#f4f6fb',
    muted: '#9aa4b4',
    surface: '#171c25',
    border: '#2b3441'
  };

  $: entries = buildProviderShareEntries(
    providers,
    metric,
    trendSegmentColor,
    (value) => formatUsageMetric(value, currency, metric),
    formatPercent
  );
  $: chartOption = buildProviderShareChartOption(
    entries,
    theme,
    t('notAvailable'),
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

  async function renderChart(option: ReturnType<typeof buildProviderShareChartOption>) {
    if (!chart) return;
    chart.setOption(option as unknown as ProviderChartOption, {
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
    colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    colorScheme.addEventListener('change', syncChartTheme);
    return () => {
      colorScheme?.removeEventListener('change', syncChartTheme);
      colorScheme = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      chart?.dispose();
      chart = null;
    };
  });
</script>

<div class="provider-share-chart-root" bind:this={chartRoot}>
  <div
    class="provider-share-echarts"
    bind:this={chartEl}
    data-testid="provider-share-chart"
    data-chart-engine="echarts"
  ></div>
  <table class="provider-share-data" aria-label={t('providerShare')}>
    <thead>
      <tr>
        <th>{t('providersLabel')}</th>
        <th>{metric === 'tokens' ? t('tokens') : t('cost')}</th>
        <th>{metric === 'tokens' ? t('tokenShare') : t('costShare')}</th>
      </tr>
    </thead>
    <tbody>
      {#each entries as entry (entry.key)}
        <tr>
          <td>{entry.name} · {entry.billingDomainDisplayName}</td>
          <td>{entry.formattedValue}</td>
          <td>{entry.formattedShare}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .provider-share-chart-root {
    min-width: 0;
  }

  .provider-share-echarts {
    width: 100%;
    height: 282px;
  }

  .provider-share-data {
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
    .provider-share-echarts {
      height: 300px;
    }
  }
</style>
