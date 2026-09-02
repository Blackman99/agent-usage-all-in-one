import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import protobuf from 'protobufjs';


import {
  AntigravitySqliteUsageClient,
  canonicalizeAntigravityModel,
  decodeGenMetadata,
  extractTimestampFromStepMetadata
} from '$server/antigravity-sqlite-usage-client.js';

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite'
) as typeof import('node:sqlite');

describe('AntigravitySqliteUsageClient', () => {
  it('canonicalizes known Antigravity model identifiers', () => {
    expect(canonicalizeAntigravityModel('gemini-3p7-flash-exp-d')).toBe('gemini-3.7-flash');
    expect(canonicalizeAntigravityModel('gemini-3.7-flash-high')).toBe('gemini-3.7-flash');
    expect(canonicalizeAntigravityModel('gemini-3.6-flash-low')).toBe('gemini-3.6-flash');
    expect(canonicalizeAntigravityModel('gemini-3.1-pro-high')).toBe('gemini-3.1-pro');
    expect(canonicalizeAntigravityModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(canonicalizeAntigravityModel('Claude Opus 4.6 (Thinking)')).toBe('claude-opus-4-6-thinking');
    expect(canonicalizeAntigravityModel('gpt-oss-120b-medium')).toBe('gpt-oss-120b-medium');
    expect(canonicalizeAntigravityModel('custom-fine-tune')).toBe('custom-fine-tune');
  });

  it('extracts timestamps from step metadata protobuf', () => {
    // Construct protobuf with field 1 = submessage(field 1 = seconds 1788343329, field 2 = nanos 500000000)
    const writerTs = new protobuf.Writer();
    writerTs.uint32((1 << 3) | 0).uint64(1788343329);
    writerTs.uint32((2 << 3) | 0).uint64(500_000_000);
    const tsBuf = writerTs.finish();

    const writerMeta = new protobuf.Writer();
    writerMeta.uint32((1 << 3) | 2).bytes(tsBuf);
    const metaBuf = Buffer.from(writerMeta.finish());

    const timestamp = extractTimestampFromStepMetadata(metaBuf);
    expect(timestamp).toBe(1788343329500);
  });

  it('decodes gen_metadata protobuf with input tokens, cache read tokens, and model name', () => {
    // Construct sub10 with input tokens (f1 = 20848) and cache read tokens (f3 -> f2 = 5000)
    const writerCache = new protobuf.Writer();
    writerCache.uint32((2 << 3) | 0).uint64(5000);
    const cacheBuf = writerCache.finish();

    const writer10 = new protobuf.Writer();
    writer10.uint32((1 << 3) | 0).uint64(20848);
    writer10.uint32((3 << 3) | 2).bytes(cacheBuf);
    const sub10Buf = writer10.finish();

    const writer9 = new protobuf.Writer();
    writer9.uint32((10 << 3) | 2).bytes(sub10Buf);
    const sub9Buf = writer9.finish();

    const writer1 = new protobuf.Writer();
    writer1.uint32((19 << 3) | 2).bytes(Buffer.from('gemini-3p7-flash-exp-d', 'utf8'));
    writer1.uint32((9 << 3) | 2).bytes(sub9Buf);
    const sub1Buf = writer1.finish();

    const writerTop = new protobuf.Writer();
    writerTop.uint32((1 << 3) | 2).bytes(sub1Buf);
    const topBuf = Buffer.from(writerTop.finish());

    const decoded = decodeGenMetadata(topBuf);
    expect(decoded.rawModel).toBe('gemini-3p7-flash-exp-d');
    expect(decoded.canonicalModel).toBe('gemini-3.7-flash');
    expect(decoded.inputTokens).toBe(20848);
    expect(decoded.cacheReadTokens).toBe(5000);
  });

  it('scans synthetic SQLite conversation databases and calculates retail equivalent costs', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'antigravity-test-'));
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
        VALUES ('conv-123', '2026-09-02T10:00:00.000Z');
      `).run();
      summariesDb.close();

      // Create conversations/conv-123.db
      const convDb = new DatabaseSync(join(convDir, 'conv-123.db'));
      convDb.exec(`
        CREATE TABLE steps (idx INTEGER PRIMARY KEY, metadata BLOB);
        CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);
      `);

      // Timestamp for step 0
      const writerTs = new protobuf.Writer();
      writerTs.uint32((1 << 3) | 0).uint64(1788343200); // 2026-09-02T10:00:00Z
      const tsBuf = writerTs.finish();
      const writerMeta = new protobuf.Writer();
      writerMeta.uint32((1 << 3) | 2).bytes(tsBuf);
      const metaBuf = Buffer.from(writerMeta.finish());

      // Gen metadata for step 0
      const writer10 = new protobuf.Writer();
      writer10.uint32((1 << 3) | 0).uint64(100_000);
      const sub10Buf = writer10.finish();
      const writer9 = new protobuf.Writer();
      writer9.uint32((10 << 3) | 2).bytes(sub10Buf);
      const sub9Buf = writer9.finish();
      const writer1 = new protobuf.Writer();
      writer1.uint32((19 << 3) | 2).bytes(Buffer.from('gemini-3.7-flash', 'utf8'));
      writer1.uint32((9 << 3) | 2).bytes(sub9Buf);
      const sub1Buf = writer1.finish();
      const writerTop = new protobuf.Writer();
      writerTop.uint32((1 << 3) | 2).bytes(sub1Buf);
      const genBuf = Buffer.from(writerTop.finish());

      convDb.prepare('INSERT INTO steps (idx, metadata) VALUES (?, ?)').run(0, metaBuf);
      convDb.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(0, genBuf);
      convDb.close();

      const client = new AntigravitySqliteUsageClient({
        roots: [tempDir],
        clock: () => new Date('2026-09-02T12:00:00.000Z'),
        lookbackDays: 7,
        cachePath: join(tempDir, 'cache.json')
      });

      const result = await client.readUsage();
      expect(result.complete).toBe(true);
      expect(result.usage.length).toBe(1);
      expect(result.usage[0]).toMatchObject({
        id: 'antigravity:conv-123:0',
        billingDomainId: 'code-assist-subscription',
        model: 'gemini-3.7-flash',
        inputTokens: 100_000,
        observedAt: '2026-09-02T10:00:00.000Z',
        authority: 'local-observation'
      });

      expect(result.costs.length).toBe(1);
      expect(result.costs[0]?.amount).toBeCloseTo(0.01, 4);

      // Verify incremental cache hit on second read
      const cachedResult = await client.readUsage();
      expect(cachedResult.usage.length).toBe(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
