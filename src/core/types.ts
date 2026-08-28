import type { ConnectorStatusRecord } from './onboarding-types.js';

export type DataAuthority =
  'official-account' | 'official-client' | 'local-observation' | 'estimate' | 'unavailable';

export type CoverageLevel = 'complete' | 'partial' | 'unavailable';

export interface ProviderIdentity {
  id: string;
  displayName: string;
  accountIdentifier?: string | null;
}

export interface BillingDomain {
  id: string;
  displayName: string;
}

export interface QuotaBucket {
  id: string;
  billingDomainId: string;
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
  authority: DataAuthority;
  observedAt?: string;
  scope?: 'account-wide' | 'local-only';
  status?: string | null;
  limitAmount?: number | null;
  limitCurrency?: string | null;
  fallbackStatus?: 'enabled' | 'disabled' | 'unknown' | null;
}

export interface QuotaForecast {
  billingDomainId: string;
  bucketId: string;
  label: string;
  remainingPercent: number;
  resetsAt: string;
  burnRatePercentPerHour: number;
  predictedExhaustionAt: string;
  willLastUntilReset: boolean;
  confidence: 'medium' | 'high';
  evidence: {
    windowStart: string;
    windowEnd: string;
    samples: number;
    continuous: boolean;
  };
}

export type ReasoningTokenSemantics = 'included-in-output' | 'separate';
export type CacheTokenSemantics = 'included-in-input' | 'separate';
export type TokenTimePrecision = 'event' | 'hour' | 'day' | 'billing-period' | 'unknown';
export type TokenTotalDerivation = 'source-reported' | 'categorized' | 'legacy-total';
export type TokenModelAttribution = 'known' | 'unclassified';
export type TokenUsageScope = 'account-wide' | 'this-mac' | 'unknown';
export type TokenAggregationTemporality = 'delta' | 'cumulative' | 'unknown';

export interface TokenSemantics {
  reasoning: ReasoningTokenSemantics;
  cacheRead: CacheTokenSemantics;
  cacheWrite: CacheTokenSemantics;
}

export interface UsageObservation {
  id: string;
  billingDomainId: string;
  model: string | null;
  sessionId?: string | null;
  observedAt: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens?: number | null;
  sourceReportedTotalTokens?: number | null;
  tokenSemantics?: TokenSemantics;
  modelAttribution?: TokenModelAttribution;
  timePrecision?: TokenTimePrecision;
  usageScope?: TokenUsageScope;
  aggregationTemporality?: TokenAggregationTemporality;
  authority: DataAuthority;
}

export interface NormalizedUsageObservation extends UsageObservation {
  reasoningTokens: number;
  sourceReportedTotalTokens: number | null;
  tokenSemantics: TokenSemantics;
  modelAttribution: TokenModelAttribution;
  timePrecision: TokenTimePrecision;
  usageScope: TokenUsageScope;
  aggregationTemporality: TokenAggregationTemporality;
  recordedTokens: number;
  unclassifiedTokens: number;
  totalDerivation: TokenTotalDerivation;
}

export type CostKind = 'actual' | 'subscription' | 'estimate';

export interface PriceSnapshotReference {
  id: string;
  version: string;
  source: string;
  effectiveAt: string;
}

export interface CostRecord {
  id: string;
  sourceId?: string | null;
  billingDomainId: string;
  observedAt: string;
  kind: CostKind;
  amount: number | null;
  currency: string;
  authority: DataAuthority;
  priceSnapshot?: PriceSnapshotReference | null;
}

export type HistoryWindow = '24h' | '7d' | '30d';

export interface UsageQuery {
  window?: HistoryWindow;
  timeZone?: string;
  comparisonCurrency?: string;
}

export interface ExchangeRateSnapshot {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  observedAt: string;
  source: string;
}

export interface ExchangeRateProvider {
  readRates(): Promise<ExchangeRateSnapshot[]>;
}

export interface BalanceRecord {
  id: string;
  billingDomainId: string;
  observedAt: string;
  kind: 'prepaid' | 'spending-limit' | 'current-invoice';
  amount: number | null;
  currency: string;
  authority: DataAuthority;
  sourceId?: string | null;
}

export interface InvoiceRecord {
  id: string;
  billingDomainId: string;
  createdAt: string;
  number: string | null;
  status: string | null;
  amount: number | null;
  currency: string;
  authority: DataAuthority;
}

