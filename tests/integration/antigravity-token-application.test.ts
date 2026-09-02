import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import protobuf from 'protobufjs';
import { createRequire } from 'node:module';


import { AntigravityConnector } from '../../src/connectors/antigravity/antigravity-connector.js';
import { defaultConnectorDefinitions } from '../../src/connectors/catalog.js';
import { UsageApplication } from '../../src/core/usage-application.js';
import { AntigravitySqliteUsageClient } from '../../src/server/antigravity-sqlite-usage-client.js';
import { SqliteUsageRepository } from '../../src/server/sqlite-usage-repository.js';

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite'
) as typeof import('node:sqlite');

const NOW = new Date('2026-09-02T12:00:00.000Z');

function createSampleProtobuf(model: string, inputTokens: number, cacheReadTokens = 0): Buffer {
  const writerCache = new protobuf.Writer();
  writerCache.uint32((2 << 3) | 0).uint64(cacheReadTokens);
  const cacheBuf = writerCache.finish();

  const writer10 = new protobuf.Writer();
  writer10.uint32((1 << 3) | 0).uint64(inputTokens);
  if (cacheReadTokens > 0) {
    writer10.uint32((3 << 3) | 2).bytes(cacheBuf);
  }
  const sub10Buf = writer10.finish();

  const writer9 = new protobuf.Writer();
  writer9.uint32((10 << 3) | 2).bytes(sub10Buf);
  const sub9Buf = writer9.finish();

  const writer1 = new protobuf.Writer();
  writer1.uint32((19 << 3) | 2).bytes(Buffer.from(model, 'utf8'));
  writer1.uint32((9 << 3) | 2).bytes(sub9Buf);
  const sub1Buf = writer1.finish();

  const writerTop = new protobuf.Writer();
  writerTop.uint32((1 << 3) | 2).bytes(sub1Buf);
  return Buffer.from(writerTop.finish());
}

function createTimestampProtobuf(seconds: number): Buffer {
  const writerTs = new protobuf.Writer();
  writerTs.uint32((1 << 3) | 0).uint64(seconds);
  const tsBuf = writerTs.finish();

  const writerMeta = new protobuf.Writer();
  writerMeta.uint32((1 << 3) | 2).bytes(tsBuf);
  return Buffer.from(writerMeta.finish());
}

describe('Antigravity token application', () => {
  it('integrates Antigravity session history, empty quota buckets, and retail pricing in overview', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'antigravity-app-test-'));
    try {
      const convDir = join(tempDir, 'conversations');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(convDir, { recursive: true });

      // Create conversation_summaries.db
      const summariesDb = new DatabaseSync(join(tempDir, 'conversation_summaries.db'));
      summariesDb.exec(`
        CREATE TABLE conversation_summaries (
          conversation_id TEXT PRIMARY KEY,
          last_modified_time TEXT
        );
      `);
      summariesDb.prepare(`
        INSERT INTO conversation_summaries (conversation_id, last_modified_time)
        VALUES ('conv-test-1', '2026-09-02T10:00:00.000Z');
      `).run();
      summariesDb.close();

      // Create conversations/conv-test-1.db
      const convDb = new DatabaseSync(join(convDir, 'conv-test-1.db'));
      convDb.exec(`
        CREATE TABLE steps (idx INTEGER PRIMARY KEY, metadata BLOB);
        CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);
      `);

      const genData = createSampleProtobuf('gemini-3.7-flash', 20_000, 5_000);
      const tsData = createTimestampProtobuf(1788343200); // 2026-09-02T10:00:00.000Z

      convDb.prepare('INSERT INTO steps (idx, metadata) VALUES (?, ?)').run(0, tsData);
      convDb.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(0, genData);
      convDb.close();

      const repository = new SqliteUsageRepository(join(tempDir, 'usage.sqlite'));
      repository.saveConnectorStatus({
        id: 'antigravity',
        state: 'connected',
        installed: true,
        binaryPath: '/usr/local/bin/agy',
        officialCredentialPresent: true,
        errorCode: null,
        lastDiscoveredAt: NOW.toISOString(),
        secretReference: null
      });

      const client = new AntigravitySqliteUsageClient({
        roots: [tempDir],
        clock: () => NOW,
        cachePath: join(tempDir, 'cache.json')
      });

      const application = new UsageApplication({
        repository,
        connectors: [new AntigravityConnector({ historyClient: client, clock: () => NOW })],
        connectorDefinitions: defaultConnectorDefinitions,
        clock: () => NOW
      });

      await application.refresh({ userInitiated: true });
      const overview = await application.getOverview({ window: '24h' });
      const provider = overview.providers.find((candidate) => candidate.id === 'antigravity');

      expect(provider).toBeDefined();
      expect(provider?.quotaBuckets).toMatchObject([
        {
          id: '5-hour',
          label: '5 hour',
          windowDurationMinutes: 300
        },
        {
          id: 'weekly',
          label: 'Week',
          windowDurationMinutes: 10_080
        }
      ]);


      const domain = provider?.billingDomains.find((entry) => entry.id === 'code-assist-subscription');
      expect(domain?.tokenTotals).toMatchObject({
        input: 20_000,
        output: 0,
        cacheRead: 5_000,
        total: 25_000
      });

      const retailCosts = (domain?.costs ?? []).filter((cost) => cost.kind === 'retail-equivalent');
      expect(retailCosts).toHaveLength(1);
      expect(retailCosts[0]?.amount).toBeGreaterThan(0);
      expect(retailCosts[0]?.model).toBe('gemini-3.7-flash');

      repository.close();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
