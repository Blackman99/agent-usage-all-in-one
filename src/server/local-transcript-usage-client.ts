import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, opendir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

import type { CollectionRequest, CostRecord, UsageObservation } from '../core/types.js';
import { normalizeTokenObservation } from '../core/token-normalization.js';

export type LocalTranscriptProvider = 'claude-code' | 'codex' | 'grok';

export interface LocalTranscriptUsageResult {
  usage: UsageObservation[];
  costs: CostRecord[];
  complete: boolean;
}

export interface TranscriptUsageClient {
  readUsage(options?: CollectionRequest): Promise<LocalTranscriptUsageResult>;
}

export interface LocalTranscriptUsageClientOptions {
  provider: LocalTranscriptProvider;
  roots: string[];
  clock?: () => Date;
  lookbackDays?: number;
  cachePath?: string;
}

interface ParsedTranscriptRecord {
  dedupeKey: string;
  observation: UsageObservation;
  reportedCostUsd: number | null;
}

interface TranscriptFile {
  path: string;
  size: number;
  mtimeMs: number;
}

interface CachedTranscriptFile extends TranscriptFile {
  records: ParsedTranscriptRecord[];
  recordsDigest: string;
}

interface CodexScanState {
  model: string;
  sessionId: string;
  lastUsageSignature: string | null;
  sawSessionMeta: boolean;
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
}

export class LocalTranscriptUsageClient implements TranscriptUsageClient {
  readonly #provider: LocalTranscriptProvider;
  readonly #roots: string[];
  readonly #clock: () => Date;
  readonly #lookbackDays: number;
  readonly #cachePath?: string;
  readonly #fileCache = new Map<string, CachedTranscriptFile>();
  #cacheLoaded = false;

  constructor(options: LocalTranscriptUsageClientOptions) {
    this.#provider = options.provider;
    this.#roots = options.roots;
    this.#clock = options.clock ?? (() => new Date());
    this.#lookbackDays = options.lookbackDays ?? 90;
    this.#cachePath = options.cachePath;
  }

