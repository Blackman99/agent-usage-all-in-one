import { createHash } from 'node:crypto';
import { readdir, readFile, rename, stat, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import protobuf from 'protobufjs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

import { normalizeTokenObservation } from '../core/token-normalization.js';
import {
  OFFICIAL_PRICING_CATALOG,
  deriveRetailEquivalentCosts,
  type RetailPriceCatalog
} from '../core/retail-pricing.js';
import type { CollectionRequest, CostRecord, UsageObservation } from '../core/types.js';

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite'
) as typeof import('node:sqlite');

export interface AntigravitySqliteUsageClientOptions {
  roots: string[];
  clock?: () => Date;
  lookbackDays?: number;
  cachePath?: string;
  priceCatalog?: RetailPriceCatalog;
}

export interface AntigravitySqliteUsageResult {
  usage: UsageObservation[];
  costs: CostRecord[];
  complete: boolean;
  unsupportedFormat?: boolean;
}

interface ParsedAntigravityRecord {
  dedupeKey: string;
  observation: UsageObservation;
}

interface CachedDatabaseFile {
  path: string;
  size: number;
  mtimeMs: number;
  records: ParsedAntigravityRecord[];
  recordsDigest: string;
}

export class AntigravitySqliteUsageClient {
  readonly #roots: string[];
  readonly #clock: () => Date;
  readonly #lookbackDays: number;
  readonly #cachePath?: string;
  readonly #priceCatalog: RetailPriceCatalog;
  readonly #fileCache = new Map<string, CachedDatabaseFile>();
  #cacheLoaded = false;

  constructor(options: AntigravitySqliteUsageClientOptions) {
    this.#roots = options.roots;
    this.#clock = options.clock ?? (() => new Date());
    this.#lookbackDays = options.lookbackDays ?? 90;
    this.#cachePath = options.cachePath;
    this.#priceCatalog = options.priceCatalog ?? OFFICIAL_PRICING_CATALOG;
  }

