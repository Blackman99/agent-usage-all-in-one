import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import type {
  Connector,
  ConnectorSnapshot,
  LocalNotification,
  LocalNotifier,
  StartAtLoginManager
} from '$core/types.js';
import { CollectionScheduler } from '$server/collection-scheduler.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('monitoring', () => {
  it('coalesces overlapping refreshes and persists connector backoff across restart', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-monitoring-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    let now = new Date('2026-08-28T02:00:00.000Z');
    let attempts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const connector: Connector = {
      id: 'slow',
      displayName: 'Slow',
      async collect() {
        attempts += 1;
        await gate;
        throw new Error('fixture failure');
      }
    };
    const first = new UsageApplication({
      repository,
      connectors: [connector],
      clock: () => now,
      connectorPolicies: { slow: { minimumIntervalMs: 0, timeoutMs: 5_000 } }
    });

    const refreshA = first.refresh();
    const refreshB = first.refresh();
    release();
    await Promise.all([refreshA, refreshB]);
    expect(attempts).toBe(1);
    expect(await first.getMonitoringStatus()).toMatchObject({
      connectors: [{ id: 'slow', failureCount: 1, outcome: 'failure' }]
    });

    const second = new UsageApplication({
      repository,
      connectors: [connector],
      clock: () => now,
      connectorPolicies: { slow: { minimumIntervalMs: 0, timeoutMs: 5_000 } }
    });
    await second.refresh();
    expect(attempts).toBe(1);
    now = new Date('2026-08-28T02:01:01.000Z');
    await second.refresh();
    expect(attempts).toBe(2);
    repository.close();
  });

  it('sends transition-only low quota and reset notifications when explicitly enabled', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-notifications-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const notifier = new RecordingNotifier();
    const startAtLogin = new RecordingStartAtLoginManager();
    let now = new Date('2026-08-28T00:00:00.000Z');
    let used = 70;
    const connector: Connector = {
      id: 'quota',
      async collect() {
        return quotaSnapshot(now, used);
      }
    };
    const application = new UsageApplication({
      repository,
      connectors: [connector],
      clock: () => now,
      notifier,
      startAtLoginManager: startAtLogin,
      connectorPolicies: { quota: { minimumIntervalMs: 0, timeoutMs: 5_000 } }
    });
    expect(await application.getMonitoringSettings()).toEqual({
      backgroundCollectionEnabled: true,
      intervalMinutes: 5,
      notificationsEnabled: false,
      startAtLogin: false
    });
    await application.updateMonitoringSettings({ notificationsEnabled: true, startAtLogin: true });
    expect(startAtLogin.enabled).toBe(true);

    await application.refresh();
    now = new Date('2026-08-28T00:05:00.000Z');
    used = 82;
    await application.refresh();
    now = new Date('2026-08-28T00:10:00.000Z');
    await application.refresh();
    now = new Date('2026-08-28T00:15:00.000Z');
    used = 96;
    await application.refresh();
    now = new Date('2026-08-28T00:20:00.000Z');
    used = 5;
    await application.refresh();

    expect(notifier.events.map((event) => event.kind)).toEqual([
      'low-quota-20',
      'low-quota-5',
      'quota-reset'
    ]);
    expect(notifier.events[0]).toMatchObject({ providerId: 'quota', bucketId: 'five-hour' });
    repository.close();
  });

  it('runs the scheduler only when background collection is enabled', async () => {
    let refreshes = 0;
    let enabled = false;
    const scheduler = new CollectionScheduler({
      application: {
        async refresh() {
          refreshes += 1;
        },
        async getMonitoringSettings() {
          return {
            backgroundCollectionEnabled: enabled,
            intervalMinutes: 5,
            notificationsEnabled: false,
            startAtLogin: false
          };
        }
      },
      intervalMs: 5 * 60 * 1000
    });

    await scheduler.tick();
    expect(refreshes).toBe(0);
    enabled = true;
    await scheduler.tick();
    expect(refreshes).toBe(1);
  });

  it('times out stuck connectors and deduplicates a prolonged failure episode', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-timeout-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveMonitoringSettings({
      backgroundCollectionEnabled: true,
      intervalMinutes: 5,
      notificationsEnabled: true,
      startAtLogin: false
    });
    const notifier = new RecordingNotifier();
    let now = new Date('2026-08-28T00:00:00.000Z');
    let stuck = true;
    const connector: Connector = {
      id: 'timeout',
      displayName: 'Timeout Agent',
      async collect() {
        if (stuck) return await new Promise<ConnectorSnapshot>(() => undefined);
        throw new Error('fast failure');
      }
    };
    const application = new UsageApplication({
      repository,
      connectors: [connector],
      clock: () => now,
      notifier,
      connectorPolicies: { timeout: { minimumIntervalMs: 0, timeoutMs: 5 } }
    });

    await application.refresh();
    expect((await application.getMonitoringStatus()).connectors[0]).toMatchObject({
      failureCount: 1,
      outcome: 'failure'
    });
    stuck = false;
    now = new Date('2026-08-28T00:01:01.000Z');
    await application.refresh();
    now = new Date('2026-08-28T00:03:02.000Z');
    await application.refresh();
    now = new Date('2026-08-28T00:07:03.000Z');
    await application.refresh();

    expect(notifier.events.filter((event) => event.kind === 'connector-failure')).toHaveLength(1);
    repository.close();
  });
});

class RecordingNotifier implements LocalNotifier {
  readonly events: LocalNotification[] = [];
  async notify(event: LocalNotification): Promise<void> {
    this.events.push(event);
  }
}

class RecordingStartAtLoginManager implements StartAtLoginManager {
  enabled = false;
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
  }
  async isEnabled(): Promise<boolean> {
    return this.enabled;
  }
}

function quotaSnapshot(now: Date, usedPercent: number): ConnectorSnapshot {
  return {
    provider: { id: 'quota', displayName: 'Quota Agent' },
    billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
    quotaBuckets: [
      {
        id: 'five-hour',
        billingDomainId: 'subscription',
        label: '5 hour',
        usedPercent,
        resetsAt: '2026-08-28T05:00:00.000Z',
        authority: 'official-account'
      }
    ],
    usage: [],
    costs: [],
    observedAt: now.toISOString()
  };
}
