import type { DataAuthority, QuotaBucket } from '$core/types.js';

// The product question follows CLIProxyAPI Management Center's MIT-licensed
// quota timeline, while this projection is implemented for Agent Usage's
// normalized Provider model and ECharts renderer.

export type QuotaTimelineMode = 'weekly' | 'session';
export type QuotaTimelineWindowState = 'elapsed' | 'current' | 'upcoming';

export interface QuotaTimelineProvider {
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  observedAt: string | null;
  quotaBuckets: QuotaBucket[];
}

export interface QuotaTimelineLane {
  id: string;
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  selectedLabel: string;
  durationMinutes: number;
  usedPercent: number | null;
  resetsAt: string;
  authority: DataAuthority;
  observedAt: string | null;
}

export interface QuotaTimelineWindow {
  laneId: string;
  providerId: string;
  providerDisplayName: string;
  billingDomainDisplayName: string;
  label: string;
  startMs: number;
  endMs: number;
  visibleStartMs: number;
  visibleEndMs: number;
  state: QuotaTimelineWindowState;
  usedPercent: number | null;
  authority: DataAuthority;
  observedAt: string | null;
}

export interface QuotaTimeline {
  mode: QuotaTimelineMode;
  range: { startMs: number; endMs: number };
  lanes: QuotaTimelineLane[];
  windows: QuotaTimelineWindow[];
  nowMs: number;
}

const MINUTE_MS = 60_000;
const SESSION_MINUTES = 300;
const WEEKLY_MINIMUM_MINUTES = 24 * 60;
const WEEKLY_MAXIMUM_MINUTES = 14 * 24 * 60;

