import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, zstdCompressSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import { LocalTranscriptUsageClient } from '$server/local-transcript-usage-client.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

import { DshConnector } from '../../src/connectors/dsh/dsh-connector.js';

const NOW = new Date('2026-08-31T18:00:00.000Z');
/** Monday 12:00 UTC: outside the published 01–04 and 06–10 UTC peak windows. */
const OFF_PEAK = '2026-08-31T12:00:00.000Z';
/** Monday 02:00 UTC: inside the first published peak window. */
const PEAK = '2026-08-31T02:00:00.000Z';
const OFF_PEAK_COST = 0.000387;
const PEAK_COST = 0.000774;

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

async function sessionRoot(name: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), `agent-usage-dsh-${name}-`));
  workspaces.push(workspace);
  return join(workspace, 'sessions');
}

/** One checksummed frame per logical line, as the append-only backend writes them. */
function compressLines(lines: unknown[]): Buffer {
  return Buffer.concat(
    lines.map((line) =>
      zstdCompressSync(Buffer.from(`${JSON.stringify(line)}\n`, 'utf8'), {
        params: { [constants.ZSTD_c_checksumFlag]: 1 }
      })
    )
  );
}

async function writeSessionLog(
  root: string,
  project: string,
  sessionId: string,
  lines: unknown[],
  encoding: 'zstd' | 'none' = 'zstd'
): Promise<string> {
  const directory = join(root, `--${project}--`, sessionId);
  await mkdir(directory, { recursive: true });
  const path = join(directory, encoding === 'zstd' ? 'session.jsonl.zstd' : 'session.jsonl');
  const body =
    encoding === 'zstd'
      ? compressLines(lines)
      : Buffer.from(lines.map((line) => `${JSON.stringify(line)}\n`).join(''), 'utf8');
  await writeFile(path, body);
  return path;
}

function header(id: string, extra: Record<string, unknown> = {}): unknown {
  return {
    type: 'session',
    version: 0,
    id,
    createdAt: Date.parse(PEAK),
    cwd: '/Users/dev/project',
    delegationDepth: 0,
    agentPreset: 'code-cli',
    ...extra
  };
}

function requestContext(seq: number, model: string): unknown {
  return {
    type: 'request/context',
    seq,
    time: Date.parse(PEAK),
    data: { provider: 'deepseek-official', model, contextWindow: 1_000_000 }
  };
}

function assistantMessage(
  seq: number,
  messageId: string,
  observedAt: string,
  model = 'deepseek-v4-flash'
): unknown {
  return {
    type: 'assistant/message',
    seq,
    time: Date.parse(observedAt),
    data: {
      turn: 1,
      step: seq,
      message: {
        role: 'assistant',
        id: messageId,
        content: [],
        source: { kind: 'model', provider: 'deepseek-official', model }
      },
      usage: {
        inputTokens: 1_000,
        outputTokens: 200,
        cacheReadTokens: 5_000,
        reasoningTokens: 50
      }
    },
    surfaceOp: 'append'
  };
}

/** A packed delta-chunk row, which carries no usage and must never be counted. */
function packedChunkRow(seq: number): unknown {
  return {
    type: 'text-chunks',
    seq0: seq,
    time0: Date.parse(OFF_PEAK),
    dt: [1, 2],
    text: ['a', 'b']
  };
}

function dshClient(root: string): LocalTranscriptUsageClient {
  return new LocalTranscriptUsageClient({ provider: 'dsh', roots: [root], clock: () => NOW });
}