  async readUsage(
    options: CollectionRequest = { mode: 'incremental' }
  ): Promise<AntigravitySqliteUsageResult> {
    await this.#loadCache();
    if (options.mode === 'hard-rebuild') this.#fileCache.clear();

    const cutoff = this.#clock().getTime() - this.#lookbackDays * 24 * 60 * 60 * 1000;
    const discoveredFiles = await this.#discoverDatabases(cutoff);

    const livePaths = new Set(discoveredFiles.map((file) => stableId(file.path)));
    for (const path of this.#fileCache.keys()) {
      if (!livePaths.has(path)) this.#fileCache.delete(path);
    }

    const usage: UsageObservation[] = [];
    const seenDedupeKeys = new Set<string>();
    let allComplete = true;

    for (const file of discoveredFiles) {
      const parsed = await this.#parseDatabaseFile(file);
      allComplete &&= parsed.complete;

      for (const record of parsed.records) {
        if (new Date(record.observation.observedAt).getTime() < cutoff) continue;
        if (seenDedupeKeys.has(record.dedupeKey)) continue;
        seenDedupeKeys.add(record.dedupeKey);
        usage.push(record.observation);
      }
    }

    // Sort observations deterministically by timestamp and dedupeKey
    usage.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));

    // Calculate retail equivalent costs for all observations
    const { costs } = deriveRetailEquivalentCosts(
      {
        provider: { id: 'antigravity', displayName: 'Antigravity' },
        billingDomains: [{ id: 'code-assist-subscription', displayName: 'Gemini Code Assist' }],
        quotaBuckets: [],
        usage,
        costs: [],
        observedAt: this.#clock().toISOString()
      },
      this.#priceCatalog
    );

    await this.#persistCache();

    return {
      usage,
      costs,
      complete: allComplete
    };
  }

  async #discoverDatabases(
    cutoff: number
  ): Promise<Array<{ path: string; size: number; mtimeMs: number; conversationId: string }>> {
    const results: Array<{ path: string; size: number; mtimeMs: number; conversationId: string }> =
      [];
    const seenDbPaths = new Set<string>();

    for (const root of this.#roots) {
      try {
        const rootStat = await stat(root);
        if (!rootStat.isDirectory()) continue;
      } catch {
        continue;
      }

      // First try to inspect conversation_summaries.db for fast filtering
      const summariesPath = join(root, 'conversation_summaries.db');
      const candidateIds = new Set<string>();
      let summariesLoaded = false;

      try {
        const summariesStat = await stat(summariesPath);
        if (summariesStat.isFile()) {
          const db: DatabaseSyncType = new DatabaseSync(summariesPath, { readOnly: true });
          try {
            const rows = db
              .prepare('SELECT conversation_id, last_modified_time FROM conversation_summaries')
              .all() as Array<{ conversation_id?: string; last_modified_time?: string }>;

            for (const row of rows) {
              if (!row.conversation_id) continue;
              const modifiedMs = row.last_modified_time
                ? new Date(row.last_modified_time).getTime()
                : 0;
              if (modifiedMs >= cutoff || modifiedMs === 0) {
                candidateIds.add(row.conversation_id);
              }
            }
            summariesLoaded = true;
          } finally {
            db.close();
          }
        }
      } catch {
        // Fall back to scanning conversations/ directly
      }

      const convDir = join(root, 'conversations');
      try {
        const entries = await readdir(convDir);
        for (const entry of entries) {
          if (!entry.endsWith('.db')) continue;
          const convId = entry.slice(0, -3);
          if (summariesLoaded && candidateIds.size > 0 && !candidateIds.has(convId)) {
            continue;
          }
          const fullPath = join(convDir, entry);
          if (seenDbPaths.has(fullPath)) continue;
          seenDbPaths.add(fullPath);

          try {
            const fileStat = await stat(fullPath);
            if (fileStat.mtimeMs < cutoff && summariesLoaded) continue;
            results.push({
              path: fullPath,
              size: fileStat.size,
              mtimeMs: fileStat.mtimeMs,
              conversationId: convId
            });
          } catch {
            // Ignore missing/inaccessible files
          }
        }
      } catch {
        // Missing conversations directory is normal for uninitialized root
      }
    }

    return results;
  }

  async #parseDatabaseFile(file: {
    path: string;
    size: number;
    mtimeMs: number;
    conversationId: string;
  }): Promise<{ records: ParsedAntigravityRecord[]; complete: boolean }> {
    const cached = this.#fileCache.get(stableId(file.path));
    if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) {
      return { records: cached.records, complete: true };
    }

    try {
      const records = parseAntigravityDatabase(file.path, file.conversationId, file.mtimeMs);
      const digest = stableId(JSON.stringify(records));
      this.#fileCache.set(stableId(file.path), {
        path: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        records,
        recordsDigest: digest
      });
      return { records, complete: true };
    } catch {
      return { records: [], complete: false };
    }
  }

  async #loadCache(): Promise<void> {
    if (this.#cacheLoaded) return;
    this.#cacheLoaded = true;
    if (!this.#cachePath) return;

    try {
      const content = await readFile(this.#cachePath, 'utf8');
      const stored = JSON.parse(content) as {
        version?: number;
        files?: unknown[];
      };
      if (stored.version !== 1 || !Array.isArray(stored.files)) return;

      for (const item of stored.files) {
        if (!isCachedDatabaseFile(item)) continue;
        if (item.recordsDigest !== stableId(JSON.stringify(item.records))) continue;
        this.#fileCache.set(stableId(item.path), item);
      }
    } catch {
      // Rebuild on cache failure
    }
  }

  async #persistCache(): Promise<void> {
    if (!this.#cachePath) return;
    try {
      await mkdir(dirname(this.#cachePath), { recursive: true, mode: 0o700 });
      const temporary = `${this.#cachePath}.${process.pid}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, files: [...this.#fileCache.values()] }),
        { mode: 0o600 }
      );
      await rename(temporary, this.#cachePath);
    } catch {
      // Cache persistence failures must not block collection
    }
  }
}

export function parseAntigravityDatabase(
  dbPath: string,
  conversationId: string,
  fallbackMtimeMs: number
): ParsedAntigravityRecord[] {
  const db: DatabaseSyncType = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tableExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gen_metadata'")
      .get();
    if (!tableExists) return [];

    // Query steps timestamps
    const stepTimestamps = new Map<number, number>();
    try {
      const stepRows = db
        .prepare('SELECT idx, metadata FROM steps WHERE length(metadata) > 0')
        .all() as Array<{ idx: number; metadata: Buffer }>;
      for (const row of stepRows) {
        const ts = extractTimestampFromStepMetadata(row.metadata);
        if (ts !== null) stepTimestamps.set(row.idx, ts);
      }
    } catch {
      // Steps timestamp failure degrades to fallback mtime
    }

    const genRows = db
      .prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC')
      .all() as Array<{ idx: number; data: Buffer }>;

    const records: ParsedAntigravityRecord[] = [];

    for (const row of genRows) {
      if (!row.data || row.data.length === 0) continue;
      const parsed = decodeGenMetadata(row.data);
      if (parsed.inputTokens === 0 && parsed.outputTokens === 0 && parsed.cacheReadTokens === 0) {
        continue;
      }

      const timestampMs = stepTimestamps.get(row.idx) ?? fallbackMtimeMs;
      const observedAt = new Date(timestampMs).toISOString();
      const dedupeKey = `antigravity:${conversationId}:${row.idx}`;

      const observation: UsageObservation = {
        id: dedupeKey,
        billingDomainId: 'code-assist-subscription',
        model: parsed.canonicalModel,
        observedAt,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        reasoningTokens: 0,
        cacheReadTokens: parsed.cacheReadTokens,
        cacheWriteTokens: 0,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        modelAttribution: 'known',
        timePrecision: 'event',
        usageScope: 'this-mac',
        aggregationTemporality: 'delta',
        authority: 'local-observation'
      };

      // Validate observation with project normalization schema
      normalizeTokenObservation(observation);
      records.push({ dedupeKey, observation });
    }

    return records;
  } finally {
    db.close();
  }
}

export function decodeGenMetadata(buf: Buffer): {
  rawModel: string;
  canonicalModel: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
} {
  let rawModel = 'unknown';
  let inputTokens = 0;
  const outputTokens = 0;
  let cacheReadTokens = 0;

  try {
    const r = protobuf.Reader.create(buf);
    while (r.pos < r.len) {
      const tag = r.uint32();
      const fn = tag >>> 3;
      const wt = tag & 7;

      if (fn === 1 && wt === 2) {
        const sub1 = r.bytes();
        const rSub = protobuf.Reader.create(sub1);
        while (rSub.pos < rSub.len) {
          const sTag = rSub.uint32();
          const sFn = sTag >>> 3;
          const sWt = sTag & 7;

          if (sFn === 19 && sWt === 2) {
            rawModel = Buffer.from(rSub.bytes()).toString('utf8');
          } else if (sFn === 9 && sWt === 2) {
            const sub9 = rSub.bytes();
            const r9 = protobuf.Reader.create(sub9);
            while (r9.pos < r9.len) {
              const t9 = r9.uint32();
              const fn9 = t9 >>> 3;
              const wt9 = t9 & 7;

              if (fn9 === 10 && wt9 === 2) {
                const sub10 = r9.bytes();
                const r10 = protobuf.Reader.create(sub10);
                while (r10.pos < r10.len) {
                  const t10 = r10.uint32();
                  const fn10 = t10 >>> 3;
                  const wt10 = t10 & 7;

                  if (fn10 === 1 && wt10 === 0) {
                    inputTokens = toNumeric(r10.uint64());
                  } else if (fn10 === 3 && wt10 === 2) {
                    const sub3 = r10.bytes();
                    const r3 = protobuf.Reader.create(sub3);
                    while (r3.pos < r3.len) {
                      const t3 = r3.uint32();
                      const fn3 = t3 >>> 3;
                      const wt3 = t3 & 7;
                      if (fn3 === 2 && wt3 === 0) {
                        cacheReadTokens = toNumeric(r3.uint64());
                      } else {
                        r3.skipType(wt3);
                      }
                    }
                  } else {
                    r10.skipType(wt10);
                  }
                }
              } else {
                r9.skipType(wt9);
              }
            }
          } else {
            rSub.skipType(sWt);
          }
        }
      } else {
        r.skipType(wt);
      }
    }
  } catch {
    // Gracefully return partial or zero tokens on corrupt protobuf
  }

  return {
    rawModel,
    canonicalModel: canonicalizeAntigravityModel(rawModel),
    inputTokens,
    outputTokens,
    cacheReadTokens
  };
}

export function canonicalizeAntigravityModel(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (normalized.startsWith('gemini-3p7') || normalized.startsWith('gemini-3.7')) {
    return 'gemini-3.7-flash';
  }
  if (normalized.startsWith('gemini-3p6') || normalized.startsWith('gemini-3.6')) {
    return 'gemini-3.6-flash';
  }
  if (normalized.startsWith('gemini-3p1') || normalized.startsWith('gemini-3.1')) {
    return 'gemini-3.1-pro';
  }
  if (normalized.includes('claude-sonnet')) {
    return 'claude-sonnet-4-6';
  }
  if (normalized.includes('claude-opus')) {
    return 'claude-opus-4-6-thinking';
  }
  if (normalized.includes('gpt-oss')) {
    return 'gpt-oss-120b-medium';
  }
  return raw.trim() || 'unknown';
}

export function extractTimestampFromStepMetadata(buf: Buffer): number | null {
  try {
    const r = protobuf.Reader.create(buf);
    while (r.pos < r.len) {
      const tag = r.uint32();
      const fn = tag >>> 3;
      const wt = tag & 7;
      if (fn === 1 && wt === 2) {
        const tsBytes = r.bytes();
        const rTs = protobuf.Reader.create(tsBytes);
        let seconds = 0;
        let nanos = 0;
        while (rTs.pos < rTs.len) {
          const t = rTs.uint32();
          const tFn = t >>> 3;
          const tWt = t & 7;
          if (tFn === 1 && tWt === 0) {
            seconds = toNumeric(rTs.uint64());
          } else if (tFn === 2 && tWt === 0) {
            nanos = toNumeric(rTs.uint64());
          } else {
            rTs.skipType(tWt);
          }
        }
        if (seconds > 0) {
          return seconds * 1000 + Math.floor(nanos / 1_000_000);
        }
      } else {
        r.skipType(wt);
      }
    }
  } catch {
    // Degrade gracefully
  }
  return null;
}

function toNumeric(val: number | protobuf.Long | unknown): number {
  return Number(val?.toString?.() ?? 0);
}

function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function isCachedDatabaseFile(value: unknown): value is CachedDatabaseFile {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.path === 'string' &&
    typeof rec.size === 'number' &&
    typeof rec.mtimeMs === 'number' &&
    Array.isArray(rec.records) &&
    typeof rec.recordsDigest === 'string'
  );
}
