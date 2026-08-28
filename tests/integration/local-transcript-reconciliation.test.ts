import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorSnapshot, UsageObservation } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('local transcript source reconciliation', () => {
  it('reconciles overlapping local sources without deleting official Codex evidence or touching xAI API usage', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-transcript-reconcile-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));

    repository.saveSnapshot(
      snapshot('codex', 'subscription', legacy('codex:daily:2026-08-28', 'subscription'))
    );
    repository.saveSnapshot(
      snapshot('claude-code', 'subscription', legacy('claude-otel:old', 'subscription'))
    );
    repository.saveSnapshot(
      snapshot(
        'grok',
        'grok-build-subscription',
        legacy('grok-headless:old', 'grok-build-subscription')
      )
    );
    repository.saveSnapshot(
      snapshot('grok', 'xai-api', known('xai-usage:kept', 'grok-4.6', 'xai-api'))
    );

    const codexTranscript = transcriptSnapshot(
      'codex',
      'subscription',
      'codex-transcript:new',
      'gpt-5.6-sol',
      []
    );
    codexTranscript.usage.push(accountRemainder(879));
    repository.saveSnapshot(codexTranscript);
    repository.saveSnapshot(
      transcriptSnapshot('claude-code', 'subscription', 'claude-transcript:new', 'claude-fable-5', [
        'claude-otel:'
      ])
    );
    repository.saveSnapshot(
      transcriptSnapshot(
        'grok',
        'grok-build-subscription',
        'grok-transcript:new',
        'grok-code-fast-1',
        ['grok-otel:', 'grok-headless:']
      )
    );

    const overview = repository.getOverview(new Date('2026-08-28T03:00:00.000Z'), {
      window: '30d',
      comparisonCurrency: 'USD'
    });
    const codex = overview.providers.find((candidate) => candidate.id === 'codex')!;
    const codexDomain = codex.billingDomains.find((candidate) => candidate.id === 'subscription')!;
    expect(codexDomain.history.tokenTotals.total).toBe(999);
    expect(codexDomain.history.models.map((candidate) => candidate.model)).toEqual(['gpt-5.6-sol']);
    expect(codexDomain.history.models[0].tokenTotals.total).toBe(120);
    expect(codexDomain.history.unclassified.tokenTotals.total).toBe(879);
    expect(codexDomain.history.unclassified.tokenEvidence.totalDerivations).toContain(
      'reconciled-remainder'
    );
    expectDomain(overview, 'claude-code', 'subscription', 'claude-fable-5', 120);
    expectDomain(overview, 'grok', 'grok-build-subscription', 'grok-code-fast-1', 120);
    expectDomain(overview, 'grok', 'xai-api', 'grok-4.6', 120);
    repository.close();
  });

  it('keeps the last complete Codex reconciliation when the official adapter later fails', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-codex-reconcile-fallback-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveSnapshot(
      snapshot('codex', 'subscription', legacy('codex:daily:2026-08-28', 'subscription'))
    );
    const complete = transcriptSnapshot(
      'codex',
      'subscription',
      'codex-transcript:model',
      'gpt-5.6-sol',
      []
    );
    complete.usage.push(accountRemainder(879));
    repository.saveSnapshot(complete);

    repository.saveSnapshot(
      snapshot(
        'codex',
        'subscription',
        known('codex-transcript:model', 'gpt-5.6-sol', 'subscription')
      )
    );

    const overview = repository.getOverview(new Date('2026-08-28T03:00:00.000Z'), {
      window: '30d',
      comparisonCurrency: 'USD'
    });
    expectDomain(overview, 'codex', 'subscription', 'gpt-5.6-sol', 999);
    repository.close();
  });

  it('keeps a Grok client-reported model estimate available to the model workbench', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-grok-reported-cost-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    const grok = snapshot(
      'grok',
      'grok-build-subscription',
      known('grok-transcript:costed', 'grok-4.6-build', 'grok-build-subscription')
    );
    grok.costs = [
      {
        id: 'grok-transcript-cost:costed',
        billingDomainId: 'grok-build-subscription',
        observedAt: '2026-08-28T01:00:00.000Z',
        kind: 'reported-estimate',
        amount: 0.0191,
        currency: 'USD',
        authority: 'local-observation',
        model: 'grok-4.6-build',
        usageObservationId: 'grok-transcript:costed'
      }
    ];
    repository.saveSnapshot(grok);

    const overview = repository.getOverview(new Date('2026-08-28T03:00:00.000Z'), {
      window: '30d',
      comparisonCurrency: 'USD'
    });
    const model = overview.workbench.modelRanking.entries.find(
      (entry) => entry.model === 'grok-4.6-build'
    );
    expect(model?.retailEquivalent.status).toBe('unavailable');
    expect(model?.reportedEstimate).toMatchObject({ status: 'available', amount: 0.0191 });
    expect(model?.reportedShare).toBe(1);
    expect(overview.workbench.modelRanking.byRetailEquivalent[0]).toBe(model?.id);
    expect(model?.trend.find((bucket) => !bucket.gap)?.reportedEstimate).toMatchObject({
      status: 'available',
      amount: 0.0191
    });
    repository.close();
  });
});

