import { z } from 'zod';

import type {
  Connector,
  CollectionRequest,
  ConnectorFailure,
  ConnectorSnapshot,
  QuotaBucket,
  UsageObservation
} from '../../core/types.js';
import type { TranscriptUsageClient } from '../../server/local-transcript-usage-client.js';
import { normalizeTokenObservation } from '../../core/token-normalization.js';

const nullableNumeric = z.union([z.number(), z.string()]).transform(Number).nullable();
const numeric = z.union([z.number(), z.string()]).transform(Number);
const rateLimitWindowSchema = z
  .object({
    usedPercent: z.number(),
    windowDurationMins: z.number().nullable(),
    resetsAt: z.number().nullable()
  })
  .passthrough();
const rateLimitSnapshotSchema = z
  .object({
    limitId: z.string().nullable(),
    limitName: z.string().nullable(),
    primary: rateLimitWindowSchema.nullable(),
    secondary: rateLimitWindowSchema.nullable()
  })
  .passthrough();
export const codexRateLimitsSchema = z
  .object({
    rateLimits: rateLimitSnapshotSchema,
    rateLimitsByLimitId: z.record(z.string(), rateLimitSnapshotSchema).nullable()
  })
  .passthrough();
export const codexTokenUsageSchema = z
  .object({
    summary: z
      .object({
        lifetimeTokens: nullableNumeric,
        peakDailyTokens: nullableNumeric,
        longestRunningTurnSec: nullableNumeric,
        currentStreakDays: nullableNumeric,
        longestStreakDays: nullableNumeric
      })
      .passthrough(),
    dailyUsageBuckets: z
      .array(
        z
          .object({
            startDate: z.string(),
            tokens: numeric
          })
          .passthrough()
      )
      .nullable()
  })
  .passthrough();

export type CodexRateLimitsResponse = z.infer<typeof codexRateLimitsSchema>;
export type CodexTokenUsageResponse = z.infer<typeof codexTokenUsageSchema>;

export interface CodexAccountPayload {
  rateLimits: CodexRateLimitsResponse;
  tokenUsage: CodexTokenUsageResponse | null;
}

export interface CodexAccountClient {
  readAccount(): Promise<CodexAccountPayload>;
}

export class CodexConnector implements Connector {
  readonly id = 'codex';
  readonly displayName = 'Codex';
  readonly consentId = 'codex';
  readonly #client: CodexAccountClient;
  readonly #clock: () => Date;
  readonly #historyClient?: TranscriptUsageClient;

  constructor(
    client: CodexAccountClient,
    clock: () => Date = () => new Date(),
    historyClient?: TranscriptUsageClient
  ) {
    this.#client = client;
    this.#clock = clock;
    this.#historyClient = historyClient;
  }

  async collect(options: CollectionRequest = { mode: 'incremental' }): Promise<ConnectorSnapshot> {
    const now = this.#clock();
    const observedAt = now.toISOString();
    const warnings: ConnectorFailure[] = [];
    let payload: CodexAccountPayload | null = null;
    try {
      payload = await this.#client.readAccount();
    } catch (error) {
      warnings.push(safeFailure(error));
    }
    const history = this.#historyClient
      ? await this.#historyClient.readUsage(options)
      : { usage: [], costs: [], complete: true };
    const hasLocalHistory = history.usage.length > 0;
    const settledDays = settledAccountDays(payload?.tokenUsage ?? null, now.getTime());
    const canReconcile = history.complete && settledDays.length > 0;
    const accountUsage = canReconcile ? reconcileAccountDays(settledDays, history.usage) : [];
    if (!history.complete) warnings.push(incompleteTranscriptFailure());
    return {
      provider: { id: 'codex', displayName: 'Codex' },
      billingDomains: [{ id: 'subscription', displayName: 'Codex subscription' }],
      quotaBuckets: payload ? mapQuotaBuckets(payload.rateLimits) : [],
      usage: [...accountUsage, ...history.usage],
      ...(hasLocalHistory && canReconcile
        ? {
            usageReconciliation: {
              authoritativeIdPrefixes: ['codex-transcript:', 'codex:daily:'],
              retiredIdPrefixes: []
            }
          }
        : {}),
      costs: history.costs,
      warnings,
      observedAt
    };
  }
}

