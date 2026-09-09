<script lang="ts">
  import type { UsageWall } from '$core/types.js';
  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';
  import { buildUsageWallPresentation } from '$lib/usage-contribution-wall.js';

  export let wall: UsageWall;
  export let locale: Locale = detectLocale('');
  export let formatTokens: (value: number) => string;
  export let updating = false;

  function interpolate(key: MessageKey, values?: Record<string, string>): string {
    return translate(locale, key).replace(
      /\{(\w+)\}/g,
      (_, name: string) => values?.[name] ?? `{${name}}`
    );
  }

  $: presentation = buildUsageWallPresentation(wall, locale, formatTokens, interpolate);
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
                  title={day.accessibleName}
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
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px;
    min-width: max-content;
  }

  .usage-wall-weekdays {
    display: grid;
    grid-template-rows: repeat(7, var(--wall-cell-size));
    gap: 3px;
    color: var(--muted);
    font-size: 0.68rem;
    line-height: var(--wall-cell-size);
  }

  .usage-wall-weeks {
    display: flex;
    flex: 0 0 auto;
    gap: 3px;
  }

  .usage-wall-week {
    display: grid;
    flex: 0 0 var(--wall-cell-size);
    width: var(--wall-cell-size);
    grid-template-rows: repeat(7, var(--wall-cell-size));
    gap: 3px;
  }

  .usage-wall-cell {
    width: var(--wall-cell-size);
    height: var(--wall-cell-size);
    flex: 0 0 var(--wall-cell-size);
    padding: 0;
    border: 0;
    border-radius: 2px;
    background: var(--wall-level-0);
  }

  .usage-wall-cell-absent {
    visibility: hidden;
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
