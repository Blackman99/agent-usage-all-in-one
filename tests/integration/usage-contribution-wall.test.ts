import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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
});
