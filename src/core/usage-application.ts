import type {
  Connector,
  ConnectorSnapshot,
  ConnectorDiagnostic,
  ConnectorFailure,
  ConnectorPolicy,
  DoctorReport,
  ExchangeRateProvider,
  LocalNotification,
  LocalNotifier,
  MonitoringSettings,
  StartAtLoginManager,
  TelemetryIngestor,
  UsageOverview,
  UsageExportArtifact,
  UsageExportRequest,
  UsageQuery,
  UsageRepository,
  RetentionStatus
} from './types.js';
import type {
  ConfigureConnectorInput,
  ConnectorDefinition,
  ConnectorStatus,
  ConnectorStatusRecord,
  DiscoveryProbe,
  SecretStore
} from './onboarding-types.js';
import { redactSensitiveText } from './redaction.js';
import { buildUsageExport } from './usage-export.js';
import {
  OFFICIAL_PRICING_CATALOG,
  deriveRetailEquivalentCosts,
  type RetailPriceCatalog
} from './retail-pricing.js';

export interface UsageApplicationOptions {
  repository: UsageRepository;
  connectors: Connector[];
  clock?: () => Date;
  connectorDefinitions?: ConnectorDefinition[];
  discoveryProbe?: DiscoveryProbe;
  secretStore?: SecretStore;
  telemetryIngestors?: TelemetryIngestor[];
  exchangeRateProvider?: ExchangeRateProvider;
  connectorPolicies?: Record<string, ConnectorPolicy>;
  notifier?: LocalNotifier;
  startAtLoginManager?: StartAtLoginManager;
  priceCatalog?: RetailPriceCatalog | null;
}

export interface RefreshOptions {
  userInitiated?: boolean;
}

export class UsageApplication {
  readonly #repository: UsageRepository;
  readonly #connectors: Connector[];
  readonly #clock: () => Date;
  readonly #connectorDefinitions: ConnectorDefinition[];
  readonly #discoveryProbe?: DiscoveryProbe;
  readonly #secretStore?: SecretStore;
  readonly #telemetryIngestors: TelemetryIngestor[];
  readonly #exchangeRateProvider?: ExchangeRateProvider;
  readonly #connectorPolicies: Record<string, ConnectorPolicy>;
  readonly #notifier?: LocalNotifier;
  readonly #startAtLoginManager?: StartAtLoginManager;
  readonly #priceCatalog: RetailPriceCatalog | null;
  #refreshPromise: Promise<void> | null = null;

  constructor(options: UsageApplicationOptions) {
    this.#repository = options.repository;
    this.#connectors = options.connectors;
    this.#clock = options.clock ?? (() => new Date());
    this.#connectorDefinitions = options.connectorDefinitions ?? [];
    this.#discoveryProbe = options.discoveryProbe;
    this.#secretStore = options.secretStore;
    this.#telemetryIngestors = options.telemetryIngestors ?? [];
    this.#exchangeRateProvider = options.exchangeRateProvider;
    this.#connectorPolicies = options.connectorPolicies ?? {};
    this.#notifier = options.notifier;
    this.#startAtLoginManager = options.startAtLoginManager;
    this.#priceCatalog =
      options.priceCatalog === undefined ? OFFICIAL_PRICING_CATALOG : options.priceCatalog;
    this.#backfillRetailCosts();
  }

  #backfillRetailCosts(): void {
    if (
      !this.#priceCatalog ||
      !this.#repository.getRetailPricingBackfillSnapshots ||
      !this.#repository.saveDerivedCosts
    ) {
      return;
    }
    const calculatedAt = this.#clock().toISOString();
    for (const snapshot of this.#repository.getRetailPricingBackfillSnapshots()) {
      const costs = deriveRetailEquivalentCosts(snapshot, this.#priceCatalog, calculatedAt).costs;
      if (costs.length > 0) this.#repository.saveDerivedCosts(snapshot.provider.id, costs);
    }
  }