export function quotaWindowDurationMinutes(
  bucket: Pick<QuotaBucket, 'label' | 'windowDurationMinutes'>
): number | null {
  if (
    typeof bucket.windowDurationMinutes === 'number' &&
    Number.isFinite(bucket.windowDurationMinutes) &&
    bucket.windowDurationMinutes > 0
  ) {
    return bucket.windowDurationMinutes;
  }

  const label = bucket.label.trim().toLowerCase();
  if (/\b5[- ]?hours?\b/.test(label)) return SESSION_MINUTES;
  if (/\bweeks?\b|\bweekly\b/.test(label)) return 7 * 24 * 60;
  if (/\bmonths?\b|\bmonthly\b/.test(label)) return 30 * 24 * 60;

  const duration = label.match(/\b(\d+(?:\.\d+)?)\s*(minutes?|hours?|days?)\b/);
  if (!duration) return null;
  const value = Number(duration[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (duration[2].startsWith('day')) return value * 24 * 60;
  if (duration[2].startsWith('hour')) return value * 60;
  return value;
}

export function buildQuotaTimeline(
  providers: QuotaTimelineProvider[],
  mode: QuotaTimelineMode,
  offset: number,
  nowMs: number,
  timeZone = 'UTC'
): QuotaTimeline {
  const range = timelineRange(mode, offset, nowMs, timeZone);
  const lanes = providers.flatMap((provider) => {
    const selected = selectBucket(provider, mode);
    if (!selected || !selected.bucket.resetsAt) return [];
    return [
      {
        id: `${provider.providerId}:${provider.billingDomainId}`,
        providerId: provider.providerId,
        providerDisplayName: provider.providerDisplayName,
        billingDomainId: provider.billingDomainId,
        billingDomainDisplayName: provider.billingDomainDisplayName,
        selectedLabel: selected.bucket.label,
        durationMinutes: selected.durationMinutes,
        usedPercent: selected.bucket.usedPercent,
        resetsAt: selected.bucket.resetsAt,
        authority: selected.bucket.authority,
        observedAt: selected.bucket.observedAt ?? provider.observedAt
      }
    ];
  });

  return {
    mode,
    range,
    lanes,
    windows: lanes.flatMap((lane) => projectLane(lane, range, nowMs)),
    nowMs
  };
}

export function timelineRange(
  mode: QuotaTimelineMode,
  offset: number,
  nowMs: number,
  timeZone = 'UTC'
): { startMs: number; endMs: number } {
  const localDate = datePartsInTimeZone(nowMs, timeZone);
  if (mode === 'session') {
    const startDate = addCalendarDays(localDate, offset);
    const endDate = addCalendarDays(startDate, 3);
    return {
      startMs: zonedMidnight(startDate, timeZone),
      endMs: zonedMidnight(endDate, timeZone)
    };
  }
  const localDay = new Date(
    Date.UTC(localDate.year, localDate.month - 1, localDate.day)
  ).getUTCDay();
  const startDate = addCalendarDays(localDate, -localDay + offset * 7);
  const endDate = addCalendarDays(startDate, 14);
  return {
    startMs: zonedMidnight(startDate, timeZone),
    endMs: zonedMidnight(endDate, timeZone)
  };
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function datePartsInTimeZone(value: number, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

function addCalendarDays(value: CalendarDate, days: number): CalendarDate {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function zonedMidnight(value: CalendarDate, timeZone: string): number {
  const desiredUtc = Date.UTC(value.year, value.month - 1, value.day);
  let result = desiredUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const represented = datePartsWithTime(result, timeZone);
    const representedUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second
    );
    result += desiredUtc - representedUtc;
  }
  return result;
}

function datePartsWithTime(value: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second')
  };
}

function selectBucket(
  provider: QuotaTimelineProvider,
  mode: QuotaTimelineMode
): { bucket: QuotaBucket; durationMinutes: number } | null {
  const candidates = provider.quotaBuckets.flatMap((bucket) => {
    const durationMinutes = quotaWindowDurationMinutes(bucket);
    const resetMs = bucket.resetsAt ? Date.parse(bucket.resetsAt) : Number.NaN;
    if (!durationMinutes || !Number.isFinite(resetMs)) return [];
    if (mode === 'session' && durationMinutes !== SESSION_MINUTES) return [];
    if (
      mode === 'weekly' &&
      (durationMinutes < WEEKLY_MINIMUM_MINUTES || durationMinutes > WEEKLY_MAXIMUM_MINUTES)
    ) {
      return [];
    }
    return [{ bucket, durationMinutes }];
  });

  return (
    candidates.sort((left, right) => {
      const byDuration = right.durationMinutes - left.durationMinutes;
      if (byDuration !== 0) return byDuration;
      const byScope = bucketScopePriority(left.bucket) - bucketScopePriority(right.bucket);
      if (byScope !== 0) return byScope;
      return left.bucket.id.localeCompare(right.bucket.id);
    })[0] ?? null
  );
}

function bucketScopePriority(bucket: QuotaBucket): number {
  const label = bucket.label.toLowerCase();
  if (/all models|^week$|^weekly limit$/.test(label)) return 0;
  if (/fable|spark|model/.test(label)) return 2;
  return 1;
}

function projectLane(
  lane: QuotaTimelineLane,
  range: { startMs: number; endMs: number },
  nowMs: number
): QuotaTimelineWindow[] {
  const anchorMs = Date.parse(lane.resetsAt);
  const periodMs = lane.durationMinutes * MINUTE_MS;
  if (!Number.isFinite(anchorMs) || !(periodMs > 0) || range.endMs <= range.startMs) return [];

  const projectedCount = Math.ceil((range.endMs - range.startMs) / periodMs) + 2;
  if (projectedCount > 1_000) return [];

  let endMs = anchorMs + Math.ceil((range.startMs - anchorMs) / periodMs) * periodMs;
  const windows: QuotaTimelineWindow[] = [];
  while (endMs - periodMs < range.endMs) {
    const startMs = endMs - periodMs;
    const visibleStartMs = Math.max(startMs, range.startMs);
    const visibleEndMs = Math.min(endMs, range.endMs);
    if (visibleEndMs > visibleStartMs) {
      const state: QuotaTimelineWindowState =
        endMs <= nowMs ? 'elapsed' : startMs <= nowMs ? 'current' : 'upcoming';
      const isObservedWindow = state === 'current' && endMs === anchorMs;
      windows.push({
        laneId: lane.id,
        providerId: lane.providerId,
        providerDisplayName: lane.providerDisplayName,
        billingDomainDisplayName: lane.billingDomainDisplayName,
        label: lane.selectedLabel,
        startMs,
        endMs,
        visibleStartMs,
        visibleEndMs,
        state,
        usedPercent: isObservedWindow ? lane.usedPercent : null,
        authority: isObservedWindow ? lane.authority : 'estimate',
        observedAt: lane.observedAt
      });
    }
    endMs += periodMs;
  }
  return windows;
}
