import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorSnapshot, UsageObservation } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const OBSERVED_AT = '2026-08-28T01:00:00.000Z';
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('all-provider token contract', () => {
  it('reconciles totals and preserves authority, precision, and Grok billing isolation', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-all-provider-token-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));

    for (const snapshot of snapshots()) repository.saveSnapshot(snapshot);
    for (const snapshot of snapshots()) repository.saveSnapshot(snapshot);

    const overview = repository.getOverview(new Date('2026-08-28T02:00:00.000Z'), {
      window: '30d'
    });
    expect(overview.providers.map((provider) => provider.id).sort()).toEqual([
      'claude-code',
      'codex',
      'grok',
      'opencode-go'
    ]);

    expectDomain(overview, 'codex', 'subscription', {
      total: 100,
      authority: 'official-account',
      precision: 'day',
      scope: 'account-wide',
      derivation: 'source-reported'
    });
    expectDomain(overview, 'claude-code', 'subscription', {
      total: 575,
      authority: 'local-observation',
      precision: 'event',
      scope: 'this-mac',
      derivation: 'categorized'
    });
    expectDomain(overview, 'opencode-go', 'subscription', {
      total: 587,
      authority: 'local-observation',
      precision: 'day',
      scope: 'this-mac',
      derivation: 'categorized'
    });
    expectDomain(overview, 'grok', 'grok-build-subscription', {
      total: 525,
      authority: 'local-observation',
      precision: 'event',
      scope: 'this-mac',
      derivation: 'categorized'
    });
    expectDomain(overview, 'grok', 'xai-api', {
      total: 1_742,
      authority: 'official-account',
      precision: 'billing-period',
      scope: 'account-wide',
      derivation: 'categorized'
    });

    const grok = overview.providers.find((provider) => provider.id === 'grok')!;
    expect(grok).toMatchObject({
      summaryBillingDomainId: 'grok-build-subscription',
      tokenTotals: { total: 525 }
    });
    expect(grok.billingDomains.map((domain) => domain.id)).toEqual([
      'grok-build-subscription',
      'xai-api'
    ]);
    expect(grok.billingDomains[0].history.models.map((model) => model.model)).toEqual([
      'grok-build'
    ]);
    expect(grok.billingDomains[1].history.models.map((model) => model.model)).toEqual(['grok-4.6']);
    expect(repository.getRetentionStatus()).toMatchObject({ rawObservations: 5 });
    repository.close();
  });
});

function expectDomain(
  overview: ReturnType<SqliteUsageRepository['getOverview']>,
  providerId: string,
  domainId: string,
  expected: {
    total: number;
    authority: 'official-account' | 'local-observation';
    precision: 'event' | 'day' | 'billing-period';
    scope: 'account-wide' | 'this-mac';
    derivation: 'source-reported' | 'categorized';
  }
): void {
  const provider = overview.providers.find((candidate) => candidate.id === providerId)!;
  const domain = provider.billingDomains.find((candidate) => candidate.id === domainId)!;
  expect(domain.tokenTotals.total).toBe(expected.total);
  expect(domain.history.tokenTotals.total).toBe(expected.total);
  expect(domain.tokenAuthority).toBe(expected.authority);
  expect(domain.tokenEvidence).toMatchObject({
    recordedTokens: expected.total,
    timePrecisions: [expected.precision],
    usageScopes: [expected.scope],
    totalDerivations: [expected.derivation]
  });
}

function snapshots(): ConnectorSnapshot[] {
  return [
    snapshot('codex', 'Codex', 'subscription', 'Subscription', {
      ...usage('codex-daily', 'subscription', null),
      sourceReportedTotalTokens: 100,
      modelAttribution: 'unclassified',
      timePrecision: 'day',
      usageScope: 'account-wide',
      authority: 'official-account'
    }),
    snapshot('claude-code', 'Claude Code', 'subscription', 'Claude subscription', {
      ...usage('claude-event', 'subscription', 'claude-fable-5'),
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 400,
      cacheWriteTokens: 50,
      tokenSemantics: includedReasoningSemantics(),
      modelAttribution: 'known',
      timePrecision: 'event',
      usageScope: 'this-mac',
      aggregationTemporality: 'delta',
      authority: 'local-observation'
    }),
    snapshot('opencode-go', 'OpenCode Go', 'subscription', 'Subscription', {
      ...usage('opencode-day', 'subscription', 'glm-4.5'),
      inputTokens: 100,
      outputTokens: 25,
      reasoningTokens: 12,
      cacheReadTokens: 400,
      cacheWriteTokens: 50,
      tokenSemantics: separateSemantics(),
      modelAttribution: 'known',
      timePrecision: 'day',
      usageScope: 'this-mac',
      authority: 'local-observation'
    }),
    snapshot('grok', 'Grok', 'grok-build-subscription', 'Grok Build / SuperGrok shared pool', {
      ...usage('grok-build-event', 'grok-build-subscription', 'grok-build'),
      inputTokens: 100,
      outputTokens: 25,
      reasoningTokens: 12,
      cacheReadTokens: 400,
      tokenSemantics: includedReasoningSemantics(),
      modelAttribution: 'known',
      timePrecision: 'event',
      usageScope: 'this-mac',
      aggregationTemporality: 'delta',
      authority: 'local-observation'
    }),
    snapshot('grok', 'Grok', 'xai-api', 'xAI API', {
      ...usage('xai-invoice', 'xai-api', 'grok-4.6'),
      observedAt: '2026-08-01T00:00:00.000Z',
      inputTokens: 908,
      outputTokens: 534,
      reasoningTokens: 42,
      cacheReadTokens: 300,
      tokenSemantics: includedReasoningSemantics(),
      modelAttribution: 'known',
      timePrecision: 'billing-period',
      usageScope: 'account-wide',
      aggregationTemporality: 'delta',
      authority: 'official-account'
    })
  ];
}

function snapshot(
  providerId: string,
  providerName: string,
  domainId: string,
  domainName: string,
  observation: UsageObservation
): ConnectorSnapshot {
  return {
    provider: { id: providerId, displayName: providerName },
    billingDomains: [{ id: domainId, displayName: domainName }],
    quotaBuckets: [],
    usage: [observation],
    costs: [],
    observedAt: OBSERVED_AT
  };
}

function usage(id: string, billingDomainId: string, model: string | null): UsageObservation {
  return {
    id,
    billingDomainId,
    model,
    observedAt: OBSERVED_AT,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    authority: 'local-observation'
  };
}

function includedReasoningSemantics() {
  return {
    reasoning: 'included-in-output' as const,
    cacheRead: 'separate' as const,
    cacheWrite: 'separate' as const
  };
}

function separateSemantics() {
  return {
    reasoning: 'separate' as const,
    cacheRead: 'separate' as const,
    cacheWrite: 'separate' as const
  };
}
