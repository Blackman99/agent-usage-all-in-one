import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import type { ConnectorSnapshot } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

/** The moment the fixture's observations are read at. */
const NOW = new Date('2026-08-28T03:00:00.000Z');
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('expanded token contract', () => {
  it('exposes recorded, source-reported, unclassified, derivation, and precision evidence', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-token-contract-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(tokenSnapshot());

    const overview = repository.getOverview(NOW, {
      window: '7d'
    });
    const provider = overview.providers[0];
    const domain = provider.billingDomains[0];

    expect(provider.tokenTotals.total).toBe(1_910);
    expect(provider.tokenEvidence).toMatchObject({
      recordedTokens: 1_910,
      sourceReportedTokens: 1_725,
      sourceReportedObservationCount: 4,
      observationCount: 5,
      unclassifiedTokens: 1_565,
      classifiedTokens: 345,
      totalDerivations: ['categorized', 'source-reported'],
      timePrecisions: ['billing-period', 'day', 'event', 'hour', 'unknown'],
      aggregationTemporalities: ['unknown']
    });
    expect(provider.tokenEvidence.classificationCoverage).toBeCloseTo(345 / 1_910);
    expect(domain.tokenEvidence).toEqual(provider.tokenEvidence);
    expect(domain.history.tokenEvidence).toEqual(provider.tokenEvidence);
    expect(domain.history.models.map((model) => model.model)).toEqual([
      'known-model',
      'known-source-model'
    ]);

    // The export resolves its window from the application clock, so it is
    // pinned to the same moment the overview above was read at: the fixture's
    // day-precision observation is only inside a 7-day window from there.
    const application = new UsageApplication({ repository, connectors: [], clock: () => NOW });
    const exported = JSON.parse(
      (await application.exportUsage({ format: 'json', window: '7d', timeZone: 'UTC' })).body
    ) as { version: number; rows: Array<Record<string, unknown>> };
    expect(exported.version).toBe(2);
    expect(exported.rows[0]).toMatchObject({
      recordType: 'tokens',
      recordedTokens: 1_910,
      sourceReportedTokens: 1_725,
      unclassifiedTokens: 1_565,
      timePrecisions: ['billing-period', 'day', 'event', 'hour', 'unknown'],
      aggregationTemporalities: ['unknown']
    });
    repository.close();
  });

  it('migrates current V1 observations idempotently without changing identity or provenance', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-token-migration-'));
    workspaces.push(workspace);
    const databasePath = join(workspace, 'usage.sqlite');
    seedV1Database(databasePath);

    new SqliteUsageRepository(databasePath).close();
    new SqliteUsageRepository(databasePath).close();

    const database = new DatabaseSync(databasePath);
    const row = database
      .prepare(
        `SELECT id, authority, observed_at, total_tokens, source_reported_total_tokens,
                unclassified_tokens, total_derivation, model_attribution, time_precision,
                usage_scope, aggregation_temporality
         FROM usage_observations WHERE provider_id = 'legacy' AND id = 'legacy-observation'`
      )
      .get() as Record<string, unknown>;
    expect(row).toEqual({
      id: 'legacy-observation',
      authority: 'official-client',
      observed_at: '2026-08-27T00:00:00.000Z',
      total_tokens: 125,
      source_reported_total_tokens: null,
      unclassified_tokens: 125,
      total_derivation: 'legacy-total',
      model_attribution: 'unclassified',
      time_precision: 'unknown',
      usage_scope: 'unknown',
      aggregation_temporality: 'unknown'
    });
    const knownRemainder = database
      .prepare(
        `SELECT id, unclassified_tokens, total_derivation, model_attribution
         FROM usage_observations WHERE provider_id = 'legacy' AND id = 'known-remainder'`
      )
      .get() as Record<string, unknown>;
    expect(knownRemainder).toEqual({
      id: 'known-remainder',
      unclassified_tokens: 40,
      total_derivation: 'legacy-total',
      model_attribution: 'known'
    });
    database.close();
  });
});

function tokenSnapshot(): ConnectorSnapshot {
  return {
    provider: { id: 'token-provider', displayName: 'Token provider' },
    billingDomains: [{ id: 'subscription', displayName: 'Subscription' }],
    quotaBuckets: [],
    usage: [
      {
        id: 'categorized',
        billingDomainId: 'subscription',
        model: 'known-model',
        observedAt: '2026-08-28T00:00:00.000Z',
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 20,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        tokenSemantics: {
          reasoning: 'separate',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        modelAttribution: 'known',
        timePrecision: 'event',
        authority: 'local-observation'
      },
      {
        id: 'source-total',
        billingDomainId: 'subscription',
        model: 'known-source-model',
        observedAt: '2026-08-28T01:00:00.000Z',
        sourceReportedTotalTokens: 250,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        modelAttribution: 'known',
        timePrecision: 'hour',
        authority: 'official-account'
      },
      {
        id: 'unknown-total',
        billingDomainId: 'subscription',
        model: null,
        observedAt: '2026-08-27T00:00:00.000Z',
        sourceReportedTotalTokens: 1_250,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        modelAttribution: 'unclassified',
        timePrecision: 'billing-period',
        authority: 'official-account'
      },
      {
        id: 'legacy-all-models',
        billingDomainId: 'subscription',
        model: 'all-models',
        observedAt: '2026-08-26T00:00:00.000Z',
        sourceReportedTotalTokens: 125,
        inputTokens: 125,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        authority: 'official-client'
      },
      {
        id: 'day-total',
        billingDomainId: 'subscription',
        model: null,
        observedAt: '2026-08-25T00:00:00.000Z',
        sourceReportedTotalTokens: 100,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        modelAttribution: 'unclassified',
        timePrecision: 'day',
        authority: 'official-account'
      }
    ],
    costs: [],
    observedAt: '2026-08-28T02:00:00.000Z'
  };
}

function seedV1Database(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      last_success_at TEXT,
      last_error TEXT,
      last_failure_at TEXT,
      last_error_code TEXT,
      last_recovery TEXT,
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
    INSERT INTO providers (id, display_name) VALUES ('legacy', 'Legacy');
    INSERT INTO billing_domains (provider_id, id, display_name)
      VALUES ('legacy', 'subscription', 'Subscription');
    INSERT INTO usage_observations (
      provider_id, id, billing_domain_id, model, observed_at, total_tokens,
      input_tokens, output_tokens, reasoning_tokens, cache_read_tokens,
      cache_write_tokens, authority
    ) VALUES (
      'legacy', 'legacy-observation', 'subscription', 'all-models',
      '2026-08-27T00:00:00.000Z', 125, 125, 0, 0, 0, 0, 'official-client'
    );
    INSERT INTO usage_observations (
      provider_id, id, billing_domain_id, model, observed_at, total_tokens,
      input_tokens, output_tokens, reasoning_tokens, cache_read_tokens,
      cache_write_tokens, authority
    ) VALUES (
      'legacy', 'known-remainder', 'subscription', 'known-model',
      '2026-08-27T01:00:00.000Z', 200, 100, 50, 10, 10, 0, 'official-client'
    );
  `);
  database.close();
}
