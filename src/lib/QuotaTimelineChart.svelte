<script lang="ts">
  import { tick } from 'svelte';
  import { CustomChart } from 'echarts/charts';
  import {
    AriaComponent,
    GridComponent,
    MarkLineComponent,
    TooltipComponent
  } from 'echarts/components';
  import { init, use, type ECharts } from 'echarts/core';
  import { CanvasRenderer } from 'echarts/renderers';

  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';
  import {
    buildQuotaTimeline,
    type QuotaTimeline,
    type QuotaTimelineMode,
    type QuotaTimelineProvider,
    type QuotaTimelineWindow
  } from '$lib/quota-timeline.js';
  import { trendSegmentColor } from '$lib/usage-trend.js';

  const THEME_EVENT = 'agent-usage:theme-changed';

  use([
    CustomChart,
    GridComponent,
    MarkLineComponent,
    TooltipComponent,
    AriaComponent,
    CanvasRenderer
  ]);

  interface TimelineRenderApi {
    value(index: number): number;
    coord(values: number[]): number[];
    size(values: number[]): number[];
  }

  interface QuotaTimelineTheme {
    text: string;
    muted: string;
    surface: string;
    border: string;
    grid: string;
  }

  export let providers: QuotaTimelineProvider[];
  export let locale: Locale = detectLocale('');
  export let timeZone = 'UTC';
  export let now = Date.now();

  let chartEl: HTMLDivElement | null = null;
  let chartRoot: HTMLElement | null = null;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mode: QuotaTimelineMode = 'weekly';
  let offset = 0;
  let theme: QuotaTimelineTheme = {
    text: '#f4f6fb',
    muted: '#9aa4b4',
    surface: '#171c25',
    border: '#2b3441',
    grid: 'rgba(122, 136, 164, 0.16)'
  };

  $: weeklyTimeline = buildQuotaTimeline(providers, 'weekly', 0, now, timeZone);
  $: timeline = buildQuotaTimeline(providers, mode, offset, now, timeZone);
  $: rangeLabel = formatRange(timeline.range.startMs, timeline.range.endMs);
  $: chartHeight = Math.max(188, 70 + timeline.lanes.length * 48);
  $: chartOption = buildChartOption(timeline, theme, locale, timeZone, mode, now);
  $: if (chart) void renderChart(chartOption);

  function t(key: MessageKey): string {
    return translate(locale, key);
  }

  function formatRange(startMs: number, endMs: number): string {
    const formatter = new Intl.DateTimeFormat(locale, {
      month: '2-digit',
      day: '2-digit',
      timeZone
    });
    return `${formatter.format(startMs)} – ${formatter.format(endMs - 1)}`;
  }

  function formatInstant(value: number): string {
    return new Intl.DateTimeFormat(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone
    }).format(value);
  }

  function axisLabel(value: number): string {
    return new Intl.DateTimeFormat(locale, {
      month: '2-digit',
      day: '2-digit',
      ...(mode === 'session' ? { hour: '2-digit' as const } : {}),
      hour12: false,
      timeZone
    }).format(value);
  }

  function windowStateLabel(state: QuotaTimelineWindow['state']): string {
    const keys = {
      elapsed: 'quotaTimelineElapsed',
      current: 'quotaTimelineCurrent',
      upcoming: 'quotaTimelineUpcoming'
    } as const;
    return t(keys[state]);
  }

  function authorityLabel(authority: QuotaTimelineWindow['authority']): string {
    const keys: Record<QuotaTimelineWindow['authority'], MessageKey> = {
      'official-account': 'authorityOfficialAccount',
      'official-client': 'authorityOfficialClient',
      'local-observation': 'authorityLocalObservation',
      estimate: 'authorityEstimate',
      unavailable: 'authorityUnavailable'
    };
    return t(keys[authority]);
  }

  function selectMode(next: QuotaTimelineMode): void {
    mode = next;
    offset = 0;
  }

  function windowOpacity(state: QuotaTimelineWindow['state']): number {
    if (state === 'current') return 0.34;
    if (state === 'upcoming') return 0.12;
    return 0.08;
  }

  function buildChartOption(
    timeline: QuotaTimeline,
    theme: QuotaTimelineTheme,
    locale: Locale,
    timeZone: string,
    mode: QuotaTimelineMode,
    now: number
  ) {
    const data = timeline.windows.map((window) => {
      const laneIndex = timeline.lanes.findIndex((lane) => lane.id === window.laneId);
      return {
        value: [laneIndex, window.visibleStartMs, window.visibleEndMs],
        window,
        color: trendSegmentColor(window.providerId, timeline.lanes[laneIndex].billingDomainId)
      };
    });
    const nowVisible = now >= timeline.range.startMs && now < timeline.range.endMs;

    return {
      animation: !prefersReducedMotion(),
      animationDuration: prefersReducedMotion() ? 0 : 320,
      aria: { enabled: true, decal: { show: false } },
      grid: { left: 156, right: 18, top: 42, bottom: 14 },
      tooltip: {
        show: true,
        trigger: 'item',
        renderMode: 'html',
        confine: true,
        className: 'quota-timeline-tooltip',
        backgroundColor: theme.surface,
        borderColor: theme.border,
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { color: theme.text, fontSize: 11 },
        extraCssText: 'border-radius: 10px; box-shadow: 0 14px 34px rgba(0,0,0,.22);',
        formatter(parameters: unknown) {
          const entry = tooltipWindow(parameters);
          if (!entry) return '';
          const usage =
            entry.usedPercent === null
              ? ''
              : `<br/><strong>${formatNumber(entry.usedPercent)}% ${escapeHtml(t('used'))}</strong>`;
          const observed = entry.observedAt ? formatInstant(Date.parse(entry.observedAt)) : '—';
          return `<strong>${escapeHtml(entry.providerDisplayName)}</strong> · ${escapeHtml(
            entry.billingDomainDisplayName
          )}<br/>${escapeHtml(entry.label)} · ${escapeHtml(
            windowStateLabel(entry.state)
          )}<br/>${escapeHtml(
            formatInstant(entry.startMs)
          )} → ${escapeHtml(formatInstant(entry.endMs))}${usage}<br/>${escapeHtml(
            t('source')
          )}: ${escapeHtml(authorityLabel(entry.authority))} · ${escapeHtml(
            t('updated')
          )}: ${escapeHtml(observed)}`;
        }
      },
      xAxis: {
        type: 'time',
        position: 'top',
        min: timeline.range.startMs,
        max: timeline.range.endMs,
        splitNumber: mode === 'weekly' ? 14 : 12,
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
        axisLabel: { color: theme.muted, fontSize: 10, formatter: axisLabel },
        splitLine: { show: true, lineStyle: { color: theme.grid } }
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: timeline.lanes.map(
          (lane) => `${lane.providerDisplayName}\n${lane.billingDomainDisplayName}`
        ),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: (_value: string, index: number) => {
            const lane = timeline.lanes[index];
            return lane ? trendSegmentColor(lane.providerId, lane.billingDomainId) : theme.text;
          },
          fontSize: 12,
          fontWeight: 600,
          width: 136,
          overflow: 'truncate',
          lineHeight: 16,
          formatter: (value: string) => `●  ${value}`
        },
        splitLine: { show: true, lineStyle: { color: theme.grid } }
      },
      series: [
        {
          type: 'custom',
          name: t('quotaTimelineTitle'),
          encode: { x: [1, 2], y: 0 },
          data,
          renderItem(parameters: { dataIndex: number }, api: TimelineRenderApi) {
            const entry = data[parameters.dataIndex] ?? null;
            const laneIndex = Number(api.value(0));
            const start = api.coord([api.value(1), laneIndex]);
            const end = api.coord([api.value(2), laneIndex]);
            const bandHeight = Math.max(18, Math.min(26, api.size([0, 1])[1] * 0.46));
            const width = Math.max(1, end[0] - start[0]);
            const chartEntry =
              entry ??
              data.find(
                (candidate) =>
                  candidate.value[0] === laneIndex && candidate.value[1] === api.value(1)
              );
            if (!chartEntry) return null;
            const children: Array<Record<string, unknown>> = [
              {
                type: 'rect',
                shape: {
                  x: start[0],
                  y: start[1] - bandHeight / 2,
                  width,
                  height: bandHeight,
                  r: 8
                },
                style: {
                  fill: withAlpha(chartEntry.color, windowOpacity(chartEntry.window.state)),
                  stroke: withAlpha(
                    chartEntry.color,
                    chartEntry.window.state === 'current' ? 0.72 : 0.38
                  ),
                  lineWidth: 1,
                  lineDash: chartEntry.window.state === 'upcoming' ? [4, 3] : undefined
                }
              }
            ];
            if (chartEntry.window.usedPercent !== null) {
              children.push({
                type: 'rect',
                shape: {
                  x: start[0],
                  y: start[1] - bandHeight / 2,
                  width: (width * Math.min(100, Math.max(0, chartEntry.window.usedPercent))) / 100,
                  height: bandHeight,
                  r: 8
                },
                style: { fill: withAlpha(chartEntry.color, 0.58) }
              });
            }
            if (width > 86 && chartEntry.window.state === 'current') {
              children.push({
                type: 'text',
                style: {
                  x: start[0] + 8,
                  y: start[1],
                  text: `${formatNumber(chartEntry.window.usedPercent)}% · ${formatInstant(chartEntry.window.endMs)}`,
                  fill: theme.text,
                  font: '600 10px Inter, system-ui, sans-serif',
                  verticalAlign: 'middle',
                  width: Math.max(0, width - 16),
                  overflow: 'truncate'
                }
              });
            }
            return { type: 'group', children };
          },
          markLine: nowVisible
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { color: theme.muted, width: 1, opacity: 0.72 },
                label: { show: false },
                data: [{ xAxis: now }]
              }
            : undefined
        }
      ]
    };
  }

  function tooltipWindow(parameters: unknown): QuotaTimelineWindow | null {
    if (!parameters || typeof parameters !== 'object' || !('data' in parameters)) return null;
    const data = parameters.data;
    if (!data || typeof data !== 'object' || !('window' in data)) return null;
    return data.window as QuotaTimelineWindow;
  }

  function formatNumber(value: number | null): string {
    return value === null
      ? '—'
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  }

  function withAlpha(color: string, opacity: number): string {
    const hex = color.replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
  }

  function escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
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
      border: resolvedCssColor(source, '--border', theme.border),
      grid: resolvedCssColor(source, '--border-soft', theme.grid)
    };
  }

  async function renderChart(option: ReturnType<typeof buildChartOption>): Promise<void> {
    if (!chart) return;
    chart.setOption(option as never, { notMerge: true, lazyUpdate: false });
    await tick();
    chart.resize();
  }

  function mountChart(node: HTMLDivElement) {
    chartEl = node;
    syncChartTheme();
    chart = init(node, undefined, { renderer: 'canvas', useDirtyRect: true });
    chart.getDom().setAttribute('aria-hidden', 'true');
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(node);
    window.addEventListener(THEME_EVENT, syncChartTheme);
    void renderChart(chartOption);
    return {
      destroy() {
        window.removeEventListener(THEME_EVENT, syncChartTheme);
        resizeObserver?.disconnect();
        resizeObserver = null;
        chart?.dispose();
        chart = null;
        if (chartEl === node) chartEl = null;
      }
    };
  }
