import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorSnapshot, UsageObservation } from '$core/types.js';
import { UsageApplication } from '$core/usage-application.js';
import { startLocalServer, type LocalServer } from '$server/local-server.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const NOW = new Date('2026-08-28T02:00:00.000Z');
const workspaces: string[] = [];
const servers: LocalServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('usage contribution wall', () => {
  it('returns an empty rolling year through today with no future or padding days', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-wall-empty-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const application = new UsageApplication({
      repository,
      connectors: [],
      clock: () => NOW
    });
    const server = await startLocalServer({ application, apiToken: 'wall-token' });
    servers.push(server);

    const response = await fetch(`${server.origin}/api/usage-wall?timeZone=UTC`, {
      headers: { authorization: 'Bearer wall-token' }
    });

    expect(response.status).toBe(200);
    const wall = (await response.json()) as {
      timeZone: string;
      start: string;
      end: string;
      recordedTokens: number;
      days: Array<{ date: string; recordedTokens: number; level: number; providers: unknown[] }>;
    };

    expect(wall).toMatchObject({
      timeZone: 'UTC',
      start: '2025-08-28',
      end: '2026-08-28',
      recordedTokens: 0
    });
    expect(wall.days).toHaveLength(366);
    expect(wall.days[0]).toMatchObject({
      date: '2025-08-28',
      recordedTokens: 0,
      level: 0,
      providers: []
    });
    expect(wall.days.at(-1)).toMatchObject({
      date: '2026-08-28',
      recordedTokens: 0,
      level: 0,
      providers: []
    });
    expect(wall.days.some((day) => day.date === '2025-08-27')).toBe(false);
    expect(wall.days.some((day) => day.date === '2026-08-29')).toBe(false);
    expect(wall.days.every((day) => day.level === 0 && day.recordedTokens === 0)).toBe(true);

    repository.close();
  });

  it('sums headline-included Tokens, includes today, reads compacted days, and maps quartiles', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-wall-days-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(
      snapshot('codex', 'Codex', 'chatgpt-plus', 'ChatGPT Plus', [
        usage('codex-today', 'chatgpt-plus', '2026-08-28T01:00:00.000Z', 400),
        usage('codex-recent', 'chatgpt-plus', '2026-08-20T12:00:00.000Z', 100),
        usage('codex-busy', 'chatgpt-plus', '2026-04-01T12:00:00.000Z', 300)
      ])
    );
    repository.saveSnapshot(
      snapshot('grok', 'Grok', 'grok-build-subscription', 'Build / SuperGrok', [
        usage('grok-today', 'grok-build-subscription', '2026-08-28T01:30:00.000Z', 50)
      ])
    );
    repository.saveSnapshot(
      snapshot('grok', 'Grok', 'xai-api', 'xAI API', [
        usage('xai-today', 'xai-api', '2026-08-28T01:45:00.000Z', 9_000)
      ])
    );
    const compacted = repository.compactUsageHistory(NOW).dailyAggregates;
    expect(compacted).toBeGreaterThan(0);
    repository.saveSnapshot(
      snapshot('claude-code', 'Claude Code', 'subscription', 'Subscription', [
        usage('claude-medium', 'subscription', '2026-08-10T12:00:00.000Z', 200)
      ])
    );

    const application = new UsageApplication({
      repository,
      connectors: [],
      clock: () => NOW
    });
    const server = await startLocalServer({ application, apiToken: 'wall-days-token' });
    servers.push(server);
    const response = await fetch(`${server.origin}/api/usage-wall?timeZone=UTC`, {
      headers: { authorization: 'Bearer wall-days-token' }
    });
    expect(response.status).toBe(200);
    const wall = (await response.json()) as {
      recordedTokens: number;
      days: Array<{
        date: string;
        recordedTokens: number;
        level: number;
        providers: Array<{ providerId: string; displayName: string }>;
      }>;
    };

    const byDate = Object.fromEntries(wall.days.map((day) => [day.date, day]));
    expect(byDate['2026-08-28']).toMatchObject({
      recordedTokens: 450,
      level: 4,
      providers: [
        { providerId: 'codex', displayName: 'Codex' },
        { providerId: 'grok', displayName: 'Grok' }
      ]
    });
    expect(byDate['2026-08-20']).toMatchObject({ recordedTokens: 100, level: 1 });
    expect(byDate['2026-08-10']).toMatchObject({ recordedTokens: 200, level: 2 });
    expect(byDate['2026-04-01']).toMatchObject({ recordedTokens: 300, level: 3 });
    expect(byDate['2026-08-27']).toMatchObject({ recordedTokens: 0, level: 0, providers: [] });
    expect(wall.recordedTokens).toBe(1_050);
    expect(wall.days.some((day) => day.date === '2026-08-29')).toBe(false);

    repository.close();
  });

  it('includes every dsh route and Grok custom endpoint in the year wall', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-wall-custom-routes-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(
      snapshot('dsh', 'dsh', 'deepseek-official', 'DeepSeek API', [
        usage('dsh-flash', 'deepseek-official', '2026-08-28T01:00:00.000Z', 100)
      ])
    );
    repository.saveSnapshot(
      snapshot('dsh', 'dsh', 'my-custom-proxy', 'my-custom-proxy', [
        usage('dsh-custom', 'my-custom-proxy', '2026-08-28T01:10:00.000Z', 400)
      ])
    );
    repository.saveSnapshot(
      snapshot('grok', 'Grok', 'grok-build-subscription', 'Build / SuperGrok', [
        usage('grok-sub', 'grok-build-subscription', '2026-08-28T01:20:00.000Z', 50)
      ])
    );
    repository.saveSnapshot(
      snapshot('grok', 'Grok', 'custom', 'Custom endpoint', [
        usage('grok-custom', 'custom', '2026-08-28T01:30:00.000Z', 200)
      ])
    );
    repository.saveSnapshot(
      snapshot('grok', 'Grok', 'xai-api', 'xAI API', [
        usage('xai-today', 'xai-api', '2026-08-28T01:40:00.000Z', 9_000)
      ])
    );

    const application = new UsageApplication({
      repository,
      connectors: [],
      clock: () => NOW
    });
    const server = await startLocalServer({ application, apiToken: 'wall-custom-token' });
    servers.push(server);
    const response = await fetch(`${server.origin}/api/usage-wall?timeZone=UTC`, {
      headers: { authorization: 'Bearer wall-custom-token' }
    });
    expect(response.status).toBe(200);
    const wall = (await response.json()) as {
      recordedTokens: number;
      days: Array<{
        date: string;
        recordedTokens: number;
        providers: Array<{ providerId: string }>;
      }>;
    };

    const today = wall.days.find((day) => day.date === '2026-08-28');
    expect(today?.recordedTokens).toBe(750);
    expect(today?.providers.map((provider) => provider.providerId).sort()).toEqual(['dsh', 'grok']);
    expect(wall.recordedTokens).toBe(750);

    repository.close();
  });
});

function snapshot(
  providerId: string,
  providerDisplayName: string,
  billingDomainId: string,
  billingDomainDisplayName: string,
  observations: UsageObservation[]
): ConnectorSnapshot {
  return {
    provider: { id: providerId, displayName: providerDisplayName },
    billingDomains: [{ id: billingDomainId, displayName: billingDomainDisplayName }],
    quotaBuckets: [],
    usage: observations,
    costs: [],
    observedAt: observations.at(-1)?.observedAt ?? NOW.toISOString()
  };
}

function usage(
  id: string,
  billingDomainId: string,
  observedAt: string,
  recordedTokens: number
): UsageObservation {
  return {
    id,
    billingDomainId,
    model: 'test-model',
    observedAt,
    inputTokens: recordedTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelAttribution: 'known',
    timePrecision: 'event',
    usageScope: 'account-wide',
    aggregationTemporality: 'delta',
    authority: 'official-account'
  };
}