  refresh(options: RefreshOptions = {}): Promise<void> {
    if (this.#refreshPromise) return this.#refreshPromise;
    this.#refreshPromise = this.#performRefresh(options).finally(() => {
      this.#refreshPromise = null;
    });
    return this.#refreshPromise;
  }

  async #performRefresh(options: RefreshOptions): Promise<void> {
    if (this.#exchangeRateProvider) {
      try {
        for (const rate of await this.#exchangeRateProvider.readRates()) {
          this.#repository.saveExchangeRateSnapshot(rate);
        }
      } catch {
        // Native amounts remain available when the optional comparison rate is unavailable.
      }
    }
    const connectorStates = new Map(
      this.#repository.getConnectorStatuses().map((status) => [status.id, status.state])
    );
    const runtimeStates = new Map(
      this.#repository.getConnectorRuntimeStates().map((state) => [state.id, state])
    );
    await Promise.all(
      this.#connectors.map(async (connector) => {
        if (connector.consentId && connectorStates.get(connector.consentId) !== 'connected') {
          return;
        }
        const now = this.#clock();
        const runtime = runtimeStates.get(connector.id);
        if (
          !options.userInitiated &&
          runtime?.nextAllowedAt &&
          new Date(runtime.nextAllowedAt).getTime() > now.getTime()
        ) {
          return;
        }
        const policy = this.#connectorPolicies[connector.id] ?? {
          minimumIntervalMs: 0,
          timeoutMs: 30_000
        };
        try {
          const snapshot = await withTimeout(
            connector.collect(),
            policy.timeoutMs,
            `${connector.id} timed out`
          );
          this.#repository.saveSnapshot(this.#withRetailCosts(snapshot));
          if (snapshot.warnings && snapshot.warnings.length > 0) {
            const failure = redactFailure(combineFailures(snapshot.warnings));
            this.#repository.recordFailure(snapshot.provider, this.#clock().toISOString(), failure);
            this.#saveConnectorDiagnostic(
              connector,
              snapshot.provider.id,
              snapshot.billingDomains[0]?.id ??
                defaultBillingDomain(connector.id, this.#connectorDefinitions),
              failure
            );
            this.#recordConnectorOutcome(
              connector.id,
              now,
              policy,
              false,
              runtime?.failureCount ?? 0
            );
          } else {
            this.#saveHealthyConnectorDiagnostic(
              connector,
              snapshot.provider.id,
              snapshot.billingDomains[0]?.id ??
                defaultBillingDomain(connector.id, this.#connectorDefinitions),
              snapshot.observedAt
            );
            this.#recordConnectorOutcome(
              connector.id,
              now,
              policy,
              true,
              runtime?.failureCount ?? 0
            );
          }
        } catch (error) {
          const providerId = providerForConnector(connector.id, this.#connectorDefinitions);
          const failure = redactFailure(safeConnectorFailure(error));
          this.#repository.recordFailure(
            {
              id: providerId,
              displayName: displayNameForProvider(providerId, connector.displayName)
            },
            this.#clock().toISOString(),
            failure
          );
          this.#saveConnectorDiagnostic(
            connector,
            providerId,
            defaultBillingDomain(connector.id, this.#connectorDefinitions),
            failure
          );
          this.#recordConnectorOutcome(
            connector.id,
            now,
            policy,
            false,
            runtime?.failureCount ?? 0
          );
        }
      })
    );
    if (this.#repository.getMonitoringSettings().notificationsEnabled) {
      await this.#sendNotificationTransitions();
    }
    this.#repository.compactUsageHistory(this.#clock());
  }

  #saveHealthyConnectorDiagnostic(
    connector: Connector,
    providerId: string,
    billingDomainId: string,
    lastSuccessAt: string
  ): void {
    this.#repository.saveConnectorDiagnostic({
      id: connector.id,
      providerId,
      billingDomainId,
      status: 'healthy',
      category: null,
      message: null,
      recovery: null,
      affectedCoverage: [],
      lastAttemptAt: this.#clock().toISOString(),
      lastSuccessAt
    });
  }

  #saveConnectorDiagnostic(
    connector: Connector,
    providerId: string,
    billingDomainId: string,
    failure: ConnectorFailure
  ): void {
    const prior = this.#repository
      .getConnectorDiagnostics()
      .find((diagnostic) => diagnostic.id === connector.id);
    this.#repository.saveConnectorDiagnostic({
      id: connector.id,
      providerId,
      billingDomainId,
      status: 'degraded',
      category: diagnosticCategory(failure.code, failure.message),
      message: failure.message,
      recovery: failure.recovery,
      affectedCoverage: expectedCoverageForConnector(connector.id, this.#connectorDefinitions),
      lastAttemptAt: this.#clock().toISOString(),
      lastSuccessAt: prior?.lastSuccessAt ?? null
    });
  }

  #recordConnectorOutcome(
    id: string,
    now: Date,
    policy: ConnectorPolicy,
    success: boolean,
    priorFailures: number
  ): void {
    const failureCount = success ? 0 : priorFailures + 1;
    const backoff = success
      ? policy.minimumIntervalMs
      : Math.max(
          policy.minimumIntervalMs,
          Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, failureCount - 1))
        );
    this.#repository.saveConnectorRuntimeState({
      id,
      lastAttemptAt: now.toISOString(),
      nextAllowedAt: new Date(now.getTime() + backoff).toISOString(),
      failureCount,
      outcome: success ? 'success' : 'failure'
    });
    if (success) this.#repository.saveNotificationState(`failure:${id}`, 'clear');
  }

  async getMonitoringSettings(): Promise<MonitoringSettings> {
    return this.#repository.getMonitoringSettings();
  }

  async updateMonitoringSettings(
    changes: Partial<MonitoringSettings>
  ): Promise<MonitoringSettings> {
    const current = this.#repository.getMonitoringSettings();
    const updated = { ...current, ...changes };
    if (updated.intervalMinutes < 1 || updated.intervalMinutes > 1_440) {
      throw new Error('Collection interval must be between 1 and 1440 minutes');
    }
    if (changes.startAtLogin !== undefined) {
      if (!this.#startAtLoginManager) throw new Error('Start-at-login management is unavailable');
      await this.#startAtLoginManager.setEnabled(changes.startAtLogin);
    }
    this.#repository.saveMonitoringSettings(updated);
    return updated;
  }

  async getMonitoringStatus(): Promise<{
    settings: MonitoringSettings;
    connectors: ReturnType<UsageRepository['getConnectorRuntimeStates']>;
  }> {
    return {
      settings: this.#repository.getMonitoringSettings(),
      connectors: this.#repository.getConnectorRuntimeStates()
    };
  }

  async #sendNotificationTransitions(): Promise<void> {
    if (!this.#notifier) return;
    const overview = this.#repository.getOverview(this.#clock());
    for (const provider of overview.providers) {
      for (const bucket of provider.quotaBuckets) {
        if (bucket.usedPercent === null) continue;
        const prefix = `${provider.id}:${bucket.id}`;
        const usedKey = `quota-used:${prefix}`;
        const priorUsed = Number(this.#repository.getNotificationState(usedKey));
        if (Number.isFinite(priorUsed) && priorUsed - bucket.usedPercent >= 20) {
          await this.#notify({
            id: `reset:${prefix}:${bucket.resetsAt ?? this.#clock().toISOString()}`,
            kind: 'quota-reset',
            title: `${provider.displayName} quota reset`,
            message: `${bucket.label} usage returned to ${bucket.usedPercent}%.`,
            providerId: provider.id,
            bucketId: bucket.id,
            createdAt: this.#clock().toISOString()
          });
        }
        this.#repository.saveNotificationState(usedKey, String(bucket.usedPercent));
        const remaining = 100 - bucket.usedPercent;
        const level = remaining <= 5 ? '5' : remaining <= 20 ? '20' : 'normal';
        const levelKey = `quota-level:${prefix}`;
        const priorLevel = this.#repository.getNotificationState(levelKey) ?? 'normal';
        if (notificationLevel(level) > notificationLevel(priorLevel)) {
          await this.#notify({
            id: `quota:${prefix}:${level}:${bucket.resetsAt ?? 'unknown-reset'}`,
            kind: level === '5' ? 'low-quota-5' : 'low-quota-20',
            title: `${provider.displayName} quota is low`,
            message: `${bucket.label} has ${Math.max(0, remaining)}% remaining.`,
            providerId: provider.id,
            bucketId: bucket.id,
            createdAt: this.#clock().toISOString()
          });
        }
        this.#repository.saveNotificationState(levelKey, level);
      }
      for (const forecast of provider.forecasts.filter(
        (candidate) => !candidate.willLastUntilReset
      )) {
        const key = `forecast:${provider.id}:${forecast.bucketId}`;
        if (this.#repository.getNotificationState(key) !== forecast.resetsAt) {
          await this.#notify({
            id: `forecast:${provider.id}:${forecast.bucketId}:${forecast.resetsAt}`,
            kind: 'predicted-exhaustion',
            title: `${provider.displayName} may exhaust before reset`,
            message: `${forecast.label} is predicted to exhaust at ${forecast.predictedExhaustionAt}.`,
            providerId: provider.id,
            bucketId: forecast.bucketId,
            createdAt: this.#clock().toISOString()
          });
          this.#repository.saveNotificationState(key, forecast.resetsAt);
        }
      }
    }
    for (const runtime of this.#repository
      .getConnectorRuntimeStates()
      .filter((state) => state.failureCount >= 3)) {
      const key = `failure:${runtime.id}`;
      if (this.#repository.getNotificationState(key) !== 'active') {
        await this.#notify({
          id: `failure:${runtime.id}:${runtime.failureCount}`,
          kind: 'connector-failure',
          title: `${runtime.id} refresh is failing`,
          message: `${runtime.failureCount} consecutive refresh attempts failed.`,
          providerId: runtime.id,
          createdAt: this.#clock().toISOString()
        });
        this.#repository.saveNotificationState(key, 'active');
      }
    }
  }

  async #notify(event: LocalNotification): Promise<void> {
    try {
      await this.#notifier?.notify(event);
    } catch {
      // Notification delivery must never fail collection.
    }
  }

  async getDiagnostics(): Promise<DoctorReport> {
    const now = this.#clock();
    const overview = this.#repository.getOverview(now);
    const stored = new Map(
      this.#repository
        .getConnectorDiagnostics()
        .map((diagnostic) => [diagnostic.id, withStaleDiagnostic(diagnostic, now)])
    );
    const statuses = new Map(
      this.#repository.getConnectorStatuses().map((status) => [status.id, status])
    );

    for (const definition of this.#connectorDefinitions) {
      if (stored.has(definition.id)) continue;
      const status = statuses.get(definition.id) ?? emptyConnectorStatus(definition.id);
      const connected = status.state === 'connected';
      const category = connected
        ? null
        : !status.installed && definition.command !== null
          ? 'missing-binary'
          : 'not-configured';
      stored.set(definition.id, {
        id: definition.id,
        providerId: definition.target.provider.id,
        billingDomainId: definition.target.billingDomain.id,
        status: connected ? 'healthy' : 'degraded',
        category,
        message: connected
          ? null
          : category === 'missing-binary'
            ? `${definition.displayName} is not installed.`
            : `${definition.displayName} is not configured.`,
        recovery: connected
          ? null
          : category === 'missing-binary'
            ? `Install ${definition.displayName}, then retry discovery.`
            : `Connect ${definition.displayName} in onboarding.`,
        affectedCoverage: connected ? [] : definition.expectedCoverage,
        lastAttemptAt: status.lastDiscoveredAt ?? now.toISOString(),
        lastSuccessAt: null
      });
    }

    const connectors = [...stored.values()].sort((left, right) => left.id.localeCompare(right.id));
    return {
      generatedAt: now.toISOString(),
      daemon: { status: 'healthy' },
      database: { status: 'healthy' },
      connectors,
      providers: overview.providers.map((provider) => {
        const diagnostics = connectors.filter(
          (diagnostic) => diagnostic.providerId === provider.id
        );
        const degraded = diagnostics.some((diagnostic) => diagnostic.status === 'degraded');
        const domainIds = new Set([
          ...provider.billingDomains.map((domain) => domain.id),
          ...diagnostics.flatMap((diagnostic) =>
            diagnostic.billingDomainId ? [diagnostic.billingDomainId] : []
          )
        ]);
        return {
          id: provider.id,
          displayName: provider.displayName,
          status: degraded ? ('degraded' as const) : ('healthy' as const),
          freshness: provider.freshness,
          health: provider.health,
          billingDomains: [...domainIds].sort().map((domainId) => {
            const diagnostic = diagnostics.find(
              (candidate) => candidate.billingDomainId === domainId
            );
            const domain = provider.billingDomains.find((candidate) => candidate.id === domainId);
            return {
              id: domainId,
              displayName:
                domain?.displayName ??
                billingDomainDisplayName(domainId, this.#connectorDefinitions),
              status: diagnostic?.status ?? ('healthy' as const),
              category: diagnostic?.category ?? null,
              affectedCoverage: diagnostic?.affectedCoverage ?? [],
              recovery: diagnostic?.recovery ?? null
            };
          })
        };
      })
    };
  }

  async getOverview(query: UsageQuery = {}): Promise<UsageOverview> {
    return this.#repository.getOverview(this.#clock(), query);
  }

  async exportUsage(request: UsageExportRequest): Promise<UsageExportArtifact> {
    const overview = this.#repository.getOverview(this.#clock(), request);
    const accountIdentifiers = request.includeAccountIdentifiers
      ? this.#repository.getProviderAccountIdentifiers()
      : {};
    return buildUsageExport(overview, request, accountIdentifiers);
  }

  async getRetentionStatus(): Promise<RetentionStatus> {
    return this.#repository.getRetentionStatus();
  }

  async compactRetention(): Promise<RetentionStatus> {
    return this.#repository.compactUsageHistory(this.#clock());
  }

  async clearData(input: {
    deleteProductSecrets: boolean;
  }): Promise<{ usageCleared: true; productSecretsDeleted: number }> {
    let productSecretsDeleted = 0;
    if (input.deleteProductSecrets) {
      if (!this.#secretStore) throw new Error('Product secret management is unavailable');
      const records = new Map(
        this.#repository.getConnectorStatuses().map((status) => [status.id, status])
      );
      for (const definition of this.#connectorDefinitions.filter(
        (candidate) => candidate.credentialOwner === 'agent-usage'
      )) {
        const record = records.get(definition.id);
        if (!record?.secretReference) continue;
        await this.#secretStore.delete(record.secretReference);
        this.#repository.saveConnectorStatus({
          ...record,
          state: record.installed ? 'discovered' : 'not-installed',
          secretReference: null
        });
        productSecretsDeleted += 1;
      }
    }
    this.#repository.clearUsageData();
    return { usageCleared: true, productSecretsDeleted };
  }

  ingestTelemetry(id: string, payload: unknown): void {
    const ingestor = this.#telemetryIngestors.find((candidate) => candidate.id === id);
    if (!ingestor) throw new Error(`Unknown telemetry source: ${id}`);
    if (ingestor.consentId) {
      const status = this.#repository
        .getConnectorStatuses()
        .find((candidate) => candidate.id === ingestor.consentId);
      if (status?.state !== 'connected') throw new Error('Telemetry source is not connected');
    }
    const snapshot = ingestor.parse(payload, this.#clock());
    if (snapshot.usage.length === 0 && snapshot.costs.length === 0) {
      throw new Error('Telemetry payload contained no supported metrics');
    }
    this.#repository.saveSnapshot(this.#withRetailCosts(snapshot), { preserveFailure: true });
  }

  #withRetailCosts(snapshot: ConnectorSnapshot): ConnectorSnapshot {
    const retailCosts = this.#priceCatalog
      ? deriveRetailEquivalentCosts(snapshot, this.#priceCatalog, this.#clock().toISOString()).costs
      : [];
    return { ...snapshot, costs: [...snapshot.costs, ...retailCosts] };
  }

  async discoverConnectors(): Promise<ConnectorStatus[]> {
    if (!this.#discoveryProbe) return this.getConnectorStatuses();
    const existing = new Map(
      this.#repository.getConnectorStatuses().map((status) => [status.id, status])
    );
    await Promise.all(
      this.#connectorDefinitions.map(async (definition) => {
        try {
          const inspection = await this.#discoveryProbe!.inspect(definition);
          const prior = existing.get(definition.id);
          const explicitState = prior?.state === 'connected' || prior?.state === 'skipped';
          this.#repository.saveConnectorStatus({
            id: definition.id,
            state: explicitState
              ? prior.state
              : inspection.installed
                ? 'discovered'
                : 'not-installed',
            installed: inspection.installed,
            binaryPath: inspection.binaryPath,
            officialCredentialPresent: inspection.officialCredentialPresent,
            errorCode: null,
            lastDiscoveredAt: this.#clock().toISOString(),
            secretReference: prior?.secretReference ?? null
          });
        } catch {
          const prior = existing.get(definition.id);
          this.#repository.saveConnectorStatus({
            id: definition.id,
            state: 'error',
            installed: prior?.installed ?? false,
            binaryPath: prior?.binaryPath ?? null,
            officialCredentialPresent: prior?.officialCredentialPresent ?? false,
            errorCode: 'discovery-failed',
            lastDiscoveredAt: this.#clock().toISOString(),
            secretReference: prior?.secretReference ?? null
          });
        }
      })
    );
    return this.getConnectorStatuses();
  }

  async getConnectorStatuses(): Promise<ConnectorStatus[]> {
    const records = new Map(
      this.#repository.getConnectorStatuses().map((status) => [status.id, status])
    );
    return await Promise.all(
      this.#connectorDefinitions.map(async (definition) => {
        const record = records.get(definition.id) ?? emptyConnectorStatus(definition.id);
        return {
          ...record,
          displayName: definition.displayName,
          command: definition.command,
          permissionDescription: definition.permissionDescription,
          credentialOwner: definition.credentialOwner,
          experimental: definition.experimental,
          expectedCoverage: definition.expectedCoverage,
          target: definition.target,
          secretConfigured:
            record.secretReference !== null && this.#secretStore
              ? await this.#secretStore.has(record.secretReference)
              : false
        };
      })
    );
  }

  async configureConnector(id: string, input: ConfigureConnectorInput): Promise<ConnectorStatus> {
    const definition = this.#connectorDefinitions.find((candidate) => candidate.id === id);
    if (!definition) throw new Error(`Unknown connector: ${id}`);

    if (input.action === 'retry') {
      if (!this.#discoveryProbe) throw new Error('Connector discovery is unavailable');
      const inspection = await this.#discoveryProbe.inspect(definition);
      const prior = this.#repository.getConnectorStatuses().find((status) => status.id === id);
      this.#repository.saveConnectorStatus({
        id,
        state: inspection.installed ? 'discovered' : 'not-installed',
        installed: inspection.installed,
        binaryPath: inspection.binaryPath,
        officialCredentialPresent: inspection.officialCredentialPresent,
        errorCode: null,
        lastDiscoveredAt: this.#clock().toISOString(),
        secretReference: prior?.secretReference ?? null
      });
    } else {
      const prior = this.#repository.getConnectorStatuses().find((status) => status.id === id);
      const secretReference = `connector:${id}`;
      if (input.action === 'connect' && definition.credentialOwner === 'agent-usage') {
        if (!input.secret || !this.#secretStore) throw new Error('A managed secret is required');
        await this.#secretStore.set(secretReference, input.secret);
      }
      this.#repository.saveConnectorStatus({
        id,
        state: input.action === 'connect' ? 'connected' : 'skipped',
        installed: prior?.installed ?? false,
        binaryPath: prior?.binaryPath ?? null,
        officialCredentialPresent: prior?.officialCredentialPresent ?? false,
        errorCode: null,
        lastDiscoveredAt: prior?.lastDiscoveredAt ?? null,
        secretReference:
          input.action === 'connect' && definition.credentialOwner === 'agent-usage'
            ? secretReference
            : (prior?.secretReference ?? null)
      });
    }

    if (input.action === 'connect') await this.refresh({ userInitiated: true });

    const status = (await this.getConnectorStatuses()).find((candidate) => candidate.id === id);
    if (!status) throw new Error(`Connector status disappeared: ${id}`);
    return status;
  }
}

