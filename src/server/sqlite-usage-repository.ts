import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

import type {
  BalanceRecord,
  BillingDomainOverview,
  ConnectorDiagnostic,
  ConnectorRuntimeState,
  ConnectorSnapshot,
  CoverageLevel,
  CostRecord,
  DataAuthority,
  ExchangeRateSnapshot,
  HistoryCost,
  HistoryWindow,
  MonitoringSettings,
  PriceSnapshotReference,
  ProviderOverview,
  QuotaBucket,
  QuotaForecast,
  RetailPriceLineItem,
  RetentionStatus,
  TokenEvidence,
  TokenAggregationTemporality,
  TokenModelAttribution,
  TokenTimePrecision,
  TokenTotalDerivation,
  TokenUsageScope,
  UsageOverview,
  UsageQuery,
  UsageRepository
} from '../core/types.js';
import { normalizeTokenObservation } from '../core/token-normalization.js';
import type { ConnectorStatusRecord, ConnectorSetupState } from '../core/onboarding-types.js';

const FRESHNESS_WINDOW_MS = 15 * 60 * 1000;
const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite'
) as typeof import('node:sqlite');

interface ProviderRow {
  id: string;
  display_name: string;
  last_success_at: string | null;
  last_error: string | null;
  last_error_code: string | null;
  last_recovery: string | null;
}

interface QuotaRow {
  id: string;
  billing_domain_id: string;
  label: string;
  used_percent: number | null;
  resets_at: string | null;
  authority: DataAuthority;
  observed_at: string;
  scope: QuotaBucket['scope'] | null;
  status: string | null;
  limit_amount: number | null;
  limit_currency: string | null;
  fallback_status: QuotaBucket['fallbackStatus'] | null;
}

interface QuotaObservationRow {
  bucket_id: string;
  billing_domain_id: string;
  label: string;
  used_percent: number;
  resets_at: string | null;
  observed_at: string;
}

interface TokenRow {
  total_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  observation_count: number;
  source_reported_tokens: number | null;
  source_reported_observation_count: number;
  unclassified_tokens: number | null;
  total_derivations: string | null;
  time_precisions: string | null;
  usage_scopes: string | null;
  aggregation_temporalities: string | null;
  authorities: string | null;
}

interface BillingDomainRow {
  id: string;
  display_name: string;
}

interface CostRow {
  id: string;
  source_id: string | null;
  billing_domain_id: string;
  observed_at: string;
  kind: CostRecord['kind'];
  amount: number | null;
  currency: string;
  authority: DataAuthority;
  price_snapshot_id: string | null;
  price_snapshot_version: string | null;
  price_snapshot_source: string | null;
  price_snapshot_effective_at: string | null;
  price_snapshot_source_url: string | null;
  price_snapshot_context_tier: string | null;
  model: string | null;
  usage_observation_id: string | null;
  priced_tokens: number | null;
  line_items_json: string | null;
  calculated_at: string | null;
}

interface UsageHistoryRow {
  model: string;
  observed_at: string;
  authority: DataAuthority;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  source_reported_total_tokens: number | null;
  unclassified_tokens: number;
  total_derivation: TokenTotalDerivation;
  model_attribution: TokenModelAttribution;
  time_precision: TokenTimePrecision;
  usage_scope: TokenUsageScope;
  aggregation_temporality: TokenAggregationTemporality;
}

interface MutableTokenEvidence {
  recordedTokens: number;
  sourceReportedTokens: number;
  sourceReportedObservationCount: number;
  observationCount: number;
  unclassifiedTokens: number;
  totalDerivations: Set<TokenTotalDerivation>;
  timePrecisions: Set<TokenTimePrecision>;
  usageScopes: Set<TokenUsageScope>;
  aggregationTemporalities: Set<TokenAggregationTemporality>;
}

interface ExchangeRateRow {
  id: string;
  base_currency: string;
  quote_currency: string;
  rate: number;
  observed_at: string;
  source: string;
}

interface BalanceRow {
  id: string;
  source_id: string | null;
  billing_domain_id: string;
  observed_at: string;
  kind: BalanceRecord['kind'];
  amount: number | null;
  currency: string;
  authority: DataAuthority;
}

interface InvoiceRow {
  id: string;
  billing_domain_id: string;
  created_at: string;
  number: string | null;
  status: string | null;
  amount: number | null;
  currency: string;
  authority: DataAuthority;
}

interface ConnectorStatusRow {
  id: string;
  state: ConnectorSetupState;
  installed: number;
  binary_path: string | null;
  official_credential_present: number;
  error_code: string | null;
  last_discovered_at: string | null;
  secret_reference: string | null;
}

interface ConnectorRuntimeRow {
  id: string;
  last_attempt_at: string | null;
  next_allowed_at: string | null;
  failure_count: number;
  outcome: ConnectorRuntimeState['outcome'];
}

interface ConnectorDiagnosticRow {
  id: string;
  provider_id: string;
  billing_domain_id: string | null;
  status: ConnectorDiagnostic['status'];
  category: ConnectorDiagnostic['category'];
  message: string | null;
  recovery: string | null;
  affected_coverage: string;
  last_attempt_at: string;
  last_success_at: string | null;
}