  async readUsage(
    options: CollectionRequest = { mode: 'incremental' }
  ): Promise<LocalTranscriptUsageResult> {
    await this.#loadCache();
    if (options.mode === 'hard-rebuild') this.#fileCache.clear();
    const cutoff = this.#clock().getTime() - this.#lookbackDays * 24 * 60 * 60 * 1000;
    const discovered = await listTranscriptFiles(this.#roots, cutoff);
    const files = discovered.files;
    let complete = discovered.complete;
    const usage: UsageObservation[] = [];
    const costs: CostRecord[] = [];
    const seen = new Set<string>();
    const livePaths = new Set(files.map((file) => stableId(file.path)));
    for (const path of this.#fileCache.keys()) {
      if (!livePaths.has(path)) this.#fileCache.delete(path);
    }

    for (const file of files) {
      const parsedFile = await this.#readFile(file);
      complete &&= parsedFile.complete;
      const parsedRecords = parsedFile.records;
      for (const parsed of parsedRecords) {
        if (new Date(parsed.observation.observedAt).getTime() < cutoff) continue;
        if (seen.has(parsed.dedupeKey)) continue;
        seen.add(parsed.dedupeKey);
        usage.push(parsed.observation);
        if (parsed.reportedCostUsd !== null) {
          costs.push({
            id: `${this.#provider}-transcript-cost:${stableId(parsed.dedupeKey)}`,
            sourceId: parsed.observation.id,
            billingDomainId: parsed.observation.billingDomainId,
            observedAt: parsed.observation.observedAt,
            kind: 'reported-estimate',
            amount: parsed.reportedCostUsd,
            currency: 'USD',
            authority: 'local-observation',
            model: parsed.observation.model,
            usageObservationId: parsed.observation.id
          });
        }
      }
    }

    await this.#persistCache();

    return { usage, costs, complete };
  }

  async #readFile(
    file: TranscriptFile
  ): Promise<{ records: ParsedTranscriptRecord[]; complete: boolean }> {
    const cacheKey = stableId(file.path);
    const cached = this.#fileCache.get(cacheKey);
    if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) {
      return { records: cached.records, complete: true };
    }
    const records: ParsedTranscriptRecord[] = [];
    try {
      const codexState: CodexScanState = {
        model: '',
        sessionId: '',
        lastUsageSignature: null,
        sawSessionMeta: false,
        suppressingForkCopies: false,
        forkCopyAnchorMs: 0
      };
      const lines = createInterface({
        input: createReadStream(file.path, { encoding: 'utf8' }),
        crlfDelay: Infinity
      });
      for await (const line of lines) {
        const parsedRecords =
          this.#provider === 'claude-code'
            ? line.includes('"usage"')
              ? compact(parseClaudeTranscriptLine(line))
              : []
            : this.#provider === 'codex'
              ? compact(parseCodexTranscriptLine(line, codexState))
              : line.includes('"turn_completed"')
                ? parseGrokTranscriptLine(line)
                : [];
        records.push(...parsedRecords);
      }
    } catch {
      return { records: cached?.records ?? [], complete: false };
    }
    this.#fileCache.set(cacheKey, {
      ...file,
      path: cacheKey,
      records,
      recordsDigest: stableId(JSON.stringify(records))
    });
    return { records, complete: true };
  }

  async #loadCache(): Promise<void> {
    if (this.#cacheLoaded) return;
    this.#cacheLoaded = true;
    if (!this.#cachePath) return;
    try {
      const stored = JSON.parse(await readFile(this.#cachePath, 'utf8')) as {
        version?: number;
        files?: unknown[];
      };
      if (stored.version !== 1 || !Array.isArray(stored.files)) return;
      for (const file of stored.files) {
        if (!isCachedTranscriptFile(file)) continue;
        if (file.recordsDigest !== stableId(JSON.stringify(file.records))) continue;
        this.#fileCache.set(file.path, file);
      }
    } catch {
      // A missing or corrupt optimization cache is rebuilt from source transcripts.
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
      // Cache persistence never makes transcript collection fail.
    }
  }
}

function isCachedTranscriptFile(value: unknown): value is CachedTranscriptFile {
  const record = asObject(value);
  if (!record || !Array.isArray(record.records)) return false;
  return (
    typeof record.path === 'string' &&
    /^[0-9a-f]{24}$/.test(record.path) &&
    finiteNonNegative(record.size) !== null &&
    finiteNonNegative(record.mtimeMs) !== null &&
    typeof record.recordsDigest === 'string' &&
    /^[0-9a-f]{24}$/.test(record.recordsDigest) &&
    record.records.every(isParsedTranscriptRecord)
  );
}

function isParsedTranscriptRecord(value: unknown): value is ParsedTranscriptRecord {
  const record = asObject(value);
  const observation = asObject(record?.observation);
  if (!record || !observation) return false;
  const authority = observation.authority;
  const requiredTokenFields = [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens'
  ];
  const optionalTokenFields = [
    'reasoningTokens',
    'sourceReportedTotalTokens',
    'reconciledRemainderTokens'
  ];
  const cacheWriteTokenBreakdown = asObject(observation.cacheWriteTokenBreakdown);
  const tokenSemantics = asObject(observation.tokenSemantics);
  const structurallyValid =
    typeof record.dedupeKey === 'string' &&
    (record.reportedCostUsd === null || finiteNonNegative(record.reportedCostUsd) !== null) &&
    typeof observation.id === 'string' &&
    typeof observation.billingDomainId === 'string' &&
    (observation.model === null || typeof observation.model === 'string') &&
    (observation.sessionId === undefined ||
      observation.sessionId === null ||
      typeof observation.sessionId === 'string') &&
    typeof observation.observedAt === 'string' &&
    Number.isFinite(Date.parse(observation.observedAt)) &&
    requiredTokenFields.every((field) => nonNegativeSafeInteger(observation[field])) &&
    optionalTokenFields.every(
      (field) =>
        observation[field] === undefined ||
        observation[field] === null ||
        nonNegativeSafeInteger(observation[field])
    ) &&
    (observation.cacheWriteTokenBreakdown === undefined ||
      observation.cacheWriteTokenBreakdown === null ||
      (cacheWriteTokenBreakdown !== null &&
        nonNegativeSafeInteger(cacheWriteTokenBreakdown.fiveMinute) &&
        nonNegativeSafeInteger(cacheWriteTokenBreakdown.oneHour))) &&
    (observation.tokenSemantics === undefined ||
      (tokenSemantics !== null &&
        ['included-in-output', 'separate'].includes(String(tokenSemantics.reasoning)) &&
        ['included-in-input', 'separate'].includes(String(tokenSemantics.cacheRead)) &&
        ['included-in-input', 'separate'].includes(String(tokenSemantics.cacheWrite)))) &&
    (observation.modelAttribution === undefined ||
      ['known', 'unclassified'].includes(String(observation.modelAttribution))) &&
    (observation.timePrecision === undefined ||
      ['event', 'hour', 'day', 'billing-period', 'unknown'].includes(
        String(observation.timePrecision)
      )) &&
    (observation.usageScope === undefined ||
      ['account-wide', 'this-mac', 'unknown'].includes(String(observation.usageScope))) &&
    (observation.aggregationTemporality === undefined ||
      ['delta', 'cumulative', 'unknown'].includes(String(observation.aggregationTemporality))) &&
    ['official-account', 'official-client', 'local-observation', 'estimate'].includes(
      String(authority)
    );
  if (!structurallyValid) return false;
  try {
    normalizeTokenObservation(observation as unknown as UsageObservation);
    return true;
  } catch {
    return false;
  }
}

function nonNegativeSafeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseGrokTranscriptLine(line: string): ParsedTranscriptRecord[] {
  const record = parseObject(line);
  const params = asObject(record?.params);
  const update = asObject(params?.update);
  const usage = asObject(update?.usage);
  if (!record || !params || !update || !usage || update.sessionUpdate !== 'turn_completed') {
    return [];
  }

  const meta = asObject(params._meta);
  const agentTimestamp = finiteNonNegative(meta?.agentTimestampMs);
  const outerTimestamp = finiteNonNegative(record.timestamp);
  const timestampMs =
    agentTimestamp ??
    (outerTimestamp === null
      ? null
      : outerTimestamp > 1_000_000_000_000
        ? outerTimestamp
        : outerTimestamp * 1000);
  if (timestampMs === null || !Number.isFinite(timestampMs)) return [];

  const modelUsage = asObject(usage.modelUsage);
  const sessionId = string(params.sessionId) ?? '';
  const promptId = string(update.prompt_id);
  const observedAt = new Date(timestampMs).toISOString();
  const models = modelUsage
    ? Object.entries(modelUsage)
        .map(([model, value]) => ({ model, totals: readGrokTotals(value) }))
        .filter(
          (entry): entry is { model: string; totals: GrokTotals } =>
            entry.model.length > 0 && entry.totals !== null && grokRecordedTokens(entry.totals) > 0
        )
    : [];
  const topLevel = readGrokTotals(usage);
  if (models.length === 0 && topLevel && grokRecordedTokens(topLevel) > 0) {
    models.push({ model: 'grok', totals: topLevel });
  }
  if (models.length === 0) return [];

  const topLevelCost = grokCostUsd(topLevel?.costUsdTicks ?? null);
  const explicitCost = models.reduce(
    (total, entry) => total + (grokCostUsd(entry.totals.costUsdTicks) ?? 0),
    0
  );
  const untickedTokens = models.reduce(
    (total, entry) =>
      total + (entry.totals.costUsdTicks === null ? grokRecordedTokens(entry.totals) : 0),
    0
  );
  const remainingCost = topLevelCost === null ? null : Math.max(0, topLevelCost - explicitCost);

  return models.map(({ model, totals }) => {
    const cacheReadTokens = totals.cachedReadTokens;
    const cacheWriteTokens = totals.cacheCreationTokens;
    const inputTokens = Math.max(0, totals.inputTokens - cacheReadTokens - cacheWriteTokens);
    const outputTokens = totals.outputTokens;
    const reasoningTokens = Math.min(outputTokens, totals.reasoningTokens);
    const dedupeKey = `${sessionId}:${promptId ?? stableId(line)}:${model}`;
    const directCost = grokCostUsd(totals.costUsdTicks);
    const reportedCostUsd =
      directCost ??
      (remainingCost !== null && untickedTokens > 0
        ? remainingCost * (grokRecordedTokens(totals) / untickedTokens)
        : null);
    return {
      dedupeKey,
      observation: {
        id: `grok-transcript:${stableId(dedupeKey)}`,
        billingDomainId: 'grok-build-subscription',
        model,
        sessionId,
        observedAt,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cacheReadTokens,
        cacheWriteTokens,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        modelAttribution: model === 'grok' ? 'unclassified' : 'known',
        timePrecision: 'event',
        usageScope: 'this-mac',
        aggregationTemporality: 'delta',
        authority: 'local-observation'
      },
      reportedCostUsd
    };
  });
}

interface GrokTotals {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  costUsdTicks: number | null;
}

function readGrokTotals(value: unknown): GrokTotals | null {
  const record = asObject(value);
  if (!record) return null;
  return {
    inputTokens: positiveInteger(record.inputTokens),
    outputTokens: positiveInteger(record.outputTokens),
    cachedReadTokens: positiveInteger(record.cachedReadTokens),
    cacheCreationTokens: positiveInteger(record.cacheCreationTokens),
    reasoningTokens: positiveInteger(record.reasoningTokens),
    costUsdTicks: finiteNonNegative(record.costUsdTicks)
  };
}

function grokRecordedTokens(totals: GrokTotals): number {
  return totals.inputTokens + totals.outputTokens;
}

function grokCostUsd(ticks: number | null): number | null {
  return ticks === null ? null : ticks / 10_000_000_000;
}

function parseCodexTranscriptLine(
  line: string,
  state: CodexScanState
): ParsedTranscriptRecord | null {
  if (
    !line.includes('"token_count"') &&
    !line.includes('"turn_context"') &&
    !line.includes('"session_meta"')
  ) {
    return null;
  }
  const record = parseObject(line);
  const payload = asObject(record?.payload);
  if (!record || !payload) return null;

  if (record.type === 'session_meta') {
    if (!state.sawSessionMeta) {
      state.sawSessionMeta = true;
      state.sessionId = string(payload.id) ?? string(payload.session_id) ?? '';
      const metaTimestamp = string(record.timestamp);
      if (metaTimestamp && isForkedCodexSession(payload)) {
        state.suppressingForkCopies = true;
        state.forkCopyAnchorMs = Date.parse(metaTimestamp);
      }
    }
    return null;
  }
  if (record.type === 'turn_context') {
    state.model = string(payload.model) ?? state.model;
    return null;
  }
  if (payload.type !== 'token_count' || !state.model) return null;

  const info = asObject(payload.info);
  const last = asObject(info?.last_token_usage);
  const timestamp = string(record.timestamp);
  if (!last || !timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  const signature = JSON.stringify(last);
  if (signature === state.lastUsageSignature) return null;
  state.lastUsageSignature = signature;
  const timestampMs = Date.parse(timestamp);
  if (state.suppressingForkCopies) {
    if (timestampMs - state.forkCopyAnchorMs < 1000) {
      state.forkCopyAnchorMs = timestampMs;
      return null;
    }
    state.suppressingForkCopies = false;
  }

  const inclusiveInput = positiveInteger(last.input_tokens);
  const cacheReadTokens = positiveInteger(last.cached_input_tokens);
  const cacheWriteTokens = positiveInteger(last.cache_write_input_tokens);
  const outputTokens = positiveInteger(last.output_tokens);
  const reasoningTokens = Math.min(outputTokens, positiveInteger(last.reasoning_output_tokens));
  const inputTokens = Math.max(0, inclusiveInput - cacheReadTokens - cacheWriteTokens);
  const categorizedTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  if (categorizedTokens === 0) return null;
  const reportedTotal = optionalNonNegativeInteger(last.total_tokens);
  if (reportedTotal !== null && reportedTotal < categorizedTokens) {
    throw new Error('Codex source-reported total is smaller than categorized Tokens.');
  }
  const sourceReportedTotalTokens = reportedTotal;

  const observedAt = new Date(timestamp).toISOString();
  const dedupeKey = `${state.sessionId}:${observedAt}:${state.model}:${signature}`;
  return {
    dedupeKey,
    observation: {
      id: `codex-transcript:${stableId(dedupeKey)}`,
      billingDomainId: 'subscription',
      model: state.model,
      sessionId: state.sessionId,
      observedAt,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      sourceReportedTotalTokens,
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
    },
    reportedCostUsd: null
  };
}

function isForkedCodexSession(payload: Record<string, unknown>): boolean {
  if (string(payload.forked_from_id)) return true;
  const source = asObject(payload.source);
  const subagent = asObject(source?.subagent);
  const spawn = asObject(subagent?.thread_spawn);
  return string(spawn?.parent_thread_id) !== null;
}

async function listTranscriptFiles(
  roots: string[],
  cutoff: number
): Promise<{ files: TranscriptFile[]; complete: boolean }> {
  const files: TranscriptFile[] = [];
  const visited = new Set<string>();
  let complete = true;
  const walk = async (directory: string, isRoot = false): Promise<void> => {
    let entries;
    try {
      entries = await opendir(directory);
    } catch (error) {
      if (!(isRoot && isMissingPath(error))) complete = false;
      return;
    }
    for await (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (visited.has(path)) continue;
        visited.add(path);
        try {
          const metadata = await stat(path);
          if (metadata.mtimeMs >= cutoff) {
            files.push({ path, size: metadata.size, mtimeMs: metadata.mtimeMs });
          }
        } catch {
          // A rotating transcript may disappear between listing and stat.
          complete = false;
        }
      }
    }
  };
  // Overlapping roots stay harmless: a transcript is read once, whichever root reaches it.
  for (const root of roots) await walk(root, true);
  return { files, complete };
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function parseClaudeTranscriptLine(line: string): ParsedTranscriptRecord | null {
  const record = parseObject(line);
  if (!record || record.type !== 'assistant') return null;
  const message = asObject(record.message);
  const usage = asObject(message?.usage);
  const timestamp = string(record.timestamp);
  const model = string(message?.model);
  if (!message || !usage || !timestamp || !model || !Number.isFinite(Date.parse(timestamp))) {
    return null;
  }

  const messageId = string(message.id);
  const requestId = string(record.requestId);
  const sessionId = string(record.sessionId) ?? '';
  const dedupeKey =
    messageId || requestId
      ? `${messageId ?? ''}:${requestId ?? ''}`
      : `${sessionId}:${timestamp}:${model}:${stableId(line)}`;
  const observationId = `claude-transcript:${stableId(dedupeKey)}`;
  const cacheWriteTokens = positiveInteger(usage.cache_creation_input_tokens);
  const cacheCreation = asObject(usage.cache_creation);
  const cacheWriteFiveMinute = positiveInteger(cacheCreation?.ephemeral_5m_input_tokens);
  const cacheWriteOneHour = positiveInteger(cacheCreation?.ephemeral_1h_input_tokens);
  const hasExactCacheWriteBreakdown =
    cacheCreation !== null && cacheWriteFiveMinute + cacheWriteOneHour === cacheWriteTokens;

  return {
    dedupeKey,
    observation: {
      id: observationId,
      billingDomainId: 'subscription',
      model,
      sessionId,
      observedAt: new Date(timestamp).toISOString(),
      inputTokens: positiveInteger(usage.input_tokens),
      outputTokens: positiveInteger(usage.output_tokens),
      reasoningTokens: 0,
      cacheReadTokens: positiveInteger(usage.cache_read_input_tokens),
      cacheWriteTokens,
      cacheWriteTokenBreakdown: hasExactCacheWriteBreakdown
        ? { fiveMinute: cacheWriteFiveMinute, oneHour: cacheWriteOneHour }
        : null,
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
    },
    reportedCostUsd: finiteNonNegative(record.costUSD)
  };
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    return asObject(JSON.parse(value));
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function positiveInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function optionalNonNegativeInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Source-reported Token total is invalid.');
  }
  return value;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function compact<T>(value: T | null): T[] {
  return value === null ? [] : [value];
}

function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