// The account usage profile is relayed from the Codex backend, which buckets days in UTC and
// finishes aggregating a day some hours after it ends. A bucket whose UTC day has not closed is
// always partial, so it is never evidence for that day's total. A bucket that has closed but is
// still catching up simply reads low, and the outgrown rule below leaves the day to the local
// transcripts until the account total is at least as large as they are.
interface SettledAccountDay {
  day: string;
  startMs: number;
  tokens: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function settledAccountDays(
  response: CodexTokenUsageResponse | null,
  nowMs: number
): SettledAccountDay[] {
  return (response?.dailyUsageBuckets ?? [])
    .map((bucket) => ({
      day: bucket.startDate,
      startMs: Date.parse(`${bucket.startDate}T00:00:00.000Z`),
      tokens: bucket.tokens
    }))
    .filter((day) => Number.isFinite(day.startMs) && day.startMs + DAY_MS <= nowMs);
}

function reconcileAccountDays(
  days: SettledAccountDay[],
  localUsage: UsageObservation[]
): UsageObservation[] {
  const reconciledDays = new Set(days.map((day) => day.day));
  const localTotals = new Map<string, number>();
  for (const observation of localUsage) {
    const day = observation.observedAt.slice(0, 10);
    if (!reconciledDays.has(day)) continue;
    const recorded = normalizeTokenObservation(observation).recordedTokens;
    localTotals.set(day, (localTotals.get(day) ?? 0) + recorded);
  }

  return days.flatMap((day) => {
    const localTotal = localTotals.get(day.day) ?? 0;
    if (localTotal > day.tokens) return [];
    const observedAt = new Date(day.startMs).toISOString();
    const accountObservation = {
      id: `codex:daily:${day.day}`,
      billingDomainId: 'subscription',
      model: null,
      observedAt,
      sourceReportedTotalTokens: day.tokens,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      modelAttribution: 'unclassified',
      timePrecision: 'day',
      usageScope: 'account-wide',
      authority: 'official-account'
    } satisfies UsageObservation;
    if (localTotal === 0) return [accountObservation];
    return [
      accountObservation,
      {
        id: `codex-transcript:account-remainder:${day.day}`,
        billingDomainId: 'subscription',
        model: null,
        observedAt,
        reconciledRemainderTokens: day.tokens - localTotal,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        modelAttribution: 'unclassified',
        timePrecision: 'day',
        usageScope: 'account-wide',
        authority: 'estimate'
      } satisfies UsageObservation
    ];
  });
}

function safeFailure(error: unknown): ConnectorFailure {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    'recovery' in error &&
    typeof error.recovery === 'string'
  ) {
    return { code: error.code, message: error.message, recovery: error.recovery };
  }
  return {
    code: 'codex-account-adapter-failed',
    message: 'Codex account quota is unavailable.',
    recovery: 'Agent Usage will retry automatically.'
  };
}

function incompleteTranscriptFailure(): ConnectorFailure {
  return {
    code: 'local-transcript-scan-incomplete',
    message: 'Some local Codex history could not be read.',
    recovery: 'Agent Usage will retry automatically without removing stored history.'
  };
}

function mapQuotaBuckets(response: CodexRateLimitsResponse): QuotaBucket[] {
  const byId = response.rateLimitsByLimitId;
  const snapshots =
    byId && Object.keys(byId).length > 0
      ? Object.entries(byId)
      : [[response.rateLimits.limitId ?? 'codex', response.rateLimits] as const];
  const multipleLimits = snapshots.length > 1;
  const buckets: QuotaBucket[] = [];

  for (const [key, snapshot] of snapshots) {
    if (!snapshot) continue;
    const baseLabel = snapshot.limitName ?? snapshot.limitId ?? key;
    for (const [windowName, window] of [
      ['primary', snapshot.primary],
      ['secondary', snapshot.secondary]
    ] as const) {
      if (!window) continue;
      const windowLabel = formatWindowLabel(window.windowDurationMins, windowName);
      buckets.push({
        id: `${key}:${windowName}`,
        billingDomainId: 'subscription',
        label: multipleLimits ? `${baseLabel} · ${windowLabel}` : windowLabel,
        usedPercent: window.usedPercent,
        windowDurationMinutes: window.windowDurationMins,
        resetsAt: window.resetsAt === null ? null : new Date(window.resetsAt * 1000).toISOString(),
        authority: 'official-account'
      });
    }
  }
  return buckets;
}

function formatWindowLabel(durationMinutes: number | null, fallback: string): string {
  if (durationMinutes === 300) return '5 hour';
  if (durationMinutes === 10_080) return 'Week';
  if (durationMinutes === null) return fallback === 'primary' ? 'Primary' : 'Secondary';
  if (durationMinutes % 1_440 === 0) return `${durationMinutes / 1_440} days`;
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60} hours`;
  return `${durationMinutes} minutes`;
}
