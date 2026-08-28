<script lang="ts">
  import { onMount, tick } from 'svelte';

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
  let overviewError = false;
  let refreshError = false;
  let connectorsError = false;
  let monitoringError = false;
  let diagnosticsError = false;
  let retentionError = false;
  let privacyActionError = false;
  let connectors: ConnectorStatus[] = [];
  let pendingConnectorId: string | null = null;
  let secretInputs: Record<string, string> = {};
  let selectedBillingDomains: Record<string, string> = {};
  let selectedWindow: HistoryWindow = '7d';
  let selectedCurrency: 'CNY' | 'USD' = 'CNY';
  let selectedTrendMetric: 'tokens' | 'retail-equivalent' = 'tokens';
  let modelRankingSort: 'tokens' | 'retail-equivalent' = 'tokens';
  let selectedModelId: string | null = null;
  let modelDetailTrigger: HTMLButtonElement | null = null;
  let modelDetailPanel: HTMLElement | null = null;
  let timeZone = 'UTC';
  let monitoring: MonitoringSettings | null = null;
  let diagnostics: DoctorReport | null = null;
  let retention: RetentionStatus | null = null;
  let deleteProductSecrets = false;
  let includeAccountIdentifiers = false;
  let clearingData = false;
  let settingsOpen = false;
  let settingsTarget: string | null = null;
  let settingsButton: HTMLButtonElement | null = null;
  let settingsReturnFocus: HTMLElement | null = null;
  let settingsPanel: HTMLElement | null = null;
  let selectedModelEntry: UsageOverview['workbench']['modelRanking']['entries'][number] | null;

  $: selectedModelEntry =
    overview?.workbench?.modelRanking.entries.find((entry) => entry.id === selectedModelId) ?? null;

  onMount(async () => {
    locale = detectLocale(navigator.language);
    document.documentElement.lang = locale;
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    selectedWindow = storedWindow();
    selectedCurrency = storedCurrency();
    await Promise.all([
      refresh(),
      loadConnectors(),
      loadMonitoring(),
      loadDiagnostics(),
      loadRetention()
    ]);
    if (!overview) await loadOverview();
    const deepLink = new URL(window.location.href).searchParams.get('settings');
    if (deepLink) await openSettings(deepLink, false);
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
      const parameters = new URLSearchParams({
        window: selectedWindow,
        timeZone,
        currency: selectedCurrency
      });
      const response = await fetch(`/api/overview?${parameters}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      overview = (await response.json()) as UsageOverview;
      overviewError = false;
    } catch {
      overviewError = true;
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
      refreshError = false;
    } catch {
      refreshError = true;
    } finally {
      refreshing = false;
    }
  }

  async function loadConnectors(): Promise<void> {
    try {
      const response = await fetch('/api/connectors');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      connectors = (await response.json()) as ConnectorStatus[];
      connectorsError = false;
    } catch {
      connectorsError = true;
    }
  }

  async function loadMonitoring(): Promise<void> {
    try {
      const response = await fetch('/api/monitoring');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { settings: MonitoringSettings };
      monitoring = body.settings;
      monitoringError = false;
    } catch {
      monitoringError = true;
    }
  }

  async function loadDiagnostics(): Promise<void> {
    try {
      const response = await fetch('/api/doctor');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      diagnostics = (await response.json()) as DoctorReport;
      diagnosticsError = false;
    } catch {
      diagnosticsError = true;
    }
  }

  async function loadRetention(): Promise<void> {
    try {
      const response = await fetch('/api/retention');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      retention = (await response.json()) as RetentionStatus;
      retentionError = false;
    } catch {
      retentionError = true;
    }
  }

  function exportHref(format: 'json' | 'csv'): string {
    const parameters = new URLSearchParams({
      format,
      window: selectedWindow,
      timeZone,
      currency: selectedCurrency,
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
      privacyActionError = false;
    } catch {
      privacyActionError = true;
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
      privacyActionError = false;
    } catch {
      privacyActionError = true;
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
      monitoringError = false;
    } catch {
      monitoringError = true;
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
      connectorsError = true;
    } finally {
      pendingConnectorId = null;
    }
  }

  async function openSettings(target: string | null = null, syncUrl = true): Promise<void> {
    if (!settingsOpen) {
      const active = document.activeElement;
      settingsReturnFocus =
        active instanceof HTMLElement && active !== document.body ? active : null;
    }
    settingsOpen = true;
    settingsTarget = target;
    if (syncUrl) {
      const url = new URL(window.location.href);
      if (target) url.searchParams.set('settings', target);
      else url.searchParams.set('settings', 'root');
      window.history.replaceState(null, '', url);
    }
    await tick();
    const targetElement = target
      ? [...document.querySelectorAll<HTMLElement>('[data-settings-target]')].find(
          (element) => element.dataset.settingsTarget === target
        )
      : null;
    (targetElement ?? settingsPanel)?.focus();
  }

  async function closeSettings(): Promise<void> {
    const returnFocus = settingsReturnFocus;
    settingsOpen = false;
    settingsTarget = null;
    settingsReturnFocus = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('settings');
    window.history.replaceState(null, '', url);
    await tick();
    (returnFocus?.isConnected ? returnFocus : settingsButton)?.focus();
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    const activeDialog = selectedModelId ? modelDetailPanel : settingsOpen ? settingsPanel : null;
    if (event.key === 'Tab' && activeDialog) trapDialogFocus(event, activeDialog);
    else if (selectedModelId && event.key === 'Escape') void closeModelDetail();
    else if (settingsOpen && event.key === 'Escape') void closeSettings();
  }

  function trapDialogFocus(event: KeyboardEvent, panel: HTMLElement): void {
    const focusable = [
      ...panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      )
    ].filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    const active = document.activeElement;
    if (event.shiftKey && (active === panel || active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleTablistKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [
      ...(event.currentTarget as HTMLElement).parentElement!.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]'
      )
    ];
    const current = tabs.indexOf(event.currentTarget as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
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

  function formatCompactNumber(value: number): string {
    if (Math.abs(value) < 10_000) return formatNumber(value);
    return new Intl.NumberFormat(locale, {
      compactDisplay: 'short',
      maximumFractionDigits: 1,
      notation: 'compact'
    }).format(value);
  }

  function tokenValueLabel(value: number): string {
    return `${formatNumber(value)} ${t('tokens')}`;
  }

  function formatPercent(value: number | null): string {
    if (value === null) return t('notAvailable');
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
      value
    );
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

  function timePrecisionLabel(
    precision: ProviderOverview['tokenEvidence']['timePrecisions'][number]
  ): string {
    const keys: Record<ProviderOverview['tokenEvidence']['timePrecisions'][number], MessageKey> = {
      event: 'precisionEvent',
      hour: 'precisionHour',
      day: 'precisionDay',
      'billing-period': 'precisionBillingPeriod',
      unknown: 'precisionUnknown'
    };
    return t(keys[precision]);
  }

  function usageScopeLabel(
    scope: ProviderOverview['tokenEvidence']['usageScopes'][number]
  ): string {
    return scope === 'account-wide'
      ? t('accountWide')
      : scope === 'this-mac'
        ? t('localOnly')
        : t('unknown');
  }

  function aggregationTemporalityLabel(
    temporality: ProviderOverview['tokenEvidence']['aggregationTemporalities'][number]
  ): string {
    return temporality === 'delta'
      ? t('temporalityDelta')
      : temporality === 'cumulative'
        ? t('temporalityCumulative')
        : t('temporalityUnknown');
  }

  function tokenSemanticsSummary(
    semantics: BillingHistory['models'][number]['observations'][number]['tokenSemantics']
  ): string {
    const reasoning =
      semantics.reasoning === 'included-in-output' ? t('includedInOutput') : t('separateCategory');
    const cacheRead =
      semantics.cacheRead === 'included-in-input' ? t('includedInInput') : t('separateCategory');
    const cacheWrite =
      semantics.cacheWrite === 'included-in-input' ? t('includedInInput') : t('separateCategory');
    return `${t('reasoning')}: ${reasoning} · ${t('cacheRead')}: ${cacheRead} · ${t('cacheWrite')}: ${cacheWrite}`;
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
      'reported-estimate': 'costReportedEstimate',
      'retail-equivalent': 'costRetailEquivalent',
      'legacy-unknown': 'costLegacyUnknown'
    };
    return t(keys[kind]);
  }

  function providerHealthMessage(target: { health: ProviderOverview['health'] }): string | null {
    return locale === 'en' ? target.health.message : t('providerDegraded');
  }

  function providerHealthRecovery(target: { health: ProviderOverview['health'] }): string | null {
    return locale === 'en' ? target.health.recovery : t('providerRecovery');
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
        freshness: provider.freshness,
        health: provider.health,
        coverage: provider.coverage,
        quotaBuckets: provider.quotaBuckets,
        tokenTotals: provider.tokenTotals,
        tokenEvidence: provider.tokenEvidence,
        tokenAuthority: provider.tokenAuthority,
        costs: [],
        balances: [],
        invoices: [],
        history: fallbackHistory(
          provider.tokenTotals,
          [],
          provider.tokenAuthority,
          provider.tokenEvidence
        ),
        forecasts: [],
        forecastCoverage: provider.forecastCoverage
      }
    );
  }

  function activeHistory(domain: BillingDomainOverview): BillingHistory {
    return (
      domain.history ??
      fallbackHistory(domain.tokenTotals, domain.costs, domain.tokenAuthority, domain.tokenEvidence)
    );
  }

  function fallbackHistory(
    tokenTotals: ProviderOverview['tokenTotals'],
    costs: BillingDomainOverview['costs'],
    tokenAuthority: BillingDomainOverview['tokenAuthority'],
    tokenEvidence: ProviderOverview['tokenEvidence'] = emptyTokenEvidence()
  ): BillingHistory {
    return {
      window: selectedWindow,
      start: '',
      end: '',
      timeZone,
      tokenTotals,
      tokenEvidence,
      models: [],
      unclassified: {
        tokenTotals: emptyTokenTotals(),
        tokenEvidence: emptyTokenEvidence(),
        authorities: [],
        lastObservedAt: null
      },
      days: [],
      intervals: [],
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
    try {
      localStorage.setItem('agent-usage:history-window', window);
    } catch {
      // A disabled local preference store must not block usage queries.
    }
    loading = true;
    await loadOverview();
  }

  async function selectCurrency(currency: 'CNY' | 'USD'): Promise<void> {
    if (selectedCurrency === currency) return;
    selectedCurrency = currency;
    try {
      localStorage.setItem('agent-usage:comparison-currency', currency);
    } catch {
      // A disabled local preference store must not block usage queries.
    }
    loading = true;
    await loadOverview();
  }

  function storedWindow(): HistoryWindow {
    try {
      const stored = localStorage.getItem('agent-usage:history-window');
      return stored === '24h' || stored === '7d' || stored === '30d' ? stored : '7d';
    } catch {
      return '7d';
    }
  }

  function storedCurrency(): 'CNY' | 'USD' {
    try {
      const stored = localStorage.getItem('agent-usage:comparison-currency');
      return stored === 'USD' || stored === 'CNY' ? stored : 'CNY';
    } catch {
      return 'CNY';
    }
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

  function providerLogoSources(providerId: string): { dark: string; light: string } | null {
    const paths: Record<string, { dark: string; light: string }> = {
      codex: { dark: '/brands/openai.svg', light: '/brands/openai.svg' },
      'claude-code': { dark: '/brands/claude.svg', light: '/brands/claude.svg' },
      'opencode-go': {
        dark: '/brands/opencode-dark.svg',
        light: '/brands/opencode-light.svg'
      }
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
      summaryBillingDomainId: null,
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
      tokenEvidence: emptyTokenEvidence(),
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
      tokenEvidence: emptyTokenEvidence(),
      tokenAuthority: null,
      costs: [],
      balances: [],
      invoices: [],
      history: fallbackHistory(tokenTotals, [], null),
      forecasts: [],
      forecastCoverage: 'insufficient'
    };
  }

  function emptyTokenTotals(): ProviderOverview['tokenTotals'] {
    return { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  }

  function emptyTokenEvidence(): ProviderOverview['tokenEvidence'] {
    return {
      recordedTokens: 0,
      sourceReportedTokens: 0,
      sourceReportedObservationCount: 0,
      observationCount: 0,
      unclassifiedTokens: 0,
      classifiedTokens: 0,
      classificationCoverage: null,
      totalDerivations: [],
      timePrecisions: [],
      usageScopes: [],
      aggregationTemporalities: []
    };
  }

  function diagnosticTargetForProvider(
    report: DoctorReport | null,
    providerId: string,
    billingDomainId?: string
  ): string | null {
    const candidates = report?.connectors.filter(
      (candidate) => candidate.providerId === providerId
    );
    const exactDomainDiagnostic = billingDomainId
      ? candidates?.find((candidate) => candidate.billingDomainId === billingDomainId)
      : null;
    const diagnostic = billingDomainId
      ? exactDomainDiagnostic
      : (degradedDiagnosticForProvider(report, providerId) ?? candidates?.[0]);
    return diagnostic ? `diagnostic:${diagnostic.id}` : null;
  }

  function degradedDiagnosticForProvider(
    report: DoctorReport | null,
    providerId: string,
    billingDomainId?: string
  ): DoctorReport['connectors'][number] | null {
    const candidates = report?.connectors.filter(
      (candidate) => candidate.providerId === providerId && candidate.status === 'degraded'
    );
    return billingDomainId
      ? (candidates?.find((candidate) => candidate.billingDomainId === billingDomainId) ?? null)
      : (candidates?.[0] ?? null);
  }

  function actionableRisk(
    currentOverview: UsageOverview,
    report: DoctorReport | null,
    currentLocale: Locale
  ): { title: string; detail: string; target: string | null } | null {
    const degradedConnector = report?.connectors.find(
      (diagnostic) => diagnostic.status === 'degraded'
    );
    if (degradedConnector) {
      return {
        title: `${degradedConnector.id} · ${translate(currentLocale, 'connectionNeedsAttention')}`,
        detail:
          diagnosticRecovery(degradedConnector) ?? translate(currentLocale, 'reviewInSettings'),
        target: `diagnostic:${degradedConnector.id}`
      };
    }
    const staleDomain = currentOverview.providers
      .flatMap((provider) => provider.billingDomains.map((domain) => ({ provider, domain })))
      .find(({ provider, domain }) => (domain.freshness ?? provider.freshness).status === 'stale');
    if (staleDomain) {
      return {
        title: `${staleDomain.provider.displayName} · ${staleDomain.domain.displayName} · ${translate(currentLocale, 'stale')}`,
        detail: translate(currentLocale, 'reviewInSettings'),
        target: diagnosticTargetForProvider(report, staleDomain.provider.id, staleDomain.domain.id)
      };
    }
    const constrained = currentOverview.riskSummary?.mostConstrained;
    if (
      constrained &&
      (constrained.remainingPercent <= 20 || constrained.forecast?.willLastUntilReset === false)
    ) {
      return {
        title: `${constrained.displayName} · ${constrained.label}`,
        detail: `${formatNumber(constrained.remainingPercent)}% ${translate(currentLocale, 'remaining')} · ${authorityLabel(constrained.authority ?? 'unavailable')} · ${formatReset(constrained.observedAt ?? null)}`,
        target: diagnosticTargetForProvider(
          report,
          constrained.providerId,
          constrained.billingDomainId
        )
      };
    }
    return null;
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
      minimumFractionDigits: 2,
      maximumFractionDigits: Math.abs(amount) > 0 && Math.abs(amount) < 0.01 ? 8 : 2
    }).format(amount);
  }

  function workbenchMetrics(workbench: UsageOverview['workbench']) {
    return [
      {
        id: 'actual',
        label: 'costActual' as const,
        metric: workbench.costs.actual
      },
      {
        id: 'reported-estimate',
        label: 'costReportedEstimate' as const,
        metric: workbench.costs.reportedEstimate
      },
      {
        id: 'retail-equivalent',
        label: 'costRetailEquivalent' as const,
        metric: workbench.costs.retailEquivalent
      }
    ];
  }

  function nativeAmountEvidence(metric: UsageOverview['workbench']['costs']['actual']): string {
    if (metric.nativeAmounts.length === 0) return t('notAvailable');
    return metric.nativeAmounts
      .map((amount) => formatMoney(amount.amount, amount.currency))
      .join(' + ');
  }

  function trendValue(
    segment: UsageOverview['workbench']['trend']['buckets'][number]['segments'][number]
  ): number | null {
    return selectedTrendMetric === 'tokens'
      ? segment.recordedTokens
      : segment.retailEquivalent.amount;
  }

  function trendMaximum(workbench: UsageOverview['workbench']): number {
    return Math.max(
      1,
      ...workbench.trend.buckets.map((bucket) =>
        bucket.segments.reduce((total, segment) => total + (trendValue(segment) ?? 0), 0)
      )
    );
  }

  function trendLegend(workbench: UsageOverview['workbench']) {
    return [
      ...new Map(
        workbench.trend.buckets
          .flatMap((bucket) => bucket.segments)
          .map((segment) => [`${segment.providerId}:${segment.billingDomainId}`, segment])
      ).values()
    ];
  }

  function trendSegmentColor(providerId: string, billingDomainId: string): string {
    const colors: Record<string, string> = {
      codex: '#78a7ff',
      'claude-code': '#d69b73',
      'opencode-go': '#73d4b2',
      'grok:grok-build-subscription': '#b28cff',
      'grok:xai-api': '#f07f9a'
    };
    return colors[`${providerId}:${billingDomainId}`] ?? colors[providerId] ?? '#9aa5b8';
  }

  function trendSegmentDescription(
    segment: UsageOverview['workbench']['trend']['buckets'][number]['segments'][number]
  ): string {
    const value =
      selectedTrendMetric === 'tokens'
        ? `${formatNumber(segment.recordedTokens)} ${t('tokens')}`
        : formatMoney(segment.retailEquivalent.amount, segment.retailEquivalent.currency);
    const precision = segment.timePrecisions.map(timePrecisionLabel).join(' + ') || t('unknown');
    const authorities =
      segment.authorities && segment.authorities.length > 0
        ? segment.authorities.map(authorityLabel).join(' + ')
        : authorityLabel('unavailable');
    const headlineScope =
      segment.includedInHeadline === false ? ` · ${t('separateFromHeadline')}` : '';
    return `${segment.providerDisplayName} · ${segment.billingDomainDisplayName}${headlineScope}: ${value} · ${t('timePrecision')}: ${precision} · ${t('source')}: ${authorities} · ${formatReset(segment.lastObservedAt ?? null)}`;
  }

  function overviewTokenDisplayEvidence(currentOverview: UsageOverview): {
    authorities: DataAuthority[];
    lastObservedAt: string | null;
  } {
    const histories = currentOverview.providers.flatMap((provider) =>
      provider.billingDomains
        .filter((domain) => domain.id === provider.summaryBillingDomainId)
        .map((domain) => domain.history)
    );
    const authorities = [
      ...new Set(histories.flatMap((history) => history.authorities ?? []))
    ].sort();
    const lastObservedAt = histories
      .flatMap((history) => (history.lastObservedAt ? [history.lastObservedAt] : []))
      .sort((left, right) => right.localeCompare(left))[0];
    return { authorities, lastObservedAt: lastObservedAt ?? null };
  }

  function displayAuthorities(authorities: DataAuthority[] | undefined): string {
    return authorities && authorities.length > 0
      ? authorities.map(authorityLabel).join(' + ')
      : authorityLabel('unavailable');
  }

  function rankedModels(
    workbench: UsageOverview['workbench'],
    sort: 'tokens' | 'retail-equivalent'
  ) {
    const ids =
      sort === 'tokens'
        ? workbench.modelRanking.byTokens
        : workbench.modelRanking.byRetailEquivalent;
    return ids.flatMap((id) => {
      const entry = workbench.modelRanking.entries.find((candidate) => candidate.id === id);
      return entry ? [entry] : [];
    });
  }

  async function openModelDetail(id: string, trigger: HTMLButtonElement): Promise<void> {
    selectedModelId = id;
    modelDetailTrigger = trigger;
    await tick();
    modelDetailPanel?.focus();
  }

  async function closeModelDetail(): Promise<void> {
    selectedModelId = null;
    await tick();
    modelDetailTrigger?.focus();
  }

  function tokenKindLabel(kind: string): string {
    const keys: Record<string, MessageKey> = {
      input: 'input',
      output: 'output',
      reasoning: 'reasoning',
      'cache-read': 'cacheRead',
      'cache-write': 'cacheWrite'
    };
    return t(keys[kind] ?? 'unknown');
  }
</script>

<svelte:head>
  <title>Agent Usage</title>
  <meta
    name="description"
    content="A private local dashboard for coding-agent quota, token, and cost usage."
  />
</svelte:head>

<svelte:window on:keydown={handleWindowKeydown} />

{#key locale}
  <main class="shell" inert={settingsOpen || selectedModelEntry !== null}>
    <header>
      <div>
        <p class="eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p class="subtitle">{t('subtitle')}</p>
      </div>
      <div class="header-actions">
        <button class="settings-toggle" bind:this={settingsButton} on:click={() => openSettings()}>
          {t('settings')}
        </button>
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
    {:else if overviewError && !overview}
      <div class="state error" role="alert">{t('error')}</div>
    {:else if overview}
      {@const risk = actionableRisk(overview, diagnostics, locale)}
      {@const overviewTokenEvidence = overviewTokenDisplayEvidence(overview)}
      {#if refreshError}
        <div class="inline-error" role="status">{t('refreshUnavailable')}</div>
      {/if}
      {#if overview.providers.length === 0}
        <div class="state compact">{t('noProviders')}</div>
      {/if}
      <section class="global-summary" aria-labelledby="global-summary-heading">
        <div class="global-summary-heading">
          <div>
            <p class="eyebrow">{selectedWindow}</p>
            <h2 id="global-summary-heading">{t('globalSummary')}</h2>
          </div>
          <div class="history-toolbar" aria-label={t('history')}>
            {#each ['24h', '7d', '30d'] as window (window)}
              <button
                type="button"
                aria-pressed={selectedWindow === window}
                on:click={() => selectWindow(window as HistoryWindow)}>{window}</button
              >
            {/each}
          </div>
        </div>
        {#if overview.globalSummary}
          {@const summary = overview.globalSummary}
          <div class="summary-metrics">
            <article>
              <span>{t('recordedTokens')}</span>
              <strong
                data-testid="summary-recorded-tokens"
                aria-label={summary.recordedTokens === null
                  ? t('notAvailable')
                  : tokenValueLabel(summary.recordedTokens)}
              >
                {summary.recordedTokens === null
                  ? t('notAvailable')
                  : formatCompactNumber(summary.recordedTokens)}
              </strong>
              <small>
                {#if summary.recordedTokens === null}
                  {t('noObservations')}
                {:else}
                  {t('classificationCoverage')}:
                  {formatPercent(summary.tokenEvidence.classificationCoverage)} ·
                  {t('timePrecision')}:
                  {summary.tokenEvidence.timePrecisions.map(timePrecisionLabel).join(' + ') ||
                    t('unknown')}
                {/if}
              </small>
              <small>
                {t('source')}: {displayAuthorities(overviewTokenEvidence.authorities)} ·
                {formatReset(overviewTokenEvidence.lastObservedAt)}
              </small>
            </article>
            <article>
              <span>{t('apiRetailEquivalent')}</span>
              <strong data-testid="summary-retail-equivalent">
                {summary.apiRetailEquivalent.status === 'available'
                  ? formatMoney(
                      summary.apiRetailEquivalent.amount,
                      summary.apiRetailEquivalent.currency
                    )
                  : t('notAvailable')}
              </strong>
              <small>
                {t('pricingCoverage')}:
                {formatPercent(summary.apiRetailEquivalent.pricingCoverage)}
              </small>
              <small>
                {t('source')}: {displayAuthorities(
                  overview.workbench.costs.retailEquivalent.authorities
                )} · {formatReset(overview.workbench.costs.retailEquivalent.observedAt)}
              </small>
            </article>
            <article>
              <span>{t('mostConstrained')}</span>
              <strong>
                {summary.mostConstrained
                  ? `${summary.mostConstrained.displayName} · ${summary.mostConstrained.label}`
                  : t('notAvailable')}
              </strong>
              <small>
                {#if summary.mostConstrained}
                  {formatNumber(summary.mostConstrained.remainingPercent)}% {t('remaining')} ·
                  {formatRelativeReset(summary.mostConstrained.resetsAt)} ·
                  {formatReset(summary.mostConstrained.resetsAt)}
                  · {authorityLabel(summary.mostConstrained.authority ?? 'unavailable')} ·
                  {formatReset(summary.mostConstrained.observedAt ?? null)}
                {:else}
                  {t('notAvailable')}
                {/if}
              </small>
            </article>
            <article>
              <span>{t('latestData')}</span>
              <strong>
                {summary.latestObservedAt
                  ? formatReset(summary.latestObservedAt)
                  : t('notAvailable')}
              </strong>
              <small>{t('generatedAt')}: {formatReset(summary.generatedAt)}</small>
            </article>
          </div>
          {#if summary.contributions.length > 0}
            <div class="summary-contributions" aria-label={t('domainContributions')}>
              {#each summary.contributions as contribution (`${contribution.providerId}:${contribution.billingDomainId}`)}
                <span>
                  {contribution.providerDisplayName} · {contribution.billingDomainDisplayName}
                  <b aria-label={tokenValueLabel(contribution.recordedTokens)}
                    >{formatCompactNumber(contribution.recordedTokens)}</b
                  >
                  <small>
                    {#if contribution.includedInHeadline === false}
                      {t('separateFromHeadline')} ·
                    {/if}
                    {displayAuthorities(contribution.authorities)} ·
                    {formatReset(contribution.lastObservedAt ?? null)}
                  </small>
                </span>
              {/each}
            </div>
          {/if}
        {/if}
      </section>
      {#if risk}
        <section class="risk-banner" aria-label={t('riskOverview')}>
          <div>
            <strong>{risk.title}</strong>
            <span>{risk.detail}</span>
          </div>
          <button on:click={() => openSettings(risk.target)}>{t('reviewInSettings')}</button>
        </section>
      {/if}
      <section class="providers" aria-label={t('providersLabel')}>
        {#each displayProviders(overview, connectors) as provider (provider.id)}
          {@const logo = providerLogoSources(provider.id)}
          {@const selectedDomain = activeBillingDomain(
            provider,
            selectedBillingDomains[provider.id]
          )}
          {@const recoveryDiagnostic = degradedDiagnosticForProvider(
            diagnostics,
            provider.id,
            selectedDomain.id
          )}
          {@const domainFreshness = selectedDomain.freshness ?? provider.freshness}
          {@const domainHealth = selectedDomain.health ?? provider.health}
          {@const domainCoverage = selectedDomain.coverage ?? provider.coverage}
          <article class="provider-card">
            <div class="provider-heading">
              <div>
                {#if logo}
                  <picture class="provider-logo" data-provider-logo={provider.id}>
                    <source media="(prefers-color-scheme: light)" srcset={logo.light} />
                    <source media="(prefers-color-scheme: dark)" srcset={logo.dark} />
                    <img src={logo.dark} alt="" />
                  </picture>
                {/if}
                <div>
                  <h2 data-provider-logo={logo ? undefined : provider.id}>
                    {provider.displayName}
                  </h2>
                  <p class="freshness" data-status={domainFreshness.status}>
                    <span></span>
                    {domainFreshness.status === 'fresh'
                      ? t('updatedNow')
                      : domainFreshness.status === 'stale'
                        ? t('stale')
                        : t('unavailable')}
                    {domainFreshness.lastSuccessAt
                      ? ` · ${formatReset(domainFreshness.lastSuccessAt)}`
                      : ''}
                  </p>
                </div>
              </div>
              <div class="coverage">{coverageLevelLabel(domainCoverage.quota)}</div>
            </div>

            {#if domainHealth.status === 'degraded'}
              <div class="degraded" role="status">
                <strong>
                  {recoveryDiagnostic
                    ? `${recoveryDiagnostic.id} · ${diagnosticCategoryLabel(recoveryDiagnostic)}`
                    : providerHealthMessage({ health: domainHealth })}
                </strong>
                <code>
                  {recoveryDiagnostic
                    ? diagnosticRecovery(recoveryDiagnostic)
                    : providerHealthRecovery({ health: domainHealth })}
                </code>
                <button
                  on:click={() =>
                    openSettings(
                      diagnosticTargetForProvider(diagnostics, provider.id, selectedDomain.id)
                    )}>{t('reviewInSettings')}</button
                >
              </div>
            {/if}

            {#if (provider.billingDomains?.length ?? 0) > 1}
              <div
                class="domain-tabs"
                role="tablist"
                aria-label={`${provider.displayName} ${t('billingDomainTabs')}`}
              >
                {#each provider.billingDomains as domain (domain.id)}
                  {@const selected = selectedDomain.id === domain.id}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    tabindex={selected ? 0 : -1}
                    on:click={() => selectBillingDomain(provider.id, domain.id)}
                    on:keydown={handleTablistKeydown}>{domain.displayName}</button
                  >
                {/each}
              </div>
            {/if}

            {#each [selectedDomain] as domain (domain.id)}
              {@const history = activeHistory(domain)}
              {@const tokenAuthority = historyTokenAuthority(history, domain.tokenAuthority)}
              {@const connector = connectorForDomain(connectors, provider.id, domain.id)}
              {#if connector}
                {#if connector.state === 'connected'}
                  <div class="connected-summary" data-testid={`connector-${connector.id}`}>
                    <span>
                      <strong>{connectorStateLabel(connector.state)}</strong>
                      <small>{connector.target.billingDomain.displayName}</small>
                    </span>
                    <button on:click={() => openSettings(`connector:${connector.id}`)}
                      >{t('manageConnection')}</button
                    >
                  </div>
                {:else}
                  <details
                    class:connection-pending={pendingConnectorId === connector.id}
                    class="inline-connection"
                    data-testid={`connector-${connector.id}`}
                    aria-busy={pendingConnectorId === connector.id}
                    open
                  >
                    <summary>
                      <span>
                        <strong>{connectorStateLabel(connector.state)}</strong>
                        {#if connector.experimental}<small>{t('experimental')}</small>{/if}
                      </span>
                      {t('connectionSetup')}
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
                          >{connector.expectedCoverage
                            .map(coverageDimensionLabel)
                            .join(' · ')}</strong
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
                        {#if connector.state === 'error' || connector.state === 'not-installed'}
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
                      class:progress-warning={(bucket.usedPercent ?? 0) >= 70 &&
                        (bucket.usedPercent ?? 0) < 90}
                      class:progress-critical={(bucket.usedPercent ?? 0) >= 90}
                      role="progressbar"
                      aria-label={bucket.label}
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow={bucket.usedPercent ?? undefined}
                      aria-valuetext={bucket.usedPercent === null
                        ? t('notAvailable')
                        : `${formatNumber(bucket.usedPercent)}% ${t('used')}`}
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
                      <span
                        >{formatReset(
                          bucket.observedAt ??
                            domain.freshness?.lastSuccessAt ??
                            provider.freshness.lastSuccessAt
                        )}</span
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
                        <span>{t('limit')}: ${bucket.limitAmount} {bucket.limitCurrency ?? ''}</span
                        >
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
                  · {formatReset(history.lastObservedAt ?? null)}
                  <br />
                  {t('scope')}:
                  {(history.tokenEvidence?.usageScopes ?? []).map(usageScopeLabel).join(' + ') ||
                    t('unknown')}
                  · {t('timePrecision')}:
                  {(history.tokenEvidence?.timePrecisions ?? [])
                    .map(timePrecisionLabel)
                    .join(' + ') || t('unknown')}
                  · {t('unclassified')}:
                  {formatNumber(history.tokenEvidence?.unclassifiedTokens ?? 0)}
                  · {t('aggregationTemporality')}:
                  {(history.tokenEvidence?.aggregationTemporalities ?? [])
                    .map(aggregationTemporalityLabel)
                    .join(' + ') || t('unknown')}
                </p>
                <div class="token-total">
                  <span>{t('total')}</span>
                  <strong aria-label={tokenValueLabel(history.tokenTotals.total)}>
                    {formatCompactNumber(history.tokenTotals.total)}
                  </strong>
                </div>
                <details class="token-breakdown">
                  <summary>{t('tokenBreakdown')}</summary>
                  <dl class="tokens">
                    <div>
                      <dt>{t('input')}</dt>
                      <dd aria-label={tokenValueLabel(history.tokenTotals.input)}>
                        {formatCompactNumber(history.tokenTotals.input)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('output')}</dt>
                      <dd aria-label={tokenValueLabel(history.tokenTotals.output)}>
                        {formatCompactNumber(history.tokenTotals.output)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('reasoning')}</dt>
                      <dd aria-label={tokenValueLabel(history.tokenTotals.reasoning ?? 0)}>
                        {formatCompactNumber(history.tokenTotals.reasoning ?? 0)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('cacheRead')}</dt>
                      <dd aria-label={tokenValueLabel(history.tokenTotals.cacheRead)}>
                        {formatCompactNumber(history.tokenTotals.cacheRead)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('cacheWrite')}</dt>
                      <dd aria-label={tokenValueLabel(history.tokenTotals.cacheWrite)}>
                        {formatCompactNumber(history.tokenTotals.cacheWrite)}
                      </dd>
                    </div>
                  </dl>
                </details>
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
                      {#if cost.pricingEvidence}
                        <small>
                          {t('pricingCoverage')}:
                          {formatPercent(cost.pricingEvidence.pricingCoverage)} ·
                          {formatNumber(cost.pricingEvidence.pricedTokens)} / {formatNumber(
                            cost.pricingEvidence.recordedTokens
                          )}
                          {t('tokens')} · {formatNumber(cost.pricingEvidence.unpricedTokens)}
                          {t('unpricedTokens')}
                        </small>
                      {/if}
                      {#each cost.priceSnapshots as price (price.id)}
                        <small>
                          {t('priceVersion')}: {price.version} · {price.source}{price.contextTier
                            ? ` · ${price.contextTier}`
                            : ''}
                        </small>
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
                      <span>
                        {model.model}<b aria-label={tokenValueLabel(model.tokenTotals.total)}
                          >{formatCompactNumber(model.tokenTotals.total)}</b
                        >
                        <small>
                          {displayAuthorities(
                            model.observations?.map((observation) => observation.authority) ??
                              history.authorities
                          )} · {formatReset(
                            model.observations
                              ?.map((observation) => observation.observedAt)
                              .sort((left, right) => right.localeCompare(left))[0] ??
                              history.lastObservedAt ??
                              null
                          )}
                        </small>
                      </span>
                    {/each}
                  </div>
                  <div>
                    <strong>{t('topDays')}</strong>
                    {#each history.days.slice(-3).reverse() as day (day.day)}
                      <span>
                        {day.day}<b aria-label={tokenValueLabel(day.tokenTotals.total)}
                          >{formatCompactNumber(day.tokenTotals.total)}</b
                        >
                        <small>
                          {displayAuthorities(day.authorities)} ·
                          {formatReset(day.lastObservedAt ?? null)}
                        </small>
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}
            {/each}
          </article>
        {/each}
      </section>
      {#if overview.workbench}
        {@const workbench = overview.workbench}
        <section
          class="token-money-workbench"
          data-testid="token-money-workbench"
          aria-labelledby="token-money-workbench-heading"
        >
          <div class="workbench-heading">
            <div>
              <p class="eyebrow">{selectedWindow} · {workbench.timeZone}</p>
              <h2 id="token-money-workbench-heading">{t('tokenMoneyWorkbench')}</h2>
              <p>{t('workbenchSubtitle')}</p>
            </div>
            <div class="workbench-controls">
              <div class="segmented-control" role="group" aria-label={t('displayCurrency')}>
                {#each ['CNY', 'USD'] as currency (currency)}
                  <button
                    type="button"
                    aria-pressed={selectedCurrency === currency}
                    on:click={() => selectCurrency(currency as 'CNY' | 'USD')}>{currency}</button
                  >
                {/each}
              </div>
            </div>
          </div>

          <div class="workbench-metrics">
            <article data-testid="workbench-recorded-tokens">
              <span>{t('recordedTokens')}</span>
              <strong
                aria-label={workbench.recordedTokens === null
                  ? t('notAvailable')
                  : tokenValueLabel(workbench.recordedTokens)}
              >
                {workbench.recordedTokens === null
                  ? t('notAvailable')
                  : formatCompactNumber(workbench.recordedTokens)}
              </strong>
              <small
                >{workbench.trend.granularity === 'hour'
                  ? t('precisionHour')
                  : t('precisionDay')}</small
              >
              <small>
                {t('source')}: {displayAuthorities(overviewTokenEvidence.authorities)} ·
                {formatReset(overviewTokenEvidence.lastObservedAt)}
              </small>
            </article>
            {#each workbenchMetrics(workbench) as item (item.id)}
              <article data-testid={`workbench-${item.id}`}>
                <span>{t(item.label)}</span>
                <strong>
                  {item.metric.status === 'available'
                    ? formatMoney(item.metric.amount, item.metric.comparisonCurrency)
                    : t('notAvailable')}
                </strong>
                <small>{t('nativeAmount')}: {nativeAmountEvidence(item.metric)}</small>
                <small>
                  {t('source')}:
                  {item.metric.authorities.length > 0
                    ? item.metric.authorities.map(authorityLabel).join(' + ')
                    : authorityLabel('unavailable')}
                  · {formatReset(item.metric.observedAt)}
                </small>
                <small>{t('amountCoverage')}: {formatPercent(item.metric.amountCoverage)}</small>
                {#if item.metric.purpose === 'retail-equivalent'}
                  <small>{t('pricingCoverage')}: {formatPercent(item.metric.pricingCoverage)}</small
                  >
                {/if}
                {#if item.metric.exchangeRates.length > 0}
                  {#each item.metric.exchangeRates as rate (rate.id)}
                    <small>
                      {t('conversionEvidence')}: 1 {rate.baseCurrency} = {rate.rate}
                      {rate.quoteCurrency} · {rate.source} · {formatReset(rate.observedAt)}
                    </small>
                  {/each}
                {:else if item.metric.status === 'available' && selectedCurrency === 'USD'}
                  <small>{t('noConversionNeeded')}</small>
                {:else if item.metric.conversionUnavailableReasons.length > 0}
                  <small>{t('rateUnavailable')}</small>
                {/if}
              </article>
            {/each}
          </div>

          <article class="workbench-trend">
            <div class="trend-heading">
              <div>
                <span>{t('trendMetric')}</span>
                <strong data-testid="trend-mode">
                  {selectedTrendMetric === 'tokens'
                    ? t('recordedTokens')
                    : t('apiRetailEquivalent')}
                </strong>
              </div>
              <div class="segmented-control" role="group" aria-label={t('trendMetric')}>
                <button
                  type="button"
                  aria-pressed={selectedTrendMetric === 'tokens'}
                  on:click={() => (selectedTrendMetric = 'tokens')}
                  >{t('recordedTokenTrend')}</button
                >
                <button
                  type="button"
                  aria-pressed={selectedTrendMetric === 'retail-equivalent'}
                  on:click={() => (selectedTrendMetric = 'retail-equivalent')}
                  >{t('retailEquivalentTrend')}</button
                >
              </div>
            </div>
            <div class="trend-chart" aria-hidden="true">
              {#each workbench.trend.buckets as bucket (bucket.start)}
                <div class="trend-column" title={bucket.label}>
                  <div class:trend-gap={bucket.gap} class="trend-stack">
                    {#if bucket.gap}
                      <span class="gap-marker">·</span>
                    {:else}
                      {#each bucket.segments as segment (`${segment.providerId}:${segment.billingDomainId}`)}
                        {#if (trendValue(segment) ?? 0) > 0}
                          <span
                            class="trend-segment"
                            style={`height: ${Math.max(2, ((trendValue(segment) ?? 0) / trendMaximum(workbench)) * 100)}%; background: ${trendSegmentColor(segment.providerId, segment.billingDomainId)}`}
                            title={trendSegmentDescription(segment)}
                          ></span>
                        {/if}
                      {/each}
                    {/if}
                  </div>
                  <small>{bucket.label.slice(-5)}</small>
                </div>
              {/each}
            </div>
            <div class="trend-legend" aria-hidden="true">
              {#each trendLegend(workbench) as segment (`${segment.providerId}:${segment.billingDomainId}`)}
                <span>
                  <i
                    style={`background: ${trendSegmentColor(segment.providerId, segment.billingDomainId)}`}
                  ></i>
                  {segment.providerDisplayName} · {segment.billingDomainDisplayName}
                  {#if segment.includedInHeadline === false}
                    · {t('separateFromHeadline')}{/if}
                </span>
              {/each}
            </div>
            <div class="trend-data">
              <table
                aria-label={`${t('trendData')} · ${selectedWindow} · ${workbench.timeZone} · ${workbench.trend.granularity === 'hour' ? t('precisionHour') : t('precisionDay')} · ${t('trendSummary')}`}
              >
                <thead>
                  <tr>
                    <th>{t('interval')}</th>
                    <th>{t('providerEvidence')}</th>
                  </tr>
                </thead>
                <tbody>
                  {#each workbench.trend.buckets as bucket (bucket.start)}
                    <tr>
                      <td>{bucket.label}</td>
                      <td>
                        {bucket.gap
                          ? t('gap')
                          : bucket.segments.map(trendSegmentDescription).join('; ')}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </article>

          <section
            class="model-ranking"
            data-testid="model-ranking"
            aria-labelledby="model-ranking-heading"
          >
            <div class="ranking-heading">
              <div>
                <h3 id="model-ranking-heading">{t('topModels')}</h3>
                <p>{t('modelRankingSubtitle')}</p>
              </div>
              <div class="segmented-control" role="group" aria-label={t('topModels')}>
                <button
                  type="button"
                  aria-pressed={modelRankingSort === 'tokens'}
                  on:click={() => (modelRankingSort = 'tokens')}>{t('sortByTokens')}</button
                >
                <button
                  type="button"
                  aria-pressed={modelRankingSort === 'retail-equivalent'}
                  on:click={() => (modelRankingSort = 'retail-equivalent')}
                  >{t('sortByRetailEquivalent')}</button
                >
              </div>
            </div>
            <ol class="ranking-list">
              {#each rankedModels(workbench, modelRankingSort) as model (model.id)}
                {@const modelLogo = providerLogoSources(model.providerId)}
                <li>
                  <button
                    type="button"
                    data-testid="model-ranking-row"
                    on:click={(event) => openModelDetail(model.id, event.currentTarget)}
                    on:keydown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void openModelDetail(model.id, event.currentTarget);
                      }
                    }}
                  >
                    <span class="ranking-identity">
                      {#if modelLogo}
                        <picture class="ranking-logo" data-provider-logo={model.providerId}>
                          <source media="(prefers-color-scheme: light)" srcset={modelLogo.light} />
                          <source media="(prefers-color-scheme: dark)" srcset={modelLogo.dark} />
                          <img src={modelLogo.dark} alt="" />
                        </picture>
                      {/if}
                      <span>
                        <strong>{model.model}</strong>
                        <small>{model.providerDisplayName} · {model.billingDomainDisplayName}</small
                        >
                        {#if model.includedInHeadline === false}
                          <small>{t('separateFromHeadline')}</small>
                        {/if}
                        <small>
                          {displayAuthorities(model.authorities)} ·
                          {formatReset(model.lastObservedAt)}
                        </small>
                      </span>
                    </span>
                    <span class="ranking-value">
                      <strong aria-label={tokenValueLabel(model.tokenTotals.total)}
                        >{formatCompactNumber(model.tokenTotals.total)} {t('tokens')}</strong
                      >
                      <small>
                        {t('tokenShare')}:
                        {model.includedInHeadline !== false
                          ? formatPercent(model.tokenShare)
                          : t('headlineShareNotApplicable')}
                      </small>
                    </span>
                    <span class="ranking-value">
                      <strong>
                        {model.retailEquivalent.status === 'available'
                          ? formatMoney(
                              model.retailEquivalent.amount,
                              model.retailEquivalent.comparisonCurrency
                            )
                          : t('notAvailable')}
                      </strong>
                      <small>
                        {t('retailShare')}:
                        {model.includedInHeadline !== false
                          ? formatPercent(model.retailShare)
                          : t('headlineShareNotApplicable')}
                      </small>
                      <small>
                        {displayAuthorities(model.retailEquivalent.authorities)} ·
                        {formatReset(model.retailEquivalent.observedAt)}
                      </small>
                    </span>
                  </button>
                </li>
              {/each}
            </ol>
            {#if workbench.modelRanking.unclassified.length > 0}
              <div class="unclassified-usage">
                <strong>{t('unclassifiedUsage')}</strong>
                {#each workbench.modelRanking.unclassified as item (`${item.providerId}:${item.billingDomainId}`)}
                  <span>
                    {item.providerDisplayName} · {item.billingDomainDisplayName}
                    {#if item.includedInHeadline === false}
                      · {t('separateFromHeadline')}{/if}
                    <b aria-label={tokenValueLabel(item.tokenTotals.total)}
                      >{formatCompactNumber(item.tokenTotals.total)} {t('tokens')}</b
                    >
                    <small>
                      {item.includedInHeadline !== false
                        ? formatPercent(item.tokenShare)
                        : t('headlineShareNotApplicable')}
                    </small>
                    <small>
                      {displayAuthorities(item.authorities)} · {formatReset(item.lastObservedAt)}
                    </small>
                  </span>
                {/each}
              </div>
            {/if}
          </section>
        </section>
      {/if}
    {/if}
  </main>

  {#if settingsOpen}
    <div class="settings-backdrop" role="presentation">
      <div
        class="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-heading"
        tabindex="-1"
        bind:this={settingsPanel}
      >
        <div class="settings-header">
          <div>
            <p class="eyebrow">{t('settings')}</p>
            <h2 id="settings-heading">{t('settings')}</h2>
            <p>{t('settingsSubtitle')}</p>
          </div>
          <button class="settings-close" aria-label={t('closeSettings')} on:click={closeSettings}
            >×</button
          >
        </div>

        <div class="settings-content">
          <section aria-labelledby="settings-connections-heading">
            <div class="settings-section-heading">
              <h2 id="settings-connections-heading">{t('connections')}</h2>
              <p>{t('connectionsSubtitle')}</p>
            </div>
            {#if connectorsError}
              <p class="settings-error" role="status">{t('connectorsUnavailable')}</p>
            {/if}
            <div class="settings-connections">
              {#each connectors as connector (connector.id)}
                <article
                  class:settings-target-active={settingsTarget === `connector:${connector.id}`}
                  data-settings-target={`connector:${connector.id}`}
                  data-testid={`settings-connector-${connector.id}`}
                  tabindex="-1"
                >
                  <div class="settings-connector-title">
                    <strong>{connector.displayName}</strong>
                    <span>{connectorStateLabel(connector.state)}</span>
                  </div>
                  <p>{connectorPermission(connector)}</p>
                  <small
                    >{credentialOwnerLabel(connector.credentialOwner)} · {connector.target
                      .billingDomain.displayName}</small
                  >
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
                    {#if connector.state === 'connected' && connector.credentialOwner === 'agent-usage'}
                      <button
                        class="primary-action"
                        disabled={pendingConnectorId === connector.id ||
                          !secretInputs[connector.id]}
                        on:click={() => configureConnector(connector.id, 'connect')}
                        >{t('replaceCredential')}</button
                      >
                    {/if}
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
                </article>
              {/each}
            </div>
          </section>

          <section class="monitoring-section" aria-labelledby="monitoring-heading">
            <div class="settings-section-heading">
              <h2 id="monitoring-heading">{t('monitoring')}</h2>
              <p>{t('monitoringSubtitle')}</p>
            </div>
            {#if monitoringError}
              <p class="settings-error" role="status">{t('monitoringUnavailable')}</p>
            {/if}
            {#if monitoring}
              <div class="monitoring-controls">
                <label>
                  <input
                    type="checkbox"
                    checked={monitoring.backgroundCollectionEnabled}
                    on:change={(event) =>
                      updateMonitoring({
                        backgroundCollectionEnabled: event.currentTarget.checked
                      })}
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
                    on:change={(event) =>
                      updateMonitoring({ startAtLogin: event.currentTarget.checked })}
                  />
                  {t('startAtLogin')}
                </label>
              </div>
            {/if}
          </section>

          <section class="diagnostics-section" aria-labelledby="diagnostics-heading">
            <div class="settings-section-heading">
              <h2 id="diagnostics-heading">{t('diagnostics')}</h2>
              <p>{t('diagnosticsSubtitle')}</p>
            </div>
            {#if diagnosticsError}
              <p class="settings-error" role="status">{t('diagnosticsUnavailable')}</p>
            {/if}
            {#if diagnostics}
              <div class="diagnostics-grid">
                {#each diagnostics.connectors as diagnostic (diagnostic.id)}
                  <article
                    class:diagnostic-degraded={diagnostic.status === 'degraded'}
                    class:settings-target-active={settingsTarget === `diagnostic:${diagnostic.id}`}
                    data-settings-target={`diagnostic:${diagnostic.id}`}
                    data-testid={`settings-diagnostic-${diagnostic.id}`}
                    tabindex="-1"
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
            {/if}
          </section>

          <section class="privacy-section" aria-labelledby="privacy-heading">
            <div class="settings-section-heading">
              <h2 id="privacy-heading">{t('privacy')}</h2>
              <p>{t('privacySubtitle')}</p>
            </div>
            {#if retentionError}
              <p class="settings-error" role="status">{t('retentionUnavailable')}</p>
            {:else if retention}
              <small>
                {retention.rawRetentionDays}
                {t('retentionDays')} · {retention.rawObservations}
                {t('rawObservations')} · {retention.dailyAggregates}
                {t('dailyAggregates')}
              </small>
            {/if}
            {#if privacyActionError}
              <p class="settings-error" role="status">{t('privacyActionUnavailable')}</p>
            {/if}
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
        </div>
      </div>
    </div>
  {/if}

  {#if selectedModelEntry}
    {@const model = selectedModelEntry}
    <div class="model-detail-backdrop" role="presentation">
      <div
        class="model-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${t('modelDetail')}: ${model.model}`}
        tabindex="-1"
        bind:this={modelDetailPanel}
      >
        <div class="model-detail-header">
          <div>
            <p class="eyebrow">{model.providerDisplayName} · {model.billingDomainDisplayName}</p>
            {#if model.includedInHeadline === false}
              <p>{t('separateFromHeadline')}</p>
            {/if}
            <h2>{t('modelDetail')}: {model.model}</h2>
          </div>
          <button aria-label={t('closeModelDetail')} on:click={closeModelDetail}>×</button>
        </div>

        <div class="model-detail-content">
          <div class="model-detail-summary">
            <span>{t('recordedTotal')} <b>{formatNumber(model.tokenTotals.total)}</b></span>
            <span
              >{t('sourceReportedTotal')}
              <b>
                {model.tokenEvidence.sourceReportedObservationCount === 0
                  ? t('notAvailable')
                  : formatNumber(model.tokenEvidence.sourceReportedTokens)}
                {#if model.tokenEvidence.sourceReportedObservationCount > 0 && model.tokenEvidence.sourceReportedObservationCount < model.tokenEvidence.observationCount}
                  · {t('coveragePartial')}
                {/if}
              </b></span
            >
            <span
              >{t('totalDerivation')}
              <b>{model.tokenEvidence.totalDerivations.join(' + ') || t('unknown')}</b></span
            >
            <span
              >{t('pricingCoverage')}
              <b>{formatPercent(model.retailEquivalent.pricingCoverage)}</b></span
            >
          </div>
          <p class="model-detail-evidence">
            {t('source')}: {displayAuthorities(model.authorities)} ·
            {formatReset(model.lastObservedAt)}
          </p>

          <dl class="model-token-breakdown">
            <div>
              <dt>{t('input')}</dt>
              <dd>{formatNumber(model.tokenTotals.input)}</dd>
            </div>
            <div>
              <dt>{t('output')}</dt>
              <dd>{formatNumber(model.tokenTotals.output)}</dd>
            </div>
            <div>
              <dt>{t('reasoning')}</dt>
              <dd>{formatNumber(model.tokenTotals.reasoning)}</dd>
            </div>
            <div>
              <dt>{t('cacheRead')}</dt>
              <dd>{formatNumber(model.tokenTotals.cacheRead)}</dd>
            </div>
            <div>
              <dt>{t('cacheWrite')}</dt>
              <dd>{formatNumber(model.tokenTotals.cacheWrite)}</dd>
            </div>
          </dl>

          <section aria-labelledby="model-observations-heading">
            <h3 id="model-observations-heading">{t('providerEvidence')}</h3>
            <div class="model-observations">
              {#each model.observations as observation (observation.id)}
                <article>
                  <strong>
                    {authorityLabel(observation.authority)} ·
                    {timePrecisionLabel(observation.timePrecision)}
                  </strong>
                  <span>{formatReset(observation.observedAt)}</span>
                  <small>{t('scope')} {usageScopeLabel(observation.usageScope)}</small>
                  <small>
                    {t('aggregationTemporality')}
                    {aggregationTemporalityLabel(observation.aggregationTemporality)}
                  </small>
                  <small>{t('recordedTotal')} {formatNumber(observation.recordedTokens)}</small>
                  <small>{t('classified')} {formatNumber(observation.classifiedTokens)}</small>
                  <small>{t('unclassified')} {formatNumber(observation.unclassifiedTokens)}</small>
                  <small>
                    {t('sourceReportedTotal')}
                    {observation.sourceReportedTotalTokens === null
                      ? t('notAvailable')
                      : formatNumber(observation.sourceReportedTotalTokens)}
                  </small>
                  <small
                    >{t('semantics')} · {tokenSemanticsSummary(observation.tokenSemantics)}</small
                  >
                </article>
              {/each}
            </div>
          </section>

          <section aria-labelledby="model-pricing-heading">
            <h3 id="model-pricing-heading">{t('priceLineItems')}</h3>
            {#if model.priceEvidence.length === 0}
              <p class="model-evidence-empty">{t('noPriceEvidence')}</p>
            {:else}
              {#each model.priceEvidence as price (price.id)}
                <article class="model-price-evidence">
                  <div>
                    <strong>{formatMoney(price.amount, price.currency)}</strong>
                    <span
                      >{authorityLabel(price.authority)} · {formatReset(
                        price.observedAt ?? null
                      )}</span
                    >
                  </div>
                  {#each price.lineItems as line (`${price.id}:${line.tokenKind}`)}
                    <p>
                      {tokenKindLabel(line.tokenKind)} · {formatNumber(line.tokens)} ·
                      {formatMoney(line.amount, price.currency)}
                      <small>{formatMoney(line.ratePerMillion, price.currency)} / 1M</small>
                    </p>
                  {/each}
                  {#if price.priceSnapshot}
                    <small>
                      {price.priceSnapshot.version} · {price.priceSnapshot.source} ·
                      {t('priceEffective')}
                      {formatReset(price.priceSnapshot.effectiveAt)}
                    </small>
                  {/if}
                  {#if price.calculatedAt}
                    <small>{t('calculatedAt')}: {formatReset(price.calculatedAt)}</small>
                  {/if}
                </article>
              {/each}
            {/if}
          </section>

          <section aria-labelledby="model-trend-heading">
            <h3 id="model-trend-heading">{t('modelTrend')}</h3>
            <table class="model-trend-table" aria-label={t('modelTrend')}>
              <thead>
                <tr
                  ><th>{t('interval')}</th><th>{t('tokens')}</th><th>{t('apiRetailEquivalent')}</th
                  ><th>{t('providerEvidence')}</th></tr
                >
              </thead>
              <tbody>
                {#each model.trend as bucket (bucket.start)}
                  <tr>
                    <td>{bucket.label}</td>
                    {#if bucket.gap}
                      <td colspan="3">{t('gap')}</td>
                    {:else}
                      <td>{formatNumber(bucket.tokenTotals.total)}</td>
                      <td>
                        {bucket.retailEquivalent.status === 'available'
                          ? formatMoney(
                              bucket.retailEquivalent.amount,
                              bucket.retailEquivalent.comparisonCurrency
                            )
                          : t('notAvailable')}
                      </td>
                      <td>
                        {displayAuthorities(bucket.authorities)} ·
                        {formatReset(bucket.lastObservedAt ?? null)}
                        {#if bucket.retailEquivalent.status === 'available'}
                          <br />{displayAuthorities(bucket.retailEquivalent.authorities)} ·
                          {formatReset(bucket.retailEquivalent.observedAt ?? null)}
                        {/if}
                      </td>
                    {/if}
                  </tr>
                {/each}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  {/if}
{/key}

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html) {
    --page: #f5f5f2;
    --surface: #ffffff;
    --surface-subtle: #f7f7f4;
    --surface-inset: #eeeeea;
    --text: #171817;
    --text-strong: #080908;
    --muted: #60645f;
    --border: #d7d8d2;
    --border-soft: #e5e5df;
    --button: #ffffff;
    --selected: #e5e8f0;
    --selected-text: #18213a;
    --primary: #4f64c4;
    --progress-track: #dedfd9;
    --backdrop: rgba(18, 19, 18, 0.45);
    --warning-bg: #fff8ed;
    --warning-border: #d9b47d;
    --warning-text: #74400f;
    --danger-bg: #fff4f2;
    --danger-border: #d8a29e;
    --danger-text: #922f2b;
    --focus: #315fd3;
    color-scheme: light dark;
    background: var(--page);
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
    overflow-x: hidden;
    background: var(--page);
    color: var(--text);
  }

  .shell {
    width: min(1600px, calc(100% - 40px));
    margin: 0 auto;
    padding: 48px 0 80px;
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
    font-size: clamp(2.5rem, 4.6vw, 4.2rem);
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

  .locale-toggle,
  .settings-toggle {
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid #2c3342;
    border-radius: 999px;
    background: rgba(20, 24, 32, 0.8);
    color: #aeb6c4;
    cursor: pointer;
  }

  .settings-toggle {
    color: #e8ebf2;
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    margin-bottom: 48px;
  }

  .token-money-workbench {
    margin-bottom: 48px;
    padding: 20px;
    border: 1px solid rgba(122, 136, 164, 0.2);
    border-radius: 18px;
    background: rgba(14, 17, 24, 0.88);
  }

  .workbench-heading,
  .trend-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }

  .workbench-heading {
    margin-bottom: 16px;
  }

  .workbench-heading h2,
  .workbench-heading p,
  .trend-heading span,
  .trend-heading strong {
    margin: 0;
  }

  .workbench-heading h2 {
    margin-top: 5px;
    font-size: 1.12rem;
  }

  .workbench-heading > div > p:not(.eyebrow) {
    max-width: 720px;
    margin-top: 7px;
    color: #929baa;
    font-size: 0.72rem;
    line-height: 1.45;
  }

  .segmented-control {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    border: 1px solid rgba(122, 136, 164, 0.18);
    border-radius: 11px;
    background: rgba(8, 10, 15, 0.58);
  }

  .segmented-control button {
    min-height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: #929baa;
    cursor: pointer;
    font-size: 0.7rem;
  }

  .segmented-control button[aria-pressed='true'] {
    background: #29324b;
    color: #eef2ff;
  }

  .workbench-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .workbench-metrics article {
    display: grid;
    align-content: start;
    gap: 7px;
    min-height: 158px;
    padding: 13px;
    border: 1px solid rgba(122, 136, 164, 0.14);
    border-radius: 13px;
    background: rgba(20, 24, 33, 0.72);
  }

  .workbench-metrics span,
  .workbench-metrics small,
  .trend-heading span {
    color: #929baa;
    font-size: 0.68rem;
  }

  .workbench-metrics strong {
    overflow-wrap: anywhere;
    color: #f2f4f8;
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
    font-weight: 650;
  }

  .workbench-trend {
    margin-top: 12px;
    padding: 14px;
    border: 1px solid rgba(122, 136, 164, 0.14);
    border-radius: 14px;
    background: rgba(8, 10, 15, 0.32);
  }

  .trend-heading > div:first-child {
    display: grid;
    gap: 4px;
  }

  .trend-heading strong {
    color: #e6eaf2;
    font-size: 0.84rem;
  }

  .trend-chart {
    display: grid;
    grid-auto-columns: minmax(24px, 1fr);
    grid-auto-flow: column;
    gap: 5px;
    min-height: 152px;
    margin-top: 16px;
    overflow-x: auto;
  }

  .trend-column {
    display: grid;
    grid-template-rows: 124px auto;
    gap: 6px;
    min-width: 24px;
  }

  .trend-stack {
    display: flex;
    flex-direction: column-reverse;
    justify-content: flex-start;
    overflow: hidden;
    border-bottom: 1px solid rgba(122, 136, 164, 0.22);
    border-radius: 5px 5px 0 0;
    background: rgba(255, 255, 255, 0.018);
  }

  .trend-stack.trend-gap {
    align-items: center;
    justify-content: center;
    border-bottom-style: dashed;
  }

  .trend-segment {
    display: block;
    min-height: 2px;
    flex: none;
    opacity: 0.9;
  }

  .gap-marker,
  .trend-column small {
    color: #687283;
    font-size: 0.6rem;
    text-align: center;
  }

  .trend-column small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trend-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    margin-top: 10px;
  }

  .trend-legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #929baa;
    font-size: 0.64rem;
  }

  .trend-legend i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .trend-data {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    border: 0;
    white-space: nowrap;
  }

  .model-ranking {
    margin-top: 12px;
    padding: 14px;
    border: 1px solid rgba(122, 136, 164, 0.14);
    border-radius: 14px;
    background: rgba(8, 10, 15, 0.32);
  }

  .ranking-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 12px;
  }

  .ranking-heading h3,
  .ranking-heading p {
    margin: 0;
  }

  .ranking-heading h3 {
    color: #e6eaf2;
    font-size: 0.9rem;
  }

  .ranking-heading p {
    max-width: 660px;
    margin-top: 5px;
    color: #8993a3;
    font-size: 0.68rem;
  }

  .ranking-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ranking-list button {
    display: grid;
    grid-template-columns: minmax(180px, 1.6fr) minmax(120px, 0.8fr) minmax(120px, 0.8fr);
    align-items: center;
    width: 100%;
    min-height: 64px;
    padding: 10px 12px;
    border: 1px solid rgba(122, 136, 164, 0.12);
    border-radius: 11px;
    background: rgba(255, 255, 255, 0.018);
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .ranking-list button:hover,
  .ranking-list button:focus-visible {
    border-color: rgba(112, 137, 239, 0.52);
    outline: none;
    background: rgba(81, 104, 186, 0.1);
  }

  .ranking-identity,
  .ranking-identity > span,
  .ranking-value {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .ranking-identity {
    grid-template-columns: 34px minmax(0, 1fr);
    align-items: center;
  }

  .ranking-identity img {
    width: 30px;
    height: 30px;
    padding: 4px;
    object-fit: contain;
  }

  .ranking-logo {
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
  }

  .ranking-logo img {
    display: block;
    width: 100%;
    height: 100%;
    padding: 3px;
    object-fit: contain;
  }

  .ranking-logo[data-provider-logo='codex'] {
    border-radius: 6px;
    background: #fff;
  }

  .ranking-identity strong {
    overflow: hidden;
    color: #edf0f6;
    font-size: 0.78rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ranking-identity small,
  .ranking-value small {
    color: #8993a3;
    font-size: 0.64rem;
  }

  .ranking-value {
    justify-items: end;
    font-variant-numeric: tabular-nums;
  }

  .ranking-value strong {
    color: #dce2ec;
    font-size: 0.76rem;
  }

  .unclassified-usage {
    display: grid;
    gap: 6px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed rgba(122, 136, 164, 0.18);
  }

  .unclassified-usage > strong {
    color: #aab2c0;
    font-size: 0.68rem;
  }

  .unclassified-usage > span {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #8993a3;
    font-size: 0.66rem;
  }

  .unclassified-usage b {
    margin-left: auto;
    color: #dce2ec;
  }

  .unclassified-usage small {
    width: 52px;
    text-align: right;
  }

  .global-summary {
    margin-bottom: 18px;
    padding: 18px;
    border: 1px solid rgba(122, 136, 164, 0.2);
    border-radius: 18px;
    background: rgba(14, 17, 24, 0.84);
  }

  .global-summary-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 16px;
  }

  .global-summary-heading .eyebrow,
  .global-summary-heading h2 {
    margin: 0;
  }

  .global-summary-heading h2 {
    margin-top: 5px;
    font-size: 1rem;
  }

  .summary-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .summary-metrics article {
    display: grid;
    align-content: start;
    gap: 7px;
    min-height: 112px;
    padding: 13px;
    border: 1px solid rgba(122, 136, 164, 0.14);
    border-radius: 13px;
    background: rgba(20, 24, 33, 0.72);
  }

  .summary-metrics span,
  .summary-metrics small {
    color: #929baa;
    font-size: 0.7rem;
  }

  .summary-metrics strong {
    overflow-wrap: anywhere;
    color: #f2f4f8;
    font-size: 1.04rem;
    font-weight: 650;
  }

  .summary-contributions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .summary-contributions span {
    display: inline-flex;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid rgba(122, 136, 164, 0.14);
    border-radius: 999px;
    color: #929baa;
    font-size: 0.66rem;
  }

  .summary-contributions b {
    color: #dce1ea;
    font-weight: 650;
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

  .global-summary .history-toolbar {
    margin: 0;
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

  .risk-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 18px;
    padding: 12px 14px;
    border: 1px solid var(--warning-border);
    border-radius: 13px;
    background: var(--warning-bg);
    color: var(--warning-text);
  }

  .risk-banner > div {
    display: grid;
    gap: 4px;
  }

  .risk-banner span {
    color: var(--warning-text);
    font-size: 0.74rem;
  }

  .risk-banner button,
  .degraded button {
    min-height: 32px;
    padding: 0 11px;
    border: 1px solid var(--warning-border);
    border-radius: 9px;
    background: transparent;
    color: var(--warning-text);
    cursor: pointer;
    font-size: 0.7rem;
  }

  .inline-error,
  .settings-error {
    margin: 0 0 14px;
    padding: 10px 12px;
    border: 1px solid var(--danger-border);
    border-radius: 10px;
    background: var(--danger-bg);
    color: var(--danger-text);
    font-size: 0.74rem;
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
    border-color: #4e62bd;
    background: #4e62bd;
    color: white;
  }

  .connection-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .provider-card,
  .state {
    border: 1px solid var(--border);
    border-radius: 18px;
    background: var(--surface);
    box-shadow: 0 8px 24px rgba(15, 18, 16, 0.06);
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
    border: 1px solid var(--warning-border);
    border-radius: 12px;
    background: var(--warning-bg);
    color: var(--warning-text);
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

  .token-total {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border: 1px solid rgba(122, 136, 164, 0.12);
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.018);
  }

  .token-total span,
  .token-breakdown summary {
    color: #858e9e;
    font-size: 0.68rem;
  }

  .token-total strong {
    color: #e6eaf1;
    font-size: 1.18rem;
    font-variant-numeric: tabular-nums;
  }

  .token-breakdown {
    margin-top: 8px;
  }

  .token-breakdown summary {
    width: fit-content;
    cursor: pointer;
  }

  .token-breakdown .tokens {
    margin-top: 8px;
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
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    flex: 0 0 46px;
    padding: 5px;
    border-radius: 9px;
    background: transparent;
  }

  .provider-logo img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .provider-logo[data-provider-logo='codex'] {
    padding: 8px;
    background: #fff;
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
    background: var(--progress-track);
  }

  .progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--primary);
  }

  .progress.progress-warning span {
    background: #b06a16;
  }

  .progress.progress-critical span {
    background: #c2413b;
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
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    color: #858e9e;
    font-size: 0.68rem;
  }

  .history-rankings b {
    color: #d9deea;
    font-variant-numeric: tabular-nums;
  }

  .history-rankings small {
    grid-column: 1 / -1;
    color: #717b8c;
    font-size: 0.6rem;
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

  .connected-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 18px 0 4px;
    padding: 10px 12px;
    border: 1px solid rgba(73, 208, 151, 0.18);
    border-radius: 12px;
    background: rgba(15, 27, 23, 0.58);
  }

  .connected-summary > span {
    display: grid;
    gap: 2px;
    color: #72ddaf;
    font-size: 0.72rem;
  }

  .connected-summary small {
    color: #859188;
  }

  .connected-summary button {
    min-height: 30px;
    padding: 0 10px;
    border: 1px solid #303747;
    border-radius: 9px;
    background: transparent;
    color: #aeb6c4;
    cursor: pointer;
    font-size: 0.7rem;
  }

  .settings-backdrop {
    position: fixed;
    z-index: 40;
    inset: 0;
    display: flex;
    justify-content: flex-end;
    background: var(--backdrop);
    backdrop-filter: blur(8px);
  }

  .model-detail-backdrop {
    position: fixed;
    z-index: 50;
    inset: 0;
    display: flex;
    justify-content: flex-end;
    background: var(--backdrop);
    backdrop-filter: blur(8px);
  }

  .model-detail-drawer {
    width: min(620px, 100%);
    height: 100%;
    overflow-y: auto;
    border-left: 1px solid rgba(122, 136, 164, 0.22);
    outline: none;
    background: var(--surface);
    box-shadow: -18px 0 48px rgba(0, 0, 0, 0.16);
  }

  .model-detail-header {
    position: sticky;
    z-index: 2;
    top: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    padding: 26px 28px 20px;
    border-bottom: 1px solid rgba(122, 136, 164, 0.16);
    background: rgba(11, 14, 20, 0.95);
    backdrop-filter: blur(18px);
  }

  .model-detail-header h2,
  .model-detail-header p {
    margin: 0;
  }

  .model-detail-header h2 {
    margin-top: 5px;
    overflow-wrap: anywhere;
    font-size: 1.08rem;
  }

  .model-detail-header button {
    width: 36px;
    height: 36px;
    border: 1px solid rgba(122, 136, 164, 0.2);
    border-radius: 9px;
    background: transparent;
    color: #d8dde7;
    cursor: pointer;
    font-size: 1.15rem;
  }

  .model-detail-content {
    display: grid;
    gap: 22px;
    padding: 22px 28px 48px;
  }

  .model-detail-content section h3 {
    margin: 0 0 10px;
    color: #dfe4ed;
    font-size: 0.8rem;
  }

  .model-detail-summary,
  .model-token-breakdown {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .model-detail-summary span,
  .model-token-breakdown div,
  .model-observations article,
  .model-price-evidence {
    padding: 11px;
    border: 1px solid rgba(122, 136, 164, 0.13);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.018);
  }

  .model-detail-summary span {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: #8e98a8;
    font-size: 0.68rem;
  }

  .model-detail-summary b {
    color: #e0e5ed;
    font-variant-numeric: tabular-nums;
  }

  .model-detail-evidence {
    margin: -14px 0 0;
    color: #8e98a8;
    font-size: 0.7rem;
  }

  .model-token-breakdown {
    margin: 0;
  }

  .model-observations {
    display: grid;
    gap: 7px;
  }

  .model-observations article {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 5px 10px;
    color: #dce2eb;
    font-size: 0.7rem;
  }

  .model-observations span,
  .model-observations small,
  .model-price-evidence span,
  .model-price-evidence small {
    color: #8791a1;
    font-size: 0.64rem;
  }

  .model-price-evidence + .model-price-evidence {
    margin-top: 7px;
  }

  .model-price-evidence > div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 9px;
  }

  .model-price-evidence p {
    display: flex;
    gap: 6px;
    margin: 5px 0;
    color: #d6dce6;
    font-size: 0.68rem;
  }

  .model-price-evidence p small {
    margin-left: auto;
  }

  .model-price-evidence > small {
    display: block;
    margin-top: 6px;
  }

  .model-evidence-empty {
    margin: 0;
    padding: 12px;
    border: 1px dashed rgba(122, 136, 164, 0.18);
    border-radius: 10px;
    color: #8791a1;
    font-size: 0.7rem;
  }

  .model-trend-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.66rem;
  }

  .model-trend-table th,
  .model-trend-table td {
    padding: 7px 8px;
    border-bottom: 1px solid rgba(122, 136, 164, 0.12);
    color: #9aa4b3;
    text-align: left;
  }

  .model-trend-table th {
    color: #d2d8e2;
    font-weight: 600;
  }

  .settings-drawer {
    width: min(680px, 100%);
    height: 100%;
    overflow-y: auto;
    border-left: 1px solid rgba(122, 136, 164, 0.22);
    outline: none;
    background: var(--surface);
    box-shadow: -18px 0 48px rgba(0, 0, 0, 0.16);
  }

  .settings-header {
    position: sticky;
    z-index: 2;
    top: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    padding: 28px 30px 22px;
    border-bottom: 1px solid rgba(122, 136, 164, 0.16);
    background: rgba(11, 14, 20, 0.94);
    backdrop-filter: blur(18px);
  }

  .settings-header h2,
  .settings-header p {
    margin: 0;
  }

  .settings-header > div > p:last-child {
    margin-top: 7px;
    color: #929baa;
    font-size: 0.76rem;
  }

  .settings-close {
    width: 38px;
    height: 38px;
    border: 1px solid #303747;
    border-radius: 50%;
    background: transparent;
    color: #d9dee8;
    cursor: pointer;
    font-size: 1.35rem;
    line-height: 1;
  }

  .settings-content {
    display: grid;
    gap: 18px;
    padding: 24px 30px 48px;
  }

  .settings-content > section {
    padding: 18px;
    border: 1px solid rgba(122, 136, 164, 0.17);
    border-radius: 17px;
    background: rgba(14, 17, 24, 0.78);
  }

  .settings-section-heading {
    margin-bottom: 14px;
  }

  .settings-section-heading h2,
  .settings-section-heading p {
    margin: 0;
  }

  .settings-section-heading p {
    margin-top: 6px;
    color: #929baa;
    font-size: 0.74rem;
    line-height: 1.45;
  }

  .settings-connections {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
  }

  .settings-connections article {
    padding: 12px;
    border: 1px solid rgba(122, 136, 164, 0.13);
    border-radius: 12px;
    outline: none;
    background: rgba(255, 255, 255, 0.018);
  }

  .settings-connector-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .settings-connector-title span,
  .settings-connections small {
    color: #929baa;
    font-size: 0.66rem;
  }

  .settings-connections article > p {
    min-height: 42px;
    margin: 9px 0;
    color: #aab1bf;
    font-size: 0.7rem;
    line-height: 1.45;
  }

  .settings-drawer .monitoring-section,
  .settings-drawer .diagnostics-section,
  .settings-drawer .privacy-section {
    display: block;
    margin: 0;
  }

  .settings-drawer .monitoring-controls,
  .settings-drawer .privacy-actions {
    justify-content: flex-start;
  }

  .settings-drawer .privacy-section > small {
    display: block;
    margin-bottom: 12px;
    color: #8f98a8;
    font-size: 0.72rem;
  }

  .settings-target-active,
  [data-settings-target]:focus-visible {
    border-color: #6f89ef !important;
    box-shadow: 0 0 0 3px rgba(98, 126, 239, 0.17);
  }

  /* Theme surfaces stay neutral so Provider identity comes from official artwork and data. */
  .global-summary,
  .token-money-workbench,
  .privacy-section,
  .monitoring-section,
  .settings-content > section {
    border-color: var(--border);
    background: var(--surface);
  }

  .summary-metrics article,
  .workbench-metrics article,
  .workbench-trend,
  .model-ranking,
  .ranking-list button,
  .billing-records div,
  .history-rankings > div,
  .tokens div,
  .inline-connection,
  .token-unavailable,
  .settings-connections article,
  .model-detail-summary span,
  .model-token-breakdown div,
  .model-observations article,
  .model-price-evidence {
    border-color: var(--border-soft);
    background: var(--surface-subtle);
  }

  .segmented-control,
  .history-toolbar,
  .domain-tabs,
  .trend-stack {
    border-color: var(--border-soft);
    background: var(--surface-inset);
  }

  .refresh,
  .locale-toggle,
  .settings-toggle {
    border-color: var(--border);
    background: var(--button);
    color: var(--text);
  }

  .risk-banner span,
  .degraded code {
    color: var(--warning-text);
  }

  .refresh:hover:not(:disabled) {
    border-color: var(--primary);
    background: var(--surface-subtle);
  }

  .segmented-control button,
  .history-toolbar button,
  .domain-tabs button,
  .eyebrow,
  .section-label,
  .subtitle,
  .workbench-heading > div > p:not(.eyebrow),
  .workbench-metrics span,
  .workbench-metrics small,
  .trend-heading span,
  .gap-marker,
  .trend-column small,
  .trend-legend span,
  .ranking-heading p,
  .ranking-identity small,
  .ranking-value small,
  .unclassified-usage > strong,
  .unclassified-usage > span,
  .summary-metrics span,
  .summary-metrics small,
  .summary-contributions span,
  .risk-banner span,
  .privacy-section > div > p:not(.eyebrow),
  .privacy-section small,
  .diagnostics-grid span,
  .diagnostics-grid small,
  .diagnostics-grid p,
  .monitoring-section > div > p:last-child,
  .connection-meta,
  .coverage-list,
  .inline-connection summary,
  .permission,
  .secret-field,
  .connection-actions button,
  .token-scope,
  .token-unavailable,
  .freshness,
  .quota-copy span,
  .quota-meta,
  dt,
  .billing-records small,
  .rate-evidence,
  .history-rankings strong,
  .history-rankings span,
  .model-detail-summary span,
  .model-observations span,
  .model-observations small,
  .model-price-evidence span,
  .model-price-evidence small,
  .model-evidence-empty,
  .model-trend-table th,
  .model-trend-table td,
  .settings-header > div > p:last-child,
  .settings-section-heading p,
  .settings-connector-title span,
  .settings-connections small,
  .settings-connections article > p,
  .settings-drawer .privacy-section > small {
    color: var(--muted);
  }

  .workbench-metrics strong,
  .trend-heading strong,
  .ranking-heading h3,
  .ranking-identity strong,
  .ranking-value strong,
  .unclassified-usage b,
  .summary-metrics strong,
  .summary-contributions b,
  .inline-connection summary strong,
  .coverage-list strong,
  .token-unavailable strong,
  .history-rankings b,
  .model-detail-header button,
  .model-detail-content section h3,
  .model-detail-summary b,
  .model-observations article,
  .model-price-evidence p,
  .model-trend-table th,
  .settings-close {
    color: var(--text-strong);
  }

  .segmented-control button[aria-pressed='true'],
  .history-toolbar button[aria-pressed='true'],
  .domain-tabs button[aria-selected='true'] {
    background: var(--selected);
    color: var(--selected-text);
  }

  .secret-field input {
    border-color: var(--border);
    background: var(--surface-inset);
    color: var(--text);
  }

  .model-detail-header,
  .settings-header {
    border-color: var(--border);
    background: color-mix(in srgb, var(--surface) 94%, transparent);
  }

  @media (prefers-color-scheme: dark) {
    :global(html) {
      --page: #0d0f11;
      --surface: #15181b;
      --surface-subtle: #1b1f23;
      --surface-inset: #101316;
      --text: #eef0f2;
      --text-strong: #ffffff;
      --muted: #a1a8b1;
      --border: #353b42;
      --border-soft: #292e34;
      --button: #171a1e;
      --selected: #293249;
      --selected-text: #f2f5ff;
      --primary: #7d93ef;
      --progress-track: #2a3036;
      --backdrop: rgba(3, 5, 7, 0.7);
      --warning-bg: #211912;
      --warning-border: #684722;
      --warning-text: #f0bd83;
      --danger-bg: #241416;
      --danger-border: #71363a;
      --danger-text: #ffaaa5;
      --focus: #9bb1ff;
    }

    .provider-card,
    .state {
      box-shadow: none;
    }
  }

  @media (min-width: 1640px) {
    .providers {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .provider-card {
      padding: 20px;
    }

    .tokens {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 759px) {
    .providers {
      grid-template-columns: 1fr;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  :global(button:focus-visible),
  :global(a[href]:focus-visible),
  :global(input:focus-visible),
  :global(select:focus-visible),
  :global(textarea:focus-visible),
  :global(summary:focus-visible),
  :global([tabindex]:focus-visible) {
    outline: 3px solid var(--focus) !important;
    outline-offset: 2px;
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

    .settings-header,
    .settings-content {
      padding-right: 18px;
      padding-left: 18px;
    }

    .settings-connections {
      grid-template-columns: 1fr;
    }

    .tokens {
      grid-template-columns: repeat(2, 1fr);
    }

    .global-summary-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .summary-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .workbench-heading,
    .trend-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .workbench-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .ranking-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .ranking-list button {
      grid-template-columns: 1fr;
      gap: 9px;
    }

    .ranking-value {
      grid-template-columns: 1fr auto;
      justify-items: stretch;
    }

    .model-detail-header,
    .model-detail-content {
      padding-right: 18px;
      padding-left: 18px;
    }

    .quota-meta {
      align-items: flex-start;
      flex-direction: column;
      gap: 4px;
    }

    .monitoring-section {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(*),
    :global(*::before),
    :global(*::after) {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      transition-delay: 0ms !important;
    }

    .spin {
      animation: none !important;
    }
  }
</style>