function safeConnectorFailure(error: unknown): ConnectorFailure {
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
    code: 'connector-refresh-failed',
    message: 'Provider refresh failed.',
    recovery: 'Run agent-usage doctor, then retry refresh.'
  };
}

function combineFailures(failures: ConnectorFailure[]): ConnectorFailure {
  return {
    code: failures.map((failure) => failure.code).join(','),
    message: failures.map((failure) => failure.message).join(' '),
    recovery: [...new Set(failures.map((failure) => failure.recovery))].join(' ')
  };
}

function providerForConnector(id: string, definitions: ConnectorDefinition[]): string {
  return definitions.find((definition) => definition.id === id)?.target.provider.id ?? id;
}

function displayNameForProvider(providerId: string, connectorDisplayName?: string): string {
  return providerId === 'grok' ? 'Grok' : (connectorDisplayName ?? providerId);
}

function defaultBillingDomain(id: string, definitions: ConnectorDefinition[]): string {
  return (
    definitions.find((definition) => definition.id === id)?.target.billingDomain.id ??
    'subscription'
  );
}

function billingDomainDisplayName(id: string, definitions: ConnectorDefinition[]): string {
  return (
    definitions.find((definition) => definition.target.billingDomain.id === id)?.target
      .billingDomain.displayName ?? id
  );
}