export class SqliteUsageRepository implements UsageRepository {
  readonly #database: DatabaseSyncType;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.#migrate();
  }

  saveSnapshot(snapshot: ConnectorSnapshot, options: { preserveFailure?: boolean } = {}): void {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const providerSql = options.preserveFailure
        ? `INSERT INTO providers (
             id, display_name, account_identifier, last_success_at, last_error, last_error_code, last_recovery
           ) VALUES (?, ?, ?, ?, NULL, NULL, NULL)
           ON CONFLICT(id) DO UPDATE SET
             display_name = excluded.display_name,
             account_identifier = COALESCE(excluded.account_identifier, providers.account_identifier),
             last_success_at = excluded.last_success_at`
        : `INSERT INTO providers (
             id, display_name, account_identifier, last_success_at, last_error, last_error_code, last_recovery
           ) VALUES (?, ?, ?, ?, NULL, NULL, NULL)
           ON CONFLICT(id) DO UPDATE SET
             display_name = excluded.display_name,
             account_identifier = COALESCE(excluded.account_identifier, providers.account_identifier),
             last_success_at = excluded.last_success_at,
             last_error = NULL,
             last_error_code = NULL,
             last_recovery = NULL`;
      this.#database
        .prepare(providerSql)
        .run(
          snapshot.provider.id,
          snapshot.provider.displayName,
          snapshot.provider.accountIdentifier ?? null,
          snapshot.observedAt
        );

      const billingDomainStatement = this.#database.prepare(
        `INSERT INTO billing_domains (provider_id, id, display_name)
         VALUES (?, ?, ?)
         ON CONFLICT(provider_id, id) DO UPDATE SET display_name = excluded.display_name`
      );
      for (const billingDomain of snapshot.billingDomains) {
        billingDomainStatement.run(
          snapshot.provider.id,
          billingDomain.id,
          billingDomain.displayName
        );
      }

      const quotaStatement = this.#database.prepare(
        `INSERT INTO quota_buckets (
           provider_id, id, billing_domain_id, label, used_percent, resets_at, authority, observed_at,
           scope, status, limit_amount, limit_currency, fallback_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, id) DO UPDATE SET
           billing_domain_id = excluded.billing_domain_id,
           label = excluded.label,
           used_percent = excluded.used_percent,
           resets_at = excluded.resets_at,
           authority = excluded.authority,
           observed_at = excluded.observed_at,
           scope = excluded.scope,
           status = excluded.status,
           limit_amount = excluded.limit_amount,
           limit_currency = excluded.limit_currency,
           fallback_status = excluded.fallback_status`
      );
      for (const bucket of snapshot.quotaBuckets) {
        quotaStatement.run(
          snapshot.provider.id,
          bucket.id,
          bucket.billingDomainId,
          bucket.label,
          bucket.usedPercent,
          bucket.resetsAt,
          bucket.authority,
          snapshot.observedAt,
          bucket.scope ?? null,
          bucket.status ?? null,
          bucket.limitAmount ?? null,
          bucket.limitCurrency ?? null,
          bucket.fallbackStatus ?? null
        );
      }
      const quotaObservationStatement = this.#database.prepare(
        `INSERT INTO quota_observations (
           provider_id, bucket_id, billing_domain_id, label, used_percent, resets_at,
           authority, observed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, bucket_id, observed_at) DO UPDATE SET
           billing_domain_id = excluded.billing_domain_id,
           label = excluded.label,
           used_percent = excluded.used_percent,
           resets_at = excluded.resets_at,
           authority = excluded.authority`
      );
      for (const bucket of snapshot.quotaBuckets) {
        if (bucket.usedPercent === null) continue;
        quotaObservationStatement.run(
          snapshot.provider.id,
          bucket.id,
          bucket.billingDomainId,
          bucket.label,
          bucket.usedPercent,
          bucket.resetsAt,
          bucket.authority,
          snapshot.observedAt
        );
      }

      const usageStatement = this.#database.prepare(
        `INSERT INTO usage_observations (
           provider_id, id, billing_domain_id, model, session_id, observed_at,
           total_tokens, input_tokens, output_tokens, reasoning_tokens,
           cache_read_tokens, cache_write_tokens, authority,
           source_reported_total_tokens, unclassified_tokens, total_derivation,
           reasoning_semantics, cache_read_semantics, cache_write_semantics,
           model_attribution, time_precision, usage_scope, aggregation_temporality
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, id) DO UPDATE SET
           billing_domain_id = excluded.billing_domain_id,
           model = excluded.model,
           session_id = excluded.session_id,
           observed_at = excluded.observed_at,
           total_tokens = excluded.total_tokens,
           input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           reasoning_tokens = excluded.reasoning_tokens,
           cache_read_tokens = excluded.cache_read_tokens,
           cache_write_tokens = excluded.cache_write_tokens,
           authority = excluded.authority,
           source_reported_total_tokens = excluded.source_reported_total_tokens,
           unclassified_tokens = excluded.unclassified_tokens,
           total_derivation = excluded.total_derivation,
           reasoning_semantics = excluded.reasoning_semantics,
           cache_read_semantics = excluded.cache_read_semantics,
           cache_write_semantics = excluded.cache_write_semantics,
           model_attribution = excluded.model_attribution,
           time_precision = excluded.time_precision,
           usage_scope = excluded.usage_scope,
           aggregation_temporality = excluded.aggregation_temporality`
      );
      for (const observation of snapshot.usage) {
        const normalized = normalizeTokenObservation(observation);
        usageStatement.run(
          snapshot.provider.id,
          normalized.id,
          normalized.billingDomainId,
          normalized.model?.trim() || '__unclassified__',
          normalized.sessionId ?? null,
          normalized.observedAt,
          normalized.recordedTokens,
          normalized.inputTokens,
          normalized.outputTokens,
          normalized.reasoningTokens,
          normalized.cacheReadTokens,
          normalized.cacheWriteTokens,
          normalized.authority,
          normalized.sourceReportedTotalTokens,
          normalized.unclassifiedTokens,
          normalized.totalDerivation,
          normalized.tokenSemantics.reasoning,
          normalized.tokenSemantics.cacheRead,
          normalized.tokenSemantics.cacheWrite,
          normalized.modelAttribution,
          normalized.timePrecision,
          normalized.usageScope,
          normalized.aggregationTemporality
        );
      }

      const costStatement = this.#database.prepare(
        `INSERT INTO cost_records (
           provider_id, id, source_id, billing_domain_id, observed_at, kind, amount, currency,
           authority, price_snapshot_id, price_snapshot_version, price_snapshot_source,
           price_snapshot_effective_at, price_snapshot_source_url, price_snapshot_context_tier,
           model, usage_observation_id, priced_tokens,
           line_items_json, calculated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, id) DO UPDATE SET
           source_id = excluded.source_id,
           billing_domain_id = excluded.billing_domain_id,
           observed_at = excluded.observed_at,
           kind = excluded.kind,
           amount = excluded.amount,
           currency = excluded.currency,
           authority = excluded.authority,
           price_snapshot_id = excluded.price_snapshot_id,
           price_snapshot_version = excluded.price_snapshot_version,
           price_snapshot_source = excluded.price_snapshot_source,
           price_snapshot_effective_at = excluded.price_snapshot_effective_at,
           price_snapshot_source_url = excluded.price_snapshot_source_url,
           price_snapshot_context_tier = excluded.price_snapshot_context_tier,
           model = excluded.model,
           usage_observation_id = excluded.usage_observation_id,
           priced_tokens = excluded.priced_tokens,
           line_items_json = excluded.line_items_json,
           calculated_at = excluded.calculated_at`
      );
      for (const cost of snapshot.costs) {
        costStatement.run(
          snapshot.provider.id,
          cost.id,
          cost.sourceId ?? null,
          cost.billingDomainId,
          cost.observedAt,
          cost.kind,
          cost.amount,
          cost.currency,
          cost.authority,
          cost.priceSnapshot?.id ?? null,
          cost.priceSnapshot?.version ?? null,
          cost.priceSnapshot?.source ?? null,
          cost.priceSnapshot?.effectiveAt ?? null,
          cost.priceSnapshot?.sourceUrl ?? null,
          cost.priceSnapshot?.contextTier ?? null,
          cost.model ?? null,
          cost.usageObservationId ?? null,
          cost.pricedTokens ?? null,
          cost.lineItems ? JSON.stringify(cost.lineItems) : null,
          cost.calculatedAt ?? null
        );
      }

      const balanceStatement = this.#database.prepare(
        `INSERT INTO balance_records (
           provider_id, id, source_id, billing_domain_id, observed_at, kind, amount, currency, authority
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, id) DO UPDATE SET
           source_id = excluded.source_id,
           billing_domain_id = excluded.billing_domain_id,
           observed_at = excluded.observed_at,
           kind = excluded.kind,
           amount = excluded.amount,
           currency = excluded.currency,
           authority = excluded.authority`
      );
      for (const balance of snapshot.balances ?? []) {
        balanceStatement.run(
          snapshot.provider.id,
          balance.id,
          balance.sourceId ?? null,
          balance.billingDomainId,
          balance.observedAt,
          balance.kind,
          balance.amount,
          balance.currency,
          balance.authority
        );
      }

      const invoiceStatement = this.#database.prepare(
        `INSERT INTO invoice_records (
           provider_id, id, billing_domain_id, created_at, number, status, amount, currency, authority
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, id) DO UPDATE SET
           billing_domain_id = excluded.billing_domain_id,
           created_at = excluded.created_at,
           number = excluded.number,
           status = excluded.status,
           amount = excluded.amount,
           currency = excluded.currency,
           authority = excluded.authority`
      );
      for (const invoice of snapshot.invoices ?? []) {
        invoiceStatement.run(
          snapshot.provider.id,
          invoice.id,
          invoice.billingDomainId,
          invoice.createdAt,
          invoice.number,
          invoice.status,
          invoice.amount,
          invoice.currency,
          invoice.authority
        );
      }

      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  recordFailure(
    provider: { id: string; displayName: string },
    failedAt: string,
    failure: { code: string; message: string; recovery: string }
  ): void {
    this.#database
      .prepare(
        `INSERT INTO providers (
           id, display_name, last_success_at, last_error, last_failure_at,
           last_error_code, last_recovery
         ) VALUES (?, ?, NULL, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           last_error = excluded.last_error,
           last_failure_at = excluded.last_failure_at,
           last_error_code = excluded.last_error_code,
           last_recovery = excluded.last_recovery`
      )
      .run(
        provider.id,
        provider.displayName,
        failure.message,
        failedAt,
        failure.code,
        failure.recovery
      );
  }

  getOverview(now: Date, query: UsageQuery = {}): UsageOverview {
    const providers = this.#database
      .prepare(
        `SELECT id, display_name, last_success_at, last_error, last_error_code, last_recovery
         FROM providers ORDER BY id`
      )
      .all() as unknown as ProviderRow[];

    const overviews = providers.map((provider) => this.#getProviderOverview(provider, now, query));
    const riskSummary = buildRiskSummary(overviews);
    return {
      generatedAt: now.toISOString(),
      globalSummary: buildGlobalSummary(overviews, riskSummary, now, query),
      providers: overviews,
      riskSummary
    };
  }

  saveExchangeRateSnapshot(snapshot: ExchangeRateSnapshot): void {
    this.#database
      .prepare(
        `INSERT INTO exchange_rate_snapshots (
           id, base_currency, quote_currency, rate, observed_at, source
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           base_currency = excluded.base_currency,
           quote_currency = excluded.quote_currency,
           rate = excluded.rate,
           observed_at = excluded.observed_at,
           source = excluded.source`
      )
      .run(
        snapshot.id,
        snapshot.baseCurrency.toUpperCase(),
        snapshot.quoteCurrency.toUpperCase(),
        snapshot.rate,
        snapshot.observedAt,
        snapshot.source
      );
  }

  getConnectorRuntimeStates(): ConnectorRuntimeState[] {
    const rows = this.#database
      .prepare(
        `SELECT id, last_attempt_at, next_allowed_at, failure_count, outcome
         FROM connector_runtime ORDER BY id`
      )
      .all() as unknown as ConnectorRuntimeRow[];
    return rows.map((row) => ({
      id: row.id,
      lastAttemptAt: row.last_attempt_at,
      nextAllowedAt: row.next_allowed_at,
      failureCount: row.failure_count,
      outcome: row.outcome
    }));
  }

  saveConnectorRuntimeState(state: ConnectorRuntimeState): void {
    this.#database
      .prepare(
        `INSERT INTO connector_runtime (
           id, last_attempt_at, next_allowed_at, failure_count, outcome
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           last_attempt_at = excluded.last_attempt_at,
           next_allowed_at = excluded.next_allowed_at,
           failure_count = excluded.failure_count,
           outcome = excluded.outcome`
      )
      .run(state.id, state.lastAttemptAt, state.nextAllowedAt, state.failureCount, state.outcome);
  }

  getMonitoringSettings(): MonitoringSettings {
    const row = this.#database
      .prepare(
        `SELECT background_collection_enabled, interval_minutes, notifications_enabled,
                start_at_login FROM monitoring_settings WHERE id = 1`
      )
      .get() as unknown as
      | {
          background_collection_enabled: number;
          interval_minutes: number;
          notifications_enabled: number;
          start_at_login: number;
        }
      | undefined;
    return row
      ? {
          backgroundCollectionEnabled: row.background_collection_enabled === 1,
          intervalMinutes: row.interval_minutes,
          notificationsEnabled: row.notifications_enabled === 1,
          startAtLogin: row.start_at_login === 1
        }
      : defaultMonitoringSettings();
  }

  saveMonitoringSettings(settings: MonitoringSettings): void {
    this.#database
      .prepare(
        `INSERT INTO monitoring_settings (
           id, background_collection_enabled, interval_minutes, notifications_enabled,
           start_at_login
         ) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           background_collection_enabled = excluded.background_collection_enabled,
           interval_minutes = excluded.interval_minutes,
           notifications_enabled = excluded.notifications_enabled,
           start_at_login = excluded.start_at_login`
      )
      .run(
        settings.backgroundCollectionEnabled ? 1 : 0,
        settings.intervalMinutes,
        settings.notificationsEnabled ? 1 : 0,
        settings.startAtLogin ? 1 : 0
      );
  }

  getNotificationState(key: string): string | null {
    const row = this.#database
      .prepare('SELECT value FROM notification_state WHERE key = ?')
      .get(key) as unknown as { value: string } | undefined;
    return row?.value ?? null;
  }

  saveNotificationState(key: string, value: string): void {
    this.#database
      .prepare(
        `INSERT INTO notification_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }

  saveConnectorDiagnostic(diagnostic: ConnectorDiagnostic): void {
    this.#database
      .prepare(
        `INSERT INTO connector_diagnostics (
           id, provider_id, billing_domain_id, status, category, message, recovery,
           affected_coverage, last_attempt_at, last_success_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider_id = excluded.provider_id,
           billing_domain_id = excluded.billing_domain_id,
           status = excluded.status,
           category = excluded.category,
           message = excluded.message,
           recovery = excluded.recovery,
           affected_coverage = excluded.affected_coverage,
           last_attempt_at = excluded.last_attempt_at,
           last_success_at = excluded.last_success_at`
      )
      .run(
        diagnostic.id,
        diagnostic.providerId,
        diagnostic.billingDomainId,
        diagnostic.status,
        diagnostic.category,
        diagnostic.message,
        diagnostic.recovery,
        JSON.stringify(diagnostic.affectedCoverage),
        diagnostic.lastAttemptAt,
        diagnostic.lastSuccessAt
      );
  }

  getConnectorDiagnostics(): ConnectorDiagnostic[] {
    const rows = this.#database
      .prepare(
        `SELECT id, provider_id, billing_domain_id, status, category, message, recovery,
                affected_coverage, last_attempt_at, last_success_at
         FROM connector_diagnostics ORDER BY id`
      )
      .all() as unknown as ConnectorDiagnosticRow[];
    return rows.map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      billingDomainId: row.billing_domain_id,
      status: row.status,
      category: row.category,
      message: row.message,
      recovery: row.recovery,
      affectedCoverage: JSON.parse(
        row.affected_coverage
      ) as ConnectorDiagnostic['affectedCoverage'],
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at
    }));
  }

  saveConnectorStatus(status: ConnectorStatusRecord): void {
    this.#database
      .prepare(
        `INSERT INTO connector_settings (
           id, state, installed, binary_path, official_credential_present,
           error_code, last_discovered_at, secret_reference
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state,
           installed = excluded.installed,
           binary_path = excluded.binary_path,
           official_credential_present = excluded.official_credential_present,
           error_code = excluded.error_code,
           last_discovered_at = excluded.last_discovered_at,
           secret_reference = excluded.secret_reference`
      )
      .run(
        status.id,
        status.state,
        status.installed ? 1 : 0,
        status.binaryPath,
        status.officialCredentialPresent ? 1 : 0,
        status.errorCode,
        status.lastDiscoveredAt,
        status.secretReference
      );
  }

  getConnectorStatuses(): ConnectorStatusRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT id, state, installed, binary_path, official_credential_present,
                error_code, last_discovered_at, secret_reference
         FROM connector_settings ORDER BY id`
      )
      .all() as unknown as ConnectorStatusRow[];
    return rows.map((row) => ({
      id: row.id,
      state: row.state,
      installed: row.installed === 1,
      binaryPath: row.binary_path,
      officialCredentialPresent: row.official_credential_present === 1,
      errorCode: row.error_code,
      lastDiscoveredAt: row.last_discovered_at,
      secretReference: row.secret_reference
    }));
  }

  getProviderAccountIdentifiers(): Record<string, string> {
    const rows = this.#database
      .prepare('SELECT id, account_identifier FROM providers WHERE account_identifier IS NOT NULL')
      .all() as unknown as Array<{ id: string; account_identifier: string }>;
    return Object.fromEntries(rows.map((row) => [row.id, row.account_identifier]));
  }

  compactUsageHistory(now: Date): RetentionStatus {
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#database
        .prepare(
          `INSERT INTO daily_usage_aggregates (
             provider_id, billing_domain_id, day_utc, model, authority,
             total_tokens, input_tokens, output_tokens, reasoning_tokens,
             cache_read_tokens, cache_write_tokens, source_count
           )
           SELECT provider_id, billing_domain_id, substr(observed_at, 1, 10), model, authority,
                  SUM(total_tokens), SUM(input_tokens), SUM(output_tokens), SUM(reasoning_tokens),
                  SUM(cache_read_tokens), SUM(cache_write_tokens), COUNT(*)
           FROM usage_observations
           WHERE observed_at < ?
           GROUP BY provider_id, billing_domain_id, substr(observed_at, 1, 10), model, authority
           ON CONFLICT(provider_id, billing_domain_id, day_utc, model, authority) DO UPDATE SET
             total_tokens = excluded.total_tokens,
             input_tokens = excluded.input_tokens,
             output_tokens = excluded.output_tokens,
             reasoning_tokens = excluded.reasoning_tokens,
             cache_read_tokens = excluded.cache_read_tokens,
             cache_write_tokens = excluded.cache_write_tokens,
             source_count = excluded.source_count`
        )
        .run(cutoff);
      this.#database.prepare('DELETE FROM usage_observations WHERE observed_at < ?').run(cutoff);
      this.#database
        .prepare(
          `INSERT INTO retention_state (id, last_compacted_at) VALUES (1, ?)
           ON CONFLICT(id) DO UPDATE SET last_compacted_at = excluded.last_compacted_at`
        )
        .run(now.toISOString());
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
    return this.getRetentionStatus();
  }

  getRetentionStatus(): RetentionStatus {
    const raw = this.#database
      .prepare('SELECT COUNT(*) AS count, MIN(observed_at) AS oldest FROM usage_observations')
      .get() as unknown as { count: number; oldest: string | null };
    const aggregates = this.#database
      .prepare('SELECT COUNT(*) AS count FROM daily_usage_aggregates')
      .get() as unknown as { count: number };
    const state = this.#database
      .prepare('SELECT last_compacted_at FROM retention_state WHERE id = 1')
      .get() as unknown as { last_compacted_at: string | null } | undefined;
    return {
      rawRetentionDays: 90,
      rawObservations: Number(raw.count),
      oldestRawObservedAt: raw.oldest,
      dailyAggregates: Number(aggregates.count),
      lastCompactedAt: state?.last_compacted_at ?? null
    };
  }

  clearUsageData(): void {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#database.exec(`
        DELETE FROM connector_diagnostics;
        DELETE FROM connector_runtime;
        DELETE FROM notification_state;
        DELETE FROM exchange_rate_snapshots;
        DELETE FROM providers;
        DELETE FROM retention_state;
      `);
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  #getProviderOverview(provider: ProviderRow, now: Date, query: UsageQuery): ProviderOverview {
    const forecastAnalysis = this.#getQuotaForecasts(provider.id, now);
    const degradedDiagnostic = this.#database
      .prepare(
        `SELECT id, provider_id, billing_domain_id, status, category, message, recovery,
                affected_coverage, last_attempt_at, last_success_at
         FROM connector_diagnostics
         WHERE provider_id = ? AND status = 'degraded'
         ORDER BY id LIMIT 1`
      )
      .get(provider.id) as unknown as ConnectorDiagnosticRow | undefined;
    const domainRows = this.#database
      .prepare(`SELECT id, display_name FROM billing_domains WHERE provider_id = ? ORDER BY id`)
      .all(provider.id) as unknown as BillingDomainRow[];
    const quotaRows = this.#database
      .prepare(
        `SELECT id, billing_domain_id, label, used_percent, resets_at, authority, observed_at,
                scope, status, limit_amount, limit_currency, fallback_status
         FROM quota_buckets WHERE provider_id = ? ORDER BY id`
      )
      .all(provider.id) as unknown as QuotaRow[];
    const tokens = this.#database
      .prepare(
        `SELECT
           COALESCE(SUM(total_tokens), 0) AS total_tokens,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
           COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
           COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
           COUNT(*) AS observation_count,
           COALESCE(SUM(source_reported_total_tokens), 0) AS source_reported_tokens,
           SUM(CASE WHEN source_reported_total_tokens IS NOT NULL THEN 1 ELSE 0 END)
             AS source_reported_observation_count,
           COALESCE(SUM(unclassified_tokens), 0) AS unclassified_tokens,
           GROUP_CONCAT(DISTINCT total_derivation) AS total_derivations,
           GROUP_CONCAT(DISTINCT time_precision) AS time_precisions,
           GROUP_CONCAT(DISTINCT usage_scope) AS usage_scopes,
           GROUP_CONCAT(DISTINCT aggregation_temporality) AS aggregation_temporalities,
           GROUP_CONCAT(DISTINCT authority) AS authorities
         FROM usage_observations WHERE provider_id = ?`
      )
      .get(provider.id) as unknown as TokenRow;
    const actualCostCount = this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM cost_records WHERE provider_id = ? AND kind = 'actual'"
      )
      .get(provider.id) as unknown as { count: number };

    const quotaBuckets = quotaRows.map(mapQuotaRow);

    return {
      id: provider.id,
      displayName: provider.display_name,
      freshness: {
        status: freshnessStatus(provider.last_success_at, now),
        lastSuccessAt: provider.last_success_at
      },
      health: {
        status: degradedDiagnostic || provider.last_error ? 'degraded' : 'healthy',
        errorCode: provider.last_error_code ?? degradedDiagnostic?.category ?? null,
        message: provider.last_error ?? degradedDiagnostic?.message ?? null,
        recovery: provider.last_recovery ?? degradedDiagnostic?.recovery ?? null
      },
      coverage: {
        quota: coverageFromCount(quotaRows.length),
        tokens: tokenCoverage(tokens),
        actualCost: coverageFromCount(actualCostCount.count),
        history: tokenCoverage(tokens)
      },
      quotaBuckets,
      tokenTotals: {
        total: Number(tokens.total_tokens ?? 0),
        input: Number(tokens.input_tokens ?? 0),
        output: Number(tokens.output_tokens ?? 0),
        reasoning: Number(tokens.reasoning_tokens ?? 0),
        cacheRead: Number(tokens.cache_read_tokens ?? 0),
        cacheWrite: Number(tokens.cache_write_tokens ?? 0)
      },
      tokenEvidence: mapTokenEvidence(tokens),
      tokenAuthority: tokenAuthority(tokens.authorities),
      billingDomains: domainRows.map((domain) =>
        this.#getBillingDomainOverview(
          provider.id,
          domain,
          now,
          query,
          forecastAnalysis.forecasts.filter((forecast) => forecast.billingDomainId === domain.id)
        )
      ),
      forecasts: forecastAnalysis.forecasts,
      forecastCoverage: forecastAnalysis.coverage
    };
  }

  #getBillingDomainOverview(
    providerId: string,
    domain: BillingDomainRow,
    now: Date,
    query: UsageQuery,
    forecasts: QuotaForecast[]
  ): BillingDomainOverview {
    const quotaRows = this.#database
      .prepare(
        `SELECT id, billing_domain_id, label, used_percent, resets_at, authority, observed_at,
                scope, status, limit_amount, limit_currency, fallback_status
         FROM quota_buckets WHERE provider_id = ? AND billing_domain_id = ? ORDER BY id`
      )
      .all(providerId, domain.id) as unknown as QuotaRow[];
    const tokens = this.#database
      .prepare(
        `SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                COUNT(*) AS observation_count,
                COALESCE(SUM(source_reported_total_tokens), 0) AS source_reported_tokens,
                SUM(CASE WHEN source_reported_total_tokens IS NOT NULL THEN 1 ELSE 0 END)
                  AS source_reported_observation_count,
                COALESCE(SUM(unclassified_tokens), 0) AS unclassified_tokens,
                GROUP_CONCAT(DISTINCT total_derivation) AS total_derivations,
                GROUP_CONCAT(DISTINCT time_precision) AS time_precisions,
                GROUP_CONCAT(DISTINCT usage_scope) AS usage_scopes,
                GROUP_CONCAT(DISTINCT aggregation_temporality) AS aggregation_temporalities,
                GROUP_CONCAT(DISTINCT authority) AS authorities
         FROM usage_observations WHERE provider_id = ? AND billing_domain_id = ?`
      )
      .get(providerId, domain.id) as unknown as TokenRow;
    const costs = this.#database
      .prepare(
        `SELECT id, source_id, billing_domain_id, observed_at, kind, amount, currency, authority,
                price_snapshot_id, price_snapshot_version, price_snapshot_source,
                price_snapshot_effective_at, price_snapshot_source_url,
                price_snapshot_context_tier, model, usage_observation_id, priced_tokens,
                line_items_json, calculated_at
         FROM cost_records WHERE provider_id = ? AND billing_domain_id = ? ORDER BY observed_at DESC, id`
      )
      .all(providerId, domain.id) as unknown as CostRow[];
    const balances = this.#database
      .prepare(
        `SELECT id, source_id, billing_domain_id, observed_at, kind, amount, currency, authority
         FROM balance_records WHERE provider_id = ? AND billing_domain_id = ? ORDER BY observed_at DESC, id`
      )
      .all(providerId, domain.id) as unknown as BalanceRow[];
    const invoices = this.#database
      .prepare(
        `SELECT id, billing_domain_id, created_at, number, status, amount, currency, authority
         FROM invoice_records WHERE provider_id = ? AND billing_domain_id = ? ORDER BY created_at DESC, id`
      )
      .all(providerId, domain.id) as unknown as InvoiceRow[];
    return {
      id: domain.id,
      displayName: domain.display_name,
      quotaBuckets: quotaRows.map(mapQuotaRow),
      tokenTotals: mapTokenTotals(tokens),
      tokenEvidence: mapTokenEvidence(tokens),
      tokenAuthority: tokenAuthority(tokens.authorities),
      costs: costs.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        billingDomainId: row.billing_domain_id,
        observedAt: row.observed_at,
        kind: row.kind,
        amount: row.amount,
        currency: row.currency,
        authority: row.authority,
        priceSnapshot: priceSnapshotFromRow(row),
        model: row.model,
        usageObservationId: row.usage_observation_id,
        pricedTokens: row.priced_tokens,
        lineItems: parseLineItems(row.line_items_json),
        calculatedAt: row.calculated_at
      })),
      balances: balances.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        billingDomainId: row.billing_domain_id,
        observedAt: row.observed_at,
        kind: row.kind,
        amount: row.amount,
        currency: row.currency,
        authority: row.authority
      })),
      invoices: invoices.map((row) => ({
        id: row.id,
        billingDomainId: row.billing_domain_id,
        createdAt: row.created_at,
        number: row.number,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        authority: row.authority
      })),
      history: this.#getBillingHistory(providerId, domain.id, now, query),
      forecasts
    };
  }

  #getQuotaForecasts(
    providerId: string,
    now: Date
  ): {
    forecasts: QuotaForecast[];
    coverage: ProviderOverview['forecastCoverage'];
  } {
    const rows = this.#database
      .prepare(
        `SELECT bucket_id, billing_domain_id, label, used_percent, resets_at, observed_at
         FROM quota_observations
         WHERE provider_id = ? AND observed_at >= ? AND observed_at <= ?
         ORDER BY bucket_id, observed_at`
      )
      .all(
        providerId,
        new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        now.toISOString()
      ) as unknown as QuotaObservationRow[];
    const grouped = new Map<string, QuotaObservationRow[]>();
    for (const row of rows) {
      const group = grouped.get(row.bucket_id) ?? [];
      group.push(row);
      grouped.set(row.bucket_id, group);
    }
    const forecasts: QuotaForecast[] = [];
    let sawDiscontinuous = false;
    let sawStale = false;
    for (const samples of grouped.values()) {
      const latest = samples.at(-1)!;
      if (now.getTime() - new Date(latest.observed_at).getTime() > FRESHNESS_WINDOW_MS) {
        sawStale = true;
        continue;
      }
      let segmentStart = 0;
      for (let index = 1; index < samples.length; index += 1) {
        if (samples[index].used_percent < samples[index - 1].used_percent) segmentStart = index;
      }
      const segment = samples.slice(segmentStart);
      if (segment.length < 3) continue;
      const gaps = segment
        .slice(1)
        .map(
          (sample, index) =>
            new Date(sample.observed_at).getTime() - new Date(segment[index].observed_at).getTime()
        );
      if (gaps.some((gap) => gap > 2 * 60 * 60 * 1000)) {
        sawDiscontinuous = true;
        continue;
      }
      const first = segment[0];
      const last = segment.at(-1)!;
      const hours =
        (new Date(last.observed_at).getTime() - new Date(first.observed_at).getTime()) /
        (60 * 60 * 1000);
      if (hours < 0.5 || !last.resets_at) continue;
      const burnRate = (last.used_percent - first.used_percent) / hours;
      const resetTime = new Date(last.resets_at).getTime();
      if (burnRate <= 0 || resetTime <= now.getTime()) continue;
      const remaining = Math.max(0, 100 - last.used_percent);
      const predicted = new Date(now.getTime() + (remaining / burnRate) * 60 * 60 * 1000);
      forecasts.push({
        billingDomainId: last.billing_domain_id,
        bucketId: last.bucket_id,
        label: last.label,
        remainingPercent: remaining,
        resetsAt: last.resets_at,
        burnRatePercentPerHour: round(burnRate),
        predictedExhaustionAt: predicted.toISOString(),
        willLastUntilReset: predicted.getTime() >= resetTime,
        confidence: hours >= 2 ? 'high' : 'medium',
        evidence: {
          windowStart: first.observed_at,
          windowEnd: last.observed_at,
          samples: segment.length,
          continuous: true
        }
      });
    }
    return {
      forecasts: forecasts.sort((left, right) => left.bucketId.localeCompare(right.bucketId)),
      coverage:
        forecasts.length > 0
          ? 'complete'
          : sawDiscontinuous
            ? 'discontinuous'
            : sawStale
              ? 'stale'
              : 'insufficient'
    };
  }

  #getBillingHistory(
    providerId: string,
    billingDomainId: string,
    now: Date,
    query: UsageQuery
  ): BillingDomainOverview['history'] {
    const normalized = normalizeUsageQuery(now, query);
    const start = normalized.start.toISOString();
    const end = normalized.end.toISOString();
    const usage = this.#database
      .prepare(
        `SELECT model, observed_at, authority, total_tokens, input_tokens, output_tokens, reasoning_tokens,
                cache_read_tokens, cache_write_tokens, source_reported_total_tokens,
                unclassified_tokens, total_derivation, model_attribution, time_precision,
                usage_scope, aggregation_temporality
         FROM usage_observations
         WHERE provider_id = ? AND billing_domain_id = ?
           AND observed_at >= ? AND observed_at < ?
         ORDER BY observed_at, id`
      )
      .all(providerId, billingDomainId, start, end) as unknown as UsageHistoryRow[];
    const costs = this.#database
      .prepare(
        `SELECT id, source_id, billing_domain_id, observed_at, kind, amount, currency, authority,
                price_snapshot_id, price_snapshot_version, price_snapshot_source,
                price_snapshot_effective_at, price_snapshot_source_url,
                price_snapshot_context_tier, model, usage_observation_id, priced_tokens,
                line_items_json, calculated_at
         FROM cost_records
         WHERE provider_id = ? AND billing_domain_id = ?
           AND observed_at >= ? AND observed_at < ?
         ORDER BY observed_at, id`
      )
      .all(providerId, billingDomainId, start, end) as unknown as CostRow[];
    const rateRows = this.#database
      .prepare(
        `SELECT id, base_currency, quote_currency, rate, observed_at, source
         FROM exchange_rate_snapshots WHERE observed_at < ? ORDER BY observed_at DESC, id`
      )
      .all(end) as unknown as ExchangeRateRow[];
    const rateByCurrency = new Map<string, ExchangeRateRow>();
    for (const row of rateRows) {
      if (
        row.quote_currency === normalized.comparisonCurrency &&
        !rateByCurrency.has(row.base_currency)
      ) {
        rateByCurrency.set(row.base_currency, row);
      }
    }

    const tokenTotals = zeroTokenTotals();
    const tokenEvidence = emptyTokenEvidence();
    const byModel = new Map<
      string,
      { tokens: ReturnType<typeof zeroTokenTotals>; evidence: MutableTokenEvidence }
    >();
    const authorities = new Set<DataAuthority>();
    const byDay = new Map<
      string,
      {
        tokens: ReturnType<typeof zeroTokenTotals>;
        evidence: MutableTokenEvidence;
        costs: CostRow[];
      }
    >();
    for (const row of usage) {
      authorities.add(row.authority);
      addUsageRow(tokenTotals, row);
      addTokenEvidence(tokenEvidence, row);
      if (row.model_attribution === 'known') {
        const model = byModel.get(row.model) ?? {
          tokens: zeroTokenTotals(),
          evidence: emptyTokenEvidence()
        };
        addUsageRow(model.tokens, row);
        addTokenEvidence(model.evidence, row);
        byModel.set(row.model, model);
      }
      const day = localDay(row.observed_at, normalized.timeZone);
      const daily = byDay.get(day) ?? {
        tokens: zeroTokenTotals(),
        evidence: emptyTokenEvidence(),
        costs: []
      };
      addUsageRow(daily.tokens, row);
      addTokenEvidence(daily.evidence, row);
      byDay.set(day, daily);
    }
    for (const cost of costs) {
      const day = localDay(cost.observed_at, normalized.timeZone);
      const daily = byDay.get(day) ?? {
        tokens: zeroTokenTotals(),
        evidence: emptyTokenEvidence(),
        costs: []
      };
      daily.costs.push(cost);
      byDay.set(day, daily);
    }

    const exchangeRates = new Map<string, ExchangeRateSnapshot>();
    const summarizeCosts = (rows: CostRow[], recordedTokens: number) =>
      summarizeHistoryCosts(
        rows,
        recordedTokens,
        rateByCurrency,
        normalized.comparisonCurrency,
        normalized.end,
        exchangeRates
      );
    return {
      window: normalized.window,
      start,
      end,
      timeZone: normalized.timeZone,
      tokenTotals,
      tokenEvidence: finishTokenEvidence(tokenEvidence),
      models: [...byModel.entries()]
        .map(([model, value]) => ({
          model,
          tokenTotals: value.tokens,
          tokenEvidence: finishTokenEvidence(value.evidence)
        }))
        .sort(
          (left, right) =>
            right.tokenTotals.total - left.tokenTotals.total ||
            left.model.localeCompare(right.model)
        ),
      days: [...byDay.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, daily]) => ({
          day,
          tokenTotals: daily.tokens,
          tokenEvidence: finishTokenEvidence(daily.evidence),
          costs: summarizeCosts(daily.costs, daily.tokens.total)
        })),
      costs: summarizeCosts(costs, tokenTotals.total),
      exchangeRates: [...exchangeRates.values()],
      authorities: [...authorities].sort(),
      lastObservedAt: usage.at(-1)?.observed_at ?? null
    };
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        account_identifier TEXT,
        last_success_at TEXT,
        last_error TEXT,
        last_failure_at TEXT,
        last_error_code TEXT,
        last_recovery TEXT
      );
      CREATE TABLE IF NOT EXISTS billing_domains (
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        PRIMARY KEY (provider_id, id)
      );
      CREATE TABLE IF NOT EXISTS quota_buckets (
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        billing_domain_id TEXT NOT NULL,
        label TEXT NOT NULL,
        used_percent REAL,
        resets_at TEXT,
        authority TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        scope TEXT,
        status TEXT,
        limit_amount REAL,
        limit_currency TEXT,
        fallback_status TEXT,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider_id, id),
        FOREIGN KEY (provider_id, billing_domain_id)
          REFERENCES billing_domains(provider_id, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS usage_observations (
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        billing_domain_id TEXT NOT NULL,
        model TEXT NOT NULL,
        session_id TEXT,
        observed_at TEXT NOT NULL,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        authority TEXT NOT NULL,
        source_reported_total_tokens INTEGER,
        unclassified_tokens INTEGER NOT NULL DEFAULT 0,
        total_derivation TEXT NOT NULL DEFAULT 'legacy-total',
        reasoning_semantics TEXT NOT NULL DEFAULT 'included-in-output',
        cache_read_semantics TEXT NOT NULL DEFAULT 'separate',
        cache_write_semantics TEXT NOT NULL DEFAULT 'separate',
        model_attribution TEXT NOT NULL DEFAULT 'known',
        time_precision TEXT NOT NULL DEFAULT 'unknown',
        usage_scope TEXT NOT NULL DEFAULT 'unknown',
        aggregation_temporality TEXT NOT NULL DEFAULT 'unknown',
        PRIMARY KEY (provider_id, id),
        FOREIGN KEY (provider_id, billing_domain_id)
          REFERENCES billing_domains(provider_id, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS quota_observations (
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        bucket_id TEXT NOT NULL,
        billing_domain_id TEXT NOT NULL,
        label TEXT NOT NULL,
        used_percent REAL NOT NULL,
        resets_at TEXT,
        authority TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, bucket_id, observed_at),
        FOREIGN KEY (provider_id, billing_domain_id)
          REFERENCES billing_domains(provider_id, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS cost_records (
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        source_id TEXT,
        billing_domain_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        amount REAL,
        currency TEXT NOT NULL,
        authority TEXT NOT NULL,
        price_snapshot_id TEXT,
        price_snapshot_version TEXT,
        price_snapshot_source TEXT,
        price_snapshot_effective_at TEXT,
        price_snapshot_source_url TEXT,
        price_snapshot_context_tier TEXT,
        model TEXT,
        usage_observation_id TEXT,
        priced_tokens INTEGER,
        line_items_json TEXT,
        calculated_at TEXT,
        PRIMARY KEY (provider_id, id),
        FOREIGN KEY (provider_id, billing_domain_id)
          REFERENCES billing_domains(provider_id, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS balance_records (
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        source_id TEXT,
        billing_domain_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        amount REAL,
        currency TEXT NOT NULL,
        authority TEXT NOT NULL,
        PRIMARY KEY (provider_id, id),
        FOREIGN KEY (provider_id, billing_domain_id)
          REFERENCES billing_domains(provider_id, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS invoice_records (
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        billing_domain_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        number TEXT,
        status TEXT,
        amount REAL,
        currency TEXT NOT NULL,
        authority TEXT NOT NULL,
        PRIMARY KEY (provider_id, id),
        FOREIGN KEY (provider_id, billing_domain_id)
          REFERENCES billing_domains(provider_id, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS exchange_rate_snapshots (
        id TEXT PRIMARY KEY,
        base_currency TEXT NOT NULL,
        quote_currency TEXT NOT NULL,
        rate REAL NOT NULL,
        observed_at TEXT NOT NULL,
        source TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connector_settings (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        installed INTEGER NOT NULL,
        binary_path TEXT,
        official_credential_present INTEGER NOT NULL,
        error_code TEXT,
        last_discovered_at TEXT,
        secret_reference TEXT
      );
      CREATE TABLE IF NOT EXISTS connector_runtime (
        id TEXT PRIMARY KEY,
        last_attempt_at TEXT,
        next_allowed_at TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0,
        outcome TEXT
      );
      CREATE TABLE IF NOT EXISTS monitoring_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        background_collection_enabled INTEGER NOT NULL,
        interval_minutes INTEGER NOT NULL,
        notifications_enabled INTEGER NOT NULL,
        start_at_login INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connector_diagnostics (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        billing_domain_id TEXT,
        status TEXT NOT NULL,
        category TEXT,
        message TEXT,
        recovery TEXT,
        affected_coverage TEXT NOT NULL,
        last_attempt_at TEXT NOT NULL,
        last_success_at TEXT
      );
      CREATE TABLE IF NOT EXISTS daily_usage_aggregates (
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        billing_domain_id TEXT NOT NULL,
        day_utc TEXT NOT NULL,
        model TEXT NOT NULL,
        authority TEXT NOT NULL,
        total_tokens INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        source_count INTEGER NOT NULL,
        PRIMARY KEY (provider_id, billing_domain_id, day_utc, model, authority)
      );
      CREATE TABLE IF NOT EXISTS retention_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_compacted_at TEXT
      );
    `);
    const usageColumns = this.#database
      .prepare('PRAGMA table_info(usage_observations)')
      .all() as unknown as Array<{ name: string }>;
    if (!usageColumns.some((column) => column.name === 'total_tokens')) {
      this.#database.exec(
        'ALTER TABLE usage_observations ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0'
      );
      this.#database.exec(
        'UPDATE usage_observations SET total_tokens = input_tokens + output_tokens'
      );
    }
    if (!usageColumns.some((column) => column.name === 'session_id')) {
      this.#database.exec('ALTER TABLE usage_observations ADD COLUMN session_id TEXT');
    }
    if (!usageColumns.some((column) => column.name === 'reasoning_tokens')) {
      this.#database.exec(
        'ALTER TABLE usage_observations ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0'
      );
    }
    for (const [name, definition] of [
      ['source_reported_total_tokens', 'INTEGER'],
      ['unclassified_tokens', 'INTEGER NOT NULL DEFAULT 0'],
      ['total_derivation', "TEXT NOT NULL DEFAULT 'legacy-total'"],
      ['reasoning_semantics', "TEXT NOT NULL DEFAULT 'included-in-output'"],
      ['cache_read_semantics', "TEXT NOT NULL DEFAULT 'separate'"],
      ['cache_write_semantics', "TEXT NOT NULL DEFAULT 'separate'"],
      ['model_attribution', "TEXT NOT NULL DEFAULT 'known'"],
      ['time_precision', "TEXT NOT NULL DEFAULT 'unknown'"],
      ['usage_scope', "TEXT NOT NULL DEFAULT 'unknown'"],
      ['aggregation_temporality', "TEXT NOT NULL DEFAULT 'unknown'"]
    ] as const) {
      if (!usageColumns.some((column) => column.name === name)) {
        this.#database.exec(`ALTER TABLE usage_observations ADD COLUMN ${name} ${definition}`);
      }
    }
    this.#database.exec(`
      UPDATE usage_observations
      SET unclassified_tokens = MAX(
        0,
        total_tokens - input_tokens - output_tokens - cache_read_tokens - cache_write_tokens
      )
      WHERE total_derivation = 'legacy-total'
    `);
    this.#database.exec(`
      UPDATE usage_observations
      SET model_attribution = 'unclassified',
          unclassified_tokens = total_tokens
      WHERE lower(trim(model)) IN ('all-models', 'unknown', 'unknown-model', '__unclassified__')
    `);
    this.#database.exec(`
      UPDATE usage_observations
      SET usage_scope = 'this-mac',
          total_derivation = 'categorized'
      WHERE usage_scope = 'unknown'
        AND (
          (provider_id = 'claude-code' AND id LIKE 'claude-otel:%')
          OR (provider_id = 'grok' AND id LIKE 'grok-otel:%')
          OR (provider_id = 'grok' AND id LIKE 'grok-headless:%')
        )
    `);
    this.#database.exec(`
      UPDATE usage_observations
      SET aggregation_temporality = 'delta'
      WHERE aggregation_temporality = 'unknown'
        AND provider_id = 'grok'
        AND (id LIKE 'grok-otel:%' OR id LIKE 'grok-headless:%')
    `);
    this.#database.exec(`
      UPDATE usage_observations
      SET time_precision = 'event'
      WHERE time_precision = 'unknown'
        AND provider_id = 'grok'
        AND id LIKE 'grok-headless:%'
    `);
    const providerColumns = this.#database
      .prepare('PRAGMA table_info(providers)')
      .all() as unknown as Array<{ name: string }>;
    if (!providerColumns.some((column) => column.name === 'account_identifier')) {
      this.#database.exec('ALTER TABLE providers ADD COLUMN account_identifier TEXT');
    }
    if (!providerColumns.some((column) => column.name === 'last_error_code')) {
      this.#database.exec('ALTER TABLE providers ADD COLUMN last_error_code TEXT');
    }
    if (!providerColumns.some((column) => column.name === 'last_recovery')) {
      this.#database.exec('ALTER TABLE providers ADD COLUMN last_recovery TEXT');
    }
    const costColumns = this.#database
      .prepare('PRAGMA table_info(cost_records)')
      .all() as unknown as Array<{ name: string }>;
    if (!costColumns.some((column) => column.name === 'source_id')) {
      this.#database.exec('ALTER TABLE cost_records ADD COLUMN source_id TEXT');
    }
    for (const [name, type] of [
      ['price_snapshot_id', 'TEXT'],
      ['price_snapshot_version', 'TEXT'],
      ['price_snapshot_source', 'TEXT'],
      ['price_snapshot_effective_at', 'TEXT'],
      ['price_snapshot_source_url', 'TEXT'],
      ['price_snapshot_context_tier', 'TEXT'],
      ['model', 'TEXT'],
      ['usage_observation_id', 'TEXT'],
      ['priced_tokens', 'INTEGER'],
      ['line_items_json', 'TEXT'],
      ['calculated_at', 'TEXT']
    ] as const) {
      if (!costColumns.some((column) => column.name === name)) {
        this.#database.exec(`ALTER TABLE cost_records ADD COLUMN ${name} ${type}`);
      }
    }
    const quotaColumns = this.#database
      .prepare('PRAGMA table_info(quota_buckets)')
      .all() as unknown as Array<{ name: string }>;
    for (const [name, type] of [
      ['scope', 'TEXT'],
      ['status', 'TEXT'],
      ['limit_amount', 'REAL'],
      ['limit_currency', 'TEXT'],
      ['fallback_status', 'TEXT']
    ] as const) {
      if (!quotaColumns.some((column) => column.name === name)) {
        this.#database.exec(`ALTER TABLE quota_buckets ADD COLUMN ${name} ${type}`);
      }
    }
  }
}

function mapQuotaRow(row: QuotaRow): QuotaBucket {
  return {
    id: row.id,
    billingDomainId: row.billing_domain_id,
    label: row.label,
    usedPercent: row.used_percent,
    resetsAt: row.resets_at,
    authority: row.authority,
    observedAt: row.observed_at,
    scope: row.scope ?? undefined,
    status: row.status,
    limitAmount: row.limit_amount,
    limitCurrency: row.limit_currency,
    fallbackStatus: row.fallback_status
  };
}

function defaultMonitoringSettings(): MonitoringSettings {
  return {
    backgroundCollectionEnabled: true,
    intervalMinutes: 5,
    notificationsEnabled: false,
    startAtLogin: false
  };
}

function mapTokenTotals(tokens: TokenRow): ProviderOverview['tokenTotals'] {
  return {
    total: Number(tokens.total_tokens ?? 0),
    input: Number(tokens.input_tokens ?? 0),
    output: Number(tokens.output_tokens ?? 0),
    reasoning: Number(tokens.reasoning_tokens ?? 0),
    cacheRead: Number(tokens.cache_read_tokens ?? 0),
    cacheWrite: Number(tokens.cache_write_tokens ?? 0)
  };
}

function mapTokenEvidence(tokens: TokenRow): TokenEvidence {
  const recordedTokens = Number(tokens.total_tokens ?? 0);
  const unclassifiedTokens = Number(tokens.unclassified_tokens ?? 0);
  const classifiedTokens = Math.max(0, recordedTokens - unclassifiedTokens);
  return {
    recordedTokens,
    sourceReportedTokens: Number(tokens.source_reported_tokens ?? 0),
    sourceReportedObservationCount: Number(tokens.source_reported_observation_count ?? 0),
    observationCount: Number(tokens.observation_count ?? 0),
    unclassifiedTokens,
    classifiedTokens,
    classificationCoverage: recordedTokens === 0 ? null : classifiedTokens / recordedTokens,
    totalDerivations: commaSeparatedValues<TokenTotalDerivation>(tokens.total_derivations),
    timePrecisions: commaSeparatedValues<TokenTimePrecision>(tokens.time_precisions),
    usageScopes: commaSeparatedValues<TokenUsageScope>(tokens.usage_scopes),
    aggregationTemporalities: commaSeparatedValues<TokenAggregationTemporality>(
      tokens.aggregation_temporalities
    )
  };
}

function emptyTokenEvidence(): MutableTokenEvidence {
  return {
    recordedTokens: 0,
    sourceReportedTokens: 0,
    sourceReportedObservationCount: 0,
    observationCount: 0,
    unclassifiedTokens: 0,
    totalDerivations: new Set(),
    timePrecisions: new Set(),
    usageScopes: new Set(),
    aggregationTemporalities: new Set()
  };
}

function addTokenEvidence(target: MutableTokenEvidence, row: UsageHistoryRow): void {
  target.recordedTokens += Number(row.total_tokens);
  target.observationCount += 1;
  target.unclassifiedTokens += Number(row.unclassified_tokens);
  if (row.source_reported_total_tokens !== null) {
    target.sourceReportedTokens += Number(row.source_reported_total_tokens);
    target.sourceReportedObservationCount += 1;
  }
  target.totalDerivations.add(row.total_derivation);
  target.timePrecisions.add(row.time_precision);
  target.usageScopes.add(row.usage_scope);
  target.aggregationTemporalities.add(row.aggregation_temporality);
}

function finishTokenEvidence(evidence: MutableTokenEvidence): TokenEvidence {
  const classifiedTokens = Math.max(0, evidence.recordedTokens - evidence.unclassifiedTokens);
  return {
    recordedTokens: evidence.recordedTokens,
    sourceReportedTokens: evidence.sourceReportedTokens,
    sourceReportedObservationCount: evidence.sourceReportedObservationCount,
    observationCount: evidence.observationCount,
    unclassifiedTokens: evidence.unclassifiedTokens,
    classifiedTokens,
    classificationCoverage:
      evidence.recordedTokens === 0 ? null : classifiedTokens / evidence.recordedTokens,
    totalDerivations: [...evidence.totalDerivations].sort(),
    timePrecisions: [...evidence.timePrecisions].sort(),
    usageScopes: [...evidence.usageScopes].sort(),
    aggregationTemporalities: [...evidence.aggregationTemporalities].sort()
  };
}

function commaSeparatedValues<T extends string>(value: string | null): T[] {
  return value ? ([...new Set(value.split(',').filter(Boolean))].sort() as T[]) : [];
}

function priceSnapshotFromRow(row: CostRow): PriceSnapshotReference | null {
  if (
    !row.price_snapshot_id ||
    !row.price_snapshot_version ||
    !row.price_snapshot_source ||
    !row.price_snapshot_effective_at
  ) {
    return null;
  }
  return {
    id: row.price_snapshot_id,
    version: row.price_snapshot_version,
    source: row.price_snapshot_source,
    effectiveAt: row.price_snapshot_effective_at,
    ...(row.price_snapshot_source_url ? { sourceUrl: row.price_snapshot_source_url } : {}),
    ...(row.price_snapshot_context_tier ? { contextTier: row.price_snapshot_context_tier } : {})
  };
}

function parseLineItems(value: string | null): RetailPriceLineItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as RetailPriceLineItem[]) : [];
  } catch {
    return [];
  }
}

function buildGlobalSummary(
  providers: ProviderOverview[],
  riskSummary: UsageOverview['riskSummary'],
  now: Date,
  query: UsageQuery
): UsageOverview['globalSummary'] {
  const evidence = emptyTokenEvidence();
  const contributions: UsageOverview['globalSummary']['contributions'] = [];
  let latestObservedAt: string | null = null;
  let retailAmount = 0;
  let retailPricedTokens = 0;
  let sawRetailEquivalent = false;

  for (const provider of providers) {
    for (const domain of provider.billingDomains) {
      for (const cost of domain.history.costs) {
        if (
          cost.kind !== 'retail-equivalent' ||
          cost.currency.toUpperCase() !== 'USD' ||
          cost.amount === null
        ) {
          continue;
        }
        sawRetailEquivalent = true;
        retailAmount += cost.amount;
        retailPricedTokens += cost.pricingEvidence?.pricedTokens ?? 0;
      }
      for (const observedAt of [
        domain.history.lastObservedAt,
        ...domain.quotaBuckets.map((bucket) => bucket.observedAt ?? null),
        ...domain.costs.map((cost) => cost.observedAt),
        ...domain.balances.map((balance) => balance.observedAt),
        ...domain.invoices.map((invoice) => invoice.createdAt)
      ]) {
        if (observedAt && (!latestObservedAt || observedAt > latestObservedAt)) {
          latestObservedAt = observedAt;
        }
      }
      const domainEvidence = domain.history.tokenEvidence;
      if (domainEvidence.observationCount === 0) continue;
      addAggregatedTokenEvidence(evidence, domainEvidence);
      contributions.push({
        providerId: provider.id,
        providerDisplayName: provider.displayName,
        billingDomainId: domain.id,
        billingDomainDisplayName: domain.displayName,
        recordedTokens: domain.history.tokenTotals.total,
        tokenEvidence: domainEvidence
      });
    }
  }

  const tokenEvidence = finishTokenEvidence(evidence);
  return {
    window: query.window ?? providers[0]?.billingDomains[0]?.history.window ?? '24h',
    recordedTokens: tokenEvidence.observationCount > 0 ? tokenEvidence.recordedTokens : null,
    tokenEvidence,
    apiRetailEquivalent: {
      status: sawRetailEquivalent ? 'available' : 'unavailable',
      amount: sawRetailEquivalent ? preciseAmount(retailAmount) : null,
      currency: 'USD',
      pricingCoverage:
        tokenEvidence.recordedTokens === 0
          ? null
          : retailPricedTokens / tokenEvidence.recordedTokens
    },
    mostConstrained: riskSummary.mostConstrained,
    latestObservedAt,
    generatedAt: now.toISOString(),
    contributions
  };
}

function addAggregatedTokenEvidence(target: MutableTokenEvidence, source: TokenEvidence): void {
  target.recordedTokens += source.recordedTokens;
  target.sourceReportedTokens += source.sourceReportedTokens;
  target.sourceReportedObservationCount += source.sourceReportedObservationCount;
  target.observationCount += source.observationCount;
  target.unclassifiedTokens += source.unclassifiedTokens;
  for (const value of source.totalDerivations) target.totalDerivations.add(value);
  for (const value of source.timePrecisions) target.timePrecisions.add(value);
  for (const value of source.usageScopes) target.usageScopes.add(value);
  for (const value of source.aggregationTemporalities) {
    target.aggregationTemporalities.add(value);
  }
}

function normalizeUsageQuery(
  now: Date,
  query: UsageQuery
): {
  window: HistoryWindow;
  start: Date;
  end: Date;
  timeZone: string;
  comparisonCurrency: string;
} {
  const window = query.window ?? '24h';
  const durations: Record<HistoryWindow, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };
  const timeZone = validTimeZone(query.timeZone) ? query.timeZone! : 'UTC';
  return {
    window,
    start: new Date(now.getTime() - durations[window]),
    end: now,
    timeZone,
    comparisonCurrency: (query.comparisonCurrency ?? 'CNY').toUpperCase()
  };
}

function validTimeZone(value: string | undefined): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function zeroTokenTotals(): ProviderOverview['tokenTotals'] {
  return { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
}

function addUsageRow(target: ProviderOverview['tokenTotals'], row: UsageHistoryRow): void {
  target.total += Number(row.total_tokens);
  target.input += Number(row.input_tokens);
  target.output += Number(row.output_tokens);
  target.reasoning += Number(row.reasoning_tokens);
  target.cacheRead += Number(row.cache_read_tokens);
  target.cacheWrite += Number(row.cache_write_tokens);
}

function localDay(observedAt: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(observedAt));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function summarizeHistoryCosts(
  rows: CostRow[],
  recordedTokens: number,
  rates: Map<string, ExchangeRateRow>,
  comparisonCurrency: string,
  end: Date,
  usedRates: Map<string, ExchangeRateSnapshot>
): HistoryCost[] {
  const groups = new Map<
    string,
    {
      kind: CostRecord['kind'];
      currency: string;
      amount: number;
      unknown: boolean;
      prices: Map<string, PriceSnapshotReference>;
      authorities: Set<DataAuthority>;
      observedAt: string | null;
      pricedTokens: number;
    }
  >();
  for (const row of rows) {
    const currency = row.currency.toUpperCase();
    const key = `${row.kind}:${currency}`;
    const group = groups.get(key) ?? {
      kind: row.kind,
      currency,
      amount: 0,
      unknown: false,
      prices: new Map<string, PriceSnapshotReference>(),
      authorities: new Set<DataAuthority>(),
      observedAt: null,
      pricedTokens: 0
    };
    if (!group.observedAt || row.observed_at > group.observedAt) group.observedAt = row.observed_at;
    group.authorities.add(row.authority);
    if (row.amount === null) group.unknown = true;
    else group.amount += Number(row.amount);
    if (row.kind === 'retail-equivalent') group.pricedTokens += Number(row.priced_tokens ?? 0);
    const price = priceSnapshotFromRow(row);
    if (price) group.prices.set(price.id, price);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group): HistoryCost => {
      const amount = group.unknown ? null : group.amount;
      const pricingEvidence =
        group.kind === 'retail-equivalent'
          ? {
              pricedTokens: group.pricedTokens,
              recordedTokens,
              pricingCoverage: recordedTokens === 0 ? null : group.pricedTokens / recordedTokens
            }
          : undefined;
      if (amount === null) {
        return {
          kind: group.kind,
          currency: group.currency,
          amount: null,
          convertedAmount: null,
          comparisonCurrency,
          conversionUnavailableReason: 'unknown-native-amount',
          priceSnapshots: [...group.prices.values()],
          authorities: [...group.authorities].sort(),
          observedAt: group.observedAt,
          pricingEvidence
        };
      }
      if (group.currency === comparisonCurrency) {
        return {
          kind: group.kind,
          currency: group.currency,
          amount,
          convertedAmount: amount,
          comparisonCurrency,
          conversionUnavailableReason: null,
          priceSnapshots: [...group.prices.values()],
          authorities: [...group.authorities].sort(),
          observedAt: group.observedAt,
          pricingEvidence
        };
      }
      const rate = rates.get(group.currency);
      if (!rate) {
        return {
          kind: group.kind,
          currency: group.currency,
          amount,
          convertedAmount: null,
          comparisonCurrency,
          conversionUnavailableReason: 'missing-rate',
          priceSnapshots: [...group.prices.values()],
          authorities: [...group.authorities].sort(),
          observedAt: group.observedAt,
          pricingEvidence
        };
      }
      if (end.getTime() - new Date(rate.observed_at).getTime() > 7 * 24 * 60 * 60 * 1000) {
        return {
          kind: group.kind,
          currency: group.currency,
          amount,
          convertedAmount: null,
          comparisonCurrency,
          conversionUnavailableReason: 'stale-rate',
          priceSnapshots: [...group.prices.values()],
          authorities: [...group.authorities].sort(),
          observedAt: group.observedAt,
          pricingEvidence
        };
      }
      usedRates.set(rate.id, {
        id: rate.id,
        baseCurrency: rate.base_currency,
        quoteCurrency: rate.quote_currency,
        rate: rate.rate,
        observedAt: rate.observed_at,
        source: rate.source
      });
      return {
        kind: group.kind,
        currency: group.currency,
        amount,
        convertedAmount: amount * rate.rate,
        comparisonCurrency,
        conversionUnavailableReason: null,
        priceSnapshots: [...group.prices.values()],
        authorities: [...group.authorities].sort(),
        observedAt: group.observedAt,
        pricingEvidence
      };
    })
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.currency.localeCompare(right.currency)
    );
}

function buildRiskSummary(providers: ProviderOverview[]): UsageOverview['riskSummary'] {
  const risks = providers.flatMap((provider) =>
    provider.quotaBuckets.flatMap((bucket) => {
      if (bucket.usedPercent === null) return [];
      return [
        {
          providerId: provider.id,
          displayName: provider.displayName,
          billingDomainId: bucket.billingDomainId,
          bucketId: bucket.id,
          label: bucket.label,
          remainingPercent: Math.max(0, 100 - bucket.usedPercent),
          resetsAt: bucket.resetsAt,
          forecast: provider.forecasts.find((forecast) => forecast.bucketId === bucket.id) ?? null,
          authority: bucket.authority,
          observedAt: bucket.observedAt ?? provider.freshness.lastSuccessAt
        }
      ];
    })
  );
  risks.sort(
    (left, right) =>
      left.remainingPercent - right.remainingPercent ||
      left.providerId.localeCompare(right.providerId) ||
      left.bucketId.localeCompare(right.bucketId)
  );
  const candidates = providers
    .filter(
      (provider) =>
        provider.freshness.status === 'fresh' &&
        provider.health.status === 'healthy' &&
        provider.quotaBuckets.some((bucket) => bucket.usedPercent !== null)
    )
    .map((provider) => {
      const buckets = provider.quotaBuckets.filter(
        (bucket): bucket is QuotaBucket & { usedPercent: number } => bucket.usedPercent !== null
      );
      const limitingBucket = [...buckets].sort(
        (left, right) => right.usedPercent - left.usedPercent || left.id.localeCompare(right.id)
      )[0];
      const remaining = Math.min(...buckets.map((bucket) => 100 - bucket.usedPercent));
      const predictsFailure = provider.forecasts.some((forecast) => !forecast.willLastUntilReset);
      const predictsSuccess =
        provider.forecasts.length > 0 &&
        provider.forecasts.every((forecast) => forecast.willLastUntilReset);
      const coveragePenalty = provider.forecastCoverage === 'discontinuous' ? 40 : 0;
      return {
        provider,
        billingDomainId: limitingBucket.billingDomainId,
        limitingBucket,
        remaining,
        score:
          remaining + (predictsSuccess ? 20 : 0) - (predictsFailure ? 100 : 0) - coveragePenalty,
        predictsSuccess
      };
    })
    .sort(
      (left, right) => right.score - left.score || left.provider.id.localeCompare(right.provider.id)
    );
  const selected = candidates[0];
  return {
    mostConstrained: risks[0] ?? null,
    recommendation: selected
      ? {
          providerId: selected.provider.id,
          displayName: selected.provider.displayName,
          billingDomainId: selected.billingDomainId,
          score: round(selected.score),
          readOnly: true,
          reasonKeys: [
            'highest-safe-capacity',
            ...(selected.predictsSuccess ? (['forecast-lasts-until-reset'] as const) : [])
          ],
          evidence: {
            remainingPercent: round(selected.remaining),
            freshness: selected.provider.freshness.status,
            forecastCoverage: selected.provider.forecastCoverage,
            authority: selected.limitingBucket.authority,
            observedAt:
              selected.limitingBucket.observedAt ?? selected.provider.freshness.lastSuccessAt
          }
        }
      : null
  };
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function preciseAmount(value: number): number {
  return Number(value.toFixed(12));
}

function tokenAuthority(authorities: string | null): ProviderOverview['tokenAuthority'] {
  if (!authorities) return null;
  const values = authorities.split(',') as DataAuthority[];
  return values.length === 1 ? values[0] : 'mixed';
}

function coverageFromCount(count: number): CoverageLevel {
  return count > 0 ? 'complete' : 'unavailable';
}

function tokenCoverage(tokens: TokenRow): CoverageLevel {
  if (tokens.observation_count === 0) return 'unavailable';
  const scopes = commaSeparatedValues<TokenUsageScope>(tokens.usage_scopes);
  const temporalities = commaSeparatedValues<TokenAggregationTemporality>(
    tokens.aggregation_temporalities
  );
  return scopes.includes('this-mac') || temporalities.includes('delta') ? 'partial' : 'complete';
}

function freshnessStatus(
  lastSuccessAt: string | null,
  now: Date
): ProviderOverview['freshness']['status'] {
  if (!lastSuccessAt) return 'unavailable';
  return now.getTime() - new Date(lastSuccessAt).getTime() <= FRESHNESS_WINDOW_MS
    ? 'fresh'
    : 'stale';
}
