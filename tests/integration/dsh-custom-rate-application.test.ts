import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import { LocalTranscriptUsageClient } from '$server/local-transcript-usage-client.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';
import { DshConnector } from '../../src/connectors/dsh/dsh-connector.js';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const OBSERVED_AT = '2026-09-02T10:00:00.000Z';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

async function sessionRoot(name: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), `agent-usage-dsh-custom-${name}-`));
  workspaces.push(workspace);
  return join(workspace, 'sessions');
}

async function writeJsonlLog(
  root: string,
  project: string,
  sessionId: string,
  lines: unknown[]
): Promise<string> {
  const directory = join(root, `--${project}--`, sessionId);
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'session.jsonl');
  const body = Buffer.from(lines.map((line) => `${JSON.stringify(line)}\n`).join(''), 'utf8');
  await writeFile(path, body);
  return path;
}

function header(id: string): unknown {
  return { type: 'session', id, version: 0 };
}

function requestContext(seq: number, provider: string, model: string): unknown {
  return {
    type: 'request/context',
    seq,
    time: Date.parse(OBSERVED_AT),
    data: { provider, model, contextWindow: 1_000_000 }
  };
}

function assistantMessage(
  seq: number,
  messageId: string,
  provider: string,
  model: string
): unknown {
  return {
    type: 'assistant/message',
    seq,
    time: Date.parse(OBSERVED_AT),
    data: {
      turn: 1,
      step: seq,
      message: {
        role: 'assistant',
        id: messageId,
        content: [],
        source: { kind: 'model', provider, model }
      },
      usage: {
        inputTokens: 100_000,
        outputTokens: 20_000,
        cacheReadTokens: 10_000,
        reasoningTokens: 0
      }
    },
    surfaceOp: 'append'
  };
}

describe('dsh custom endpoint model rate application and backfill', () => {
  it('automatically prices previously unpriced custom endpoint sessions when custom rate is added', async () => {
    const root = await sessionRoot('custom-rate');
    const databasePath = join(root, '..', 'usage.sqlite');
    const repository = new SqliteUsageRepository(databasePath);
    repository.saveConnectorStatus({
      id: 'dsh',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/dsh',
      officialCredentialPresent: true,
      errorCode: null,
      lastDiscoveredAt: NOW.toISOString(),
      secretReference: null
    });

    await writeJsonlLog(root, 'my-project', 'session-custom-endpoint', [
      header('session-custom-endpoint'),
      requestContext(1, 'my-custom-proxy', 'my-coder-model'),
      assistantMessage(2, 'msg-1', 'my-custom-proxy', 'my-coder-model')
    ]);

    const historyClient = new LocalTranscriptUsageClient({
      provider: 'dsh',
      roots: [root],
      clock: () => NOW
    });

    const application = new UsageApplication({
      repository,
      connectors: [new DshConnector({ historyClient, clock: () => NOW })],
      clock: () => NOW
    });

    // 1. Initially without custom rate: tokens are recorded, but unpriced
    await application.refresh({ userInitiated: true });

    const initialOverview = await application.getOverview({ window: '24h', auditEvidence: true });
    const dshProviderInitial = initialOverview.providers.find((p) => p.id === 'dsh');
    expect(dshProviderInitial).toBeDefined();

    const customDomainInitial = dshProviderInitial?.billingDomains.find(
      (d) => d.id === 'my-custom-proxy'
    );
    expect(customDomainInitial).toBeDefined();
    // 100k input + 20k output + 10k cache = 130k recorded tokens
    expect(customDomainInitial?.tokenTotals.total).toBe(130_000);
    // Cost should be empty / unpriced
    const initialRetailCosts = (customDomainInitial?.costs ?? []).filter(
      (c) => c.kind === 'retail-equivalent'
    );
    expect(initialRetailCosts).toHaveLength(0);

    // 2. Configure custom model rate for my-coder-model under dsh
    const savedRate = await application.setCustomModelRate({
      providerId: 'dsh',
      model: 'my-coder-model',
      inputRate: 2.0,
      outputRate: 5.0,
      cacheReadRate: 0.1
    });
    expect(savedRate.model).toBe('my-coder-model');

    const rates = await application.getCustomModelRates();
    expect(rates).toHaveLength(1);
    expect(rates[0]?.model).toBe('my-coder-model');

    // 3. Verify that previously unpriced session is now automatically backfilled and priced
    const updatedOverview = await application.getOverview({ window: '24h', auditEvidence: true });
    const dshProviderUpdated = updatedOverview.providers.find((p) => p.id === 'dsh');
    const customDomainUpdated = dshProviderUpdated?.billingDomains.find(
      (d) => d.id === 'my-custom-proxy'
    );

    const updatedRetailCosts = (customDomainUpdated?.costs ?? []).filter(
      (c) => c.kind === 'retail-equivalent'
    );
    expect(updatedRetailCosts).toHaveLength(1);
    // 100k * 2.0 / 1M = 0.20, 20k * 5.0 / 1M = 0.10, 10k * 0.1 / 1M = 0.001 -> 0.301 USD
    expect(updatedRetailCosts[0]?.amount).toBeCloseTo(0.301, 5);

    // 4. Delete rate and verify backfill unprices or handles deletion
    const deleted = await application.deleteCustomModelRate(savedRate.id);
    expect(deleted).toBe(true);

    const afterDeleteOverview = await application.getOverview({ window: '24h', auditEvidence: true });
    const customDomainDeleted = afterDeleteOverview.providers
      .find((p) => p.id === 'dsh')
      ?.billingDomains.find((d) => d.id === 'my-custom-proxy');
    const afterDeleteRetailCosts = (customDomainDeleted?.costs ?? []).filter(
      (c) => c.kind === 'retail-equivalent'
    );
    expect(afterDeleteRetailCosts).toHaveLength(0);

    repository.close();
  });
});
