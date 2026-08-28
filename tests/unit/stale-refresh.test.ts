import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DoctorReport, UsageOverview } from '../../src/core/types.js';
import { createStaleRefreshController } from '../../src/lib/stale-refresh.js';

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

describe('stale refresh controller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes once per unchanged stale signature and rearms after fresh evidence', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const controller = createStaleRefreshController(refresh);

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
    const controller = createStaleRefreshController(refresh);

    controller.schedule(staleOverview, staleDiagnostics, false);
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);

    controller.dispose();
    finishRefresh?.();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    expect(refresh).toHaveBeenCalledTimes(1);
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
