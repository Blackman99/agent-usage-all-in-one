<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { LineChart, type LineSeriesOption } from 'echarts/charts';
  import { GridComponent, type GridComponentOption } from 'echarts/components';
  import { init, use, type ComposeOption, type ECharts } from 'echarts/core';
  import { CanvasRenderer } from 'echarts/renderers';

  import type { HistoryWindow, WorkbenchTrendBucket, WorkbenchTrendSegment } from '$core/types.js';
  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';
  import { THEME_EVENT } from '$lib/theme.js';
  import {
    MINIMUM_TREND_BUCKETS,
    TREND_AXIS_LABEL_FALLBACK,
    TREND_GRID_LINE_FALLBACK,
    buildTrendChartOption,
    buildTrendChartSeries,
    nextTrendZoom,
    panTrendViewport,
    trendMaximum,
    trendSegmentColor,
    trendTooltipPosition,
    trendViewportBounds,
    type TrendMetric
  } from '$lib/usage-trend.js';

  use([LineChart, GridComponent, CanvasRenderer]);

  type TrendChartOption = ComposeOption<LineSeriesOption | GridComponentOption>;

  export let buckets: WorkbenchTrendBucket[];
  export let metric: TrendMetric;
  export let currency: string;
  export let locale: Locale = detectLocale('');
  export let selectedWindow: HistoryWindow;
  export let timeZone: string;
  export let granularity: 'hour' | 'day';
  export let rangeLabel: string;
  export let formatUsageMetric: (
    value: number | null,
    currency: string,
    metric: TrendMetric
  ) => string;
  export let describeSegment: (segment: WorkbenchTrendSegment, metric: TrendMetric) => string;

  let chartEl: HTMLDivElement | null = null;
  let chartRoot: HTMLElement | null = null;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let trendViewportStart = 0;
  let trendViewportSize: number | null = null;
  let trendHoverIndex: number | null = null;
  let trendPanOrigin: { clientX: number; viewportStart: number } | null = null;
  let trendPanning = false;
  let gridLineColor = TREND_GRID_LINE_FALLBACK;
  let axisLabelColor = TREND_AXIS_LABEL_FALLBACK;

  $: chartViewport = trendViewportBounds(buckets.length, trendViewportStart, trendViewportSize);
  $: chartBuckets = buckets.slice(chartViewport.start, chartViewport.start + chartViewport.size);
  $: chartSeries = buildTrendChartSeries(chartBuckets, metric);
  $: visibleMaximum = trendMaximum(chartSeries);
  // One legend entry per Provider billing domain: the cost purpose stays visible
  // in the plot itself through the solid and dashed lines.
  $: legendSeries = chartSeries.filter(
    (series, index) =>
      chartSeries.findIndex(
        (candidate) =>
          candidate.providerId === series.providerId &&
          candidate.billingDomainId === series.billingDomainId
      ) === index
  );
  $: hoverBucket = trendHoverIndex === null ? null : chartBuckets[trendHoverIndex];
  $: chartOption = buildTrendChartOption(
    chartBuckets.map((bucket) => bucket.label),
    chartSeries,
    visibleMaximum,
    { gridLine: gridLineColor, label: axisLabelColor },
    !trendPanning && !prefersReducedMotion(),
    (value) => formatUsageMetric(value, currency, metric)
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

  function resolveCssColor(source: HTMLElement, value: string): string {
    const probe = document.createElement('span');
    probe.style.color = value;
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    source.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }

  function syncChartTheme(): void {
    const source = chartRoot ?? chartEl;
    if (!source) return;
    const next = getComputedStyle(source).getPropertyValue('--trend-grid-line').trim();
    const muted = getComputedStyle(source).getPropertyValue('--muted').trim();
    const resolvedGrid = next ? resolveCssColor(source, next) : '';
    const resolvedLabel = muted ? resolveCssColor(source, muted) : '';
    gridLineColor =
      resolvedGrid && resolvedGrid !== 'rgba(0, 0, 0, 0)' ? resolvedGrid : TREND_GRID_LINE_FALLBACK;
    axisLabelColor =
      resolvedLabel && resolvedLabel !== 'rgba(0, 0, 0, 0)'
        ? resolvedLabel
        : TREND_AXIS_LABEL_FALLBACK;
  }

  function hoverAnchor(index: number): string {
    if (chart) {
      const x = chart.convertToPixel({ xAxisIndex: 0 }, index);
      const top = chart.convertToPixel({ yAxisIndex: 0 }, Math.max(1, visibleMaximum ?? 1));
      const bottom = chart.convertToPixel({ yAxisIndex: 0 }, 0);
      if (Number.isFinite(x) && Number.isFinite(top) && Number.isFinite(bottom)) {
        return `left: ${x}px; top: ${top}px; height: ${Math.max(0, bottom - top)}px`;
      }
    }
    return `left: ${trendTooltipPosition(index, chartBuckets.length)}%; top: 16px; bottom: 28px`;
  }

  function resetTrendViewport(): void {
    trendViewportStart = 0;
    trendViewportSize = null;
    trendHoverIndex = null;
    trendPanOrigin = null;
    trendPanning = false;
  }

  function zoomTrend(direction: 'in' | 'out', anchorRatio = 0.5): void {
    const next = nextTrendZoom(
      buckets.length,
      trendViewportStart,
      trendViewportSize,
      direction,
      anchorRatio
    );
    trendViewportStart = next.start;
    trendViewportSize = next.size;
    trendHoverIndex = null;
  }

  function handleTrendWheel(event: WheelEvent): void {
    if (event.deltaY === 0) return;
    const bounds =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.getBoundingClientRect()
        : null;
    const anchorRatio = bounds?.width ? (event.clientX - bounds.left) / bounds.width : 0.5;
    zoomTrend(event.deltaY < 0 ? 'in' : 'out', anchorRatio);
  }

  function updateTrendHover(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement) || chartBuckets.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    trendHoverIndex = Math.round(ratio * Math.max(0, chartBuckets.length - 1));
  }

  function handleTrendPointerDown(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement) || chartViewport.size >= buckets.length) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    trendPanOrigin = { clientX: event.clientX, viewportStart: chartViewport.start };
    trendPanning = true;
  }

  function handleTrendPointerMove(event: PointerEvent): void {
    updateTrendHover(event);
    if (!trendPanOrigin || !(event.currentTarget instanceof HTMLElement)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const bucketShift = Math.round(
      ((trendPanOrigin.clientX - event.clientX) / bounds.width) * chartViewport.size
    );
    trendViewportStart = Math.max(
      0,
      Math.min(buckets.length - chartViewport.size, trendPanOrigin.viewportStart + bucketShift)
    );
  }

  function finishTrendPan(event: PointerEvent): void {
    if (
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    trendPanOrigin = null;
    trendPanning = false;
  }

  function panTrend(bucketDelta: number): void {
    trendViewportStart = panTrendViewport(
      buckets.length,
      trendViewportStart,
      trendViewportSize,
      bucketDelta
    );
    trendHoverIndex = null;
  }

  function handleTrendKeydown(event: KeyboardEvent): void {
    if (event.key === '+' || event.key === '=') zoomTrend('in');
    else if (event.key === '-') zoomTrend('out');
    else if (event.key === 'ArrowLeft') panTrend(-1);
    else if (event.key === 'ArrowRight') panTrend(1);
    else if (event.key === 'Home') resetTrendViewport();
    else return;
    event.preventDefault();
  }

  async function renderChart(option: ReturnType<typeof buildTrendChartOption>): Promise<void> {
    if (!chart) return;
    chart.setOption(option as unknown as TrendChartOption, {
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

<article class="workbench-trend" bind:this={chartRoot}>
  <div class="trend-heading">
    <div>
      <span>{metric === 'tokens' ? t('tokenTrend') : t('costTrend')}</span>
      <strong>{rangeLabel}</strong>
    </div>
    <div class="trend-interactions">
      <span>{t('trendInteractionHint')}</span>
      <div class="trend-zoom-controls" role="group" aria-label={t('timeAxisControls')}>
        <button
          type="button"
          aria-label={t('zoomOutTimeAxis')}
          disabled={trendViewportSize === null}
          on:click={() => zoomTrend('out')}>−</button
        >
        <button
          type="button"
          aria-label={t('zoomInTimeAxis')}
          disabled={(trendViewportSize ?? buckets.length) <=
            Math.min(MINIMUM_TREND_BUCKETS, buckets.length)}
          on:click={() => zoomTrend('in')}>+</button
        >
        <button
          type="button"
          aria-label={t('resetTimeAxis')}
          disabled={trendViewportSize === null && trendViewportStart === 0}
          on:click={() => resetTrendViewport()}>↺</button
        >
      </div>
    </div>
  </div>
  <div class="trend-chart" data-testid="usage-trend-chart">
    <div
      class:trend-panning={trendPanning}
      class="trend-plot"
      data-testid="trend-plot"
      data-total-buckets={buckets.length}
      data-visible-buckets={chartViewport.size}
      data-viewport-start={chartViewport.start}
      role="slider"
      aria-label={t('interactiveTrend')}
      aria-valuemin="0"
      aria-valuemax={Math.max(0, buckets.length - chartViewport.size)}
      aria-valuenow={chartViewport.start}
      aria-valuetext={`${chartBuckets[0]?.label ?? '—'} – ${chartBuckets.at(-1)?.label ?? '—'}`}
      tabindex="0"
      on:wheel|preventDefault={handleTrendWheel}
      on:pointerdown={handleTrendPointerDown}
      on:pointermove={handleTrendPointerMove}
      on:pointerup={finishTrendPan}
      on:pointercancel={finishTrendPan}
      on:pointerleave={() => {
        if (!trendPanOrigin) trendHoverIndex = null;
      }}
      on:keydown={handleTrendKeydown}
    >
      <div class="trend-echarts" bind:this={chartEl}></div>
      <div class="trend-series-markers" aria-hidden="true">
        {#each chartSeries as series (series.key)}
          <span
            data-cost-purpose={series.costPurpose ?? 'tokens'}
            style={series.costPurpose === 'reported-estimate'
              ? `fill: transparent; stroke: ${trendSegmentColor(series.providerId, series.billingDomainId)}`
              : `fill: ${trendSegmentColor(series.providerId, series.billingDomainId)}`}
          ></span>
        {/each}
      </div>
      {#if trendHoverIndex !== null && chartBuckets.length > 0}
        <div class="trend-hover-line" style={hoverAnchor(trendHoverIndex)}></div>
      {/if}
      {#if hoverBucket}
        <div
          class="trend-tooltip"
          data-testid="trend-tooltip"
          role="tooltip"
          style={`left: ${trendTooltipPosition(trendHoverIndex ?? 0, chartBuckets.length)}%`}
        >
          <strong>{hoverBucket.label}</strong>
          {#if hoverBucket.gap || hoverBucket.segments.length === 0}
            <span>{t('gap')}</span>
          {:else}
            {#each hoverBucket.segments as segment (`${segment.providerId}:${segment.billingDomainId}`)}
              <span>
                <b>{segment.providerDisplayName}</b>
                <small>{describeSegment(segment, metric)}</small>
              </span>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </div>
  <div class="trend-legend" aria-hidden="true">
    {#each legendSeries as segment (segment.key)}
      <span>
        <i style={`background: ${trendSegmentColor(segment.providerId, segment.billingDomainId)}`}
        ></i>
        {segment.providerDisplayName} · {segment.billingDomainDisplayName}
        {#if segment.includedInHeadline === false}
          · {t('separateFromHeadline')}{/if}
      </span>
    {/each}
  </div>
  <div class="trend-data">
    <table
      aria-label={`${t('trendData')} · ${selectedWindow} · ${timeZone} · ${granularity === 'hour' ? t('precisionHour') : t('precisionDay')} · ${t('trendSummary')}`}
    >
      <thead>
        <tr>
          <th>{t('interval')}</th>
          <th>{metric === 'tokens' ? t('tokens') : t('cost')}</th>
        </tr>
      </thead>
      <tbody>
        {#each buckets as bucket (bucket.start)}
          <tr>
            <td>{bucket.label}</td>
            <td>
              {bucket.gap
                ? t('gap')
                : bucket.segments.map((segment) => describeSegment(segment, metric)).join('; ')}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</article>

<style>
  .workbench-trend {
    --trend-height: 280px;
    --trend-grid-line: color-mix(in srgb, var(--muted) 28%, transparent);
    min-width: 0;
    padding: 20px;
    border: 1px solid var(--border-soft);
    border-radius: 18px;
    background: var(--surface-subtle);
  }

  .trend-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }

  .trend-heading > div:first-child {
    display: grid;
    gap: 4px;
  }

  .trend-heading span,
  .trend-heading strong {
    margin: 0;
  }

  .trend-heading span,
  .trend-interactions > span,
  .trend-legend span {
    color: var(--muted);
  }

  .trend-heading strong {
    color: var(--text-strong);
    font-size: 0.84rem;
  }

  .trend-interactions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .trend-interactions > span {
    font-size: 0.62rem;
  }

  .trend-zoom-controls {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--border-soft);
    border-radius: 10px;
    background: var(--surface-inset);
  }

  .trend-zoom-controls button {
    width: 30px;
    height: 28px;
    padding: 0;
    border: 0;
    border-left: 1px solid var(--border-soft);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font-size: 0.82rem;
  }

  .trend-zoom-controls button:first-child {
    border-left: 0;
  }

  .trend-zoom-controls button:hover:not(:disabled) {
    background: var(--surface);
    color: var(--text-strong);
  }

  .trend-zoom-controls button:disabled {
    color: var(--muted);
    cursor: default;
    opacity: 0.55;
  }

  .trend-chart {
    margin-top: 20px;
  }

  .trend-plot {
    position: relative;
    min-width: 0;
    height: var(--trend-height);
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }

  .trend-plot.trend-panning {
    cursor: grabbing;
  }

  .trend-echarts {
    width: 100%;
    height: var(--trend-height);
    pointer-events: none;
  }

  .trend-series-markers {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .trend-hover-line {
    position: absolute;
    width: 0;
    border-left: 1px dashed color-mix(in srgb, var(--text) 42%, transparent);
    pointer-events: none;
    transform: translateX(-50%);
  }

  .trend-tooltip {
    position: absolute;
    z-index: 2;
    top: 12px;
    display: grid;
    width: min(240px, 72%);
    gap: 7px;
    padding: 10px 12px;
    transform: translateX(-50%);
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    box-shadow: var(--shadow-raised);
    color: var(--text);
    pointer-events: none;
    backdrop-filter: blur(16px) saturate(1.2);
  }

  .trend-tooltip > strong {
    color: var(--text-strong);
    font-size: 0.7rem;
  }

  .trend-tooltip > span {
    display: grid;
    gap: 2px;
    font-size: 0.66rem;
  }

  .trend-tooltip b {
    font-weight: 600;
  }

  .trend-tooltip small {
    color: var(--muted);
    font-size: 0.6rem;
    line-height: 1.35;
  }

  .trend-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    margin-top: 10px;
  }

  .trend-legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.64rem;
  }

  .trend-legend i {
    width: 18px;
    height: 3px;
    border-radius: 999px;
  }

  .trend-data {
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

  @media (max-width: 759px) {
    .workbench-trend {
      padding: 16px;
    }

    .trend-heading {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