function snapshot(
  providerId: string,
  domainId: string,
  observation: UsageObservation
): ConnectorSnapshot {
  return {
    provider: { id: providerId, displayName: providerId },
    billingDomains: [{ id: domainId, displayName: domainId }],
    quotaBuckets: [],
    usage: [observation],
    costs: [],
    observedAt: '2026-08-28T02:00:00.000Z'
  };
}

function transcriptSnapshot(
  providerId: string,
  domainId: string,
  id: string,
  model: string,
  retiredIdPrefixes: string[]
): ConnectorSnapshot {
  return {
    ...snapshot(providerId, domainId, known(id, model, domainId)),
    usageReconciliation: {
      authoritativeIdPrefix: id.slice(0, id.indexOf(':') + 1),
      retiredIdPrefixes
    }
  };
}

function legacy(id: string, billingDomainId: string): UsageObservation {
  return {
    ...known(id, null, billingDomainId),
    sourceReportedTotalTokens: 999,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelAttribution: 'unclassified',
    timePrecision: 'day',
    usageScope: 'account-wide',
    authority: 'official-account'
  };
}

function accountRemainder(tokens: number): UsageObservation {
  return {
    ...legacy('codex-transcript:account-remainder:2026-08-28', 'subscription'),
    sourceReportedTotalTokens: null,
    reconciledRemainderTokens: tokens,
    authority: 'estimate'
  };
}

function known(id: string, model: string | null, billingDomainId: string): UsageObservation {
  return {
    id,
    billingDomainId,
    model,
    observedAt: '2026-08-28T01:00:00.000Z',
    inputTokens: 50,
    outputTokens: 20,
    reasoningTokens: 5,
    cacheReadTokens: 40,
    cacheWriteTokens: 10,
    tokenSemantics: {
      reasoning: 'included-in-output',
      cacheRead: 'separate',
      cacheWrite: 'separate'
    },
    modelAttribution: model ? 'known' : 'unclassified',
    timePrecision: 'event',
    usageScope: 'this-mac',
    aggregationTemporality: 'delta',
    authority: 'local-observation'
  };
}

function expectDomain(
  overview: ReturnType<SqliteUsageRepository['getOverview']>,
  providerId: string,
  domainId: string,
  model: string,
  tokens: number
): void {
  const provider = overview.providers.find((candidate) => candidate.id === providerId)!;
  const domain = provider.billingDomains.find((candidate) => candidate.id === domainId)!;
  expect(domain.history.tokenTotals.total).toBe(tokens);
  expect(domain.history.models.map((candidate) => candidate.model)).toEqual([model]);
}
