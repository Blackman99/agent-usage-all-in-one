import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import { LocalTranscriptUsageClient } from '$server/local-transcript-usage-client.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';
import {
  GrokBuildConnector,
  type GrokBuildBillingClient
} from '../../src/connectors/grok-build/grok-build-connector.js';

const NOW = new Date('2026-08-28T04:00:00.000Z');

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('grok custom endpoint separation and rate application', () => {
  it('separates official Grok models and custom endpoint models into distinct billing domains', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-usage-grok-custom-endpoint-'));
    workspaces.push(root);
    const sessionsDir = join(root, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    // Official grok session
    const officialSessionDir = join(sessionsDir, 'session-official');
    await mkdir(officialSessionDir, { recursive: true });
    const officialUpdate = JSON.stringify({
      timestamp: Date.parse('2026-08-28T01:00:00.000Z') / 1000,
      params: {
        sessionId: 'session-official',
        _meta: { agentTimestampMs: Date.parse('2026-08-28T01:00:00.000Z') },
        update: {
          sessionUpdate: 'turn_completed',
          prompt_id: 'prompt-1',
          usage: {
            inputTokens: 500,
            outputTokens: 100,
            cachedReadTokens: 200,
            cacheCreationTokens: 0,
            reasoningTokens: 10,
            modelUsage: {
              'grok-4.6-build': {
                inputTokens: 500,
                outputTokens: 100,
                cachedReadTokens: 200,
                cacheCreationTokens: 0,
                reasoningTokens: 10
              }
            }
          }
        }
      }
    });
    await writeFile(join(officialSessionDir, 'updates.jsonl'), `${officialUpdate}\n`);

    // Custom endpoint session (e.g. gemini-3.8-flash)
    const customSessionDir = join(sessionsDir, 'session-custom');
    await mkdir(customSessionDir, { recursive: true });
    const customUpdate = JSON.stringify({
      timestamp: Date.parse('2026-08-28T02:00:00.000Z') / 1000,
      params: {
        sessionId: 'session-custom',
        _meta: { agentTimestampMs: Date.parse('2026-08-28T02:00:00.000Z') },
        update: {
          sessionUpdate: 'turn_completed',
          prompt_id: 'prompt-2',
          usage: {
            inputTokens: 100_000,
            outputTokens: 20_000,
            cachedReadTokens: 10_000,
            cacheCreationTokens: 0,
            reasoningTokens: 0,
            modelUsage: {
              'gemini-3.8-flash': {
                inputTokens: 100_000,
                outputTokens: 20_000,
                cachedReadTokens: 10_000,
                cacheCreationTokens: 0,
                reasoningTokens: 0
              }
            }
          }
        }
      }
    });
    await writeFile(join(customSessionDir, 'updates.jsonl'), `${customUpdate}\n`);

    const databasePath = join(root, 'usage.sqlite');
    const repository = new SqliteUsageRepository(databasePath);
    repository.saveConnectorStatus({
      id: 'grok',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/grok',
      officialCredentialPresent: true,
      errorCode: null,
      lastDiscoveredAt: NOW.toISOString(),
      secretReference: null
    });

    const billingClient: GrokBuildBillingClient = {
      async readBilling() {
        return {
          config: {
            creditUsagePercent: 30,
            monthlyLimit: { val: 10000 },
            used: { val: 3000 }
          },
          sourceObservedAt: '2026-08-28T03:00:00.000Z'
        };
      }
    };

    const historyClient = new LocalTranscriptUsageClient({
      provider: 'grok',
      roots: [sessionsDir],
      clock: () => NOW
    });

    const connector = new GrokBuildConnector({
      billingClient,
      historyClient,
      clock: () => NOW
    });

    const application = new UsageApplication({
      repository,
      connectors: [connector],
      clock: () => NOW
    });

    await application.refresh({ userInitiated: true });

    const initialOverview = await application.getOverview({
      window: '24h',
      comparisonCurrency: 'USD',
      auditEvidence: true
    });

    const grokProvider = initialOverview.providers.find((p) => p.id === 'grok')!;
    expect(grokProvider).toBeDefined();

    // Verify Grok has both billing domains separated
    expect(grokProvider.billingDomains.map((d) => d.id).sort()).toEqual([
      'custom',
      'grok-build-subscription'
    ]);

    const subscriptionDomain = grokProvider.billingDomains.find(
      (d) => d.id === 'grok-build-subscription'
    )!;
    // 300 input + 100 output + 200 cache = 600 total tokens
    expect(subscriptionDomain.tokenTotals.total).toBe(600);
    expect(subscriptionDomain.history.models.map((m) => m.model)).toEqual(['grok-4.6-build']);
    // Quota belongs exclusively to subscription domain
    expect(subscriptionDomain.quotaBuckets).toHaveLength(1);

    const customDomain = grokProvider.billingDomains.find((d) => d.id === 'custom')!;
    // 90k input + 20k output + 10k cache = 120k total tokens
    expect(customDomain.tokenTotals.total).toBe(120_000);
    expect(customDomain.history.models.map((m) => m.model)).toEqual(['gemini-3.8-flash']);
    expect(customDomain.quotaBuckets).toHaveLength(0);

    // Custom model is unpriced initially
    const customRetailCosts = (customDomain.costs ?? []).filter(
      (c) => c.kind === 'retail-equivalent'
    );
    expect(customRetailCosts).toHaveLength(0);

    // Now configure custom model rate for gemini-3.8-flash
    await application.setCustomModelRate({
      providerId: 'grok',
      billingDomainId: 'custom',
      model: 'gemini-3.8-flash',
      inputRate: 2.0,
      outputRate: 5.0,
      cacheReadRate: 0.1
    });

    const updatedOverview = await application.getOverview({
      window: '24h',
      comparisonCurrency: 'USD',
      auditEvidence: true
    });

    const updatedCustomDomain = updatedOverview.providers
      .find((p) => p.id === 'grok')!
      .billingDomains.find((d) => d.id === 'custom')!;

    const updatedCustomRetailCosts = (updatedCustomDomain.costs ?? []).filter(
      (c) => c.kind === 'retail-equivalent'
    );
    expect(updatedCustomRetailCosts).toHaveLength(1);
    // 90k * 2.0 / 1M = 0.18, 20k * 5.0 / 1M = 0.10, 10k * 0.1 / 1M = 0.001 => 0.281 USD
    expect(updatedCustomRetailCosts[0]?.amount).toBeCloseTo(0.281, 5);

    // Verify model ranking includes custom model in headline with tokenShare & retailShare calculated
    const geminiRankingEntry = updatedOverview.workbench.modelRanking.entries.find(
      (entry) => entry.model === 'gemini-3.8-flash'
    )!;
    expect(geminiRankingEntry).toBeDefined();
    expect(geminiRankingEntry.billingDomainId).toBe('custom');
    expect(geminiRankingEntry.includedInHeadline).toBe(true);
    expect(geminiRankingEntry.tokenShare).not.toBeNull();
    expect(geminiRankingEntry.retailShare).not.toBeNull();
    expect(geminiRankingEntry.tokenShare).toBeGreaterThan(0.9); // 120k / 120.6k

    const grokRankingEntry = updatedOverview.workbench.modelRanking.entries.find(
      (entry) => entry.model === 'grok-4.6-build'
    )!;
    expect(grokRankingEntry).toBeDefined();
    expect(grokRankingEntry.billingDomainId).toBe('grok-build-subscription');
    expect(grokRankingEntry.includedInHeadline).toBe(true);

    repository.close();
  });

  it('moves official grok-*-build usage onto Custom endpoints when the session selected a custom Grok alias', async () => {
    const grokHome = await mkdtemp(join(tmpdir(), 'agent-usage-grok-custom-alias-app-'));
    workspaces.push(grokHome);
    const sessionsDir = join(grokHome, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(grokHome, 'config.toml'),
      `[model."grk-4.6"]
model = "grk-4.6"
base_url = "https://example.invalid/v1"
`
    );
    const sessionDir = join(sessionsDir, 'session-custom-grok');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'updates.jsonl'),
      `${JSON.stringify({
        timestamp: Date.parse('2026-08-28T01:00:00.000Z') / 1000,
        params: {
          sessionId: 'session-custom-grok',
          update: {
            sessionUpdate: 'user_message_chunk',
            _meta: { modelId: 'grk-4.6' }
          }
        }
      })}\n${JSON.stringify({
        timestamp: Date.parse('2026-08-28T01:01:00.000Z') / 1000,
        params: {
          sessionId: 'session-custom-grok',
          _meta: { agentTimestampMs: Date.parse('2026-08-28T01:01:00.000Z') },
          update: {
            sessionUpdate: 'turn_completed',
            prompt_id: 'prompt-custom-grok',
            usage: {
              inputTokens: 800,
              outputTokens: 50,
              cachedReadTokens: 200,
              cacheCreationTokens: 0,
              reasoningTokens: 0,
              modelUsage: {
                'grok-4.6-build': {
                  inputTokens: 800,
                  outputTokens: 50,
                  cachedReadTokens: 200,
                  cacheCreationTokens: 0,
                  reasoningTokens: 0
                }
              }
            }
          }
        }
      })}\n`
    );

    const databasePath = join(grokHome, 'usage.sqlite');
    const repository = new SqliteUsageRepository(databasePath);
    repository.saveConnectorStatus({
      id: 'grok',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/grok',
      officialCredentialPresent: true,
      errorCode: null,
      lastDiscoveredAt: NOW.toISOString(),
      secretReference: null
    });

    const application = new UsageApplication({
      repository,
      connectors: [
        new GrokBuildConnector({
          billingClient: {
            async readBilling() {
              return {
                config: {
                  creditUsagePercent: 10,
                  monthlyLimit: { val: 10000 },
                  used: { val: 1000 }
                },
                sourceObservedAt: '2026-08-28T03:00:00.000Z'
              };
            }
          },
          historyClient: new LocalTranscriptUsageClient({
            provider: 'grok',
            roots: [sessionsDir],
            clock: () => NOW
          }),
          clock: () => NOW
        })
      ],
      clock: () => NOW
    });

    await application.refresh({ userInitiated: true });
    const overview = await application.getOverview({
      window: '24h',
      comparisonCurrency: 'USD'
    });
    const grokProvider = overview.providers.find((provider) => provider.id === 'grok')!;
    const customDomain = grokProvider.billingDomains.find((domain) => domain.id === 'custom')!;
    const subscriptionDomain = grokProvider.billingDomains.find(
      (domain) => domain.id === 'grok-build-subscription'
    )!;

    expect(customDomain.tokenTotals.total).toBe(850);
    expect(customDomain.history.models.map((model) => model.model)).toEqual(['grok-4.6-build']);
    expect(subscriptionDomain.tokenTotals.total).toBe(0);
    expect(
      overview.workbench.modelRanking.entries.find(
        (entry) => entry.model === 'grok-4.6-build' && entry.billingDomainId === 'custom'
      )
    ).toMatchObject({ includedInHeadline: true });

    repository.close();
  });
});
