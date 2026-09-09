import type { Locale, MessageKey } from '$lib/i18n.js';
import type { UsageWall, UsageWallDay } from '$core/types.js';

export type { UsageWallDay };

export interface UsageWallCell {
  date: string;
  recordedTokens: number;
  level: 0 | 1 | 2 | 3 | 4;
  accessibleName: string;
}

export interface UsageWallWeek {
  days: Array<UsageWallCell | null>;
}

export interface UsageWallMonthLabel {
  weekIndex: number;
  label: string;
}

export interface UsageWallPresentation {
  heading: string;
  weekdayLabels: [string, string, string];
  monthLabels: UsageWallMonthLabel[];
  weeks: UsageWallWeek[];
  legendLevels: Array<0 | 1 | 2 | 3 | 4>;
  lessLabel: string;
  moreLabel: string;
}

type TranslateValues = (key: MessageKey, values?: Record<string, string>) => string;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function buildUsageWallPresentation(
  wall: UsageWall,
  locale: Locale,
  formatTokens: (value: number) => string,
  translate: TranslateValues
): UsageWallPresentation {
  const dayByDate = new Map(wall.days.map((day) => [day.date, day]));
  const weeks: UsageWallWeek[] = [];
  const firstSunday = addUtcDays(wall.start, -weekdayIndex(wall.start));
  const lastSunday = addUtcDays(wall.end, -weekdayIndex(wall.end));

  for (let weekStart = firstSunday; weekStart <= lastSunday; weekStart = addUtcDays(weekStart, 7)) {
    weeks.push({
      days: Array.from({ length: 7 }, (_, weekday) => {
        const date = addUtcDays(weekStart, weekday);
        if (date < wall.start || date > wall.end) return null;
        const day = dayByDate.get(date) ?? emptyDay(date);
        return {
          date,
          recordedTokens: day.recordedTokens,
          level: day.level,
          accessibleName: dayAccessibleName(day, locale, formatTokens, translate)
        };
      })
    });
  }

  const seenMonths = new Set<string>();
  const monthLabels: UsageWallMonthLabel[] = [];
  weeks.forEach((week, weekIndex) => {
    const firstDay = week.days.find((day) => day !== null);
    if (!firstDay) return;
    const monthKey = firstDay.date.slice(0, 7);
    if (seenMonths.has(monthKey)) return;
    seenMonths.add(monthKey);
    monthLabels.push({
      weekIndex,
      label: monthLabel(firstDay.date, locale)
    });
  });

  return {
    heading: translate('usageWallHeading', { tokens: formatTokens(wall.recordedTokens) }),
    weekdayLabels: [
      translate('usageWallWeekdayMon'),
      translate('usageWallWeekdayWed'),
      translate('usageWallWeekdayFri')
    ],
    monthLabels,
    weeks,
    legendLevels: [0, 1, 2, 3, 4],
    lessLabel: translate('usageWallLess'),
    moreLabel: translate('usageWallMore')
  };
}

function emptyDay(date: string): UsageWallDay {
  return { date, recordedTokens: 0, level: 0, providers: [] };
}

function dayAccessibleName(
  day: UsageWallDay,
  locale: Locale,
  formatTokens: (value: number) => string,
  translate: TranslateValues
): string {
  const date = formatWallDate(day.date, locale);
  if (day.recordedTokens <= 0) return translate('usageWallEmptyDay', { date });
  const summary = translate('usageWallUsedDay', {
    tokens: formatTokens(day.recordedTokens),
    date
  });
  const providers = day.providers.map((provider) => provider.displayName).filter(Boolean);
  return providers.length > 0 ? `${summary} · ${providers.join(', ')}` : summary;
}

function formatWallDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function monthLabel(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function weekdayIndex(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function addUtcDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}
