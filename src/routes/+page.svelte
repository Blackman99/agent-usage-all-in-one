<script lang="ts">
  import { onMount } from 'svelte';

  import type {
    BillingDomainOverview,
    CostKind,
    CoverageLevel,
    DataAuthority,
    BillingHistory,
    DoctorReport,
    HistoryWindow,
    MonitoringSettings,
    ProviderOverview,
    RetentionStatus,
    UsageOverview
  } from '$core/types.js';
  import type {
    ConfigureConnectorInput,
    ConnectorSetupState,
    ConnectorStatus,
    CoverageDimension,
    CredentialOwner
  } from '$core/onboarding-types.js';
  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';

  let locale: Locale = 'en';
  let overview: UsageOverview | null = null;
  let loading = true;
  let refreshing = false;
  let error = false;
  let connectors: ConnectorStatus[] = [];
  let pendingConnectorId: string | null = null;
  let secretInputs: Record<string, string> = {};
  let selectedBillingDomains: Record<string, string> = {};
  let selectedWindow: HistoryWindow = '24h';
  let timeZone = 'UTC';
  let monitoring: MonitoringSettings | null = null;
  let diagnostics: DoctorReport | null = null;
  let retention: RetentionStatus | null = null;
  let deleteProductSecrets = false;
  let includeAccountIdentifiers = false;
  let clearingData = false;

  onMount(async () => {
    locale = detectLocale(navigator.language);
    document.documentElement.lang = locale;
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    await Promise.all([
      refresh(),
      loadConnectors(),
      loadMonitoring(),
      loadDiagnostics(),
      loadRetention()
    ]);
    if (!overview) await loadOverview();
  });

  function t(key: MessageKey): string {
    return translate(locale, key);
  }

  function toggleLocale(): void {
    locale = locale === 'en' ? 'zh-CN' : 'en';
    document.documentElement.lang = locale;
  }

  async function loadOverview(): Promise<void> {
    try {
      error = false;
      const parameters = new URLSearchParams({
        window: selectedWindow,
        timeZone,
        currency: 'CNY'
      });
      const response = await fetch(`/api/overview?${parameters}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      overview = (await response.json()) as UsageOverview;
    } catch {
      error = true;
    } finally {
      loading = false;
    }
  }

  async function refresh(): Promise<void> {
    refreshing = true;
    try {
      const response = await fetch('/api/refresh', { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await Promise.all([loadOverview(), loadDiagnostics()]);
    } catch {
      error = true;
    } finally {
      refreshing = false;
    }
  }

  async function loadConnectors(): Promise<void> {
    try {
      const response = await fetch('/api/connectors');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      connectors = (await response.json()) as ConnectorStatus[];
    } catch {
      error = true;
    }
  }

  async function loadMonitoring(): Promise<void> {
    try {
      const response = await fetch('/api/monitoring');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { settings: MonitoringSettings };
      monitoring = body.settings;
    } catch {
      error = true;
    }
  }

  async function loadDiagnostics(): Promise<void> {
    try {
      const response = await fetch('/api/doctor');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      diagnostics = (await response.json()) as DoctorReport;
    } catch {
      error = true;
    }
  }

  async function loadRetention(): Promise<void> {
    try {
      const response = await fetch('/api/retention');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      retention = (await response.json()) as RetentionStatus;
    } catch {
      error = true;
    }
  }

  function exportHref(format: 'json' | 'csv'): string {
    const parameters = new URLSearchParams({
      format,
      window: selectedWindow,
      timeZone,
      currency: 'CNY',
      includeAccountIdentifiers: String(includeAccountIdentifiers)
    });
    return `/api/export?${parameters}`;
  }

  async function downloadExport(format: 'json' | 'csv'): Promise<void> {
    try {
      const response = await fetch(exportHref(format));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `agent-usage-${selectedWindow}.${format}`;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      error = true;
    }
  }

  async function clearLocalData(): Promise<void> {
    if (!window.confirm(t('clearConfirmation'))) return;
    clearingData = true;
    try {
      const response = await fetch('/api/data', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deleteProductSecrets })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      deleteProductSecrets = false;
      await Promise.all([loadOverview(), loadConnectors(), loadDiagnostics(), loadRetention()]);
    } catch {
      error = true;
    } finally {
      clearingData = false;
    }
  }

  async function updateMonitoring(changes: Partial<MonitoringSettings>): Promise<void> {
    try {
      const response = await fetch('/api/monitoring/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      monitoring = (await response.json()) as MonitoringSettings;
    } catch {
      error = true;
    }
  }

  async function configureConnector(
    id: string,
    action: ConfigureConnectorInput['action']
  ): Promise<void> {
    pendingConnectorId = id;
    try {
      const response = await fetch(`/api/connectors/${encodeURIComponent(id)}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(action === 'connect' && secretInputs[id] ? { secret: secretInputs[id] } : {})
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.json();
      secretInputs = { ...secretInputs, [id]: '' };
      await Promise.all([loadConnectors(), loadOverview(), loadDiagnostics()]);
    } catch {
      error = true;
    } finally {
      pendingConnectorId = null;
    }
  }

  function connectorStateLabel(state: ConnectorSetupState): string {
    const keys: Record<ConnectorSetupState, MessageKey> = {
      'not-checked': 'notChecked',
      'not-installed': 'notInstalled',
      discovered: 'discovered',
      connected: 'connected',
      skipped: 'skipped',
      error: 'connectionError'
    };
    return t(keys[state]);
  }

  function credentialOwnerLabel(owner: CredentialOwner): string {
    return t(
      owner === 'official-client'
        ? 'officialClient'
        : owner === 'agent-usage'
          ? 'managedSecret'
          : 'noCredential'
    );
  }

  function connectorPermission(connector: ConnectorStatus): string {
    const keys: Partial<Record<string, MessageKey>> = {
      codex: 'codexPermission',
      'claude-code': 'claudePermission',
      'opencode-go': 'openCodePermission',
      grok: 'grokPermission',
      'xai-api': 'xaiPermission'
    };
    const key = keys[connector.id];
    return key ? t(key) : connector.permissionDescription;
  }

  function diagnosticCategoryLabel(diagnostic: DoctorReport['connectors'][number]): string {
    if (diagnostic.status === 'healthy') return t('healthy');
    const keys: Record<NonNullable<typeof diagnostic.category>, MessageKey> = {
      'missing-binary': 'diagnosticMissingBinary',
      'not-configured': 'diagnosticNotConfigured',
      unauthorized: 'diagnosticUnauthorized',
      unsupported: 'diagnosticUnsupported',
      'schema-mismatch': 'diagnosticSchemaMismatch',
      'rate-limited': 'diagnosticRateLimited',
      timeout: 'diagnosticTimeout',
      stale: 'diagnosticStale',
      unavailable: 'diagnosticUnavailable'
    };
    return diagnostic.category ? t(keys[diagnostic.category]) : t('diagnosticUnavailable');
  }

  function diagnosticRecovery(diagnostic: DoctorReport['connectors'][number]): string | null {
    if (!diagnostic.recovery || locale === 'en') return diagnostic.recovery;
    const keys: Record<NonNullable<typeof diagnostic.category>, MessageKey> = {
      'missing-binary': 'recoveryMissingBinary',
      'not-configured': 'recoveryNotConfigured',
      unauthorized: 'recoveryUnauthorized',
      unsupported: 'recoveryUnsupported',
      'schema-mismatch': 'recoverySchemaMismatch',
      'rate-limited': 'recoveryRateLimited',
      timeout: 'recoveryTimeout',
      stale: 'recoveryStale',
      unavailable: 'recoveryUnavailable'
    };
    return diagnostic.category ? t(keys[diagnostic.category]) : t('recoveryUnavailable');
  }

  function formatNumber(value: number): string {
    return new Intl.NumberFormat(locale).format(value);
  }

  function formatReset(value: string | null): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric'
    }).format(new Date(value));
  }

  function formatRelativeReset(value: string | null): string {
    if (!value) return '—';
    const milliseconds = new Date(value).getTime() - Date.now();
    const absolute = Math.abs(milliseconds);
    const [divisor, unit] =
      absolute >= 24 * 60 * 60 * 1000
        ? [24 * 60 * 60 * 1000, 'day']
        : absolute >= 60 * 60 * 1000
          ? [60 * 60 * 1000, 'hour']
          : absolute >= 60 * 1000
            ? [60 * 1000, 'minute']
            : [1000, 'second'];
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      Math.round(milliseconds / divisor),
      unit as Intl.RelativeTimeFormatUnit
    );
  }

  function authorityLabel(authority: DataAuthority | 'mixed'): string {
    const keys: Record<DataAuthority | 'mixed', MessageKey> = {
      'official-account': 'authorityOfficialAccount',
      'official-client': 'authorityOfficialClient',
      'local-observation': 'authorityLocalObservation',
      estimate: 'authorityEstimate',
      unavailable: 'authorityUnavailable',
      mixed: 'authorityMixed'
    };
    return t(keys[authority]);
  }

  function coverageLevelLabel(coverage: CoverageLevel): string {
    const keys: Record<CoverageLevel, MessageKey> = {
      complete: 'coverageComplete',
      partial: 'coveragePartial',
      unavailable: 'coverageUnavailable'
    };
    return t(keys[coverage]);
  }

  function coverageDimensionLabel(coverage: CoverageDimension): string {
    const keys: Record<CoverageDimension, MessageKey> = {
      quota: 'quota',
      tokens: 'tokens',
      'actual-cost': 'actualCost',
      history: 'history'
    };
    return t(keys[coverage]);
  }

  function confidenceLabel(confidence: 'medium' | 'high'): string {
    return t(confidence === 'high' ? 'confidenceHigh' : 'confidenceMedium');
  }

  function costKindLabel(kind: CostKind): string {
    const keys: Record<CostKind, MessageKey> = {
      actual: 'costActual',
      subscription: 'costSubscription',
      estimate: 'costEstimate'
    };
    return t(keys[kind]);
  }

  function providerHealthMessage(provider: ProviderOverview): string | null {
    return locale === 'en' ? provider.health.message : t('providerDegraded');
  }

  function providerHealthRecovery(provider: ProviderOverview): string | null {
    return locale === 'en' ? provider.health.recovery : t('providerRecovery');
  }

  function activeBillingDomain(
    provider: ProviderOverview,
    selected: string | undefined
  ): BillingDomainOverview {
    const domains = provider.billingDomains ?? [];
    return (
      domains.find((domain) => domain.id === selected) ??
      domains[0] ?? {
        id: 'combined',
        displayName: provider.displayName,
        quotaBuckets: provider.quotaBuckets,
        tokenTotals: provider.tokenTotals,
        tokenAuthority: provider.tokenAuthority,
        costs: [],
        balances: [],
        invoices: [],
        history: fallbackHistory(provider.tokenTotals, [], provider.tokenAuthority),
        forecasts: []
      }
    );
  }

  function activeHistory(domain: BillingDomainOverview): BillingHistory {
    return (
      domain.history ?? fallbackHistory(domain.tokenTotals, domain.costs, domain.tokenAuthority)
    );
  }

  function fallbackHistory(
    tokenTotals: ProviderOverview['tokenTotals'],
    costs: BillingDomainOverview['costs'],
    tokenAuthority: BillingDomainOverview['tokenAuthority']
  ): BillingHistory {
    return {
      window: selectedWindow,
      start: '',
      end: '',
      timeZone,
      tokenTotals,
      models: [],
      days: [],
      costs: costs.map((cost) => ({
        kind: cost.kind,
        currency: cost.currency,
        amount: cost.amount,
        convertedAmount: null,
        comparisonCurrency: 'CNY',
        conversionUnavailableReason:
          cost.amount === null ? 'unknown-native-amount' : 'missing-rate',
        priceSnapshots: cost.priceSnapshot ? [cost.priceSnapshot] : [],
        authorities: [cost.authority],
        observedAt: cost.observedAt
      })),
      exchangeRates: [],
      authorities: tokenAuthority === 'mixed' ? undefined : tokenAuthority ? [tokenAuthority] : [],
      lastObservedAt: null
    };
  }

  function historyTokenAuthority(
    history: BillingHistory,
    fallback: BillingDomainOverview['tokenAuthority']
  ): BillingDomainOverview['tokenAuthority'] {
    if (!history.lastObservedAt) return null;
    if (!history.authorities) return fallback;
    const authorities = [...new Set(history.authorities)];
    if (authorities.length === 0) return null;
    return authorities.length === 1 ? authorities[0] : 'mixed';
  }

  async function selectWindow(window: HistoryWindow): Promise<void> {
    selectedWindow = window;
    loading = true;
    await loadOverview();
  }

  function selectBillingDomain(providerId: string, billingDomainId: string): void {
    selectedBillingDomains = { ...selectedBillingDomains, [providerId]: billingDomainId };
  }

  function connectorForDomain(
    connectionStatuses: ConnectorStatus[],
    providerId: string,
    billingDomainId: string
  ): ConnectorStatus | undefined {
    return connectionStatuses.find(
      (connector) =>
        connector.target.provider.id === providerId &&
        connector.target.billingDomain.id === billingDomainId
    );
  }

  function providerLogoPath(providerId: string): string | null {
    const paths: Record<string, string> = {
      codex: '/brands/openai.svg',
      'claude-code': '/brands/claude.svg',
      'opencode-go': '/brands/opencode.svg'
    };
    return paths[providerId] ?? null;
  }

  function displayProviders(
    currentOverview: UsageOverview,
    connectionStatuses: ConnectorStatus[]
  ): ProviderOverview[] {
    const providers = currentOverview.providers.map((provider) => ({
      ...provider,
      billingDomains: [...provider.billingDomains]
    }));
    for (const connector of connectionStatuses) {
      const { provider: targetProvider, billingDomain: targetDomain } = connector.target;
      let provider = providers.find((candidate) => candidate.id === targetProvider.id);
      if (!provider) {
        provider = emptyProvider(targetProvider.id, targetProvider.displayName);
        providers.push(provider);
      }
      if (!provider.billingDomains.some((domain) => domain.id === targetDomain.id)) {
        provider.billingDomains.push(emptyBillingDomain(targetDomain.id, targetDomain.displayName));
      }
    }
    const priority: Record<string, number> = {
      codex: 0,
      'claude-code': 1,
      'opencode-go': 2,
      grok: 3
    };
    return providers.sort(
      (left, right) =>
        (priority[left.id] ?? 100) - (priority[right.id] ?? 100) ||
        left.displayName.localeCompare(right.displayName)
    );
  }

  function emptyProvider(id: string, displayName: string): ProviderOverview {
    const tokenTotals = emptyTokenTotals();
    return {
      id,
      displayName,
      freshness: { status: 'unavailable', lastSuccessAt: null },
      health: { status: 'healthy', errorCode: null, message: null, recovery: null },
      coverage: {
        quota: 'unavailable',
        tokens: 'unavailable',
        actualCost: 'unavailable',
        history: 'unavailable'
      },
      quotaBuckets: [],
      tokenTotals,
      tokenAuthority: null,
      billingDomains: [],
      forecasts: [],
      forecastCoverage: 'insufficient'
    };
  }

  function emptyBillingDomain(id: string, displayName: string): BillingDomainOverview {
    const tokenTotals = emptyTokenTotals();
    return {
      id,
      displayName,
      quotaBuckets: [],
      tokenTotals,
      tokenAuthority: null,
      costs: [],
      balances: [],
      invoices: [],
      history: fallbackHistory(tokenTotals, [], null),
      forecasts: []
    };
  }

  function emptyTokenTotals(): ProviderOverview['tokenTotals'] {
    return { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  }

  function tokenTelemetryCommand(providerId: string, billingDomainId: string): string | null {
    if (providerId === 'claude-code' && billingDomainId === 'subscription') {
      return 'eval "$(agent-usage telemetry-env --provider claude-code)"';
    }
    if (providerId === 'grok' && billingDomainId === 'grok-build-subscription') {
      return 'eval "$(agent-usage telemetry-env --provider grok)"';
    }
    return null;
  }

  function formatMoney(amount: number | null, currency: string): string {
    if (amount === null) return '—';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2
    }).format(amount);
  }