export interface ConnectorSnapshot {
  provider: ProviderIdentity;
  billingDomains: BillingDomain[];
  quotaBuckets: QuotaBucket[];
  usage: UsageObservation[];
  costs: CostRecord[];
  balances?: BalanceRecord[];
  invoices?: InvoiceRecord[];
  warnings?: ConnectorFailure[];
  observedAt: string;
}

export interface Connector {
  readonly id: string;
  readonly displayName?: string;
  readonly consentId?: string;
  collect(): Promise<ConnectorSnapshot>;
}

export interface ConnectorFailure {
  code: string;
  message: string;
  recovery: string;
}

export interface TokenTotals {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TokenEvidence {
  recordedTokens: number;
  sourceReportedTokens: number;
  sourceReportedObservationCount: number;
  observationCount: number;
  unclassifiedTokens: number;
  classifiedTokens: number;
  classificationCoverage: number | null;
  totalDerivations: TokenTotalDerivation[];
  timePrecisions: TokenTimePrecision[];
  usageScopes: TokenUsageScope[];
  aggregationTemporalities: TokenAggregationTemporality[];
}

export interface BillingDomainOverview extends BillingDomain {
  quotaBuckets: QuotaBucket[];
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  tokenAuthority: DataAuthority | 'mixed' | null;
  costs: CostRecord[];
  balances: BalanceRecord[];
  invoices: InvoiceRecord[];
  history: BillingHistory;
  forecasts: QuotaForecast[];
}

export interface HistoryModel {
  model: string;
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
}

export interface HistoryDay {
  day: string;
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  costs: HistoryCost[];
}

export interface HistoryCost {
  kind: CostKind;
  currency: string;
  amount: number | null;
  convertedAmount: number | null;
  comparisonCurrency: string;
  conversionUnavailableReason: 'unknown-native-amount' | 'missing-rate' | 'stale-rate' | null;
  priceSnapshots: PriceSnapshotReference[];
  authorities?: DataAuthority[];
  observedAt?: string | null;
}

export interface BillingHistory {
  window: HistoryWindow;
  start: string;
  end: string;
  timeZone: string;
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  models: HistoryModel[];
  days: HistoryDay[];
  costs: HistoryCost[];
  exchangeRates: ExchangeRateSnapshot[];
  authorities?: DataAuthority[];
  lastObservedAt?: string | null;
}

export interface UsageExportRequest extends UsageQuery {
  format: 'json' | 'csv';
  includeAccountIdentifiers?: boolean;
}

export interface UsageExportArtifact {
  format: UsageExportRequest['format'];
  filename: string;
  contentType: string;
  body: string;
}

export interface RetentionStatus {
  rawRetentionDays: 90;
  rawObservations: number;
  oldestRawObservedAt: string | null;
  dailyAggregates: number;
  lastCompactedAt: string | null;
}

export interface ProviderOverview {
  id: string;
  displayName: string;
  freshness: {
    status: 'fresh' | 'stale' | 'unavailable';
    lastSuccessAt: string | null;
  };
  health: {
    status: 'healthy' | 'degraded';
    errorCode: string | null;
    message: string | null;
    recovery: string | null;
  };
  coverage: {
    quota: CoverageLevel;
    tokens: CoverageLevel;
    actualCost: CoverageLevel;
    history: CoverageLevel;
  };
  quotaBuckets: QuotaBucket[];
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  tokenAuthority: DataAuthority | 'mixed' | null;
  billingDomains: BillingDomainOverview[];
  forecasts: QuotaForecast[];
  forecastCoverage: 'complete' | 'insufficient' | 'discontinuous' | 'stale';
}

export interface QuotaRisk {
  providerId: string;
  displayName: string;
  billingDomainId: string;
  bucketId: string;
  label: string;
  remainingPercent: number;
  resetsAt: string | null;
  forecast: QuotaForecast | null;
  authority?: DataAuthority;
  observedAt?: string | null;
}

export type RecommendationReasonKey =
  'highest-safe-capacity' | 'forecast-lasts-until-reset' | 'history-insufficient';

export interface AgentRecommendation {
  providerId: string;
  displayName: string;
  billingDomainId: string;
  score: number;
  readOnly: true;
  reasonKeys: RecommendationReasonKey[];
  evidence: {
    remainingPercent: number;
    freshness: ProviderOverview['freshness']['status'];
    forecastCoverage: ProviderOverview['forecastCoverage'];
    authority?: DataAuthority;
    observedAt?: string | null;
  };
}

export interface UsageOverview {
  generatedAt: string;
  providers: ProviderOverview[];
  riskSummary: {
    mostConstrained: QuotaRisk | null;
    recommendation: AgentRecommendation | null;
  };
}

export interface MonitoringSettings {
  backgroundCollectionEnabled: boolean;
  intervalMinutes: number;
  notificationsEnabled: boolean;
  startAtLogin: boolean;
}

export interface ConnectorPolicy {
  minimumIntervalMs: number;
  timeoutMs: number;
}

export interface ConnectorRuntimeState {
  id: string;
  lastAttemptAt: string | null;
  nextAllowedAt: string | null;
  failureCount: number;
  outcome: 'success' | 'failure' | null;
}

export interface LocalNotification {
  id: string;
  kind:
    'low-quota-20' | 'low-quota-5' | 'predicted-exhaustion' | 'quota-reset' | 'connector-failure';
  title: string;
  message: string;
  providerId: string;
  bucketId?: string;
  createdAt: string;
}

export interface LocalNotifier {
  notify(event: LocalNotification): Promise<void>;
}

export interface StartAtLoginManager {
  setEnabled(enabled: boolean): Promise<void>;
  isEnabled(): Promise<boolean>;
}

export type DiagnosticCategory =
  | 'missing-binary'
  | 'not-configured'
  | 'unauthorized'
  | 'unsupported'
  | 'schema-mismatch'
  | 'rate-limited'
  | 'timeout'
  | 'stale'
  | 'unavailable';

export interface ConnectorDiagnostic {
  id: string;
  providerId: string;
  billingDomainId: string | null;
  status: 'healthy' | 'degraded';
  category: DiagnosticCategory | null;
  message: string | null;
  recovery: string | null;
  affectedCoverage: Array<'quota' | 'tokens' | 'actual-cost' | 'history'>;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
}

export interface DoctorReport {
  generatedAt: string;
  daemon: { status: 'healthy' };
  database: { status: 'healthy' };
  connectors: ConnectorDiagnostic[];
  providers: Array<{
    id: string;
    displayName: string;
    status: 'healthy' | 'degraded';
    freshness: ProviderOverview['freshness'];
    health: ProviderOverview['health'];
    billingDomains: Array<{
      id: string;
      displayName: string;
      status: 'healthy' | 'degraded';
      category: DiagnosticCategory | null;
      affectedCoverage: ConnectorDiagnostic['affectedCoverage'];
      recovery: string | null;
    }>;
  }>;
}

export interface UsageRepository {
  saveSnapshot(snapshot: ConnectorSnapshot, options?: { preserveFailure?: boolean }): void;
  recordFailure(provider: ProviderIdentity, failedAt: string, failure: ConnectorFailure): void;
  getOverview(now: Date, query?: UsageQuery): UsageOverview;
  saveExchangeRateSnapshot(snapshot: ExchangeRateSnapshot): void;
  getConnectorRuntimeStates(): ConnectorRuntimeState[];
  saveConnectorRuntimeState(state: ConnectorRuntimeState): void;
  getMonitoringSettings(): MonitoringSettings;
  saveMonitoringSettings(settings: MonitoringSettings): void;
  getNotificationState(key: string): string | null;
  saveNotificationState(key: string, value: string): void;
  saveConnectorDiagnostic(diagnostic: ConnectorDiagnostic): void;
  getConnectorDiagnostics(): ConnectorDiagnostic[];
  getProviderAccountIdentifiers(): Record<string, string>;
  compactUsageHistory(now: Date): RetentionStatus;
  getRetentionStatus(): RetentionStatus;
  clearUsageData(): void;
  saveConnectorStatus(status: ConnectorStatusRecord): void;
  getConnectorStatuses(): ConnectorStatusRecord[];
  close(): void;
}

export interface TelemetryIngestor {
  readonly id: string;
  readonly consentId?: string;
  parse(payload: unknown, receivedAt: Date): ConnectorSnapshot;
}
