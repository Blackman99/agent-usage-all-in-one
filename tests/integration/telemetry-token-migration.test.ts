import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

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
    seedLegacyTelemetry(databasePath);

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

function seedLegacyTelemetry(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      last_success_at TEXT,
      last_error TEXT,
      last_failure_at TEXT,
      account_identifier TEXT
    );
    CREATE TABLE billing_domains (
      provider_id TEXT NOT NULL,
      id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      PRIMARY KEY (provider_id, id)
    );
    CREATE TABLE usage_observations (
      provider_id TEXT NOT NULL,
      id TEXT NOT NULL,
      billing_domain_id TEXT NOT NULL,
      model TEXT NOT NULL,
      session_id TEXT,
      observed_at TEXT NOT NULL,
      total_tokens INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      authority TEXT NOT NULL,
      PRIMARY KEY (provider_id, id)
    );
    INSERT INTO providers (id, display_name) VALUES
      ('claude-code', 'Claude Code'),
      ('grok', 'Grok');
    INSERT INTO billing_domains (provider_id, id, display_name) VALUES
      ('claude-code', 'subscription', 'Claude subscription'),
      ('grok', 'grok-build-subscription', 'Grok Build / SuperGrok shared pool');
    INSERT INTO usage_observations (
      provider_id, id, billing_domain_id, model, observed_at, total_tokens,
      input_tokens, output_tokens, reasoning_tokens, cache_read_tokens,
      cache_write_tokens, authority
    ) VALUES
      (
        'claude-code', 'claude-otel:1787878800000000000:claude-fable-5',
        'subscription', 'claude-fable-5', '2026-08-28T01:00:00.000Z',
        575, 100, 25, 0, 400, 50, 'local-observation'
      ),
      (
        'grok', 'grok-otel:1787878800000000000:session-123:grok-build',
        'grok-build-subscription', 'grok-build', '2026-08-28T01:00:00.000Z',
        525, 100, 25, 12, 400, 0, 'local-observation'
      );
  `);
  database.close();
}
