import { z } from 'zod';

import type { SecretStore } from '../../core/onboarding-types.js';
import type {
  BalanceRecord,
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  CostRecord,
  InvoiceRecord,
  QuotaBucket,
  UsageObservation
} from '../../core/types.js';

const numericString = z.union([z.string(), z.number()]).transform(Number);
const centSchema = z.object({ val: numericString }).passthrough();
const validationSchema = z
  .object({
    teamId: z.string().optional(),
    scope: z.string().optional(),
    scopeId: z.string().optional()
  })
  .passthrough();
const usageSchema = z
  .object({
    timeSeries: z.array(
      z
        .object({
          group: z.array(z.string()).default([]),
          groupLabels: z.array(z.string()).default([]),
          dataPoints: z.array(
            z
              .object({
                timestamp: z.string(),
                values: z.array(z.number())
              })
              .passthrough()
          )
        })
        .passthrough()
    ),
    limitReached: z.boolean().default(false)
  })
  .passthrough();
const balanceSchema = z
  .object({
    total: centSchema.optional()
  })
  .passthrough();
const limitsSchema = z
  .object({
    spendingLimits: z
      .object({
        effectiveSl: centSchema.optional(),
        softSl: centSchema.optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();
const previewSchema = z
  .object({
    coreInvoice: z
      .object({
        amountBeforeVat: numericString.optional(),
        totalWithCorr: centSchema.optional()
      })
      .passthrough()
      .optional(),
    effectiveSpendingLimit: numericString.optional(),
    billingCycle: z.object({ year: z.number(), month: z.number() }).passthrough().optional()
  })
  .passthrough();
const invoiceLineSchema = z
  .object({
    description: z.string(),
    unitType: z.string(),
    numUnits: numericString
  })
  .passthrough();
const invoiceSchema = z
  .object({
    invoiceId: z.string(),
    invoiceNumber: z.string().optional(),
    createTime: z.string(),
    invoiceStatus: z.string().optional(),
    total: numericString.optional(),
    lines: z.array(invoiceLineSchema).default([])
  })
  .passthrough();
const invoicesSchema = z.object({ invoices: z.array(invoiceSchema) }).passthrough();

type UsageResponse = z.infer<typeof usageSchema>;
type Invoice = z.infer<typeof invoiceSchema>;

interface XaiApiAccountPayload {
  teamId: string;
  usage: UsageResponse | null;
  balanceCents: number | null;
  spendingLimitCents: number | null;
  currentInvoiceCents: number | null;
  invoices: Invoice[];
  warnings: ConnectorFailure[];
}

export interface XaiApiAccountClient {
  readAccount(): Promise<XaiApiAccountPayload>;
}

export interface XaiManagementApiClientOptions {
  secretStore: SecretStore;
  fetch?: typeof fetch;
  clock?: () => Date;
  baseUrl?: string;
}

export class XaiManagementApiError extends Error {
  readonly code:
    | 'xai-management-key-missing'
    | 'xai-management-key-invalid'
    | 'xai-management-team-scope-required';
  readonly recovery: string;

  constructor(code: XaiManagementApiError['code'], message: string, recovery: string) {
    super(message);
    this.name = 'XaiManagementApiError';
    this.code = code;
    this.recovery = recovery;
  }
}

export class XaiManagementApiClient implements XaiApiAccountClient {
  readonly #secretStore: SecretStore;
  readonly #fetch: typeof fetch;
  readonly #clock: () => Date;
  readonly #baseUrl: string;

  constructor(options: XaiManagementApiClientOptions) {
    this.#secretStore = options.secretStore;
    this.#fetch = options.fetch ?? fetch;
    this.#clock = options.clock ?? (() => new Date());
    this.#baseUrl = (options.baseUrl ?? 'https://management-api.x.ai').replace(/\/$/, '');
  }

  async readAccount(): Promise<XaiApiAccountPayload> {
    const key = await this.#secretStore.get('connector:xai-api');
    if (!key) {
      throw new XaiManagementApiError(
        'xai-management-key-missing',
        'The xAI Management API key is not configured.',
        'Connect xAI API and save a dedicated management key in Keychain.'
      );
    }

    const validationResponse = await this.#request(
      key,
      '/auth/management-keys/validation',
      validationSchema
    );
    const teamId =
      validationResponse.teamId ??
      (validationResponse.scope === 'SCOPE_TEAM' ? validationResponse.scopeId : undefined);
    if (!teamId) {
      throw new XaiManagementApiError(
        'xai-management-team-scope-required',
        'This management key does not identify one xAI API team.',
        'Use a team-scoped management key; organization team selection is not configured.'
      );
    }

    const now = this.#clock();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const authorization = { authorization: `Bearer ${key}` };
    const usageBody = {
      analyticsRequest: {
        timeRange: {
          startTime: analyticsTimestamp(start),
          endTime: analyticsTimestamp(now),
          timezone: 'Etc/GMT'
        },
        timeUnit: 'TIME_UNIT_DAY',
        values: [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }],
        groupBy: ['description'],
        filters: []
      }
    };
    const invoiceQuery = `since.year=${start.getUTCFullYear()}&since.month=${start.getUTCMonth() + 1}`;

    const [usage, balance, limits, preview, invoices] = await Promise.all([
      this.#optionalRequest(
        key,
        `/v1/billing/teams/${encodeURIComponent(teamId)}/usage`,
        usageSchema,
        {
          method: 'POST',
          headers: { ...authorization, 'content-type': 'application/json' },
          body: JSON.stringify(usageBody)
        },
        'usage'
      ),
      this.#optionalRequest(
        key,
        `/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`,
        balanceSchema,
        undefined,
        'balance'
      ),
      this.#optionalRequest(
        key,
        `/v1/billing/teams/${encodeURIComponent(teamId)}/postpaid/spending-limits`,
        limitsSchema,
        undefined,
        'spending limit'
      ),
      this.#optionalRequest(
        key,
        `/v1/billing/teams/${encodeURIComponent(teamId)}/postpaid/invoice/preview`,
        previewSchema,
        undefined,
        'invoice preview'
      ),
      this.#optionalRequest(
        key,
        `/v1/billing/teams/${encodeURIComponent(teamId)}/invoices?${invoiceQuery}`,
        invoicesSchema,
        undefined,
        'invoices'
      )
    ]);

    const warnings = [usage, balance, limits, preview, invoices].flatMap(
      (result) => result.warning ?? []
    );
    if (usage.value?.limitReached) {
      warnings.push({
        code: 'xai-api-history-partial',
        message: 'xAI API returned only part of the requested usage history.',
        recovery: 'Narrow the history range or grouping, then retry.'
      });
    }
    return {
      teamId,
      usage: usage.value ?? null,
      balanceCents: balance.value?.total?.val ?? null,
      spendingLimitCents:
        limits.value?.spendingLimits?.effectiveSl?.val ??
        preview.value?.effectiveSpendingLimit ??
        null,
      currentInvoiceCents:
        preview.value?.coreInvoice?.amountBeforeVat ??
        preview.value?.coreInvoice?.totalWithCorr?.val ??
        null,
      invoices: invoices.value?.invoices ?? [],
      warnings
    };
  }

  async #optionalRequest<T>(
    key: string,
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit | undefined,
    label: string
  ): Promise<{ value?: T; warning?: ConnectorFailure }> {
    try {
      return { value: await this.#request(key, path, schema, init) };
    } catch (error) {
      return { warning: endpointFailure(error, label) };
    }
  }

  async #request<T>(
    key: string,
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {}
  ): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${key}`, ...init.headers },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      const error = Object.assign(
        new Error(`xAI Management API returned HTTP ${response.status}`),
        {
          status: response.status,
          retryAfter: response.headers.get('retry-after')
        }
      );
      throw error;
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw Object.assign(new Error('xAI Management API schema changed'), {
        status: 422,
        cause: parsed.error
      });
    }
    return parsed.data;
  }
}

export interface XaiApiConnectorOptions {
  accountClient: XaiApiAccountClient;
  clock?: () => Date;
}

export class XaiApiConnector implements Connector {
  readonly id = 'xai-api';
  readonly displayName = 'Grok';
  readonly consentId = 'xai-api';
  readonly #accountClient: XaiApiAccountClient;
  readonly #clock: () => Date;

  constructor(options: XaiApiConnectorOptions) {
    this.#accountClient = options.accountClient;
    this.#clock = options.clock ?? (() => new Date());
  }

  async collect(): Promise<ConnectorSnapshot> {
    const observedAt = this.#clock().toISOString();
    try {
      const account = await this.#accountClient.readAccount();
      return {
        provider: { id: 'grok', displayName: 'Grok', accountIdentifier: account.teamId },
        billingDomains: [{ id: 'xai-api', displayName: 'xAI API' }],
        quotaBuckets: mapSpendingLimit(account, this.#clock()),
        usage: mapInvoiceTokens(account.invoices),
        costs: mapUsageCosts(account),
        balances: mapBalances(account, observedAt),
        invoices: mapInvoices(account.invoices),
        warnings: account.warnings,
        observedAt
      };
    } catch (error) {
      return {
        provider: { id: 'grok', displayName: 'Grok' },
        billingDomains: [{ id: 'xai-api', displayName: 'xAI API' }],
        quotaBuckets: [],
        usage: [],
        costs: [],
        balances: [],
        invoices: [],
        warnings: [safeFailure(error)],
        observedAt
      };
    }
  }
}

function mapSpendingLimit(account: XaiApiAccountPayload, now: Date): QuotaBucket[] {
  if (account.spendingLimitCents === null) return [];
  const limit = account.spendingLimitCents / 100;
  const used = account.currentInvoiceCents === null ? null : account.currentInvoiceCents / 100;
  return [
    {
      id: 'xai-api:monthly-spending-limit',
      billingDomainId: 'xai-api',
      label: 'Monthly invoiced spending limit',
      usedPercent: used === null || limit <= 0 ? null : Math.min(100, (used / limit) * 100),
      resetsAt: nextUtcMonth(now),
      authority: 'official-account',
      scope: 'account-wide',
      limitAmount: limit,
      limitCurrency: 'USD'
    }
  ];
}

function mapUsageCosts(account: XaiApiAccountPayload): CostRecord[] {
  return (account.usage?.timeSeries ?? []).flatMap((series) => {
    const model = series.groupLabels[0] ?? series.group[0] ?? 'Unlabeled usage';
    return series.dataPoints.flatMap((point) => {
      const amount = point.values[0];
      if (amount === undefined || !Number.isFinite(amount)) return [];
      const sourceId = `${account.teamId}:${model}:${point.timestamp}`;
      return [
        {
          id: `xai-usage:${model}:${point.timestamp}`,
          sourceId,
          billingDomainId: 'xai-api',
          observedAt: point.timestamp,
          kind: 'actual' as const,
          amount,
          currency: 'USD',
          authority: 'official-account' as const,
          model: modelFromDescription(model)
        }
      ];
    });
  });
}

function mapInvoiceTokens(invoices: Invoice[]): UsageObservation[] {
  const observations: UsageObservation[] = [];
  for (const invoice of invoices) {
    const byModel = new Map<string, UsageObservation>();
    for (const line of invoice.lines) {
      const kind = tokenKind(line.unitType);
      if (!kind) continue;
      const model = modelFromDescription(line.description);
      const observation = byModel.get(model) ?? {
        id: `xai-invoice:${invoice.invoiceId}:${model}`,
        billingDomainId: 'xai-api',
        model,
        observedAt: invoice.createTime,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        modelAttribution: 'known',
        timePrecision: 'billing-period',
        usageScope: 'account-wide',
        aggregationTemporality: 'delta',
        authority: 'official-account'
      };
      observation[kind] = (observation[kind] ?? 0) + line.numUnits;
      byModel.set(model, observation);
    }
    observations.push(...byModel.values());
  }
  return observations;
}

function mapBalances(account: XaiApiAccountPayload, observedAt: string): BalanceRecord[] {
  const records: BalanceRecord[] = [];
  if (account.balanceCents !== null) {
    records.push({
      id: 'xai-api:prepaid-balance',
      billingDomainId: 'xai-api',
      observedAt,
      kind: 'prepaid',
      amount: -account.balanceCents / 100,
      currency: 'USD',
      authority: 'official-account',
      sourceId: `${account.teamId}:prepaid-balance`
    });
  }
  if (account.spendingLimitCents !== null) {
    records.push({
      id: 'xai-api:spending-limit',
      billingDomainId: 'xai-api',
      observedAt,
      kind: 'spending-limit',
      amount: account.spendingLimitCents / 100,
      currency: 'USD',
      authority: 'official-account',
      sourceId: `${account.teamId}:spending-limit`
    });
  }
  if (account.currentInvoiceCents !== null) {
    records.push({
      id: 'xai-api:current-invoice',
      billingDomainId: 'xai-api',
      observedAt,
      kind: 'current-invoice',
      amount: account.currentInvoiceCents / 100,
      currency: 'USD',
      authority: 'official-account',
      sourceId: `${account.teamId}:current-invoice`
    });
  }
  return records;
}

function mapInvoices(invoices: Invoice[]): InvoiceRecord[] {
  return invoices.map((invoice) => ({
    id: invoice.invoiceId,
    billingDomainId: 'xai-api',
    createdAt: invoice.createTime,
    number: invoice.invoiceNumber ?? null,
    status: invoice.invoiceStatus ?? null,
    amount: invoice.total === undefined ? null : invoice.total / 100,
    currency: 'USD',
    authority: 'official-account'
  }));
}

function tokenKind(
  unitType: string
): 'inputTokens' | 'outputTokens' | 'reasoningTokens' | 'cacheReadTokens' | null {
  const value = unitType.toLowerCase();
  if (!value.includes('token')) return null;
  if (value.includes('cache')) return 'cacheReadTokens';
  if (value.includes('reason')) return 'reasoningTokens';
  if (value.includes('prompt') || value.includes('input')) return 'inputTokens';
  if (value.includes('completion') || value.includes('output')) return 'outputTokens';
  return null;
}

function modelFromDescription(description: string): string {
  return description.replace(/^(Chat|Responses?)\s+/i, '') || description;
}

function analyticsTimestamp(value: Date): string {
  return value
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
}

function nextUtcMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function endpointFailure(error: unknown, label: string): ConnectorFailure {
  const status =
    error instanceof Error && 'status' in error && typeof error.status === 'number'
      ? error.status
      : null;
  if (status === 429) {
    const retryAfter =
      error instanceof Error && 'retryAfter' in error && typeof error.retryAfter === 'string'
        ? error.retryAfter
        : 'the provider retry interval';
    return {
      code: 'xai-api-rate-limited',
      message: `xAI API ${label} is rate limited.`,
      recovery: `Retry after ${retryAfter} seconds.`
    };
  }
  if (status === 401 || status === 403) {
    return {
      code: 'xai-api-permission-denied',
      message: `The management key cannot read xAI API ${label}.`,
      recovery: 'Grant the management key read access for this billing endpoint, then retry.'
    };
  }
  if (status === 422) {
    return {
      code: 'xai-api-schema-changed',
      message: `xAI API ${label} returned an unsupported schema.`,
      recovery: 'Update Agent Usage, then retry.'
    };
  }
  return {
    code: 'xai-api-endpoint-unavailable',
    message: `xAI API ${label} is unavailable.`,
    recovery: 'Check network access and xAI status, then retry.'
  };
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
    code: 'xai-api-connector-failed',
    message: 'xAI API billing is unavailable.',
    recovery: 'Run agent-usage doctor and reconnect the xAI Management API key.'
  };
}