function expectedCoverageForConnector(
  id: string,
  definitions: ConnectorDefinition[]
): ConnectorDiagnostic['affectedCoverage'] {
  const configured = definitions.find((definition) => definition.id === id)?.expectedCoverage;
  if (configured) return configured;
  if (id === 'xai-api') return ['tokens', 'actual-cost', 'history'];
  return ['quota', 'tokens', 'history'];
}

function diagnosticCategory(code: string, message: string): ConnectorDiagnostic['category'] {
  const value = `${code} ${message}`.toLowerCase();
  if (/missing|binary|not[ -]?installed/.test(value)) return 'missing-binary';
  if (/not[ -]?configured|credential.*missing|key.*missing/.test(value)) {
    return 'not-configured';
  }
  if (/unauthori[sz]ed|permission|forbidden|\b401\b|\b403\b/.test(value)) {
    return 'unauthorized';
  }
  if (/unsupported|capability/.test(value)) return 'unsupported';
  if (/schema|shape|parse/.test(value)) return 'schema-mismatch';
  if (/rate[ -]?limit|\b429\b/.test(value)) return 'rate-limited';
  if (/timeout|timed out/.test(value)) return 'timeout';
  if (/stale/.test(value)) return 'stale';
  return 'unavailable';
}

function redactFailure(failure: ConnectorFailure): ConnectorFailure {
  return {
    code: failure.code,
    message: redactSensitiveText(failure.message),
    recovery: redactSensitiveText(failure.recovery)
  };
}

function withStaleDiagnostic(diagnostic: ConnectorDiagnostic, now: Date): ConnectorDiagnostic {
  if (
    diagnostic.status === 'healthy' &&
    diagnostic.lastSuccessAt &&
    now.getTime() - new Date(diagnostic.lastSuccessAt).getTime() > 15 * 60 * 1000
  ) {
    return {
      ...diagnostic,
      status: 'degraded',
      category: 'stale',
      message: 'The latest successful observation is stale.',
      recovery: 'Refresh this connector and check its credentials if staleness persists.',
      affectedCoverage: expectedCoverageForConnector(diagnostic.id, [])
    };
  }
  return diagnostic;
}

function emptyConnectorStatus(id: string): ConnectorStatusRecord {
  return {
    id,
    state: 'not-checked',
    installed: false,
    binaryPath: null,
    officialCredentialPresent: false,
    errorCode: null,
    lastDiscoveredAt: null,
    secretReference: null
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function notificationLevel(value: string): number {
  return value === '5' ? 2 : value === '20' ? 1 : 0;
}