describe('dsh token application', () => {
  it('counts every session log once and prices it against DeepSeek published rates', async () => {
    const root = await sessionRoot('tokens');
    await writeSessionLog(root, 'Users-dev-project', 'session-parent', [
      header('session-parent'),
      requestContext(2, 'deepseek-v4-flash'),
      assistantMessage(3, 'message-off-peak', OFF_PEAK),
      packedChunkRow(4),
      assistantMessage(7, 'message-peak', PEAK)
    ]);
    // A subagent keeps its own log, so its requests are separate observations
    // rather than a second copy of the parent's.
    await writeSessionLog(
      root,
      'Users-dev-project',
      'session-child',
      [
        header('session-child', { origin: 'subagent', delegationDepth: 1 }),
        requestContext(2, 'deepseek-v4-flash'),
        assistantMessage(3, 'message-child', OFF_PEAK)
      ],
      'none'
    );
    const repository = new SqliteUsageRepository(join(root, '..', 'usage.sqlite'));
    // Collection follows the same consent gate every Provider uses: the person
    // connects dsh in Settings before its logs are read.
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
    const application = new UsageApplication({
      repository,
      connectors: [new DshConnector({ historyClient: dshClient(root), clock: () => NOW })],
      clock: () => NOW
    });

    await application.refresh({ userInitiated: true });
    const overview = await application.getOverview({ window: '24h' });
    const provider = overview.providers.find((candidate) => candidate.id === 'dsh');

    expect(provider).toBeDefined();
    expect(provider?.summaryBillingDomainId).toBe('deepseek-official');
    expect(provider?.quotaBuckets).toEqual([]);
    const domain = provider?.billingDomains.find((entry) => entry.id === 'deepseek-official');
    expect(domain?.tokenTotals).toMatchObject({
      input: 3_000,
      output: 600,
      reasoning: 150,
      cacheRead: 15_000,
      cacheWrite: 0,
      total: 18_600
    });
    expect(domain?.tokenEvidence).toMatchObject({
      observationCount: 3,
      timePrecisions: ['event'],
      usageScopes: ['this-mac'],
      unclassifiedTokens: 0
    });
    const retail = (domain?.costs ?? []).filter((cost) => cost.kind === 'retail-equivalent');
    expect(retail).toHaveLength(3);
    expect(retail.map((cost) => cost.amount).sort()).toEqual(
      [OFF_PEAK_COST, OFF_PEAK_COST, PEAK_COST].sort()
    );
    expect(retail.every((cost) => cost.authority === 'estimate')).toBe(true);
    // No reported estimate exists to relabel: dsh logs accounting, not money.
    expect((domain?.costs ?? []).some((cost) => cost.kind === 'reported-estimate')).toBe(false);

    await application.refresh({ userInitiated: true });
    const second = await application.getOverview({ window: '24h' });
    expect(
      second.providers
        .find((candidate) => candidate.id === 'dsh')
        ?.billingDomains.find((entry) => entry.id === 'deepseek-official')?.tokenTotals.total
    ).toBe(18_600);
    repository.close();
  });

  it('keeps the records before an unfinished final frame', async () => {
    const root = await sessionRoot('torn');
    const complete = compressLines([
      header('session-torn'),
      requestContext(2, 'deepseek-v4-flash'),
      assistantMessage(3, 'message-complete', OFF_PEAK)
    ]);
    const torn = compressLines([assistantMessage(4, 'message-torn', OFF_PEAK)]);
    const directory = join(root, '--Users-dev-project--', 'session-torn');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'session.jsonl.zstd'),
      Buffer.concat([complete, torn.subarray(0, torn.byteLength - 6)])
    );

    const result = await dshClient(root).readUsage();

    expect(result.usage.map((observation) => observation.model)).toEqual(['deepseek-v4-flash']);
    expect(result.complete).toBe(true);
    expect(result.unsupportedFormat).toBe(false);
  });

  it('skips a log whose on-disk format version is unknown and names the gap', async () => {
    const root = await sessionRoot('version');
    await writeSessionLog(root, 'Users-dev-project', 'session-future', [
      header('session-future', { version: 1 }),
      requestContext(2, 'deepseek-v4-flash'),
      assistantMessage(3, 'message-future', OFF_PEAK)
    ]);
    await writeSessionLog(root, 'Users-dev-project', 'session-current', [
      header('session-current'),
      requestContext(2, 'deepseek-v4-flash'),
      assistantMessage(3, 'message-current', OFF_PEAK)
    ]);

    const result = await dshClient(root).readUsage();

    expect(result.usage).toHaveLength(1);
    expect(result.unsupportedFormat).toBe(true);
    expect(result.complete).toBe(false);
  });

  it('attributes a request to the route that answered it', async () => {
    const root = await sessionRoot('routes');
    await writeSessionLog(root, 'Users-dev-project', 'session-routes', [
      header('session-routes'),
      requestContext(2, 'deepseek-v4-flash'),
      assistantMessage(3, 'message-deepseek', OFF_PEAK),
      {
        type: 'assistant/message',
        seq: 4,
        time: Date.parse(OFF_PEAK),
        data: {
          turn: 1,
          step: 2,
          message: {
            role: 'assistant',
            id: 'message-other-route',
            content: [],
            source: { kind: 'model', provider: 'openai-compatible', model: 'gpt-5.6-terra' }
          },
          usage: { inputTokens: 10, outputTokens: 20 }
        }
      }
    ]);

    const snapshot = await new DshConnector({
      historyClient: dshClient(root),
      clock: () => NOW
    }).collect();

    expect(snapshot.billingDomains).toEqual([
      { id: 'deepseek-official', displayName: 'DeepSeek API' },
      { id: 'openai-compatible', displayName: 'openai-compatible' }
    ]);
    expect(
      snapshot.usage.map((observation) => [observation.billingDomainId, observation.model])
    ).toEqual([
      ['deepseek-official', 'deepseek-v4-flash'],
      ['openai-compatible', 'gpt-5.6-terra']
    ]);
  });
});
