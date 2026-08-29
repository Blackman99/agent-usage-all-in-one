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
  windowDurationMinutes?: number | null;
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
export type TokenTotalDerivation =
  'source-reported' | 'reconciled-remainder' | 'categorized' | 'legacy-total';
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
  cacheWriteTokenBreakdown?: {
    fiveMinute: number;
    oneHour: number;
  } | null;
  sourceReportedTotalTokens?: number | null;
  reconciledRemainderTokens?: number | null;
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
  reconciledRemainderTokens: number | null;
  cacheWriteTokenBreakdown: { fiveMinute: number; oneHour: number } | null;
  tokenSemantics: TokenSemantics;
  modelAttribution: TokenModelAttribution;
  timePrecision: TokenTimePrecision;
  usageScope: TokenUsageScope;
  aggregationTemporality: TokenAggregationTemporality;
  recordedTokens: number;
  unclassifiedTokens: number;
  totalDerivation: TokenTotalDerivation;
}

export type CostPurpose = 'actual' | 'subscription' | 'reported-estimate' | 'retail-equivalent';
export type CostKind = CostPurpose | 'legacy-unknown';

export type RetailTokenKind = 'input' | 'output' | 'reasoning' | 'cache-read' | 'cache-write';

export interface RetailPriceLineItem {
  tokenKind: RetailTokenKind;
  tokens: number;
  ratePerMillion: number;
  amount: number;
}

