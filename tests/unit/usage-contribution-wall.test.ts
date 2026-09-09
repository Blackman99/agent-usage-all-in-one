import { describe, expect, it } from 'vitest';

import { translate } from '../../src/lib/i18n.js';
import {
  buildUsageWallPresentation,
  usageWallTooltipPlacement,
  type UsageWallDay
} from '../../src/lib/usage-contribution-wall.js';

const NOW = '2026-08-28T02:00:00.000Z';
const TIME_ZONE = 'UTC';

function emptyDays(): UsageWallDay[] {
  const days: UsageWallDay[] = [];
  const start = Date.UTC(2025, 7, 28);
  const end = Date.UTC(2026, 7, 28);
  for (let time = start; time <= end; time += 24 * 60 * 60 * 1000) {
    const date = new Date(time).toISOString().slice(0, 10);
    days.push({
      date,
      recordedTokens: 0,
      level: 0,
      providers: []
    });
  }
  return days;
}

describe('usage contribution wall presentation', () => {
  it('builds Sunday-start columns, omits days before the year start, and names empty days', () => {
    const presentation = buildUsageWallPresentation(
      {
        timeZone: TIME_ZONE,
        start: '2025-08-28',
        end: '2026-08-28',
        recordedTokens: 0,
        days: emptyDays()
      },
      'en',
      (value) => String(value),
      (key, values) => {
        const template = translate('en', key);
        return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
      }
    );

    expect(presentation.weekdayLabels).toEqual(['Mon', 'Wed', 'Fri']);
    expect(presentation.weeks[0]?.days.map((day) => day?.date ?? null)).toEqual([
      null,
      null,
      null,
      null,
      '2025-08-28',
      '2025-08-29',
      '2025-08-30'
    ]);
    expect(presentation.weeks.at(-1)?.days.map((day) => day?.date ?? null)).toEqual([
      '2026-08-23',
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      null
    ]);
    expect(presentation.weeks).toHaveLength(53);
    expect(presentation.monthLabels.map((label) => label.label)).toEqual([
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug'
    ]);
    expect(presentation.monthLabels[0]?.weekIndex).toBe(0);
    expect(presentation.monthLabels.at(-1)?.weekIndex).toBeGreaterThan(40);
    expect(presentation.heading).toBe('0 recorded Tokens in the last year');
    expect(presentation.lessLabel).toBe('Less');
    expect(presentation.moreLabel).toBe('More');
    expect(presentation.legendLevels).toEqual([0, 1, 2, 3, 4]);

    const firstDay = presentation.weeks[0]?.days[4];
    expect(firstDay).toMatchObject({
      date: '2025-08-28',
      level: 0,
      accessibleName: 'No usage on Aug 28, 2025'
    });
  });

  it('uses Simplified Chinese weekday labels and empty-day copy without changing Sunday-start geometry', () => {
    const presentation = buildUsageWallPresentation(
      {
        timeZone: TIME_ZONE,
        start: '2025-08-28',
        end: '2026-08-28',
        recordedTokens: 0,
        days: emptyDays()
      },
      'zh-CN',
      (value) => String(value),
      (key, values) => {
        const template = translate('zh-CN', key);
        return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
      }
    );

    expect(presentation.weekdayLabels).toEqual(['一', '三', '五']);
    expect(presentation.weeks[0]?.days[4]?.accessibleName).toBe('2025年8月28日无用量');
    expect(presentation.heading).toContain('过去一年');
  });

  it('lists headline Providers on a used-day tooltip and keeps compact Token totals in the heading', () => {
    const presentation = buildUsageWallPresentation(
      {
        timeZone: TIME_ZONE,
        start: '2025-08-28',
        end: '2026-08-28',
        recordedTokens: 12_400,
        days: emptyDays().map((day) =>
          day.date === '2026-08-28'
            ? {
                date: '2026-08-28',
                recordedTokens: 12_400,
                level: 4,
                providers: [{ providerId: 'codex', displayName: 'Codex' }]
              }
            : day
        )
      },
      'en',
      (value) => (value >= 10_000 ? '12.4K' : String(value)),
      (key, values) => {
        const template = translate('en', key);
        return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
      }
    );

    expect(presentation.heading).toBe('12.4K recorded Tokens in the last year');
    const today = presentation.weeks.at(-1)?.days[5];
    expect(today).toMatchObject({
      date: '2026-08-28',
      level: 4,
      accessibleName: '12.4K recorded Tokens on Aug 28, 2026 · Codex'
    });
  });

  it('keeps the hover tooltip inside the viewport and flips below a top-row cell', () => {
    expect(
      usageWallTooltipPlacement(
        { left: 800, top: 120, width: 11, height: 11 },
        { width: 240, height: 48 },
        { width: 900, height: 600 }
      )
    ).toEqual({ left: 652, top: 64, placement: 'above' });

    expect(
      usageWallTooltipPlacement(
        { left: 40, top: 20, width: 11, height: 11 },
        { width: 180, height: 40 },
        { width: 400, height: 300 }
      )
    ).toEqual({ left: 8, top: 39, placement: 'below' });
  });
});
