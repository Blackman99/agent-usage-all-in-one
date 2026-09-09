<script lang="ts">
  import { tick } from 'svelte';
  import type { UsageWall } from '$core/types.js';
  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';
  import {
    buildUsageWallPresentation,
    usageWallTooltipPlacement,
    type UsageWallCell
  } from '$lib/usage-contribution-wall.js';

  export let wall: UsageWall;
  export let locale: Locale = detectLocale('');
  export let formatTokens: (value: number) => string;
  export let updating = false;

  let tooltipEl: HTMLElement | null = null;
  let hover: { text: string; left: number; top: number } | null = null;

  function interpolate(key: MessageKey, values?: Record<string, string>): string {
    return translate(locale, key).replace(
      /\{(\w+)\}/g,
      (_, name: string) => values?.[name] ?? `{${name}}`
    );
  }

  $: presentation = buildUsageWallPresentation(wall, locale, formatTokens, interpolate);
  $: monthByWeek = new Map(presentation.monthLabels.map((label) => [label.weekIndex, label.label]));
  $: weekIndexes = presentation.weeks.map((_week, weekIndex) => weekIndex);

  async function showTooltip(event: FocusEvent | PointerEvent, day: UsageWallCell): Promise<void> {
    const cell = event.currentTarget as HTMLElement;
    const cellRect = cell.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };
    const estimated = tooltipEl?.getBoundingClientRect();
    const tooltipSize = {
      width: estimated?.width || Math.min(240, Math.max(160, day.accessibleName.length * 7)),
      height: estimated?.height || (day.accessibleName.includes('·') ? 48 : 36)
    };
    hover = {
      text: day.accessibleName,
      ...usageWallTooltipPlacement(cellRect, tooltipSize, viewport)
    };
    await tick();
    if (!tooltipEl || hover?.text !== day.accessibleName) return;
    const measured = tooltipEl.getBoundingClientRect();
    hover = {
      text: day.accessibleName,
      ...usageWallTooltipPlacement(
        cellRect,
        { width: measured.width, height: measured.height },
        viewport
      )
    };
  }

  function hideTooltip(): void {
    hover = null;
  }
</script>

<section
  class="usage-contribution-wall"
  data-testid="usage-contribution-wall"
  aria-labelledby="usage-wall-heading"
  aria-busy={updating}
