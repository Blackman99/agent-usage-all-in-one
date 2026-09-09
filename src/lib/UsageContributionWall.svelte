<script lang="ts">
  import type { UsageWall } from '$core/types.js';
  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';
  import { buildUsageWallPresentation } from '$lib/usage-contribution-wall.js';

  export let wall: UsageWall;
  export let locale: Locale = detectLocale('');
  export let formatTokens: (value: number) => string;

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
>
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
    display: grid;
    gap: 12px;
    margin-bottom: 14px;
    padding: 16px 18px 14px;
    border: 1px solid var(--border-soft);
    border-radius: 18px;
    background: var(--surface-subtle);
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
    grid-template-rows: repeat(7, 11px);
    gap: 3px;
    color: var(--muted);
    font-size: 0.68rem;
    line-height: 11px;
  }

  .usage-wall-weeks {
    display: flex;
    gap: 3px;
  }

  .usage-wall-week {
    display: grid;
    grid-template-rows: repeat(7, 11px);
    gap: 3px;
  }

  .usage-wall-cell {
    width: 11px;
    height: 11px;
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
    width: 11px;
    height: 11px;
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
