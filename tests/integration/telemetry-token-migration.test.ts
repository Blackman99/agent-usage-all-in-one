import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorSnapshot } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true }))
  );
});

describe('legacy telemetry token migration', () => {
  it('backfills only provider evidence proven by the old ingestion contracts', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-telemetry-migration-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');
    const initial = new SqliteUsageRepository(databasePath);
    initial.saveSnapshot(legacyClaudeSnapshot());
    initial.saveSnapshot(legacyGrokSnapshot());
    initial.close();

    const migrated = new SqliteUsageRepository(databasePath);
    const overview = migrated.getOverview(new Date('2026-08-28T02:00:00.000Z'), {
      window: '24h'
    });
    const claude = overview.providers.find((provider) => provider.id === 'claude-code')!;
    expect(claude.coverage).toMatchObject({ tokens: 'partial', history: 'partial' });
    expect(claude.tokenEvidence).toMatchObject({
      totalDerivations: ['categorized'],
      usageScopes: ['this-mac'],
      aggregationTemporalities: ['unknown'],
      timePrecisions: ['unknown']
    });

    const grok = overview.providers.find((provider) => provider.id === 'grok')!;
    expect(grok.tokenTotals).toMatchObject({ total: 525, reasoning: 12 });
    expect(grok.tokenEvidence).toMatchObject({
      totalDerivations: ['categorized'],
      usageScopes: ['this-mac'],
      aggregationTemporalities: ['delta'],
      timePrecisions: ['unknown']
    });
    expect(grok.billingDomains.map((domain) => domain.id)).toEqual(['grok-build-subscription']);
    migrated.close();
  });
});

function legacyClaudeSnapshot(): ConnectorSnapshot {
  return {
    provider: { id: 'claude-code', displayName: 'Claude Code' },
    billingDomains: [{ id: 'subscription', displayName: 'Claude subscription' }],
    quotaBuckets: [],
    usage: [
      {
        id: 'claude-otel:1787878800000000000:claude-fable-5',
        billingDomainId: 'subscription',
        model: 'claude-fable-5',
        observedAt: '2026-08-28T01:00:00.000Z',
        totalTokens: 575,
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 400,
        cacheWriteTokens: 50,
        authority: 'local-observation'
      }
    ],
    costs: [],
    observedAt: '2026-08-28T01:00:00.000Z'
  };
}

function legacyGrokSnapshot(): ConnectorSnapshot {
  return {
    provider: { id: 'grok', displayName: 'Grok' },
    billingDomains: [
      {
        id: 'grok-build-subscription',
        displayName: 'Grok Build / SuperGrok shared pool'
      }
    ],
    quotaBuckets: [],
    usage: [
      {
        id: 'grok-otel:1787878800000000000:session-123:grok-build',
        billingDomainId: 'grok-build-subscription',
        model: 'grok-build',
        sessionId: 'session-123',
        observedAt: '2026-08-28T01:00:00.000Z',
        totalTokens: 525,
        inputTokens: 100,
        outputTokens: 25,
        reasoningTokens: 12,
        cacheReadTokens: 400,
        cacheWriteTokens: 0,
        authority: 'local-observation'
      }
    ],
    costs: [],
    observedAt: '2026-08-28T01:00:00.000Z'
  };
}