export interface PriceSnapshotReference {
  id: string;
  version: string;
  source: string;
  canonicalModel: string | null;
  effectiveAt: string;
  effectiveUntil: string | null;
  currency: string;
  ratesPerMillion: Record<RetailTokenKind, number | null>;
  cacheWriteRatesPerMillion?: {
    fiveMinute: number;
    oneHour: number;
  };
  sourceUrl?: string;
  contextTier?: string;
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
  model?: string | null;
  usageObservationId?: string | null;
  pricedTokens?: number | null;
  lineItems?: RetailPriceLineItem[];
  calculatedAt?: string | null;
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

export interface UsageReconciliationPolicy {
  authoritativeIdPrefix: string;
  retiredIdPrefixes: string[];
}

export interface ConnectorSnapshot {
  provider: ProviderIdentity;
  billingDomains: BillingDomain[];
  quotaBuckets: QuotaBucket[];
  usage: UsageObservation[];
  usageReconciliation?: UsageReconciliationPolicy;
  costs: CostRecord[];
  balances?: BalanceRecord[];
  invoices?: InvoiceRecord[];
  warnings?: ConnectorFailure[];
  observedAt: string;
}

export type CollectionMode = 'incremental' | 'hard-rebuild';
export interface CollectionRequest {
  mode: CollectionMode;
}

export interface Connector {
  readonly id: string;
  readonly displayName?: string;
  readonly consentId?: string;
  collect(options?: CollectionRequest): Promise<ConnectorSnapshot>;
}

export type ProcessingModuleId = 'discovery' | 'usage' | 'pricing' | 'retention';
export type ProcessingModuleState = 'pending' | 'running' | 'ready' | 'failed';

export interface ProcessingStatus {
  startedAt: string;
  hardRebuild: boolean;
  modules: Record<
    ProcessingModuleId,
    {
      state: ProcessingModuleState;
      startedAt: string | null;
      completedAt: string | null;
      message: string | null;
    }
  >;
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
  freshness: ProviderOverview['freshness'];
  health: ProviderOverview['health'];
  coverage: ProviderOverview['coverage'];
  quotaBuckets: QuotaBucket[];
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  tokenAuthority: DataAuthority | 'mixed' | null;
  costs: CostRecord[];
  balances: BalanceRecord[];
  invoices: InvoiceRecord[];
  history: BillingHistory;
  forecasts: QuotaForecast[];
  forecastCoverage: ProviderOverview['forecastCoverage'];
}

export interface HistoryModel {
  model: string;
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  observations: HistoryModelObservation[];
  priceEvidence: HistoryModelPriceEvidence[];
}

export interface HistoryModelObservation {
  id: string;
  model: string | null;
  observedAt: string;
  authority: DataAuthority;
  timePrecision: TokenTimePrecision;
  sourceReportedTotalTokens: number | null;
  cacheWriteTokenBreakdown: { fiveMinute: number; oneHour: number } | null;
  recordedTokens: number;
  classifiedTokens: number;
  unclassifiedTokens: number;
  totalDerivation: TokenTotalDerivation;
  tokenSemantics: TokenSemantics;
  usageScope: TokenUsageScope;
  aggregationTemporality: TokenAggregationTemporality;
  tokenTotals: TokenTotals;
}

export interface HistoryDay {
  day: string;
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  costs: HistoryCost[];
  authorities?: DataAuthority[];
  lastObservedAt?: string | null;
}

export interface HistoryInterval {
  start: string;
  end: string;
  label: string;
  gap: boolean;
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  costs: HistoryCost[];
  authorities?: DataAuthority[];
  lastObservedAt?: string | null;
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
  records?: number;
  knownRecords?: number;
  pricingEvidence?: {
    pricedTokens: number;
    unpricedTokens: number;
    recordedTokens: number;
    pricingCoverage: number | null;
  };
}

export interface HistoryModelPriceEvidence extends HistoryCost {
  id: string;
  usageObservationId: string | null;
  pricedTokens: number;
  lineItems: RetailPriceLineItem[];
  priceSnapshot: PriceSnapshotReference | null;
  authority: DataAuthority;
  calculatedAt: string | null;
}

export interface HistoryUnclassifiedUsage {
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  authorities: DataAuthority[];
  lastObservedAt: string | null;
  observations?: HistoryModelObservation[];
}

export interface BillingHistory {
  window: HistoryWindow;
  start: string;
  end: string;
  timeZone: string;
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  models: HistoryModel[];
  unclassified: HistoryUnclassifiedUsage;
  days: HistoryDay[];
  intervals: HistoryInterval[];
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

export interface RetailPricingBackfillCursor {
  providerId: string;
  observedAt: string;
  observationId: string;
}

export interface RetailPricingBackfillPage {
  snapshots: ConnectorSnapshot[];
  nextCursor: RetailPricingBackfillCursor | null;
}

export interface ProviderOverview {
  id: string;
  displayName: string;
  summaryBillingDomainId: string | null;
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
  globalSummary: GlobalUsageSummary;
  workbench: TokenMoneyWorkbench;
  providers: ProviderOverview[];
  riskSummary: {
    mostConstrained: QuotaRisk | null;
    recommendation: AgentRecommendation | null;
  };
}

export type WorkbenchCostPurpose = 'actual' | 'reported-estimate' | 'retail-equivalent';

export interface WorkbenchNativeAmount {
  currency: string;
  amount: number | null;
  records: number;
  knownRecords: number;
}

export interface WorkbenchMoneyMetric {
  purpose: WorkbenchCostPurpose;
  status: 'available' | 'partial' | 'unavailable';
  amount: number | null;
  comparisonCurrency: string;
  nativeAmounts: WorkbenchNativeAmount[];
  authorities: DataAuthority[];
  observedAt: string | null;
  records: number;
  knownRecords: number;
  amountCoverage: number | null;
  pricingCoverage: number | null;
  pricedTokens: number;
  recordedTokens: number;
  conversionUnavailableReasons: Array<'unknown-native-amount' | 'missing-rate' | 'stale-rate'>;
  exchangeRates: ExchangeRateSnapshot[];
}

export interface WorkbenchTrendSegment {
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  recordedTokens: number;
  observationCount: number;
  timePrecisions: TokenTimePrecision[];
  authorities?: DataAuthority[];
  lastObservedAt?: string | null;
  retailEquivalent: {
    status: WorkbenchMoneyMetric['status'];
    amount: number | null;
    currency: string;
  };
  reportedEstimate: {
    status: WorkbenchMoneyMetric['status'];
    amount: number | null;
    currency: string;
  };
}

export interface WorkbenchTrendBucket {
  start: string;
  end: string;
  label: string;
  gap: boolean;
  segments: WorkbenchTrendSegment[];
}

export interface TokenMoneyWorkbench {
  window: HistoryWindow;
  start: string;
  end: string;
  timeZone: string;
  comparisonCurrency: string;
  recordedTokens: number | null;
  costs: {
    actual: WorkbenchMoneyMetric;
    reportedEstimate: WorkbenchMoneyMetric;
    retailEquivalent: WorkbenchMoneyMetric;
  };
  trend: {
    granularity: 'hour' | 'day';
    buckets: WorkbenchTrendBucket[];
  };
  providerSummary: WorkbenchProviderSummary[];
  tokenBreakdown: WorkbenchTokenBreakdown;
  dayBreakdown: WorkbenchDayBreakdown[];
  modelRanking: WorkbenchModelRanking;
}

export interface WorkbenchProviderSummary {
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  recordedTokens: number | null;
  tokenShare: number | null;
  retailEquivalent: WorkbenchMoneyMetric;
  retailShare: number | null;
  authorities: DataAuthority[];
  lastObservedAt: string | null;
}

export interface WorkbenchTokenBreakdown {
  status: 'available' | 'partial' | 'unavailable';
  tokenTotals: TokenTotals;
  classificationCoverage: number | null;
  authorities: DataAuthority[];
  lastObservedAt: string | null;
}

export interface WorkbenchDayBreakdown {
  start: string;
  end: string;
  label: string;
  gap: boolean;
  recordedTokens: number | null;
  tokenShare: number | null;
  retailEquivalent: WorkbenchMoneyMetric;
  retailShare: number | null;
  authorities: DataAuthority[];
  lastObservedAt: string | null;
}

export interface WorkbenchModelTrendBucket {
  start: string;
  end: string;
  label: string;
  gap: boolean;
  tokenTotals: TokenTotals;
  authorities?: DataAuthority[];
  lastObservedAt?: string | null;
  retailEquivalent: Pick<
    WorkbenchMoneyMetric,
    'status' | 'amount' | 'comparisonCurrency' | 'pricingCoverage'
  > &
    Partial<Pick<WorkbenchMoneyMetric, 'authorities' | 'observedAt'>>;
  reportedEstimate: Pick<
    WorkbenchMoneyMetric,
    'status' | 'amount' | 'comparisonCurrency' | 'pricingCoverage'
  > &
    Partial<Pick<WorkbenchMoneyMetric, 'authorities' | 'observedAt'>>;
}

export interface WorkbenchModelEntry {
  id: string;
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  model: string;
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  tokenShare: number | null;
  retailEquivalent: WorkbenchMoneyMetric;
  reportedEstimate: WorkbenchMoneyMetric;
  retailShare: number | null;
  reportedShare: number | null;
  authorities: DataAuthority[];
  lastObservedAt: string | null;
  observations: HistoryModelObservation[];
  priceEvidence: HistoryModelPriceEvidence[];
  trend: WorkbenchModelTrendBucket[];
}

export interface WorkbenchUnclassifiedUsage {
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  tokenTotals: TokenTotals;
  tokenEvidence: TokenEvidence;
  tokenShare: number | null;
  authorities: DataAuthority[];
  lastObservedAt: string | null;
}

export interface WorkbenchModelRanking {
  byTokens: string[];
  byCost: string[];
  byRetailEquivalent: string[];
  entries: WorkbenchModelEntry[];
  unclassified: WorkbenchUnclassifiedUsage[];
}

export interface GlobalUsageContribution {
  providerId: string;
  providerDisplayName: string;
  billingDomainId: string;
  billingDomainDisplayName: string;
  includedInHeadline: boolean;
  recordedTokens: number;
  tokenEvidence: TokenEvidence;
  authorities?: DataAuthority[];
  lastObservedAt?: string | null;
}

export interface GlobalUsageSummary {
  window: HistoryWindow;
  recordedTokens: number | null;
  tokenEvidence: TokenEvidence;
  apiRetailEquivalent: {
    status: 'available' | 'unavailable';
    amount: number | null;
    currency: 'USD';
    pricingCoverage: number | null;
  };
  mostConstrained: QuotaRisk | null;
  latestObservedAt: string | null;
  generatedAt: string;
  contributions: GlobalUsageContribution[];
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
  deleteConnectorDiagnostic(id: string): void;
  getConnectorDiagnostics(): ConnectorDiagnostic[];
  getProviderAccountIdentifiers(): Record<string, string>;
  compactUsageHistory(now: Date): RetentionStatus;
  getRetentionStatus(): RetentionStatus;
  clearUsageData(): void;
  saveConnectorStatus(status: ConnectorStatusRecord): void;
  getConnectorStatuses(): ConnectorStatusRecord[];
  getRetailPricingBackfillSnapshots?(): ConnectorSnapshot[];
  getRetailPricingBackfillPage?(
    cursor: RetailPricingBackfillCursor | null,
    limit: number
  ): RetailPricingBackfillPage;
  saveDerivedCosts?(providerId: string, costs: CostRecord[]): void;
  deleteDerivedRetailCosts?(): void;
  deleteDerivedRetailCostsAsync?(): Promise<void>;
  getApplicationState?(key: string): string | null;
  saveApplicationState?(key: string, value: string): void;
  ensureQueryIndexes?(): Promise<void> | void;
  maintainUsageHistory?(now: Date): Promise<RetentionStatus>;
  close(): void;
}

export interface TelemetryIngestor {
  readonly id: string;
  readonly consentId?: string;
  parse(payload: unknown, receivedAt: Date): ConnectorSnapshot;
}