</script>

<svelte:head>
  <title>Agent Usage</title>
  <meta
    name="description"
    content="A private local dashboard for coding-agent quota, token, and cost usage."
  />
</svelte:head>

<div class="shell">
  <header>
    <div>
      <p class="eyebrow">{t('eyebrow')}</p>
      <h1>{t('title')}</h1>
      <p class="subtitle">{t('subtitle')}</p>
    </div>
    <div class="header-actions">
      <button class="locale-toggle" on:click={toggleLocale}>
        {locale === 'en' ? '中文' : 'EN'}
      </button>
      <button class="refresh" on:click={refresh} disabled={refreshing}>
        <span class:spin={refreshing} aria-hidden="true">↻</span>
        {refreshing ? t('refreshing') : t('refresh')}
      </button>
    </div>
  </header>

  {#if loading}
    <div class="state" aria-live="polite">{t('loading')}</div>
  {:else if error}
    <div class="state error" role="alert">{t('error')}</div>
  {:else if overview}
    {#if overview.providers.length === 0}
      <div class="state compact">{t('noProviders')}</div>
    {/if}
    <div class="history-toolbar" aria-label={t('history')}>
      {#each ['24h', '7d', '30d'] as window (window)}
        <button
          type="button"
          aria-pressed={selectedWindow === window}
          on:click={() => selectWindow(window as HistoryWindow)}>{window}</button
        >
      {/each}
    </div>
    {#if overview.riskSummary}
      <section class="risk-overview" aria-label={t('riskOverview')}>
        {#if overview.riskSummary.mostConstrained}
          <article>
            <span>{t('mostConstrained')}</span>
            <strong
              >{overview.riskSummary.mostConstrained.displayName} · {overview.riskSummary
                .mostConstrained.label}</strong
            >
            <p>
              {formatNumber(overview.riskSummary.mostConstrained.remainingPercent)}%
              {t('remaining')}
            </p>
            <small>
              {t('source')}:
              {authorityLabel(overview.riskSummary.mostConstrained.authority ?? 'unavailable')} ·
              {formatReset(overview.riskSummary.mostConstrained.observedAt ?? null)}
            </small>
            {#if overview.riskSummary.mostConstrained.forecast}
              <small>
                {overview.riskSummary.mostConstrained.forecast.willLastUntilReset
                  ? t('lastsUntilReset')
                  : t('exhaustsBeforeReset')}
                · {t('predictedExhaustion')}
                {formatReset(overview.riskSummary.mostConstrained.forecast.predictedExhaustionAt)}
                · {authorityLabel('estimate')} ·
                {formatReset(overview.riskSummary.mostConstrained.forecast.evidence.windowEnd)}
              </small>
            {/if}
          </article>
        {/if}
        {#if overview.riskSummary.recommendation}
          <article class="recommendation">
            <span>{t('recommendation')}</span>
            <strong>{overview.riskSummary.recommendation.displayName}</strong>
            <p>
              {formatNumber(overview.riskSummary.recommendation.evidence.remainingPercent)}%
              {t('remaining')}
            </p>
            <small>
              {t('source')}:
              {authorityLabel(
                overview.riskSummary.recommendation.evidence.authority ?? 'unavailable'
              )} ·
              {formatReset(overview.riskSummary.recommendation.evidence.observedAt ?? null)}
            </small>
            {#each overview.riskSummary.recommendation.reasonKeys as reason (reason)}
              <small
                >{reason === 'forecast-lasts-until-reset'
                  ? t('forecastSupports')
                  : t('highestSafeCapacity')}</small
              >
            {/each}
            <small>{t('readOnlyAdvice')}</small>
          </article>
        {/if}
      </section>
    {/if}
    <section class="providers" aria-label="Providers">
      {#each displayProviders(overview, connectors) as provider (provider.id)}
        {@const logoPath = providerLogoPath(provider.id)}
        <article class="provider-card">
          <div class="provider-heading">
            <div>
              {#if logoPath}
                <img class="provider-logo" data-provider-logo={provider.id} src={logoPath} alt="" />
              {/if}
              <div>
                <h2 data-provider-logo={logoPath ? undefined : provider.id}>
                  {provider.displayName}
                </h2>
                <p class="freshness" data-status={provider.freshness.status}>
                  <span></span>
                  {provider.freshness.status === 'fresh'
                    ? t('updatedNow')
                    : provider.freshness.status === 'stale'
                      ? t('stale')
                      : t('unavailable')}
                  {provider.freshness.lastSuccessAt
                    ? ` · ${formatReset(provider.freshness.lastSuccessAt)}`
                    : ''}
                </p>
              </div>
            </div>
            <div class="coverage">{coverageLevelLabel(provider.coverage.quota)}</div>
          </div>

          {#if provider.health.status === 'degraded'}
            <div class="degraded" role="status">
              <strong>{providerHealthMessage(provider)}</strong>
              <code>{providerHealthRecovery(provider)}</code>
            </div>
          {/if}

          {#if (provider.billingDomains?.length ?? 0) > 1}
            <div class="domain-tabs" role="tablist" aria-label={`${provider.displayName} billing`}>
              {#each provider.billingDomains as domain (domain.id)}
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeBillingDomain(provider, selectedBillingDomains[provider.id])
                    .id === domain.id}
                  on:click={() => selectBillingDomain(provider.id, domain.id)}
                  >{domain.displayName}</button
                >
              {/each}
            </div>
          {/if}

          {#each [activeBillingDomain(provider, selectedBillingDomains[provider.id])] as domain (domain.id)}
            {@const history = activeHistory(domain)}
            {@const tokenAuthority = historyTokenAuthority(history, domain.tokenAuthority)}
            {@const connector = connectorForDomain(connectors, provider.id, domain.id)}
            {#if connector}
              <details
                class:connection-pending={pendingConnectorId === connector.id}
                class="inline-connection"
                data-testid={`connector-${connector.id}`}
                aria-busy={pendingConnectorId === connector.id}
                open={connector.state !== 'connected'}
              >
                <summary>
                  <span>
                    <strong>{connectorStateLabel(connector.state)}</strong>
                    {#if connector.experimental}<small>{t('experimental')}</small>{/if}
                  </span>
                  {connector.state === 'connected' ? t('manageConnection') : t('connectionSetup')}
                </summary>
                <div class="inline-connection-body">
                  <p class="permission">{connectorPermission(connector)}</p>
                  <div class="connection-meta">
                    <span>{connector.installed ? t('installed') : t('notInstalled')}</span>
                    <span>{credentialOwnerLabel(connector.credentialOwner)}</span>
                  </div>
                  <div class="coverage-list">
                    <span>{t('coverageLabel')}</span>
                    <strong
                      >{connector.expectedCoverage.map(coverageDimensionLabel).join(' · ')}</strong
                    >
                  </div>
                  {#if connector.credentialOwner === 'agent-usage'}
                    <label class="secret-field">
                      <span>{t('managementKey')}</span>
                      <input
                        type="password"
                        autocomplete="off"
                        aria-label={`${connector.displayName} ${t('managementKey')}`}
                        value={secretInputs[connector.id] ?? ''}
                        on:input={(event) =>
                          (secretInputs = {
                            ...secretInputs,
                            [connector.id]: event.currentTarget.value
                          })}
                      />
                    </label>
                  {/if}
                  <div class="connection-actions">
                    {#if connector.state === 'discovered' || connector.state === 'skipped'}
                      <button
                        class="primary-action"
                        disabled={!connector.installed ||
                          pendingConnectorId === connector.id ||
                          (connector.credentialOwner === 'agent-usage' &&
                            !secretInputs[connector.id])}
                        on:click={() => configureConnector(connector.id, 'connect')}
                        >{t('connect')}</button
                      >
                    {/if}
                    {#if connector.state === 'error' || connector.state === 'not-installed' || connector.state === 'connected'}
                      <button
                        disabled={pendingConnectorId === connector.id}
                        on:click={() => configureConnector(connector.id, 'retry')}
                        >{t('retry')}</button
                      >
                    {/if}
                    {#if connector.state !== 'skipped'}
                      <button
                        disabled={pendingConnectorId === connector.id}
                        on:click={() => configureConnector(connector.id, 'skip')}
                        >{t('skip')}</button
                      >
                    {/if}
                  </div>
                </div>
              </details>
            {/if}
            <div class="section-label">{t('quota')}</div>
            <div class="quotas">
              {#each domain.quotaBuckets as bucket (bucket.id)}
                <div class="quota-row">
                  <div class="quota-copy">
                    <strong>{bucket.label}</strong>
                    <span>{bucket.usedPercent ?? '—'}% {t('used')}</span>
                  </div>
                  <div
                    class="progress"
                    role="progressbar"
                    aria-label={bucket.label}
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={bucket.usedPercent ?? 0}
                  >
                    <span style={`width: ${Math.min(100, Math.max(0, bucket.usedPercent ?? 0))}%`}
                    ></span>
                  </div>
                  <div class="quota-meta">
                    <span>
                      {t('resets')}
                      {formatReset(bucket.resetsAt)} · {formatRelativeReset(bucket.resetsAt)}
                    </span>
                    <span>{t('source')}: {authorityLabel(bucket.authority)}</span>
                    <span>{formatReset(bucket.observedAt ?? provider.freshness.lastSuccessAt)}</span
                    >
                    {#if bucket.scope}
                      <span
                        >{t('scope')}: {bucket.scope === 'account-wide'
                          ? t('accountWide')
                          : t('localOnly')}</span
                      >
                    {/if}
                    {#if bucket.status}
                      <span>{t('plan')}: {bucket.status}</span>
                    {/if}
                    {#if bucket.limitAmount !== null && bucket.limitAmount !== undefined}
                      <span>{t('limit')}: ${bucket.limitAmount} {bucket.limitCurrency ?? ''}</span>
                    {/if}
                    {#if bucket.fallbackStatus}
                      <span
                        >{t('fallback')}: {bucket.fallbackStatus === 'unknown'
                          ? t('unknown')
                          : bucket.fallbackStatus === 'enabled'
                            ? t('enabled')
                            : t('disabled')}</span
                      >
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
            {#if (domain.forecasts?.length ?? 0) > 0}
              <div class="forecast-list">
                {#each domain.forecasts as forecast (forecast.bucketId)}
                  <p>
                    <strong>{forecast.label}</strong>
                    <span
                      >{forecast.willLastUntilReset
                        ? t('lastsUntilReset')
                        : t('exhaustsBeforeReset')}</span
                    >
                    <small>
                      {confidenceLabel(forecast.confidence)} · {forecast.evidence.samples}
                      {t('samples')} ·
                      {t('predictedExhaustion')}
                      {formatReset(forecast.predictedExhaustionAt)}
                      · {authorityLabel('estimate')} · {formatReset(forecast.evidence.windowEnd)}
                    </small>
                  </p>
                {/each}
              </div>
            {/if}

            <div class="section-label">{t('tokens')}</div>
            {#if tokenAuthority}
              <p class="token-scope">
                {t('source')}: {authorityLabel(tokenAuthority)}
                {tokenAuthority === 'local-observation' ? ` · ${t('localOnly')}` : ''}
                · {formatReset(history.lastObservedAt ?? null)}
              </p>
              <dl class="tokens">
                <div>
                  <dt>{t('total')}</dt>
                  <dd>{formatNumber(history.tokenTotals.total)}</dd>
                </div>
                <div>
                  <dt>{t('input')}</dt>
                  <dd>{formatNumber(history.tokenTotals.input)}</dd>
                </div>
                <div>
                  <dt>{t('output')}</dt>
                  <dd>{formatNumber(history.tokenTotals.output)}</dd>
                </div>
                <div>
                  <dt>{t('reasoning')}</dt>
                  <dd>{formatNumber(history.tokenTotals.reasoning ?? 0)}</dd>
                </div>
                <div>
                  <dt>{t('cacheRead')}</dt>
                  <dd>{formatNumber(history.tokenTotals.cacheRead)}</dd>
                </div>
                <div>
                  <dt>{t('cacheWrite')}</dt>
                  <dd>{formatNumber(history.tokenTotals.cacheWrite)}</dd>
                </div>
              </dl>
            {:else}
              {@const telemetryCommand = tokenTelemetryCommand(provider.id, domain.id)}
              <div class="token-unavailable">
                <strong>{t('tokenObservationsMissing')}</strong>
                {#if telemetryCommand}
                  <span>{t('tokenCollectionEnable')}</span>
                  <code>{telemetryCommand}</code>
                {/if}
              </div>
            {/if}

            {#if history.costs.length > 0 || domain.balances.length > 0 || domain.invoices.length > 0}
              <div class="section-label">{t('billing')}</div>
              <dl class="billing-records">
                {#each history.costs as cost (`${cost.kind}:${cost.currency}`)}
                  <div>
                    <dt>{costKindLabel(cost.kind)} · {t('nativeAmount')}</dt>
                    <dd>{formatMoney(cost.amount, cost.currency)}</dd>
                    <small>
                      {#if cost.convertedAmount !== null}
                        {t('comparison')}: {formatMoney(
                          cost.convertedAmount,
                          cost.comparisonCurrency
                        )}
                      {:else if cost.conversionUnavailableReason === 'unknown-native-amount'}
                        {t('unknownAmount')}
                      {:else}
                        {t('rateUnavailable')}
                      {/if}
                    </small>
                    <small>
                      {t('source')}:
                      {cost.authorities && cost.authorities.length > 0
                        ? cost.authorities.map(authorityLabel).join(' + ')
                        : authorityLabel('unavailable')} ·
                      {formatReset(cost.observedAt ?? null)}
                    </small>
                    {#each cost.priceSnapshots as price (price.id)}
                      <small>{t('priceVersion')}: {price.version} · {price.source}</small>
                    {/each}
                  </div>
                {/each}
                {#each domain.balances as balance (balance.id)}
                  <div>
                    <dt>
                      {balance.kind === 'prepaid'
                        ? t('prepaid')
                        : balance.kind === 'spending-limit'
                          ? t('spendingLimit')
                          : t('currentInvoice')}
                    </dt>
                    <dd>{formatMoney(balance.amount, balance.currency)}</dd>
                    <small>
                      {t('source')}: {authorityLabel(balance.authority)} · {formatReset(
                        balance.observedAt
                      )}
                    </small>
                  </div>
                {/each}
                {#each domain.invoices as invoice (invoice.id)}
                  <div>
                    <dt>{invoice.number ?? t('invoices')}</dt>
                    <dd>{formatMoney(invoice.amount, invoice.currency)}</dd>
                    <small>
                      {t('source')}: {authorityLabel(invoice.authority)} · {formatReset(
                        invoice.createdAt
                      )}
                    </small>
                  </div>
                {/each}
              </dl>
              {#if history.exchangeRates.length > 0}
                <div class="rate-evidence">
                  {#each history.exchangeRates as rate (rate.id)}
                    <small>
                      {t('exchangeRate')}: 1 {rate.baseCurrency} = {rate.rate}
                      {rate.quoteCurrency} · {rate.source} · {formatReset(rate.observedAt)}
                    </small>
                  {/each}
                </div>
              {/if}
            {/if}

            {#if history.models.length > 0 || history.days.length > 0}
              <div class="history-rankings">
                <div>
                  <strong>{t('topModels')}</strong>
                  {#each history.models.slice(0, 3) as model (model.model)}
                    <span>{model.model}<b>{formatNumber(model.tokenTotals.total)}</b></span>
                  {/each}
                </div>
                <div>
                  <strong>{t('topDays')}</strong>
                  {#each history.days.slice(-3).reverse() as day (day.day)}
                    <span>{day.day}<b>{formatNumber(day.tokenTotals.total)}</b></span>
                  {/each}
                </div>
              </div>
            {/if}
          {/each}
        </article>
      {/each}
    </section>
  {/if}

  {#if monitoring}
    <section class="monitoring-section" aria-labelledby="monitoring-heading">
      <div>
        <p class="eyebrow">{t('automationEyebrow')}</p>
        <h2 id="monitoring-heading">{t('monitoring')}</h2>
        <p>{t('monitoringSubtitle')}</p>
      </div>
      <div class="monitoring-controls">
        <label>
          <input
            type="checkbox"
            checked={monitoring.backgroundCollectionEnabled}
            on:change={(event) =>
              updateMonitoring({ backgroundCollectionEnabled: event.currentTarget.checked })}
          />
          {t('backgroundCollection')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={monitoring.notificationsEnabled}
            on:change={(event) =>
              updateMonitoring({ notificationsEnabled: event.currentTarget.checked })}
          />
          {t('notifications')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={monitoring.startAtLogin}
            on:change={(event) => updateMonitoring({ startAtLogin: event.currentTarget.checked })}
          />
          {t('startAtLogin')}
        </label>
      </div>
    </section>
  {/if}

  {#if diagnostics && diagnostics.connectors.length > 0}
    <section class="diagnostics-section" aria-labelledby="diagnostics-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">{t('healthEyebrow')}</p>
          <h2 id="diagnostics-heading">{t('diagnostics')}</h2>
        </div>
        <p>{t('diagnosticsSubtitle')}</p>
      </div>
      <div class="diagnostics-grid">
        {#each diagnostics.connectors as diagnostic (diagnostic.id)}
          <article
            class:diagnostic-degraded={diagnostic.status === 'degraded'}
            data-testid={`diagnostic-${diagnostic.id}`}
          >
            <div>
              <strong>{diagnostic.id}</strong>
              <span>{diagnosticCategoryLabel(diagnostic)}</span>
            </div>
            <small>{diagnostic.billingDomainId ?? t('unknown')}</small>
            {#if diagnostic.affectedCoverage.length > 0}
              <p>{diagnostic.affectedCoverage.map(coverageDimensionLabel).join(' · ')}</p>
            {/if}
            {#if diagnosticRecovery(diagnostic)}
              <code>{diagnosticRecovery(diagnostic)}</code>
            {/if}
          </article>
        {/each}
      </div>
    </section>
  {/if}

  {#if retention}
    <section class="privacy-section" aria-labelledby="privacy-heading">
      <div>
        <p class="eyebrow">{t('privacyEyebrow')}</p>
        <h2 id="privacy-heading">{t('privacy')}</h2>
        <p>{t('privacySubtitle')}</p>
        <small>
          {retention.rawRetentionDays}
          {t('retentionDays')} · {retention.rawObservations}
          {t('rawObservations')} · {retention.dailyAggregates}
          {t('dailyAggregates')}
        </small>
      </div>
      <div class="privacy-actions">
        <button on:click={() => downloadExport('json')}>{t('exportJson')}</button>
        <button on:click={() => downloadExport('csv')}>{t('exportCsv')}</button>
        <label>
          <input type="checkbox" bind:checked={includeAccountIdentifiers} />
          {t('includeAccountIdentifiers')}
        </label>
        <label>
          <input type="checkbox" bind:checked={deleteProductSecrets} />
          {t('deleteProductSecrets')}
        </label>
        <button class="danger-action" disabled={clearingData} on:click={clearLocalData}>
          {clearingData ? t('clearing') : t('clearData')}
        </button>
      </div>
    </section>
  {/if}
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html) {
    color-scheme: dark;
    background: #080a0f;
    font-family:
      Inter,
      ui-sans-serif,
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    background:
      radial-gradient(circle at 15% 0%, rgba(89, 120, 255, 0.13), transparent 32rem),
      radial-gradient(circle at 95% 12%, rgba(73, 218, 165, 0.08), transparent 30rem), #080a0f;
    color: #f4f6fa;
  }

  .shell {
    width: min(1180px, calc(100% - 40px));
    margin: 0 auto;
    padding: 72px 0 96px;
  }

  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 32px;
    margin-bottom: 42px;
  }

  .eyebrow,
  .section-label {
    margin: 0 0 12px;
    color: #8c96aa;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: clamp(2.6rem, 7vw, 5.8rem);
    font-weight: 620;
    letter-spacing: -0.065em;
    line-height: 0.92;
  }

  .subtitle {
    max-width: 540px;
    margin: 20px 0 0;
    color: #a9b0bf;
    font-size: 1.02rem;
    line-height: 1.6;
  }

  button {
    font: inherit;
  }

  .refresh {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 18px;
    border: 1px solid #2c3342;
    border-radius: 999px;
    background: rgba(20, 24, 32, 0.8);
    color: #e8ebf2;
    cursor: pointer;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .locale-toggle {
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid #2c3342;
    border-radius: 999px;
    background: rgba(20, 24, 32, 0.8);
    color: #aeb6c4;
    cursor: pointer;
  }

  .refresh:hover:not(:disabled) {
    border-color: #5b6d91;
    background: #171c26;
  }

  .refresh:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  .spin {
    display: inline-block;
    animation: spin 0.75s linear infinite;
  }

  .providers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 480px), 1fr));
    gap: 18px;
    margin-bottom: 48px;
  }

  .history-toolbar {
    display: flex;
    width: fit-content;
    gap: 5px;
    margin: 0 0 16px auto;
    padding: 4px;
    border: 1px solid rgba(122, 136, 164, 0.16);
    border-radius: 12px;
    background: rgba(14, 17, 24, 0.78);
  }

  .history-toolbar button {
    min-width: 52px;
    min-height: 32px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #929baa;
    cursor: pointer;
    font-size: 0.72rem;
  }

  .history-toolbar button[aria-pressed='true'] {
    background: #29324b;
    color: #eef2ff;
  }

  .risk-overview {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }

  .risk-overview article {
    display: grid;
    gap: 6px;
    padding: 18px;
    border: 1px solid rgba(242, 164, 89, 0.2);
    border-radius: 17px;
    background: rgba(33, 25, 20, 0.72);
  }

  .risk-overview article.recommendation {
    border-color: rgba(73, 208, 151, 0.2);
    background: rgba(18, 35, 29, 0.72);
  }

  .risk-overview span,
  .risk-overview small {
    color: #929baa;
    font-size: 0.7rem;
  }

  .risk-overview p {
    margin: 2px 0;
    font-size: 1.25rem;
    font-weight: 680;
  }

  .diagnostics-section {
    margin: 0 0 42px;
  }

  .privacy-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin: 0 0 42px;
    padding: 18px;
    border: 1px solid rgba(122, 136, 164, 0.17);
    border-radius: 17px;
    background: rgba(14, 17, 24, 0.78);
  }

  .privacy-section h2,
  .privacy-section p {
    margin: 0;
  }

  .privacy-section > div > p:not(.eyebrow),
  .privacy-section small {
    display: block;
    margin-top: 7px;
    color: #8f98a8;
    font-size: 0.72rem;
  }

  .privacy-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .privacy-actions button,
  .privacy-actions label {
    min-height: 34px;
    padding: 8px 10px;
    border: 1px solid #303747;
    border-radius: 10px;
    background: transparent;
    color: #b6bdca;
    font-size: 0.7rem;
  }

  .privacy-actions label {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .privacy-actions button {
    cursor: pointer;
  }

  .privacy-actions button.danger-action {
    border-color: rgba(235, 106, 106, 0.4);
    color: #ffabab;
  }

  .diagnostics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
    margin-top: 16px;
  }

  .diagnostics-grid article {
    display: grid;
    gap: 7px;
    padding: 14px;
    border: 1px solid rgba(73, 208, 151, 0.18);
    border-radius: 13px;
    background: rgba(15, 27, 23, 0.7);
  }

  .diagnostics-grid article.diagnostic-degraded {
    border-color: rgba(242, 164, 89, 0.3);
    background: rgba(38, 27, 19, 0.72);
  }

  .diagnostics-grid article > div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .diagnostics-grid span,
  .diagnostics-grid small,
  .diagnostics-grid p,
  .diagnostics-grid code {
    color: #929baa;
    font-size: 0.68rem;
  }

  .diagnostics-grid p {
    margin: 0;
  }

  .diagnostics-grid code {
    color: #d7b99c;
    white-space: normal;
  }

  .monitoring-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin: 0 0 42px;
    padding: 18px;
    border: 1px solid rgba(122, 136, 164, 0.17);
    border-radius: 17px;
    background: rgba(14, 17, 24, 0.78);
  }

  .monitoring-section h2,
  .monitoring-section p {
    margin: 0;
  }

  .monitoring-section > div > p:last-child {
    margin-top: 7px;
    color: #8f98a8;
    font-size: 0.74rem;
  }

  .monitoring-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .monitoring-controls label {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    border: 1px solid #303747;
    border-radius: 10px;
    color: #b6bdca;
    font-size: 0.7rem;
  }

  .section-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 32px;
    margin-bottom: 18px;
  }

  .section-heading h2 {
    margin: 0;
    font-size: 1.65rem;
  }

  .section-heading > p {
    max-width: 520px;
    margin: 0;
    color: #8f98a8;
    font-size: 0.86rem;
    line-height: 1.55;
    text-align: right;
  }

  .connection-meta,
  .connection-actions {
    display: flex;
    align-items: center;
  }

  .connection-meta,
  .coverage-list {
    color: #929baa;
    font-size: 0.67rem;
  }

  .inline-connection {
    margin: 18px 0 4px;
    border: 1px solid rgba(122, 136, 164, 0.16);
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.018);
  }

  .inline-connection summary {
    display: flex;
    min-height: 42px;
    padding: 10px 12px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: #929baa;
    cursor: pointer;
    font-size: 0.7rem;
    list-style: none;
  }

  .inline-connection summary::-webkit-details-marker {
    display: none;
  }

  .inline-connection summary > span {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .inline-connection summary strong {
    color: #d9dee8;
  }

  .inline-connection summary small {
    color: #d5a8ff;
  }

  .inline-connection-body {
    padding: 0 12px 12px;
  }

  .inline-connection.connection-pending {
    opacity: 0.62;
  }

  .permission {
    margin: 6px 0 14px;
    color: #aab1bf;
    font-size: 0.76rem;
    line-height: 1.55;
  }

  .connection-meta {
    justify-content: space-between;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid rgba(122, 136, 164, 0.1);
  }

  .coverage-list {
    display: flex;
    margin-top: 10px;
    flex-direction: column;
    gap: 5px;
  }

  .coverage-list strong {
    overflow: hidden;
    color: #c7ceda;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .secret-field {
    display: grid;
    gap: 6px;
    margin-top: 12px;
    color: #929baa;
    font-size: 0.67rem;
  }

  .secret-field input {
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    border: 1px solid #303747;
    border-radius: 9px;
    outline: none;
    background: #0b0e14;
    color: #e8ebf2;
  }

  .secret-field input:focus {
    border-color: #627eef;
  }

  .connection-actions {
    gap: 7px;
    margin-top: auto;
    padding-top: 16px;
  }

  .connection-actions button {
    min-height: 30px;
    padding: 0 11px;
    border: 1px solid #303747;
    border-radius: 9px;
    background: transparent;
    color: #aeb6c4;
    cursor: pointer;
    font-size: 0.7rem;
  }

  .connection-actions button.primary-action {
    border-color: #627eef;
    background: #5870d4;
    color: white;
  }

  .connection-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .provider-card,
  .state {
    border: 1px solid rgba(122, 136, 164, 0.2);
    border-radius: 24px;
    background: linear-gradient(145deg, rgba(19, 23, 31, 0.96), rgba(12, 15, 21, 0.96));
    box-shadow: 0 22px 70px rgba(0, 0, 0, 0.25);
  }

  .provider-card {
    padding: 26px;
  }

  .state.compact {
    margin-bottom: 16px;
    padding: 14px 18px;
    border-radius: 14px;
    box-shadow: none;
  }

  .degraded {
    display: grid;
    gap: 7px;
    margin: 18px 0;
    padding: 12px 14px;
    border: 1px solid rgba(242, 164, 89, 0.28);
    border-radius: 12px;
    background: rgba(190, 104, 40, 0.09);
    color: #f2bd89;
    font-size: 0.75rem;
  }

  .degraded code {
    color: #d7b99c;
    white-space: normal;
  }

  .token-scope {
    margin: -4px 0 12px;
    color: #8f98a8;
    font-size: 0.72rem;
  }

  .token-unavailable {
    display: grid;
    gap: 7px;
    margin: -4px 0 0;
    padding: 12px 14px;
    border: 1px solid rgba(122, 136, 164, 0.14);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.018);
    color: #8f98a8;
    font-size: 0.75rem;
  }

  .token-unavailable strong {
    color: #d5d9e2;
  }

  .token-unavailable code {
    color: #aebfff;
    overflow-wrap: anywhere;
  }

  .domain-tabs {
    display: flex;
    gap: 7px;
    margin-top: 22px;
    padding: 4px;
    border-radius: 12px;
    background: rgba(6, 8, 12, 0.56);
  }

  .domain-tabs button {
    flex: 1;
    min-height: 34px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: #929baa;
    cursor: pointer;
    font-size: 0.74rem;
  }

  .domain-tabs button[aria-selected='true'] {
    background: #242c42;
    color: #edf1ff;
  }

  .provider-heading,
  .provider-heading > div:first-child {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }

  .provider-heading > div:first-child {
    justify-content: flex-start;
  }

  .provider-logo {
    width: 46px;
    height: 46px;
    padding: 6px;
    border-radius: 11px;
    background: #f1ecec;
    object-fit: contain;
  }

  h2 {
    margin: 0 0 5px;
    font-size: 1.17rem;
    letter-spacing: -0.025em;
  }

  .freshness {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    color: #929baa;
    font-size: 0.78rem;
  }

  .freshness span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4bd29a;
    box-shadow: 0 0 10px rgba(75, 210, 154, 0.45);
  }

  .freshness[data-status='stale'] span {
    background: #e3ac55;
  }

  .freshness[data-status='unavailable'] span {
    background: #6e7480;
  }

  .coverage {
    padding: 6px 10px;
    border: 1px solid rgba(77, 207, 153, 0.22);
    border-radius: 999px;
    color: #7ee2b7;
    font-size: 0.7rem;
    text-transform: uppercase;
  }

  .section-label {
    margin-top: 30px;
    padding-top: 22px;
    border-top: 1px solid rgba(122, 136, 164, 0.13);
  }

  .quota-row + .quota-row {
    margin-top: 20px;
  }

  .forecast-list {
    display: grid;
    gap: 7px;
    margin-top: 14px;
  }

  .forecast-list p {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid rgba(122, 136, 164, 0.13);
    border-radius: 11px;
    color: #aeb6c4;
    font-size: 0.7rem;
  }

  .forecast-list span {
    text-align: right;
  }

  .forecast-list small {
    grid-column: 1 / -1;
    color: #7f899a;
  }

  .quota-copy,
  .quota-meta {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }

  .quota-copy strong {
    font-size: 0.92rem;
  }

  .quota-copy span,
  .quota-meta {
    color: #929baa;
    font-size: 0.76rem;
  }

  .progress {
    height: 7px;
    margin: 10px 0 9px;
    overflow: hidden;
    border-radius: 999px;
    background: #242a36;
  }

  .progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #6282ff, #7b9bff);
  }

  .tokens {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 0;
  }

  .billing-records {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
  }

  .billing-records div {
    padding: 12px;
    border: 1px solid rgba(122, 136, 164, 0.12);
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.018);
  }

  .billing-records small {
    display: block;
    margin-top: 6px;
    color: #7f899a;
    font-size: 0.64rem;
    line-height: 1.35;
  }

  .rate-evidence {
    display: grid;
    gap: 4px;
    margin-top: 8px;
    color: #7f899a;
    font-size: 0.67rem;
  }

  .history-rankings {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-top: 16px;
  }

  .history-rankings > div {
    display: grid;
    gap: 7px;
    padding: 12px;
    border: 1px solid rgba(122, 136, 164, 0.12);
    border-radius: 13px;
  }

  .history-rankings strong {
    color: #aeb6c4;
    font-size: 0.69rem;
  }

  .history-rankings span {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: #858e9e;
    font-size: 0.68rem;
  }

  .history-rankings b {
    color: #d9deea;
    font-variant-numeric: tabular-nums;
  }

  .tokens div {
    min-width: 0;
    padding: 12px;
    border: 1px solid rgba(122, 136, 164, 0.12);
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.018);
  }

  dt {
    overflow: hidden;
    color: #858e9e;
    font-size: 0.68rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  dd {
    margin: 7px 0 0;
    font-size: clamp(0.92rem, 2vw, 1.18rem);
    font-variant-numeric: tabular-nums;
    font-weight: 650;
  }

  .state {
    padding: 48px;
    color: #a9b0bf;
    text-align: center;
  }

  .state.error {
    color: #ff9b9b;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 680px) {
    .shell {
      width: min(100% - 24px, 1180px);
      padding: 44px 0 64px;
    }

    header {
      align-items: flex-start;
      flex-direction: column;
    }

    .tokens {
      grid-template-columns: repeat(2, 1fr);
    }

    .risk-overview {
      grid-template-columns: 1fr;
    }

    .quota-meta {
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
    }

    .section-heading {
      align-items: flex-start;
      flex-direction: column;
      gap: 10px;
    }

    .monitoring-section {
      align-items: flex-start;
      flex-direction: column;
    }

    .section-heading > p {
      text-align: left;
    }
  }

  @media (max-width: 980px) {
  }

  @media (max-width: 560px) {
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
