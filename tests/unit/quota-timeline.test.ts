import { describe, expect, it } from 'vitest';

import {
  buildQuotaTimeline,
  quotaWindowDurationMinutes,
  type QuotaTimelineProvider
} from '../../src/lib/quota-timeline.js';

const now = Date.parse('2026-08-29T12:00:00.000Z');

describe('quota timeline', () => {
  it('uses source duration metadata and parses legacy provider-native labels', () => {
    expect(quotaWindowDurationMinutes({ windowDurationMinutes: 300, label: 'Future label' })).toBe(
      300
    );
    expect(quotaWindowDurationMinutes({ label: '5 hour' })).toBe(300);
    expect(quotaWindowDurationMinutes({ label: 'Week · All models' })).toBe(10_080);
    expect(quotaWindowDurationMinutes({ label: '14 days' })).toBe(20_160);
    expect(quotaWindowDurationMinutes({ label: 'Unknown allowance' })).toBeNull();
  });

  it('prefers account-wide weekly windows and projects elapsed, current, and upcoming periods', () => {
    const timeline = buildQuotaTimeline(providers, 'weekly', 0, now, 'Asia/Shanghai');

    expect(timeline.range).toEqual({
      startMs: Date.parse('2026-08-22T16:00:00.000Z'),
      endMs: Date.parse('2026-09-05T16:00:00.000Z')
    });
    expect(timeline.lanes.map((lane) => lane.providerId)).toEqual([
      'codex',
      'claude-code',
      'opencode-go',
      'grok'
    ]);
    expect(timeline.lanes[0]).toMatchObject({
      selectedLabel: 'Week',
      usedPercent: 40,
      authority: 'official-account',
      observedAt: '2026-08-29T12:00:00.000Z'
    });
    expect(timeline.windows.filter((window) => window.laneId === 'codex:subscription')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'elapsed', startMs: Date.parse('2026-08-18T00:00:00Z') }),
        expect.objectContaining({
          state: 'current',
          startMs: Date.parse('2026-08-25T00:00:00Z'),
          endMs: Date.parse('2026-09-01T00:00:00Z'),
          usedPercent: 40,
          authority: 'official-account'
        }),
        expect.objectContaining({
          state: 'upcoming',
          endMs: Date.parse('2026-09-08T00:00:00Z'),
          authority: 'estimate'
        })
      ])
    );
  });

  it('shows only real five-hour windows and never invents one for Grok', () => {
    const timeline = buildQuotaTimeline(providers, 'session', 0, now);

    expect(timeline.lanes.map((lane) => lane.providerId)).toEqual([
      'codex',
      'claude-code',
      'opencode-go'
    ]);
    expect(timeline.lanes.some((lane) => lane.providerId === 'grok')).toBe(false);
    expect(timeline.lanes.every((lane) => lane.durationMinutes === 300)).toBe(true);
    expect(
      timeline.windows.find(
        (window) =>
          window.laneId === 'codex:subscription' &&
          window.endMs === Date.parse('2026-08-29T15:00:00Z')
      )
    ).toMatchObject({ state: 'current', usedPercent: 20 });
    expect(
      timeline.windows
        .filter((window) => window.laneId === 'codex:subscription' && window.state === 'upcoming')
        .every((window) => window.usedPercent === null)
    ).toBe(true);
  });

  it('keeps separate billing domains as distinct provider lanes', () => {
    const xaiDomain: QuotaTimelineProvider = {
      ...providers[3],
      billingDomainId: 'xai-api',
      billingDomainDisplayName: 'xAI API',
      quotaBuckets: [bucket('xai:weekly', 'Weekly limit', 15, 10_080, '2026-09-01T00:00:00.000Z')]
    };

    const timeline = buildQuotaTimeline([providers[3], xaiDomain], 'weekly', 0, now);

    expect(timeline.lanes.map((lane) => lane.id)).toEqual([
      'grok:grok-build-subscription',
      'grok:xai-api'
    ]);
    expect(timeline.lanes.map((lane) => lane.billingDomainDisplayName)).toEqual([
      'Build / SuperGrok',
      'xAI API'
    ]);
  });
});

const providers: QuotaTimelineProvider[] = [
  {
    providerId: 'codex',
    providerDisplayName: 'Codex',
    billingDomainId: 'subscription',
    billingDomainDisplayName: 'Subscription',
    observedAt: '2026-08-29T12:00:00.000Z',
    quotaBuckets: [
      bucket('codex:primary', '5 hour', 20, 300, '2026-08-29T15:00:00.000Z'),
      bucket('codex:secondary', 'Week', 40, 10_080, '2026-09-01T00:00:00.000Z'),
      bucket(
        'spark:secondary',
        'GPT-5.3-Codex-Spark · Week',
        70,
        10_080,
        '2026-09-02T00:00:00.000Z'
      )
    ]
  },
  {
    providerId: 'claude-code',
    providerDisplayName: 'Claude Code',
    billingDomainId: 'subscription',
    billingDomainDisplayName: 'Subscription',
    observedAt: '2026-08-29T12:00:00.000Z',
    quotaBuckets: [
      bucket('five-hour', '5 hour', 10, 300, '2026-08-29T14:00:00.000Z'),
      bucket('week-all', 'Week · All models', 35, 10_080, '2026-09-01T00:00:00.000Z'),
      bucket('week-fable', 'Week · Fable only', 80, 10_080, '2026-09-01T00:00:00.000Z')
    ]
  },
  {
    providerId: 'opencode-go',
    providerDisplayName: 'OpenCode Go',
    billingDomainId: 'go-subscription',
    billingDomainDisplayName: 'OpenCode Go',
    observedAt: '2026-08-29T12:00:00.000Z',
    quotaBuckets: [
      bucket('rolling', '5 hour', 5, 300, '2026-08-29T13:00:00.000Z'),
      bucket('weekly', 'Week', 50, 10_080, '2026-09-01T00:00:00.000Z'),
      bucket('monthly', 'Month', 60, 43_200, '2026-09-20T00:00:00.000Z')
    ]
  },
  {
    providerId: 'grok',
    providerDisplayName: 'Grok',
    billingDomainId: 'grok-build-subscription',
    billingDomainDisplayName: 'Build / SuperGrok',
    observedAt: '2026-08-29T12:00:00.000Z',
    quotaBuckets: [
      bucket('grok-build:weekly', 'Weekly limit', 65, 10_080, '2026-09-01T00:00:00.000Z')
    ]
  }
];

function bucket(
  id: string,
  label: string,
  usedPercent: number,
  windowDurationMinutes: number,
  resetsAt: string
) {
  return {
    id,
    billingDomainId: '',
    label,
    usedPercent,
    windowDurationMinutes,
    resetsAt,
    authority: 'official-account' as const
  };
}
