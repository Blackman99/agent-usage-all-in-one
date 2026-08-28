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
    const observedAt = this.#clock().toISOString();
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
    const accountUsage = mapTokenUsage(payload?.tokenUsage ?? null);
    const canReconcile = history.complete && accountUsage.length > 0;
    const reconciledRemainders = canReconcile
      ? reconcileAccountRemainders(accountUsage, history.usage)
      : [];
    if (!history.complete) warnings.push(incompleteTranscriptFailure());
    return {
      provider: { id: 'codex', displayName: 'Codex' },
      billingDomains: [{ id: 'subscription', displayName: 'Codex subscription' }],
      quotaBuckets: payload ? mapQuotaBuckets(payload.rateLimits) : [],
      usage: [...accountUsage, ...history.usage, ...reconciledRemainders],
      ...(hasLocalHistory && canReconcile
        ? {
            usageReconciliation: {
              authoritativeIdPrefix: 'codex-transcript:',
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

function reconcileAccountRemainders(
  accountUsage: UsageObservation[],
  localUsage: UsageObservation[]
): UsageObservation[] {
  return accountUsage.flatMap((accountObservation) => {
    const day = accountObservation.observedAt.slice(0, 10);
    const accountTotal = normalizeTokenObservation(accountObservation).recordedTokens;
    const localTotal = localUsage
      .filter((observation) => observation.observedAt.slice(0, 10) === day)
      .reduce(
        (total, observation) => total + normalizeTokenObservation(observation).recordedTokens,
        0
      );
    if (localTotal === 0 || localTotal > accountTotal) return [];
    return [
      {
        id: `codex-transcript:account-remainder:${day}`,
        billingDomainId: 'subscription',
        model: null,
        observedAt: accountObservation.observedAt,
        reconciledRemainderTokens: accountTotal - localTotal,
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
        resetsAt: window.resetsAt === null ? null : new Date(window.resetsAt * 1000).toISOString(),
        authority: 'official-account'
      });
    }
  }
  return buckets;
}

function mapTokenUsage(response: CodexTokenUsageResponse | null): UsageObservation[] {
  return (response?.dailyUsageBuckets ?? []).map((bucket) => ({
    id: `codex:daily:${bucket.startDate}`,
    billingDomainId: 'subscription',
    model: null,
    observedAt: `${bucket.startDate}T00:00:00.000Z`,
    sourceReportedTotalTokens: bucket.tokens,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    modelAttribution: 'unclassified',
    timePrecision: 'day',
    usageScope: 'account-wide',
    authority: 'official-account'
  }));
}

function formatWindowLabel(durationMinutes: number | null, fallback: string): string {
  if (durationMinutes === 300) return '5 hour';
  if (durationMinutes === 10_080) return 'Week';
  if (durationMinutes === null) return fallback === 'primary' ? 'Primary' : 'Secondary';
  if (durationMinutes % 1_440 === 0) return `${durationMinutes / 1_440} days`;
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60} hours`;
  return `${durationMinutes} minutes`;
}
