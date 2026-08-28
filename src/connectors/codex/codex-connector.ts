import { z } from 'zod';

import type {
  Connector,
  ConnectorSnapshot,
  QuotaBucket,
  UsageObservation
} from '../../core/types.js';

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

  constructor(client: CodexAccountClient, clock: () => Date = () => new Date()) {
    this.#client = client;
    this.#clock = clock;
  }

  async collect(): Promise<ConnectorSnapshot> {
    const payload = await this.#client.readAccount();
    const observedAt = this.#clock().toISOString();
    return {
      provider: { id: 'codex', displayName: 'Codex' },
      billingDomains: [{ id: 'subscription', displayName: 'Codex subscription' }],
      quotaBuckets: mapQuotaBuckets(payload.rateLimits),
      usage: mapTokenUsage(payload.tokenUsage),
      costs: [],
      observedAt
    };
  }
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
