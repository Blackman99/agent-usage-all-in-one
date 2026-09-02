import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorSnapshot, QuotaBucket } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true }))
  );
});

describe('quota bucket lifecycle', () => {
  it('retires a window a collection stopped reporting instead of keeping it beside its replacement', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-quota-retire-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));

    repository.saveSnapshot(
      snapshot('2026-09-02T11:00:00.000Z', [
        bucket('derived-5h', '5 hour', 61, 'local-observation'),
        bucket('derived-weekly', 'Week', 61, 'local-observation')
      ])
    );
    repository.saveSnapshot(
      snapshot('2026-09-02T11:30:00.000Z', [
        bucket('official-5h', 'Claude / GPT · 5 hour', 53, 'official-client'),
        bucket('official-weekly', 'Claude / GPT · Week', 18, 'official-client')
      ])
    );

    const domain = repository
      .getOverview(NOW)
      .providers.find((provider) => provider.id === 'antigravity')!.billingDomains[0];

    expect(domain.quotaBuckets.map((entry) => entry.id)).toEqual([
      'official-5h',
      'official-weekly'
    ]);

    // A collection that reports no quota at all leaves the last known windows in
    // place, so a source that is briefly unreadable does not blank the card.
    repository.saveSnapshot(snapshot('2026-09-02T11:45:00.000Z', []));
    expect(
      repository
        .getOverview(NOW)
        .providers.find((provider) => provider.id === 'antigravity')!
        .billingDomains[0].quotaBuckets.map((entry) => entry.id)
    ).toEqual(['official-5h', 'official-weekly']);

    repository.close();
  });

  it('preserves the Antigravity windows alongside official client buckets', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-quota-derived-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');

    const legacyWriter = new SqliteUsageRepository(databasePath);
    legacyWriter.saveSnapshot(
      snapshot('2026-09-02T11:00:00.000Z', [
        bucket('official-weekly', 'Claude / GPT · Week', 18, 'official-client'),
        bucket('gemini-5h', '5 hour', 0, 'local-observation'),
        bucket('gemini-weekly', 'Week', 61, 'local-observation')
      ])
    );
    legacyWriter.close();

    const migrated = new SqliteUsageRepository(databasePath);
    const domain = migrated
      .getOverview(NOW)
      .providers.find((provider) => provider.id === 'antigravity')!.billingDomains[0];

    expect(domain.quotaBuckets.map((entry) => entry.id).sort()).toEqual([
      'gemini-5h',
      'gemini-weekly',
      'official-weekly'
    ].sort());
    migrated.close();
  });
});

function bucket(
  id: string,
  label: string,
  usedPercent: number,
  authority: QuotaBucket['authority']
): QuotaBucket {
  return {
    id,
    billingDomainId: 'code-assist-subscription',
    label,
    usedPercent,
    windowDurationMinutes: /week/i.test(label) ? 10_080 : 300,
    resetsAt: '2026-09-02T16:00:00.000Z',
    authority,
    scope: authority === 'official-client' ? 'account-wide' : 'local-only'
  };
}

function snapshot(observedAt: string, quotaBuckets: QuotaBucket[]): ConnectorSnapshot {
  return {
    provider: { id: 'antigravity', displayName: 'Antigravity' },
    billingDomains: [{ id: 'code-assist-subscription', displayName: 'Gemini Code Assist' }],
    quotaBuckets,
    usage: [],
    costs: [],
    observedAt
  };
}