</script>

{#if weeklyTimeline.lanes.length > 0}
  <section
    class="quota-timeline"
    bind:this={chartRoot}
    data-testid="quota-timeline"
    data-chart-engine="echarts"
    data-lane-count={timeline.lanes.length}
    aria-labelledby="quota-timeline-heading"
  >
    <header>
      <div>
        <h2 id="quota-timeline-heading">{t('quotaTimelineTitle')}</h2>
        <p class="quota-timeline-range">{rangeLabel} · {t('quotaTimelineCurrentRange')}</p>
      </div>
      <div class="quota-timeline-controls">
        <div class="quota-timeline-navigation">
          <button
            type="button"
            on:click={() => (offset -= 1)}
            aria-label={t('quotaTimelinePrevious')}>‹</button
          >
          <button
            type="button"
            on:click={() => (offset = 0)}
            disabled={offset === 0}
            aria-label={t('quotaTimelineToday')}>{t('quotaTimelineToday')}</button
          >
          <button type="button" on:click={() => (offset += 1)} aria-label={t('quotaTimelineNext')}
            >›</button
          >
        </div>
        <div class="quota-timeline-modes" role="group" aria-label={t('quotaTimelineModes')}>
          <button
            type="button"
            aria-pressed={mode === 'weekly'}
            on:click={() => selectMode('weekly')}>{t('quotaTimelineWeekly')}</button
          >
          <button
            type="button"
            aria-pressed={mode === 'session'}
            on:click={() => selectMode('session')}>{t('quotaTimelineFiveHour')}</button
          >
        </div>
      </div>
    </header>

    <div class="quota-timeline-legend" aria-hidden="true">
      <ul class="quota-timeline-legend-items">
        <li class="quota-timeline-legend-item">
          <span class="quota-timeline-swatch swatch-solid"></span>
          {t('quotaTimelineCurrent')}
        </li>
        <li class="quota-timeline-legend-item">
          <span class="quota-timeline-swatch swatch-outline"></span>
          {t('quotaTimelineElapsed')}
        </li>
        <li class="quota-timeline-legend-item">
          <span class="quota-timeline-swatch swatch-dashed"></span>
          {t('quotaTimelineUpcoming')}
        </li>
      </ul>
    </div>

    {#if timeline.lanes.length === 0}
      <p class="quota-timeline-empty" role="status">{t('quotaTimelineEmpty')}</p>
    {:else}
      <div class="quota-timeline-scroll">
        <div
          class="quota-timeline-chart"
          bind:this={chartEl}
          use:mountChart
          style={`height: ${chartHeight}px`}
        ></div>
      </div>
    {/if}

    <div class="quota-timeline-data">
      <table aria-label={t('quotaTimelineData')}>
        <thead
          ><tr
            ><th>{t('providersLabel')}</th><th>{t('quotaTimelineAccount')}</th><th>{t('quota')}</th
            ><th>{t('used')}</th><th>{t('resets')}</th><th>{t('source')}</th><th>{t('updated')}</th
            ></tr
          ></thead
        >
        <tbody>
          {#each timeline.lanes as lane (lane.id)}
            <tr
              ><td>{lane.providerDisplayName}</td><td>{lane.billingDomainDisplayName}</td><td
                >{lane.selectedLabel}</td
              ><td>{lane.usedPercent === null ? '—' : `${formatNumber(lane.usedPercent)}%`}</td><td
                >{formatInstant(Date.parse(lane.resetsAt))}</td
              ><td>{authorityLabel(lane.authority)}</td><td
                >{lane.observedAt ? formatInstant(Date.parse(lane.observedAt)) : '—'}</td
              ></tr
            >
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}

<style>
  .quota-timeline {
    margin-bottom: 18px;
    padding: 22px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 22px;
    background: var(--surface);
    box-shadow: var(--shadow-soft);
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    color: var(--text-strong);
    font-size: 1rem;
  }

  .quota-timeline-range {
    margin-top: 4px;
    color: var(--muted);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .quota-timeline-controls,
  .quota-timeline-navigation,
  .quota-timeline-modes {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .quota-timeline-navigation,
  .quota-timeline-modes {
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-inset);
  }

  button {
    min-height: 30px;
    padding: 0 11px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
  }

  button:hover:not(:disabled) {
    color: var(--text-strong);
  }

  button[aria-pressed='true'] {
    border-color: var(--border);
    background: var(--button);
    color: var(--text-strong);
    box-shadow: 0 4px 12px rgba(16, 24, 40, 0.08);
  }

  button:disabled {
    cursor: default;
    opacity: 0.5;
  }

  button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .quota-timeline-scroll {
    min-width: 0;
    overflow-x: auto;
  }

  .quota-timeline-chart {
    width: 100%;
    min-width: 760px;
  }

  .quota-timeline-empty {
    display: grid;
    min-height: 120px;
    place-items: center;
    color: var(--muted);
    font-size: 0.76rem;
  }

  .quota-timeline-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 28px;
    margin: 0 0 12px;
    padding: 10px 14px;
    border: 1px solid var(--border-soft);
    border-radius: 14px;
    background: var(--surface-inset);
  }

  .quota-timeline-legend-items {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .quota-timeline-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .quota-timeline-swatch {
    display: inline-block;
    flex: none;
    width: 38px;
    height: 12px;
    border-radius: 6px;
  }

  .swatch-solid {
    background: color-mix(in srgb, var(--primary) 60%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary) 80%, transparent);
  }

  .swatch-outline {
    background: color-mix(in srgb, var(--primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary) 45%, transparent);
  }

  .swatch-dashed {
    background: color-mix(in srgb, var(--primary) 12%, transparent);
    border: 1px dashed color-mix(in srgb, var(--primary) 45%, transparent);
  }

  .quota-timeline-data {
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

  @media (max-width: 760px) {
    .quota-timeline {
      padding: 18px;
      border-radius: 18px;
    }

    header,
    .quota-timeline-controls {
      align-items: stretch;
      flex-direction: column;
    }

    .quota-timeline-navigation,
    .quota-timeline-modes {
      justify-content: center;
    }
  }
</style>