>
  {#if updating}
    <div class="panel-progress" role="status" data-testid="usage-wall-refresh-status">
      <span class="visually-hidden">{translate(locale, 'usageWallUpdating')}</span>
    </div>
  {/if}
  <div class="usage-wall-header">
    <h3 id="usage-wall-heading" data-testid="usage-wall-heading">{presentation.heading}</h3>
  </div>
  <div class="usage-wall-scroll">
    <div class="usage-wall-calendar" role="grid" aria-label={translate(locale, 'usageWallLabel')}>
      <span class="usage-wall-month-spacer" aria-hidden="true"></span>
      <div class="usage-wall-months" data-testid="usage-wall-months" aria-hidden="true">
        {#each weekIndexes as weekIndex (weekIndex)}
          <span>{monthByWeek.get(weekIndex) ?? ''}</span>
        {/each}
      </div>
      <div class="usage-wall-weekdays" aria-hidden="true">
        <span></span>
        <span>{presentation.weekdayLabels[0]}</span>
        <span></span>
        <span>{presentation.weekdayLabels[1]}</span>
        <span></span>
        <span>{presentation.weekdayLabels[2]}</span>
        <span></span>
      </div>
      <div class="usage-wall-weeks">
        {#each presentation.weeks as week, weekIndex (weekIndex)}
          <div class="usage-wall-week" role="row">
            {#each week.days as day, dayIndex (day?.date ?? `${weekIndex}-${dayIndex}`)}
              {#if day}
                <button
                  type="button"
                  class="usage-wall-cell"
                  role="gridcell"
                  data-level={day.level}
                  aria-label={day.accessibleName}
                  on:pointerenter={(event) => showTooltip(event, day)}
                  on:focus={(event) => showTooltip(event, day)}
                  on:pointerleave={hideTooltip}
                  on:blur={hideTooltip}
                ></button>
              {:else}
                <span class="usage-wall-cell usage-wall-cell-absent" aria-hidden="true"></span>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
  {#if hover}
    <div
      bind:this={tooltipEl}
      class="usage-wall-tooltip"
      data-testid="usage-wall-tooltip"
      role="tooltip"
      style={`left: ${hover.left}px; top: ${hover.top}px`}
    >
      {hover.text}
    </div>
  {/if}
  <div class="usage-wall-legend" data-testid="usage-wall-legend">
    <span>{presentation.lessLabel}</span>
    {#each presentation.legendLevels as level (level)}
      <span class="usage-wall-swatch" data-level={level}></span>
    {/each}
    <span>{presentation.moreLabel}</span>
  </div>
</section>

<style>
  .usage-contribution-wall {
    --wall-cell-size: 11px;
    --wall-cell-gap: 3px;
    position: relative;
    display: grid;
    gap: 12px;
    margin-bottom: 14px;
    padding: 16px 18px 14px;
    border: 1px solid var(--border-soft);
    border-radius: 18px;
    background: var(--surface-subtle);
  }

  .panel-progress {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .usage-wall-header h3 {
    margin: 0;
    color: var(--text-strong);
    font-size: 0.95rem;
    font-weight: 600;
  }

  .usage-wall-scroll {
    overflow-x: auto;
  }

  .usage-wall-calendar {
    position: relative;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 8px;
    min-width: max-content;
  }

  .usage-wall-months {
    display: flex;
    gap: var(--wall-cell-gap);
    color: var(--muted);
    font-size: 0.68rem;
    line-height: 1;
  }

  .usage-wall-months span {
    flex: 0 0 var(--wall-cell-size);
    width: var(--wall-cell-size);
    overflow: visible;
    white-space: nowrap;
  }

  .usage-wall-weekdays {
    display: grid;
    grid-template-rows: repeat(7, var(--wall-cell-size));
    gap: var(--wall-cell-gap);
    color: var(--muted);
    font-size: 0.68rem;
    line-height: var(--wall-cell-size);
  }

  .usage-wall-weeks {
    display: flex;
    flex: 0 0 auto;
    gap: var(--wall-cell-gap);
  }

  .usage-wall-week {
    display: grid;
    flex: 0 0 var(--wall-cell-size);
    width: var(--wall-cell-size);
    grid-template-rows: repeat(7, var(--wall-cell-size));
    gap: var(--wall-cell-gap);
  }

  .usage-wall-cell {
    width: var(--wall-cell-size);
    height: var(--wall-cell-size);
    flex: 0 0 var(--wall-cell-size);
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--text-strong) 8%, transparent);
    border-radius: 2px;
    background: var(--wall-level-0);
    outline: none;
  }

  .usage-wall-cell:focus-visible {
    box-shadow: 0 0 0 2px var(--focus);
  }

  .usage-wall-cell-absent {
    visibility: hidden;
    border-color: transparent;
    background: transparent;
  }

  .usage-wall-cell[data-level='1'] {
    background: var(--wall-level-1);
  }

  .usage-wall-cell[data-level='2'] {
    background: var(--wall-level-2);
  }

  .usage-wall-cell[data-level='3'] {
    background: var(--wall-level-3);
  }

  .usage-wall-cell[data-level='4'] {
    background: var(--wall-level-4);
  }

  .usage-wall-tooltip {
    position: fixed;
    z-index: 40;
    width: max-content;
    max-width: min(240px, calc(100vw - 16px));
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    box-shadow: var(--shadow-raised);
    color: var(--text-strong);
    font-size: 0.72rem;
    line-height: 1.35;
    pointer-events: none;
    backdrop-filter: blur(16px) saturate(1.2);
  }

  .usage-wall-legend {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    color: var(--muted);
    font-size: 0.68rem;
  }

  .usage-wall-swatch {
    width: var(--wall-cell-size);
    height: var(--wall-cell-size);
    flex: 0 0 var(--wall-cell-size);
    border: 1px solid color-mix(in srgb, var(--text-strong) 8%, transparent);
    border-radius: 2px;
    background: var(--wall-level-0);
  }

  .usage-wall-swatch[data-level='1'] {
    background: var(--wall-level-1);
  }

  .usage-wall-swatch[data-level='2'] {
    background: var(--wall-level-2);
  }

  .usage-wall-swatch[data-level='3'] {
    background: var(--wall-level-3);
  }

  .usage-wall-swatch[data-level='4'] {
    background: var(--wall-level-4);
  }
</style>
