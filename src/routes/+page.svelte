<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';

  import type {
    BillingDomainOverview,
    CoverageLevel,
    DataAuthority,
    BillingHistory,
    DoctorReport,
    HistoryWindow,
    MonitoringSettings,
    ProcessingStatus,
    ProviderOverview,
    QuotaBucket,
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
  import {
    createAutomaticRecoveryController,
    isAutomaticallyManagedCategory
  } from '$lib/automatic-recovery.js';
  import { detectLocale, translate, type Locale, type MessageKey } from '$lib/i18n.js';
  import ProviderShareChart from '$lib/ProviderShareChart.svelte';
  import UsageTrendChart from '$lib/UsageTrendChart.svelte';
  import '$lib/dashboard-polish.css';

  let locale: Locale = 'en';
  let metaDescription: string;
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
  let activeDashboardView: 'agents' | 'models' = 'agents';
  let selectedWindow: HistoryWindow = '7d';
  let selectedCurrency: 'CNY' | 'USD' = 'CNY';
  let selectedTrendMetric: 'tokens' | 'retail-equivalent' = 'retail-equivalent';
  let breakdownDimension: 'model' | 'day' = 'model';
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
  let hardRebuilding = false;
  let workbenchLoading = false;
  let processing: ProcessingStatus | null = null;
  let processingTimer: ReturnType<typeof setInterval> | null = null;
  let settingsOpen = false;
  let settingsTarget: string | null = null;
  let settingsButton: HTMLButtonElement | null = null;
  let settingsReturnFocus: HTMLElement | null = null;
  let settingsPanel: HTMLElement | null = null;
  let selectedModelEntry: UsageOverview['workbench']['modelRanking']['entries'][number] | null;
  let destroyed = false;
  let overviewRequestSequence = 0;
  let workbenchRequestSequence = 0;
  const automaticRecoveryController = createAutomaticRecoveryController(() => automaticRefresh());

  $: metaDescription = translate(locale, 'metaDescription');

  $: selectedModelEntry =
    overview?.workbench?.modelRanking.entries.find((entry) => entry.id === selectedModelId) ?? null;

  onMount(async () => {
    locale = detectLocale(navigator.language);
    document.documentElement.lang = locale;
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    selectedWindow = storedWindow();
    selectedCurrency = storedCurrency();
    await Promise.all([
      loadOverview(),
      loadConnectors(),
      loadMonitoring(),
      loadRetention(),
      loadProcessing()
    ]);
    if (!diagnostics) await loadDiagnostics();
    startProcessingPolling();
    const deepLink = new URL(window.location.href).searchParams.get('settings');
    if (deepLink) await openSettings(deepLink, false);
  });

  onDestroy(() => {
    destroyed = true;
    if (processingTimer) clearInterval(processingTimer);
    automaticRecoveryController.dispose();
  });

  function t(key: MessageKey): string {
    return translate(locale, key);
  }

  function breakdownShareLabel(dimension: 'model' | 'day'): string {
    if (selectedTrendMetric === 'tokens') return t('tokenShare');
    return t(dimension === 'model' ? 'costShare' : 'retailShare');
  }

  function toggleLocale(): void {
    locale = locale === 'en' ? 'zh-CN' : 'en';
    document.documentElement.lang = locale;
  }

  async function loadOverview(): Promise<void> {
    const requestSequence = ++overviewRequestSequence;
    const requestedWindow = selectedWindow;
    const requestedCurrency = selectedCurrency;
    try {
      const parameters = new URLSearchParams({
        window: requestedWindow,
        timeZone,
        currency: requestedCurrency
      });
      const response = await fetch(`/api/overview?${parameters}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextOverview = (await response.json()) as UsageOverview;
      if (destroyed || requestSequence !== overviewRequestSequence) return;
      overview = nextOverview;
      overviewError = false;
      scheduleAutomaticRecovery();
    } catch {
      if (requestSequence === overviewRequestSequence) overviewError = true;
    } finally {
      if (!destroyed && requestSequence === overviewRequestSequence) loading = false;
    }
  }

  async function refresh(): Promise<void> {
    await performRefresh('manual');
  }

  async function automaticRefresh(): Promise<void> {
    await performRefresh('automatic');
  }

  async function performRefresh(mode: 'manual' | 'automatic'): Promise<void> {
    refreshing = true;
    try {
      const endpoint = mode === 'automatic' ? '/api/refresh?mode=automatic' : '/api/refresh';
      const response = await fetch(endpoint, { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await Promise.all([loadOverview(), loadDiagnostics()]);
      refreshError = false;
    } catch {
      refreshError = true;
    } finally {
      if (!destroyed) {
        refreshing = false;
        scheduleAutomaticRecovery();
      }
    }
  }

  function scheduleAutomaticRecovery(): void {
    if (destroyed || !overview) return;
    automaticRecoveryController.schedule(overview, diagnostics, refreshing);
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
      const nextDiagnostics = (await response.json()) as DoctorReport;
      if (destroyed) return;
      diagnostics = nextDiagnostics;
      diagnosticsError = false;
      scheduleAutomaticRecovery();
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

  async function loadProcessing(): Promise<void> {
    try {
      const response = await fetch('/api/processing');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = (await response.json()) as ProcessingStatus;
      const previous = processing;
      processing = next;
      if (next.modules.discovery.state === 'running') void loadConnectors();
      if (next.modules.usage.state === 'running') void loadOverview();
      if (
        previous?.modules.discovery.state !== 'ready' &&
        next.modules.discovery.state === 'ready'
      ) {
        void loadConnectors();
      }
      if (
        (previous?.modules.usage.state !== 'ready' && next.modules.usage.state === 'ready') ||
        (previous?.modules.pricing.state !== 'ready' && next.modules.pricing.state === 'ready')
      ) {
        void loadOverview();
      }
      if (
        previous?.modules.retention.state !== 'ready' &&
        next.modules.retention.state === 'ready'
      ) {
        void loadRetention();
      }
      hardRebuilding =
        next.hardRebuild &&
        Object.values(next.modules).some(
          (module) => module.state === 'pending' || module.state === 'running'
        );
      if (
        processingTimer &&
        Object.values(next.modules).every(
          (module) => module.state === 'ready' || module.state === 'failed'
        )
      ) {
        clearInterval(processingTimer);
        processingTimer = null;
      }
    } catch {
      // Processing progress is optional; cached data remains usable.
    }
  }

  function startProcessingPolling(): void {
    if (processingTimer) return;
    if (
      processing &&
      Object.values(processing.modules).every(
        (module) => module.state === 'ready' || module.state === 'failed'
      )
    ) {
      return;
    }
    processingTimer = setInterval(() => void loadProcessing(), 1_000);
  }

  async function hardRebuild(): Promise<void> {
    if (!window.confirm(t('hardRebuildConfirmation'))) return;
    hardRebuilding = true;
    try {
      const response = await fetch('/api/rebuild', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmExpensiveOperation: true })
      });
      if (response.status !== 202) throw new Error(`HTTP ${response.status}`);
      await loadProcessing();
      startProcessingPolling();
      privacyActionError = false;
    } catch {
      hardRebuilding = false;
      privacyActionError = true;
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

  async function selectWindow(window: HistoryWindow): Promise<void> {
    if (selectedWindow === window && !workbenchLoading) return;
    selectedWindow = window;
    try {
      localStorage.setItem('agent-usage:history-window', window);
    } catch {
      // A disabled local preference store must not block usage queries.
    }
    const requestSequence = ++workbenchRequestSequence;
    workbenchLoading = true;
    try {
      await loadOverview();
    } finally {
      if (requestSequence === workbenchRequestSequence) workbenchLoading = false;
    }
  }

  async function selectCurrency(currency: 'CNY' | 'USD'): Promise<void> {
    if (selectedCurrency === currency) return;
    selectedCurrency = currency;
    try {
      localStorage.setItem('agent-usage:comparison-currency', currency);
    } catch {
      // A disabled local preference store must not block usage queries.
    }
    const requestSequence = ++workbenchRequestSequence;
    workbenchLoading = true;
    try {
      await loadOverview();
    } finally {
      if (requestSequence === workbenchRequestSequence) workbenchLoading = false;
    }
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
      },
      opencode: {
        dark: '/brands/opencode-dark.svg',
        light: '/brands/opencode-light.svg'
      },
      grok: {
        dark: '/brands/grok-light.svg',
        light: '/brands/grok-dark.svg'
      }
    };
    return paths[providerId] ?? null;
  }

  function displayProviders(
    currentOverview: UsageOverview,
    connectionStatuses: ConnectorStatus[]
  ): ProviderOverview[] {
    const providers = currentOverview.providers
      .filter((provider) => provider.id !== 'opencode')
      .map((provider) => ({
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

  function displayQuotaBuckets(buckets: QuotaBucket[]): QuotaBucket[] {
    const displayPriority = (bucket: QuotaBucket): number => {
      if (/\b5\s*hours?\b/i.test(bucket.label)) return 0;
      if (/\b(?:week|weekly)\b/i.test(bucket.label)) return 1;
      if (/\b(?:month|monthly)\b/i.test(bucket.label)) return 2;
      return 3;
    };

    return buckets
      .map((bucket, sourceIndex) => ({ bucket, sourceIndex }))
      .sort(
        (left, right) =>
          displayPriority(left.bucket) - displayPriority(right.bucket) ||
          left.sourceIndex - right.sourceIndex
      )
      .map(({ bucket }) => bucket);
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

  function formatMoney(amount: number | null, currency: string): string {
    if (amount === null) return '—';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: Math.abs(amount) > 0 && Math.abs(amount) < 0.01 ? 8 : 2
    }).format(amount);
  }

  function selectUsageMetric(metric: 'tokens' | 'retail-equivalent'): void {
    selectedTrendMetric = metric;
  }

  function formatWorkbenchRange(workbench: UsageOverview['workbench']): string {
    const formatter = new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: workbench.timeZone
    });
    return `${formatter.format(new Date(workbench.start))} – ${formatter.format(new Date(workbench.end))}`;
  }

  function formatUsageMetric(
    value: number | null,
    currency: string,
    metric: 'tokens' | 'retail-equivalent'
  ): string {
    if (value === null) return t('notAvailable');
    return metric === 'tokens'
      ? `${formatCompactNumber(value)} ${t('tokens')}`
      : formatMoney(value, currency);
  }

  function modelMetricShare(
    model: UsageOverview['workbench']['modelRanking']['entries'][number],
    metric: 'tokens' | 'retail-equivalent'
  ): number | null {
    if (model.includedInHeadline === false) return null;
    if (metric === 'tokens') return model.tokenShare;
    return model.retailEquivalent.amount === null && model.reportedEstimate.amount !== null
      ? model.reportedShare
      : model.retailShare;
  }

  function trendSegmentDescription(
    segment: UsageOverview['workbench']['trend']['buckets'][number]['segments'][number],
    metric: 'tokens' | 'retail-equivalent'
  ): string {
    const value =
      metric === 'tokens'
        ? `${formatNumber(segment.recordedTokens)} ${t('tokens')}`
        : [
            ...(segment.retailEquivalent.amount === null
              ? []
              : [
                  `${t('apiRetailEquivalent')}: ${formatMoney(
                    segment.retailEquivalent.amount,
                    segment.retailEquivalent.currency
                  )}`
                ]),
            ...(segment.reportedEstimate?.amount == null
              ? []
              : [
                  `${t('providerReportedEstimate')}: ${formatMoney(
                    segment.reportedEstimate.amount,
                    segment.reportedEstimate.currency
                  )}`
                ])
          ].join('; ') || t('notAvailable');
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
    metric: 'tokens' | 'retail-equivalent'
  ) {
    const ids =
      metric === 'tokens' ? workbench.modelRanking.byTokens : workbench.modelRanking.byCost;
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
  <link rel="icon" href="/brand/agent-usage-logo.svg" />
  <meta name="description" content={metaDescription} />
</svelte:head>

<svelte:window on:keydown={handleWindowKeydown} />

{#key locale}
  <main class="shell" inert={settingsOpen || selectedModelEntry !== null}>
    <header class="product-header">
      <img class="product-logo" src="/brand/agent-usage-logo.svg" alt={t('bannerAlt')} />
      <h1 class="visually-hidden">{t('title')}</h1>
      <div class="dashboard-tabs" role="tablist" aria-label={t('mainViews')}>
        <button
          id="agent-usage-tab"
          type="button"
          role="tab"
          aria-selected={activeDashboardView === 'agents'}
          aria-controls="agent-usage-panel"
          tabindex={activeDashboardView === 'agents' ? 0 : -1}
          on:click={() => (activeDashboardView = 'agents')}
          on:keydown={handleTablistKeydown}>{t('agentUsageTab')}</button
        >
        <button
          id="token-model-costs-tab"
          type="button"
          role="tab"
          aria-selected={activeDashboardView === 'models'}
          aria-controls="token-model-costs-panel"
          tabindex={activeDashboardView === 'models' ? 0 : -1}
          on:click={() => (activeDashboardView = 'models')}
          on:keydown={handleTablistKeydown}>{t('tokenModelCostsTab')}</button
        >
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
      <div class="state section-loading" aria-live="polite">
        {activeDashboardView === 'agents' ? t('loadingAgentUsage') : t('loadingModelCosts')}
      </div>
    {:else if overviewError && !overview}
      <div class="state error" role="alert">{t('error')}</div>
    {:else if overview}
      {@const overviewTokenEvidence = overviewTokenDisplayEvidence(overview)}
      {#if refreshError}
        <div class="inline-error" role="status">{t('refreshUnavailable')}</div>
      {/if}
      {#if overview.providers.length === 0}
        <div class="state compact">{t('noProviders')}</div>
      {/if}
      {#if activeDashboardView === 'agents'}
        <div
          id="agent-usage-panel"
          data-testid="agent-usage-panel"
          role="tabpanel"
          aria-labelledby="agent-usage-tab"
        >
          {#if processing?.modules.usage.state === 'running'}
            <p class="module-progress" role="status">{t('updatingAgentUsage')}</p>
          {/if}
          <section class="providers" aria-label={t('providersLabel')}>
            {#each displayProviders(overview, connectors) as provider (provider.id)}
              {@const logo = providerLogoSources(provider.id)}
              {@const selectedDomain = activeBillingDomain(
                provider,
                selectedBillingDomains[provider.id]
              )}
              {@const domainFreshness = selectedDomain.freshness ?? provider.freshness}
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
                      <p
                        class="freshness"
                        data-status={domainFreshness.status === 'unavailable'
                          ? 'unavailable'
                          : 'available'}
                      >
                        <span></span>
                        {domainFreshness.status === 'fresh'
                          ? t('updatedNow')
                          : domainFreshness.lastSuccessAt
                            ? t('updated')
                            : t('unavailable')}
                        {domainFreshness.lastSuccessAt
                          ? ` · ${formatReset(domainFreshness.lastSuccessAt)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div class="coverage">{coverageLevelLabel(domainCoverage.quota)}</div>
                </div>

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
                    {#each displayQuotaBuckets(domain.quotaBuckets) as bucket (bucket.id)}
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
                          aria-describedby={`quota-evidence-${provider.id}-${domain.id}-${bucket.id}`}
                        >
                          <span
                            style={`width: ${Math.min(100, Math.max(0, bucket.usedPercent ?? 0))}%`}
                          ></span>
                        </div>
                        <span hidden id={`quota-evidence-${provider.id}-${domain.id}-${bucket.id}`}>
                          {t('source')}: {authorityLabel(bucket.authority)} ·
                          {formatReset(
                            bucket.observedAt ??
                              domain.freshness?.lastSuccessAt ??
                              provider.freshness.lastSuccessAt
                          )}
                        </span>
                        <div class="quota-meta">
                          <span>
                            {t('resets')}
                            {formatReset(bucket.resetsAt)} · {formatRelativeReset(bucket.resetsAt)}
                          </span>
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
                            · {authorityLabel('estimate')} · {formatReset(
                              forecast.evidence.windowEnd
                            )}
                          </small>
                        </p>
                      {/each}
                    </div>
                  {/if}
                {/each}
              </article>
            {/each}
          </section>
        </div>
      {:else}
        <div
          id="token-model-costs-panel"
          data-testid="token-model-costs-panel"
          role="tabpanel"
          aria-labelledby="token-model-costs-tab"
        >
          {#if processing?.modules.pricing.state === 'running' && !workbenchLoading}
            <p class="module-progress" role="status">{t('updatingModelCosts')}</p>
          {/if}
          {#if overview.workbench}
            {@const workbench = overview.workbench}
            <section
              class="token-money-workbench"
              data-testid="token-money-workbench"
              aria-labelledby="token-money-workbench-heading"
            >
              <div class="usage-toolbar">
                <div>
                  <h2 id="token-money-workbench-heading">{t('tokenMoneyWorkbench')}</h2>
                  <p>
                    <strong>{t('usage')}</strong><span>/</span>{formatWorkbenchRange(workbench)}
                  </p>
                </div>
                <div class="workbench-controls">
                  <div class="segmented-control" role="group" aria-label={t('trendMetric')}>
                    <button
                      type="button"
                      aria-pressed={selectedTrendMetric === 'retail-equivalent'}
                      on:click={() => selectUsageMetric('retail-equivalent')}>{t('cost')}</button
                    >
                    <button
                      type="button"
                      aria-pressed={selectedTrendMetric === 'tokens'}
                      on:click={() => selectUsageMetric('tokens')}>{t('tokens')}</button
                    >
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
                  <div class="segmented-control" role="group" aria-label={t('displayCurrency')}>
                    {#each ['CNY', 'USD'] as currency (currency)}
                      <button
                        type="button"
                        aria-pressed={selectedCurrency === currency}
                        on:click={() => selectCurrency(currency as 'CNY' | 'USD')}
                        >{currency}</button
                      >
                    {/each}
                  </div>
                </div>
              </div>

              {#if workbenchLoading}
                <div
                  class="workbench-skeleton"
                  data-testid="workbench-skeleton"
                  role="status"
                  aria-label={t('updatingModelCosts')}
                >
                  <span class="visually-hidden">{t('updatingModelCosts')}</span>
                  <div class="skeleton-overview">
                    <div class="skeleton-summary">
                      <i class="skeleton-block skeleton-headline"></i>
                      <i class="skeleton-block skeleton-copy"></i>
                      <i class="skeleton-block skeleton-copy skeleton-copy-short"></i>
                      <i class="skeleton-block skeleton-provider"></i>
                      <i class="skeleton-block skeleton-provider"></i>
                    </div>
                    <div class="skeleton-chart">
                      <i class="skeleton-block skeleton-copy skeleton-copy-short"></i>
                      <i class="skeleton-block skeleton-graph"></i>
                    </div>
                  </div>
                  <div class="skeleton-totals">
                    {#each [0, 1, 2, 3, 4, 5] as skeleton (skeleton)}
                      <i class="skeleton-block"></i>
                    {/each}
                  </div>
                  <div class="skeleton-ranking">
                    <i class="skeleton-block skeleton-copy skeleton-copy-short"></i>
                    {#each [0, 1, 2, 3] as skeleton (skeleton)}
                      <i class="skeleton-block skeleton-row"></i>
                    {/each}
                  </div>
                </div>
              {/if}
              <section
                class:workbench-data-hidden={workbenchLoading}
                class="usage-summary-board"
                data-testid="usage-summary-board"
                aria-label={t('usageOverview')}
              >
                <div class="usage-headline" data-testid="usage-headline">
                  <strong
                    aria-label={selectedTrendMetric === 'tokens'
                      ? workbench.recordedTokens === null
                        ? t('notAvailable')
                        : tokenValueLabel(workbench.recordedTokens)
                      : formatMoney(
                          workbench.costs.retailEquivalent.amount,
                          workbench.comparisonCurrency
                        )}
                  >
                    {selectedTrendMetric === 'tokens'
                      ? workbench.recordedTokens === null
                        ? t('notAvailable')
                        : formatCompactNumber(workbench.recordedTokens)
                      : formatMoney(
                          workbench.costs.retailEquivalent.amount,
                          workbench.comparisonCurrency
                        )}
                  </strong>
                  <span data-testid="trend-mode">
                    {selectedTrendMetric === 'tokens'
                      ? t('recordedTokens')
                      : t('apiRetailEquivalent')}
                  </span>
                  {#if selectedTrendMetric === 'retail-equivalent'}
                    <small>
                      {t('apiRateEstimate')} · {t('pricingCoverage')}
                      {formatPercent(workbench.costs.retailEquivalent.pricingCoverage)} ·
                      {displayAuthorities(workbench.costs.retailEquivalent.authorities)} ·
                      {formatReset(workbench.costs.retailEquivalent.observedAt)}
                    </small>
                  {:else}
                    <small>
                      {displayAuthorities(overviewTokenEvidence.authorities)} ·
                      {formatReset(overviewTokenEvidence.lastObservedAt)}
                    </small>
                  {/if}
                </div>

                <div
                  class="usage-totals"
                  data-testid="usage-totals"
                  aria-labelledby="usage-totals-heading"
                >
                  <h3 id="usage-totals-heading">{t('usageTotals')}</h3>
                  <dl>
                    <div>
                      <dt>{t('recordedTokens')}</dt>
                      <dd>
                        {workbench.recordedTokens === null
                          ? t('notAvailable')
                          : formatCompactNumber(workbench.recordedTokens)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('input')}</dt>
                      <dd>
                        {workbench.tokenBreakdown.status !== 'unavailable'
                          ? formatCompactNumber(workbench.tokenBreakdown.tokenTotals.input)
                          : t('notAvailable')}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('output')}</dt>
                      <dd>
                        {workbench.tokenBreakdown.status !== 'unavailable'
                          ? formatCompactNumber(workbench.tokenBreakdown.tokenTotals.output)
                          : t('notAvailable')}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('reasoning')}</dt>
                      <dd>
                        {workbench.tokenBreakdown.status !== 'unavailable'
                          ? formatCompactNumber(workbench.tokenBreakdown.tokenTotals.reasoning)
                          : t('notAvailable')}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('cacheRead')}</dt>
                      <dd>
                        {workbench.tokenBreakdown.status !== 'unavailable'
                          ? formatCompactNumber(workbench.tokenBreakdown.tokenTotals.cacheRead)
                          : t('notAvailable')}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('cacheWrite')}</dt>
                      <dd>
                        {workbench.tokenBreakdown.status !== 'unavailable'
                          ? formatCompactNumber(workbench.tokenBreakdown.tokenTotals.cacheWrite)
                          : t('notAvailable')}
                      </dd>
                    </div>
                  </dl>
                  <small class="usage-totals-evidence">
                    {t('classificationCoverage')}
                    {formatPercent(workbench.tokenBreakdown.classificationCoverage)} ·
                    {displayAuthorities(workbench.tokenBreakdown.authorities)} ·
                    {formatReset(workbench.tokenBreakdown.lastObservedAt)}
                  </small>
                </div>
              </section>

              <div
                class:workbench-data-hidden={workbenchLoading}
                class="usage-overview-grid"
                data-testid="usage-analysis-grid"
              >
                <section class="usage-summary" aria-labelledby="provider-share-heading">
                  <div class="provider-share-heading">
                    <h3 id="provider-share-heading">{t('providerShare')}</h3>
                    <small>{t('providerShareSubtitle')}</small>
                  </div>

                  <ProviderShareChart
                    providers={workbench.providerSummary}
                    metric={selectedTrendMetric}
                    currency={workbench.comparisonCurrency}
                    {locale}
                    {formatUsageMetric}
                    {formatPercent}
                    {displayAuthorities}
                    {formatReset}
                  />
                </section>

                {#key selectedWindow}
                  <UsageTrendChart
                    buckets={workbench.trend.buckets}
                    metric={selectedTrendMetric}
                    currency={workbench.comparisonCurrency}
                    {locale}
                    {selectedWindow}
                    timeZone={workbench.timeZone}
                    granularity={workbench.trend.granularity}
                    rangeLabel={formatWorkbenchRange(workbench)}
                    {formatUsageMetric}
                    describeSegment={trendSegmentDescription}
                  />
                {/key}
              </div>

              <section
                class:workbench-data-hidden={workbenchLoading}
                class="model-ranking"
                data-testid="usage-breakdown"
                aria-labelledby="model-ranking-heading"
              >
                <div class="ranking-heading">
                  <div>
                    <h3 id="model-ranking-heading">{t('breakdown')}</h3>
                  </div>
                  <div class="segmented-control" role="group" aria-label={t('breakdown')}>
                    <button
                      type="button"
                      aria-pressed={breakdownDimension === 'model'}
                      on:click={() => (breakdownDimension = 'model')}>{t('model')}</button
                    >
                    <button
                      type="button"
                      aria-pressed={breakdownDimension === 'day'}
                      on:click={() => (breakdownDimension = 'day')}>{t('day')}</button
                    >
                  </div>
                </div>
                <div class="breakdown-header" aria-hidden="true">
                  <span>{breakdownDimension === 'model' ? t('model') : t('day')}</span>
                  <span>{t('cost')}</span>
                  <span>{breakdownShareLabel(breakdownDimension)}</span>
                  <span>{t('tokens')}</span>
                </div>
                {#if breakdownDimension === 'model'}
                  <ol class="ranking-list">
                    {#each rankedModels(workbench, selectedTrendMetric) as model (model.id)}
                      {@const modelLogo = providerLogoSources(model.providerId)}
                      {@const modelCost =
                        model.retailEquivalent.amount !== null
                          ? model.retailEquivalent
                          : (model.reportedEstimate ?? model.retailEquivalent)}
                      {@const modelCostIsReported =
                        model.retailEquivalent.amount === null &&
                        model.reportedEstimate?.amount != null}
                      {@const modelShare = modelMetricShare(model, selectedTrendMetric)}
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
                                <source
                                  media="(prefers-color-scheme: light)"
                                  srcset={modelLogo.light}
                                />
                                <source
                                  media="(prefers-color-scheme: dark)"
                                  srcset={modelLogo.dark}
                                />
                                <img src={modelLogo.dark} alt="" />
                              </picture>
                            {/if}
                            <span>
                              <strong>{model.model}</strong>
                              <small
                                >{model.providerDisplayName} · {model.billingDomainDisplayName}</small
                              >
                              {#if model.includedInHeadline === false}
                                <small>{t('separateFromHeadline')}</small>
                              {/if}
                              <small>
                                {t('tokens')}: {displayAuthorities(model.authorities)} ·
                                {formatReset(model.lastObservedAt)}
                              </small>
                              <small>
                                {modelCostIsReported
                                  ? t('providerReportedEstimate')
                                  : t('apiRetailEquivalent')}: {displayAuthorities(
                                  modelCost.authorities
                                )} · {formatReset(modelCost.observedAt)}
                              </small>
                            </span>
                          </span>
                          <span class="ranking-value" data-label={t('cost')}>
                            <strong>
                              {modelCost.amount === null
                                ? t('notAvailable')
                                : formatMoney(modelCost.amount, modelCost.comparisonCurrency)}
                            </strong>
                          </span>
                          <span
                            class="ranking-value ranking-share-value"
                            data-label={breakdownShareLabel('model')}
                          >
                            <strong>
                              {model.includedInHeadline === false
                                ? t('headlineShareNotApplicable')
                                : formatPercent(modelShare)}
                            </strong>
                            {#if modelShare !== null}
                              <span
                                class="model-share-track"
                                data-testid="model-share-meter"
                                role="meter"
                                aria-label={`${model.model} ${breakdownShareLabel('model')}`}
                                aria-valuemin="0"
                                aria-valuemax="100"
                                aria-valuenow={Math.round(modelShare * 1000) / 10}
                              >
                                <i style={`width: ${Math.max(2, Math.min(100, modelShare * 100))}%`}
                                ></i>
                              </span>
                            {/if}
                          </span>
                          <span class="ranking-value" data-label={t('tokens')}>
                            <strong aria-label={tokenValueLabel(model.tokenTotals.total)}
                              >{formatCompactNumber(model.tokenTotals.total)}</strong
                            >
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
                            {displayAuthorities(item.authorities)} ·
                            {formatReset(item.lastObservedAt)}
                          </small>
                        </span>
                      {/each}
                    </div>
                  {/if}
                {:else}
                  <ol class="day-breakdown-list">
                    {#each [...workbench.dayBreakdown]
                      .filter( (day) => (selectedTrendMetric === 'tokens' ? !day.gap : !day.gap || day.retailEquivalent.records > 0) )
                      .reverse() as day (day.start)}
                      <li data-testid="day-breakdown-row">
                        <span class="day-identity">
                          <strong>{day.label}</strong>
                          <small>
                            {t('tokens')}: {displayAuthorities(day.authorities)} ·
                            {formatReset(day.lastObservedAt)}
                          </small>
                          <small>
                            {t('cost')}: {displayAuthorities(day.retailEquivalent.authorities)} · {formatReset(
                              day.retailEquivalent.observedAt
                            )}
                          </small>
                        </span>
                        <span class="day-value" data-label={t('cost')}>
                          {formatMoney(day.retailEquivalent.amount, workbench.comparisonCurrency)}
                        </span>
                        <span class="day-value" data-label={breakdownShareLabel('day')}
                          >{formatPercent(
                            selectedTrendMetric === 'tokens' ? day.tokenShare : day.retailShare
                          )}</span
                        >
                        <span class="day-value" data-label={t('tokens')}>
                          {day.recordedTokens === null
                            ? t('notAvailable')
                            : formatCompactNumber(day.recordedTokens)}
                        </span>
                      </li>
                    {/each}
                  </ol>
                {/if}
              </section>
            </section>
          {/if}
        </div>
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
                {#each diagnostics.connectors.filter((diagnostic) => !isAutomaticallyManagedCategory(diagnostic.category)) as diagnostic (diagnostic.id)}
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
              <button class="danger-action" disabled={hardRebuilding} on:click={hardRebuild}>
                {hardRebuilding ? t('hardRebuilding') : t('hardRebuild')}
              </button>
              <small>{t('hardRebuildWarning')}</small>
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
                      >{price.kind === 'reported-estimate'
                        ? t('providerReportedEstimate')
                        : t('apiRetailEquivalent')} · {authorityLabel(price.authority)} · {formatReset(
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
                  ><th>{t('interval')}</th><th>{t('tokens')}</th><th>{t('cost')}</th><th
                    >{t('providerEvidence')}</th
                  ></tr
                >
              </thead>
              <tbody>
                {#each model.trend as bucket (bucket.start)}
                  {@const bucketCost =
                    bucket.retailEquivalent.status === 'available'
                      ? bucket.retailEquivalent
                      : (bucket.reportedEstimate ?? bucket.retailEquivalent)}
                  {@const bucketCostIsReported =
                    bucket.retailEquivalent.status !== 'available' &&
                    bucket.reportedEstimate?.status === 'available'}
                  <tr>
                    <td>{bucket.label}</td>
                    {#if bucket.gap}
                      <td colspan="3">{t('gap')}</td>
                    {:else}
                      <td>{formatNumber(bucket.tokenTotals.total)}</td>
                      <td>
                        {bucketCost.status === 'available'
                          ? formatMoney(bucketCost.amount, bucketCost.comparisonCurrency)
                          : t('notAvailable')}
                      </td>
                      <td>
                        {displayAuthorities(bucket.authorities)} ·
                        {formatReset(bucket.lastObservedAt ?? null)}
                        {#if bucketCost.status === 'available'}
                          <br />{bucketCostIsReported
                            ? t('providerReportedEstimate')
                            : t('apiRetailEquivalent')} · {displayAuthorities(
                            bucketCost.authorities
                          )} ·
                          {formatReset(bucketCost.observedAt ?? null)}
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
    --page: #f3f5f8;
    --surface: #ffffff;
    --surface-subtle: #f7f8fb;
    --surface-inset: #edf0f5;
    --text: #252a34;
    --text-strong: #10131a;
    --muted: #697386;
    --border: #dce1e9;
    --border-soft: #e8ebf1;
    --button: #ffffff;
    --selected: #e8ecff;
    --selected-text: #273c80;
    --primary: #647cf0;
    --progress-track: #e2e6ed;
    --shadow-soft: 0 12px 34px rgba(31, 38, 56, 0.08);
    --shadow-raised: 0 18px 48px rgba(31, 38, 56, 0.12);
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
    position: relative;
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    overflow-x: hidden;
    background: var(--page);
    color: var(--text);
  }

  :global(body)::before {
    position: fixed;
    z-index: 0;
    inset: 0;
    background:
      radial-gradient(circle at 8% 4%, rgba(100, 124, 240, 0.1), transparent 26rem),
      radial-gradient(circle at 92% 18%, rgba(74, 210, 162, 0.07), transparent 24rem);
    content: '';
    pointer-events: none;
  }

  .shell {
    position: relative;
    z-index: 1;
    width: min(1600px, calc(100% - 40px));
    margin: 0 auto;
    padding: 24px 0 80px;
  }

  header {
    margin-bottom: 22px;
  }

  .product-header {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    align-items: center;
    gap: 18px;
    min-height: 68px;
    padding: 10px 12px 10px 10px;
    border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    border-radius: 22px;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(18px) saturate(1.25);
  }

  .product-logo {
    display: block;
    width: 48px;
    height: 48px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
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

  button {
    font: inherit;
  }

  .refresh {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 38px;
    padding: 0 15px;
    border: 1px solid #2c3342;
    border-radius: 999px;
    background: rgba(20, 24, 32, 0.8);
    color: #e8ebf2;
    cursor: pointer;
  }

  .header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    justify-self: end;
  }

  .locale-toggle,
  .settings-toggle {
    min-height: 38px;
    padding: 0 13px;
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

  .dashboard-tabs {
    display: inline-flex;
    gap: 5px;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: var(--surface-inset);
  }

  .dashboard-tabs button {
    min-height: 36px;
    padding: 0 16px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-weight: 650;
    transition:
      background 160ms ease,
      color 160ms ease,
      box-shadow 160ms ease;
  }

  .dashboard-tabs button[aria-selected='true'] {
    background: var(--selected);
    box-shadow: 0 4px 12px rgba(44, 62, 128, 0.12);
    color: var(--selected-text);
  }

  .providers {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
    margin-bottom: 48px;
  }

  .token-money-workbench {
    margin-bottom: 48px;
    padding: 18px;
    border: 1px solid rgba(122, 136, 164, 0.2);
    border-radius: 26px;
    background: rgba(14, 17, 24, 0.88);
    box-shadow: var(--shadow-soft);
  }

  .workbench-skeleton {
    display: grid;
    gap: 30px;
  }

  .workbench-data-hidden {
    display: none !important;
  }

  .skeleton-overview {
    display: grid;
    grid-template-columns: minmax(230px, 0.36fr) minmax(0, 1fr);
    gap: 38px;
    min-height: 310px;
  }

  .skeleton-summary,
  .skeleton-chart,
  .skeleton-ranking {
    display: grid;
    align-content: start;
    gap: 12px;
  }

  .skeleton-summary {
    padding: 18px 0 16px 12px;
  }

  .skeleton-chart {
    padding-top: 14px;
  }

  .skeleton-block {
    display: block;
    border-radius: 8px;
    background: linear-gradient(
      100deg,
      rgba(122, 136, 164, 0.08) 20%,
      rgba(122, 136, 164, 0.2) 42%,
      rgba(122, 136, 164, 0.08) 64%
    );
    background-size: 220% 100%;
    animation: skeleton-shimmer 1.25s ease-in-out infinite;
  }

  .skeleton-headline {
    width: min(78%, 240px);
    height: 54px;
  }

  .skeleton-copy {
    width: 68%;
    height: 12px;
  }

  .skeleton-copy-short {
    width: 38%;
  }

  .skeleton-provider {
    height: 42px;
    margin-top: 12px;
  }

  .skeleton-graph {
    height: 250px;
    margin-top: 8px;
  }

  .skeleton-totals {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 18px;
    padding: 24px 12px 26px;
    border-top: 1px solid rgba(122, 136, 164, 0.14);
    border-bottom: 1px solid rgba(122, 136, 164, 0.14);
  }

  .skeleton-totals .skeleton-block {
    height: 48px;
  }

  .skeleton-ranking {
    padding: 0 12px;
  }

  .skeleton-row {
    height: 54px;
  }

  .usage-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }

  .usage-toolbar {
    margin-bottom: 18px;
    padding: 2px 2px 18px;
    border-bottom: 1px solid var(--border-soft);
  }

  .usage-toolbar h2,
  .usage-toolbar p {
    margin: 0;
  }

  .usage-toolbar h2 {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .usage-toolbar p {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #929baa;
    font-size: 0.78rem;
  }

  .usage-toolbar p strong {
    color: #eef1f6;
    font-size: 0.92rem;
    font-weight: 600;
  }

  .usage-toolbar p span {
    color: #626b79;
  }

  .workbench-controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 7px;
  }

  .segmented-control {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    border: 1px solid rgba(122, 136, 164, 0.18);
    border-radius: 13px;
    background: rgba(8, 10, 15, 0.58);
  }

  .segmented-control button {
    min-height: 34px;
    padding: 0 11px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: #929baa;
    cursor: pointer;
    font-size: 0.7rem;
  }

  .segmented-control button[aria-pressed='true'] {
    background: #29324b;
    color: #eef2ff;
  }

  .usage-overview-grid {
    display: grid;
    grid-template-columns: minmax(340px, 0.42fr) minmax(0, 1fr);
    gap: 14px;
    align-items: stretch;
  }

  .usage-summary-board {
    display: grid;
    grid-template-columns: minmax(230px, 0.3fr) minmax(0, 1fr);
    gap: 28px;
    align-items: center;
    margin-bottom: 14px;
    padding: 22px;
    border: 1px solid var(--border-soft);
    border-radius: 18px;
    background: var(--surface-subtle);
  }

  .usage-summary {
    display: grid;
    align-content: start;
    gap: 18px;
    min-width: 0;
    padding: 22px;
    border: 1px solid var(--border-soft);
    border-radius: 18px;
    background: var(--surface-subtle);
  }

  .usage-headline {
    display: grid;
    gap: 6px;
  }

  .usage-headline > strong {
    overflow-wrap: anywhere;
    color: #f7f8fb;
    font-size: clamp(2.2rem, 4vw, 3.5rem);
    font-variant-numeric: tabular-nums;
    font-weight: 570;
    letter-spacing: -0.055em;
    line-height: 1;
  }

  .usage-headline > span,
  .usage-headline > small {
    color: #929baa;
    font-size: 0.7rem;
  }

  .usage-headline > span {
    color: #c8ced8;
    font-size: 0.76rem;
  }

  .provider-share-heading {
    display: grid;
    gap: 5px;
  }

  .provider-share-heading h3,
  .provider-share-heading small {
    margin: 0;
  }

  .provider-share-heading h3 {
    color: var(--text-strong);
    font-size: 0.88rem;
    font-weight: 570;
  }

  .provider-share-heading small {
    color: var(--muted);
    font-size: 0.64rem;
  }

  .usage-totals {
    min-width: 0;
    padding-left: 26px;
    border-left: 1px solid var(--border-soft);
  }

  .usage-totals h3 {
    margin: 0 0 18px;
    color: #e6eaf2;
    font-size: 0.84rem;
    font-weight: 550;
  }

  .usage-totals dl {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 18px;
    margin: 0;
  }

  .usage-totals dl div {
    display: grid;
    gap: 7px;
    padding-left: 12px;
    border-left: 2px solid color-mix(in srgb, var(--primary) 38%, var(--border));
  }

  .usage-totals dt {
    color: #7f8897;
    font-size: 0.66rem;
  }

  .usage-totals dd {
    margin: 0;
    color: #e9ecf2;
    font-size: 0.95rem;
    font-variant-numeric: tabular-nums;
    font-weight: 550;
  }

  .usage-totals-evidence {
    display: block;
    margin-top: 16px;
    color: #7f8897;
    font-size: 0.62rem;
  }

  .model-ranking {
    margin-top: 14px;
    padding: 20px;
    border: 1px solid var(--border-soft);
    border-radius: 18px;
    background: var(--surface-subtle);
  }

  .ranking-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 12px;
  }

  .ranking-heading h3 {
    margin: 0;
  }

  .ranking-heading h3 {
    color: #e6eaf2;
    font-size: 0.9rem;
  }

  .breakdown-header,
  .ranking-list button,
  .day-breakdown-list li {
    display: grid;
    grid-template-columns: minmax(220px, 1.7fr) minmax(110px, 0.7fr) minmax(90px, 0.5fr) minmax(
        100px,
        0.7fr
      );
    gap: 18px;
    align-items: center;
  }

  .breakdown-header {
    min-height: 34px;
    padding: 0 12px;
    border-bottom: 1px solid rgba(122, 136, 164, 0.14);
    color: #7f8897;
    font-size: 0.64rem;
  }

  .breakdown-header span:not(:first-child) {
    text-align: right;
  }

  .ranking-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ranking-list button {
    width: 100%;
    min-height: 64px;
    padding: 10px 12px;
    border: 0;
    border-bottom: 1px solid rgba(122, 136, 164, 0.11);
    border-radius: 12px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .ranking-list button:hover,
  .ranking-list button:focus-visible {
    outline: none;
    background: color-mix(in srgb, var(--primary) 9%, transparent);
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

  .ranking-identity small {
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

  .ranking-share-value {
    gap: 7px;
  }

  .model-share-track {
    display: block;
    width: min(100%, 96px);
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--progress-track);
  }

  .model-share-track i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(
      90deg,
      var(--primary),
      color-mix(in srgb, var(--primary) 55%, #78d9b2)
    );
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
    text-align: right;
  }

  .day-breakdown-list {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .day-breakdown-list li {
    min-height: 52px;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(122, 136, 164, 0.11);
    color: #cdd2dc;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .day-breakdown-list li span {
    text-align: right;
  }

  .day-breakdown-list .day-identity {
    display: grid;
    gap: 4px;
    text-align: left;
  }

  .day-identity small {
    color: #7f8897;
    font-size: 0.6rem;
    font-weight: 400;
  }

  .history-toolbar {
    display: flex;
    width: fit-content;
    gap: 5px;
    margin: 0;
    padding: 4px;
    border: 1px solid rgba(122, 136, 164, 0.16);
    border-radius: 13px;
    background: rgba(14, 17, 24, 0.78);
  }

  .history-toolbar button {
    min-width: 52px;
    min-height: 34px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: #929baa;
    cursor: pointer;
    font-size: 0.72rem;
  }

  .history-toolbar button[aria-pressed='true'] {
    background: #29324b;
    color: #eef2ff;
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

  .module-progress {
    margin: 0 0 14px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--muted);
    font-size: 0.78rem;
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
    border-radius: 24px;
    background: var(--surface);
    box-shadow: var(--shadow-soft);
  }

  .provider-card {
    position: relative;
    overflow: hidden;
    padding: 26px;
    transition:
      border-color 180ms ease,
      box-shadow 180ms ease,
      transform 180ms ease;
  }

  .provider-card::before {
    position: absolute;
    inset: 0 20px auto;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(100, 124, 240, 0.55), transparent);
    content: '';
  }

  @media (hover: hover) {
    .provider-card:hover {
      border-color: color-mix(in srgb, var(--primary) 32%, var(--border));
      box-shadow: var(--shadow-raised);
      transform: translateY(-2px);
    }
  }

  .state.compact {
    margin-bottom: 16px;
    padding: 14px 18px;
    border-radius: 14px;
    box-shadow: none;
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
    border-radius: 12px;
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
    margin-top: 26px;
    padding-top: 20px;
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
    background: var(--surface-subtle);
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
    height: 8px;
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
    box-shadow: 0 0 12px color-mix(in srgb, var(--primary) 34%, transparent);
  }

  .progress.progress-warning span {
    background: #b06a16;
  }

  .progress.progress-critical span {
    background: #c2413b;
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
    border-radius: 14px;
    background: color-mix(in srgb, #4bd29a 7%, var(--surface-subtle));
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
  .token-money-workbench,
  .privacy-section,
  .monitoring-section,
  .settings-content > section {
    border-color: var(--border);
    background: var(--surface);
  }

  .inline-connection,
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
  .domain-tabs {
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

  .refresh:hover:not(:disabled) {
    border-color: var(--primary);
    background: var(--surface-subtle);
  }

  .segmented-control button,
  .history-toolbar button,
  .domain-tabs button,
  .eyebrow,
  .section-label,
  .usage-toolbar p,
  .usage-headline > span,
  .usage-headline > small,
  .ranking-identity small,
  .breakdown-header,
  .usage-totals dt,
  .usage-totals-evidence,
  .day-identity small,
  .unclassified-usage > strong,
  .unclassified-usage > span,
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
  .freshness,
  .quota-copy span,
  .quota-meta,
  dt,
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

  .usage-toolbar p strong,
  .usage-headline > strong,
  .usage-totals h3,
  .usage-totals dd,
  .ranking-heading h3,
  .ranking-identity strong,
  .ranking-value strong,
  .unclassified-usage b,
  .inline-connection summary strong,
  .coverage-list strong,
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
      --page: #090c11;
      --surface: #12161d;
      --surface-subtle: #171c25;
      --surface-inset: #0d1118;
      --text: #e8ecf3;
      --text-strong: #ffffff;
      --muted: #9aa4b4;
      --border: #2b3441;
      --border-soft: #222a35;
      --button: #151a22;
      --selected: #2b3552;
      --selected-text: #f2f5ff;
      --primary: #8398ff;
      --progress-track: #272e39;
      --shadow-soft: 0 16px 42px rgba(0, 0, 0, 0.2);
      --shadow-raised: 0 22px 58px rgba(0, 0, 0, 0.32);
      --backdrop: rgba(3, 5, 7, 0.7);
      --warning-bg: #211912;
      --warning-border: #684722;
      --warning-text: #f0bd83;
      --danger-bg: #241416;
      --danger-border: #71363a;
      --danger-text: #ffaaa5;
      --focus: #9bb1ff;
    }

    :global(body)::before {
      opacity: 0.78;
    }
  }

  @media (min-width: 1640px) {
    .providers {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .provider-card {
      padding: 20px;
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

  @keyframes skeleton-shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
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
      padding: 12px 0 64px;
    }

    .product-header {
      grid-template-areas:
        'logo actions'
        'tabs tabs';
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px 12px;
      padding: 9px;
      border-radius: 20px;
    }

    .product-logo {
      grid-area: logo;
      width: 44px;
      height: 44px;
    }

    .dashboard-tabs {
      grid-area: tabs;
      width: 100%;
    }

    .dashboard-tabs button {
      flex: 1;
      min-width: 0;
      padding: 0 10px;
    }

    .header-actions {
      grid-area: actions;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .refresh,
    .locale-toggle,
    .settings-toggle {
      min-height: 36px;
    }

    .settings-header,
    .settings-content {
      padding-right: 18px;
      padding-left: 18px;
    }

    .settings-connections {
      grid-template-columns: 1fr;
    }

    .usage-toolbar {
      align-items: flex-start;
      flex-direction: column;
    }

    .workbench-controls {
      justify-content: flex-start;
    }

    .token-money-workbench {
      padding: 10px;
      border-radius: 20px;
    }

    .usage-overview-grid,
    .skeleton-overview {
      grid-template-columns: 1fr;
      gap: 16px;
    }

    .usage-summary-board {
      grid-template-columns: 1fr;
      gap: 18px;
      padding: 16px;
    }

    .usage-summary {
      padding: 16px;
    }

    .model-ranking {
      padding: 16px;
    }

    .usage-totals {
      padding: 18px 0 0;
      border-top: 1px solid var(--border-soft);
      border-left: 0;
    }

    .provider-card {
      padding: 20px;
      border-radius: 22px;
    }

    .usage-totals dl {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .skeleton-totals {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .ranking-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .breakdown-header,
    .ranking-list button,
    .day-breakdown-list li {
      grid-template-columns: minmax(180px, 1.4fr) repeat(3, minmax(86px, 0.6fr));
    }

    .model-ranking {
      overflow-x: auto;
    }

    .breakdown-header,
    .ranking-list,
    .day-breakdown-list {
      min-width: 620px;
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

    .skeleton-block {
      animation: none !important;
    }
  }
</style>
