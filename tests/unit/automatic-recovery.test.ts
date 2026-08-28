import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DoctorReport, UsageOverview } from '../../src/core/types.js';
import {
  automaticRecoverySignature,
  createAutomaticRecoveryController,
  isAutomaticallyManagedCategory
} from '../../src/lib/automatic-recovery.js';

const staleOverview = {
  providers: [
    {
      id: 'grok',
      freshness: { status: 'stale', lastSuccessAt: '2026-08-27T02:00:00.000Z' },
      health: { status: 'healthy', errorCode: null },
      billingDomains: []
    }
  ]
} as unknown as UsageOverview;

const freshOverview = {
  providers: [
    {
      id: 'grok',
      freshness: { status: 'fresh', lastSuccessAt: '2026-08-28T02:00:00.000Z' },
      health: { status: 'healthy', errorCode: null },
      billingDomains: []
    }
  ]
} as unknown as UsageOverview;

function overviewWithHealthError(errorCode: string): UsageOverview {
  return {
    providers: [
      {
        id: 'claude-code',
        freshness: { status: 'fresh', lastSuccessAt: '2026-08-28T02:00:00.000Z' },
        health: { status: 'degraded', errorCode },
        billingDomains: []
      }
    ]
  } as unknown as UsageOverview;
}

function overviewWithFreshness(
  status: 'fresh' | 'stale' | 'unavailable',
  errorCode: string | null = null
): UsageOverview {
  return {
    providers: [
      {
        id: 'claude-code',
        freshness: {
          status,
          lastSuccessAt: status === 'unavailable' ? null : '2026-08-28T02:00:00.000Z'
        },
        health: { status: errorCode ? 'degraded' : 'healthy', errorCode },
        billingDomains: []
      }
    ]
  } as unknown as UsageOverview;
}

describe('automatic recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes once per unchanged stale signature and rearms after fresh evidence', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const controller = createAutomaticRecoveryController(refresh);

    controller.schedule(staleOverview, null, false);
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);

    controller.schedule(staleOverview, null, false);
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);

    controller.schedule(freshOverview, null, false);
    controller.schedule(staleOverview, null, false);
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not schedule again when an in-flight refresh completes after disposal', async () => {
    vi.useFakeTimers();
    let finishRefresh: (() => void) | undefined;
    const refreshFinished = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const refresh = vi.fn(async () => {
      await refreshFinished;
      controller.schedule(staleOverview, staleDiagnostics, false);
    });
    const controller = createAutomaticRecoveryController(refresh);

    controller.schedule(staleOverview, staleDiagnostics, false);
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);

    controller.dispose();
    finishRefresh?.();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('automatically retries unavailable and timeout evidence without bypassing rate-limit backoff', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const controller = createAutomaticRecoveryController(refresh);

    controller.schedule(
      overviewWithHealthError('claude-subscription-quota-unavailable'),
      null,
      false
    );
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);

    controller.schedule(overviewWithHealthError('claude-usage-client-timeout'), null, false);
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(2);

    controller.schedule(overviewWithHealthError('claude-rate-limited'), null, false);
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(isAutomaticallyManagedCategory('rate-limited')).toBe(true);
    expect(isAutomaticallyManagedCategory('unauthorized')).toBe(false);
  });

  it('retries freshness-only unavailable evidence', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const controller = createAutomaticRecoveryController(refresh);

    controller.schedule(overviewWithFreshness('unavailable'), null, false);
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('gives rate limits precedence over stale evidence in the same provider scope', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const controller = createAutomaticRecoveryController(refresh);

    controller.schedule(overviewWithFreshness('stale', 'claude-rate-limited'), null, false);
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps automatic recovery isolated across sibling billing domains', () => {
    const signature = automaticRecoverySignature(
      grokSiblingDomainOverview,
      conflictingXaiDiagnostics
    );

    expect(signature).toContain('grok-build-subscription');
    expect(signature).not.toContain('xai-api');
  });
});

const staleDiagnostics = {
  connectors: [
    {
      id: 'grok',
      providerId: 'grok',
      billingDomainId: 'grok-build-subscription',
      category: 'stale',
      lastSuccessAt: null
    }
  ]
} as unknown as DoctorReport;

const conflictingXaiDiagnostics = {
  connectors: [
    {
      id: 'grok',
      providerId: 'grok',
      billingDomainId: 'xai-api',
      category: 'timeout',
      lastSuccessAt: '2026-08-27T02:00:00.000Z'
    }
  ]
} as unknown as DoctorReport;

const grokSiblingDomainOverview = {
  providers: [
    {
      id: 'grok',
      summaryBillingDomainId: 'grok-build-subscription',
      freshness: { status: 'fresh', lastSuccessAt: '2026-08-28T02:00:00.000Z' },
      health: { status: 'healthy', errorCode: null },
      billingDomains: [
        {
          id: 'grok-build-subscription',
          freshness: { status: 'stale', lastSuccessAt: '2026-08-27T02:00:00.000Z' },
          health: { status: 'degraded', errorCode: 'grok-client-timeout' }
        },
        {
          id: 'xai-api',
          freshness: { status: 'stale', lastSuccessAt: '2026-08-27T02:00:00.000Z' },
          health: { status: 'degraded', errorCode: 'xai-api-rate-limited' }
        }
      ]
    }
  ]
} as unknown as UsageOverview;
