<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';

  import type {
    AgentProviderIndex,
    BillingDomainOverview,
    CoverageLevel,
    DataAuthority,
    BillingHistory,
    CustomModelRate,
    DoctorReport,
    HistoryWindow,
    MonitoringSettings,
    ProcessingStatus,
    ProviderOverview,
    QuotaBucket,
    RetentionStatus,
    UsageOverview,
    UsageWall
  } from '$core/types.js';
  import { clampPercent } from '$core/quota-normalization.js';
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
  import {
    activeTheme,
    initTheme,
    setThemePreference,
    themePreference,
    type ResolvedTheme,
    type ThemePreference
  } from '$lib/theme.js';
  import ModelDetailChart from '$lib/ModelDetailChart.svelte';
  import ModelBreakdownTreemap from '$lib/ModelBreakdownTreemap.svelte';
  import ModelTrendStackedChart from '$lib/ModelTrendStackedChart.svelte';
  import ProviderShareChart from '$lib/ProviderShareChart.svelte';
  import QuotaTimelineChart from '$lib/QuotaTimelineChart.svelte';
  import type { QuotaTimelineProvider } from '$lib/quota-timeline.js';
  import UsageTrendChart from '$lib/UsageTrendChart.svelte';
  import UsageContributionWall from '$lib/UsageContributionWall.svelte';
  import { resolveSettingsTab, type SettingsTab } from '$lib/settings-navigation.js';
  import {
    createDefaultRateDraft,
    formatRateDomain,
    formatRatePerMillion,
    resolveRateProviderChoice
  } from '$lib/custom-rates-presentation.js';
  import '$lib/dashboard-polish.css';

  const DEFAULT_AGENT_PROVIDERS: AgentProviderIndex['providers'] = [
    { id: 'codex', displayName: 'Codex' },
    { id: 'claude-code', displayName: 'Claude Code' },
    { id: 'opencode-go', displayName: 'OpenCode Go' },
    { id: 'grok', displayName: 'Grok' },
    { id: 'antigravity', displayName: 'Antigravity' }
  ];

  const DEFAULT_AGENT_PROVIDER_IDS = new Set(
    DEFAULT_AGENT_PROVIDERS.map((provider) => provider.id)
  );

  let locale: Locale = 'en';
  let metaDescription: string;
  let overview: UsageOverview | null = null;
  let usageWall: UsageWall | null = null;
  let usageWallLoading = false;
  let usageWallRequestSequence = 0;
  let agentProviderIndex: AgentProviderIndex['providers'] = DEFAULT_AGENT_PROVIDERS;
  let agentProviders: Record<string, ProviderOverview> = {};
  let agentProviderLoading: Record<string, boolean> = Object.fromEntries(
    DEFAULT_AGENT_PROVIDERS.map((provider) => [provider.id, true])
  );
  let indexedAgentProviderIds = new Set<string>();
  let agentIndexLoading = true;
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
  let breakdownView: 'list' | 'treemap' | 'trend' = 'list';
  let selectedModelId: string | null = null;
  let modelDetailTrigger: HTMLButtonElement | null = null;
  let modelDetailPanel: HTMLElement | null = null;
  let timeZone = 'UTC';
  let monitoring: MonitoringSettings | null = null;
  const defaultRateProviders = [
    { id: 'grok', label: 'Grok' },
    { id: 'dsh', label: 'DeepSeek (dsh)' },
    { id: 'claude-code', label: 'Claude Code' },
    { id: 'codex', label: 'Codex' },
    { id: 'opencode-go', label: 'OpenCode Go' },
    { id: 'opencode', label: 'OpenCode' },
    { id: 'antigravity', label: 'Antigravity' }
  ];
  let rateProviderChoice = 'grok';
  let customRates: CustomModelRate[] = [];
  let customRatesError = false;
  let loadingRates = false;
  let showAddRateForm = false;
  let newRateDraft = createDefaultRateDraft({ providerId: 'grok' });
  let savingRate = false;
  let editingRateId: string | null = null;
  let editRateDraft = {
    id: '',
    providerId: '',
    billingDomainId: '',
    model: '',
    inputRate: '',
    outputRate: '',
    cacheReadRate: ''
  };
  let updatingRate = false;
  let deletingRateId: string | null = null;
  let diagnostics: DoctorReport | null = null;
  let diagnosticsLoaded = false;
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
  let settingsTab: SettingsTab = 'connections';
  let settingsButton: HTMLButtonElement | null = null;
  let settingsReturnFocus: HTMLElement | null = null;
  let settingsPanel: HTMLElement | null = null;
  let selectedModelEntry: UsageOverview['workbench']['modelRanking']['entries'][number] | null;
  let agentViewOverview: UsageOverview | null;
  let effectiveOverview: UsageOverview | null;
  let destroyed = false;
  let overviewRequestSequence = 0;
  let agentProviderRequestSequences: Record<string, number> = {};
  let workbenchRequestSequence = 0;
  const automaticRecoveryController = createAutomaticRecoveryController(() => automaticRefresh());

  $: metaDescription = translate(locale, 'metaDescription');

  $: selectedModelEntry =
    overview?.workbench?.modelRanking.entries.find((entry) => entry.id === selectedModelId) ?? null;
  $: agentViewOverview =
    agentIndexLoading && agentProviderIndex.length === 0
      ? null
      : ({
          generatedAt: new Date().toISOString(),
          providers: Object.values(agentProviders)
        } as UsageOverview);
  $: effectiveOverview = activeDashboardView === 'agents' ? agentViewOverview : overview;
  $: processingBusy = processing
    ? Object.values(processing.modules).some(
        (module) => module.state === 'pending' || module.state === 'running'
      )
    : false;
  // A manual refresh only queues background collection, so the workbench stays
  // busy until that work lands rather than for the request alone.
  $: workbenchBusy = workbenchLoading || refreshing || processingBusy;

  onMount(async () => {
    initTheme();
    locale = detectLocale(navigator.language);
    document.documentElement.lang = locale;
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    selectedWindow = storedWindow();
    selectedCurrency = storedCurrency();
    await Promise.all([
      loadOverview(),
      loadUsageWall(),
      loadAgentProviders(),
      loadConnectors(),
      loadMonitoring(),
      loadCustomRates(),
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

  function breakdownShareLabel(): string {
    return selectedTrendMetric === 'tokens' ? t('tokenShare') : t('costShare');
  }

  function toggleLocale(): void {
    locale = locale === 'en' ? 'zh-CN' : 'en';
    document.documentElement.lang = locale;
  }

  const themeCycle: ThemePreference[] = ['system', 'light', 'dark'];

  function toggleTheme(): void {
    const next = themeCycle[(themeCycle.indexOf($themePreference) + 1) % themeCycle.length];
    setThemePreference(next);
  }

  function themeLabel(preference: ThemePreference): string {
    const keys: Record<ThemePreference, MessageKey> = {
      system: 'themeSystem',
      light: 'themeLight',
      dark: 'themeDark'
    };
    return t(keys[preference]);
  }

  async function loadUsageWall(): Promise<void> {
    const requestSequence = ++usageWallRequestSequence;
    usageWallLoading = true;
    try {
      const parameters = new URLSearchParams({ timeZone });
      const response = await fetch(`/api/usage-wall?${parameters}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextWall = (await response.json()) as UsageWall;
      if (destroyed || requestSequence !== usageWallRequestSequence) return;
      usageWall = nextWall;
    } catch {
      if (requestSequence === usageWallRequestSequence && !usageWall) usageWall = null;
    } finally {
      if (requestSequence === usageWallRequestSequence) usageWallLoading = false;
    }
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
    }
  }

  async function loadAgentProviders(): Promise<void> {
    agentIndexLoading = true;
    const immediatelyRequestedIds = new Set([
      ...DEFAULT_AGENT_PROVIDER_IDS,
      ...indexedAgentProviderIds
    ]);
    const immediateRequests = [...immediatelyRequestedIds].map((providerId) =>
      loadAgentProvider(providerId)
    );
    try {
      const response = await fetch('/api/overview/providers');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const index = (await response.json()) as AgentProviderIndex;
      if (destroyed) return;
      const visibleProviders = index.providers.filter(
        (provider) => provider.id !== 'opencode' && provider.id !== 'dsh'
      );
      const visibleProvidersById = new Map(
        visibleProviders.map((provider) => [provider.id, provider])
      );
      indexedAgentProviderIds = new Set(visibleProvidersById.keys());
      agentProviderIndex = [
        ...DEFAULT_AGENT_PROVIDERS.map(
          (provider) => visibleProvidersById.get(provider.id) ?? provider
        ),
        ...visibleProviders.filter((provider) => !DEFAULT_AGENT_PROVIDER_IDS.has(provider.id))
      ];
      agentIndexLoading = false;
      const additionalRequests = visibleProviders
        .filter((provider) => !immediatelyRequestedIds.has(provider.id))
        .map((provider) => loadAgentProvider(provider.id));
      await Promise.all([...immediateRequests, ...additionalRequests]);
    } catch {
      if (!destroyed) agentIndexLoading = false;
      await Promise.all(immediateRequests);
    }
  }

  async function loadAgentProvider(providerId: string): Promise<void> {
    const sequence = (agentProviderRequestSequences[providerId] ?? 0) + 1;
    agentProviderRequestSequences = { ...agentProviderRequestSequences, [providerId]: sequence };
    agentProviderLoading = { ...agentProviderLoading, [providerId]: true };
    try {
      const parameters = new URLSearchParams({
        window: selectedWindow,
        timeZone,
        currency: selectedCurrency
      });
      const response = await fetch(
        `/api/overview/providers/${encodeURIComponent(providerId)}?${parameters}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const provider = (await response.json()) as ProviderOverview;
      if (destroyed || agentProviderRequestSequences[providerId] !== sequence) return;
      agentProviders = { ...agentProviders, [providerId]: provider };
    } catch {
      // Cached data or the known Provider shell remains visible; diagnostics stay in Settings.
    } finally {
      if (!destroyed && agentProviderRequestSequences[providerId] === sequence) {
        agentProviderLoading = { ...agentProviderLoading, [providerId]: false };
      }
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
      const endpoint =
        mode === 'automatic'
          ? '/api/refresh?mode=automatic&background=true'
          : '/api/refresh?background=true';
      const response = await fetch(endpoint, { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await Promise.all([loadOverview(), loadUsageWall(), loadAgentProviders(), loadDiagnostics()]);
      await loadProcessing();
      startProcessingPolling();
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
    // Connector diagnostics carry their own automatic-recovery evidence, so the
    // first evaluation waits for them instead of refreshing twice.
    if (destroyed || !overview || !diagnosticsLoaded) return;
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

  async function loadCustomRates(): Promise<void> {
    loadingRates = true;
    try {
      const response = await fetch('/api/custom-rates');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { rates: CustomModelRate[] };
      customRates = data.rates;
      customRatesError = false;
    } catch {
      customRatesError = true;
    } finally {
      loadingRates = false;
    }
  }

  function handleProviderChoiceChange(): void {
    if (rateProviderChoice !== 'custom') {
      newRateDraft.providerId = rateProviderChoice;
    } else {
      newRateDraft.providerId = '';
    }
  }

  async function saveCustomRate(): Promise<void> {
    const provider =
      rateProviderChoice === 'custom' ? newRateDraft.providerId.trim() : rateProviderChoice;
    if (!provider || !newRateDraft.model.trim() || savingRate) return;
    savingRate = true;
    try {
      const response = await fetch('/api/custom-rates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: provider,
          billingDomainId: newRateDraft.billingDomainId.trim() || null,
          model: newRateDraft.model.trim(),
          inputRate: parseFloat(newRateDraft.inputRate) || 0,
          outputRate: parseFloat(newRateDraft.outputRate) || 0,
          cacheReadRate: parseFloat(newRateDraft.cacheReadRate) || 0
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      newRateDraft = createDefaultRateDraft({ providerId: provider });
      showAddRateForm = false;
      await loadCustomRates();
      await loadOverview();
    } catch (err) {
      console.error(err);
    } finally {
      savingRate = false;
    }
  }

  function toggleAddRateForm(): void {
    showAddRateForm = !showAddRateForm;
  }

  function cancelAddRate(): void {
    showAddRateForm = false;
  }

  function startEditRate(rate: CustomModelRate): void {
    editingRateId = rate.id;
    editRateDraft = {
      id: rate.id,
      providerId: rate.providerId,
      billingDomainId: rate.billingDomainId ?? '',
      model: rate.model,
      inputRate: String(rate.ratesPerMillion.input),
      outputRate: String(rate.ratesPerMillion.output),
      cacheReadRate: String(rate.ratesPerMillion.cacheRead)
    };
  }

  function cancelEditRate(): void {
    editingRateId = null;
  }

  async function updateCustomRate(): Promise<void> {
    if (!editingRateId || updatingRate) return;
    updatingRate = true;
    try {
      const response = await fetch(`/api/custom-rates/${encodeURIComponent(editingRateId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: editRateDraft.providerId.trim(),
          billingDomainId: editRateDraft.billingDomainId.trim() || null,
          model: editRateDraft.model.trim(),
          inputRate: parseFloat(editRateDraft.inputRate) || 0,
          outputRate: parseFloat(editRateDraft.outputRate) || 0,
          cacheReadRate: parseFloat(editRateDraft.cacheReadRate) || 0
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      editingRateId = null;
      await loadCustomRates();
      await loadOverview();
    } catch (err) {
      console.error(err);
    } finally {
      updatingRate = false;
    }
  }

  async function deleteCustomRate(id: string): Promise<void> {
    deletingRateId = id;
    try {
      const response = await fetch(`/api/custom-rates/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (editingRateId === id) editingRateId = null;
      await loadCustomRates();
      await loadOverview();
    } catch (err) {
      console.error(err);
    } finally {
      deletingRateId = null;
    }
  }

  function configureCustomRateForModel(
    providerId: string,
    domainId: string | null | undefined,
    modelName: string
  ): void {
    void closeModelDetail();
    rateProviderChoice = resolveRateProviderChoice(providerId, defaultRateProviders);
    newRateDraft = createDefaultRateDraft({
      providerId,
      billingDomainId: !domainId || domainId === '*' ? '' : domainId,
      model: modelName
    });
    showAddRateForm = true;
    void openSettings('rates');
  }

  async function loadDiagnostics(): Promise<void> {
    try {
      const response = await fetch('/api/doctor');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextDiagnostics = (await response.json()) as DoctorReport;
      if (destroyed) return;
      diagnostics = nextDiagnostics;
      diagnosticsError = false;
    } catch {
      diagnosticsError = true;
    } finally {
      if (!destroyed) {
        diagnosticsLoaded = true;
        scheduleAutomaticRecovery();
      }
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
      if (processingModuleBecameReady(previous, next, 'discovery')) {
        void loadConnectors();
      }
      if (processingModuleBecameReady(previous, next, 'usage')) {
        void loadAgentProviders();
        void loadOverview();
        void loadUsageWall();
      }
      if (processingModuleBecameReady(previous, next, 'pricing')) {
        void loadOverview();
      }
      if (processingModuleBecameReady(previous, next, 'retention')) {
        void loadRetention();
        void loadUsageWall();
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

  function processingModuleBecameReady(
    previous: ProcessingStatus | null,
    next: ProcessingStatus,
    moduleId: keyof ProcessingStatus['modules']
  ): boolean {
    return (
      previous !== null &&
      previous.modules[moduleId].state !== 'ready' &&
      next.modules[moduleId].state === 'ready'
    );
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
      await Promise.all([
        loadOverview(),
        loadAgentProviders(),
        loadConnectors(),
        loadDiagnostics(),
        loadRetention()
      ]);
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
      await Promise.all([
        loadConnectors(),
        loadOverview(),
        loadAgentProviders(),
        loadDiagnostics()
      ]);
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
    settingsTab = resolveSettingsTab(target);
    if (target === 'rates:add') {
      showAddRateForm = true;
    }
    void loadCustomRates();
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
    targetElement?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    (targetElement ?? settingsPanel)?.focus();
  }

  async function closeSettings(): Promise<void> {
    const returnFocus = settingsReturnFocus;
    settingsOpen = false;
    settingsTarget = null;
    settingsTab = 'connections';
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
      'xai-api': 'xaiPermission',
      dsh: 'dshPermission'
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

  function formatReset(value: string | null | undefined): string {
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

  // A Provider that meters each request has no allowance to report, so an
  // absent quota is its shape rather than a gap in what could be read.
  function quotaMetered(connector: ConnectorStatus | undefined): boolean {
    return connector ? connector.expectedCoverage.includes('quota') : true;
  }

  function coverageLevelLabel(coverage: CoverageLevel): string {
    const keys: Record<CoverageLevel, MessageKey> = {
      complete: 'coverageComplete',
      partial: 'coveragePartial',
      unavailable: 'coverageUnavailable'
    };
    return t(keys[coverage]);
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

  function modelTrendEvidence(
    model: UsageOverview['workbench']['modelRanking']['entries'][number]
  ) {
    return model.trend.map((bucket) => {
      const selectedCost =
        bucket.retailEquivalent.status !== 'unavailable' && bucket.retailEquivalent.amount !== null
          ? bucket.retailEquivalent
          : (bucket.reportedEstimate ?? bucket.retailEquivalent);
      return {
        recordedTokens: bucket.gap ? null : (bucket.recordedTokens ?? 0),
        costAmount: selectedCost.amount,
        costCurrency: selectedCost.comparisonCurrency
      };
    });
  }

  function totalDerivationLabel(derivation: string): string {
    const keys: Record<string, MessageKey> = {
      'source-reported': 'derivationSourceReported',
      'reconciled-remainder': 'derivationReconciledRemainder',
      categorized: 'derivationCategorized',
      'legacy-total': 'derivationLegacyTotal'
    };
    return t(keys[derivation] ?? 'unknown');
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
        lastCostObservedAt: null,
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
    costs: NonNullable<BillingDomainOverview['costs']>,
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
      },
      // DeepSeek publishes one monochrome mark, so it keeps a light plate in
      // both themes the way the OpenAI mark does rather than being recolored.
      dsh: {
        dark: '/brands/deepseek.svg',
        light: '/brands/deepseek.svg'
      },
      antigravity: {
        dark: '/brands/antigravity.svg',
        light: '/brands/antigravity.svg'
      }
    };
    return paths[providerId] ?? null;
  }

  // The resolved theme is an argument so the markup re-renders the mark when the
  // theme changes: a store read hidden inside the function body is not tracked.
  function logoSrc(sources: { dark: string; light: string }, theme: ResolvedTheme): string {
    return theme === 'dark' ? sources.dark : sources.light;
  }

  function usageCardBillingDomains(
    providerId: string,
    domains: BillingDomainOverview[]
  ): BillingDomainOverview[] {
    if (providerId !== 'grok') return domains;
    return domains.filter((domain) => domain.id === 'grok-build-subscription');
  }

  function displayProviders(
    currentOverview: UsageOverview,
    connectionStatuses: ConnectorStatus[],
    indexedProviders: AgentProviderIndex['providers'] = []
  ): ProviderOverview[] {
    const providers = currentOverview.providers
      .filter((provider) => provider.id !== 'opencode' && provider.id !== 'dsh')
      .map((provider) => ({
        ...provider,
        // A Provider payload that arrives without billing domains must not take
        // the whole dashboard down with it. Grok's usage card is the
        // subscription quota view; custom endpoints and xAI API stay in the
        // workbench and Settings.
        billingDomains: usageCardBillingDomains(provider.id, [...(provider.billingDomains ?? [])])
      }));
    for (const connector of connectionStatuses) {
      const { provider: targetProvider, billingDomain: targetDomain } = connector.target;
      if (targetProvider.id === 'opencode' || targetProvider.id === 'dsh') continue;
      if (targetProvider.id === 'grok' && targetDomain.id !== 'grok-build-subscription') continue;
      let provider = providers.find((candidate) => candidate.id === targetProvider.id);
      if (!provider) {
        provider = emptyProvider(targetProvider.id, targetProvider.displayName);
        providers.push(provider);
      }
      if (!provider.billingDomains.some((domain) => domain.id === targetDomain.id)) {
        provider.billingDomains.push(emptyBillingDomain(targetDomain.id, targetDomain.displayName));
      }
    }
    for (const indexedProvider of indexedProviders) {
      if (indexedProvider.id === 'opencode' || indexedProvider.id === 'dsh') continue;
      const provider = providers.find((candidate) => candidate.id === indexedProvider.id);
      if (!provider) {
        providers.push(emptyProvider(indexedProvider.id, indexedProvider.displayName));
      } else if (!currentOverview.providers.some((candidate) => candidate.id === provider.id)) {
        provider.displayName = indexedProvider.displayName;
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

  // A quota window belongs to a model group, and a label states the two in either
  // order: `Claude / GPT · Week` leads with the group, `Week · All models` with the
  // window, and a Provider's own default group states no group at all. Removing the
  // window segments leaves the group, which is what the rows are grouped by.
  function quotaWindowPriority(label: string): number {
    if (/\b5\s*hours?\b/i.test(label)) return 0;
    if (/\b(?:week|weekly)\b/i.test(label)) return 1;
    if (/\b(?:month|monthly)\b/i.test(label)) return 2;
    return 3;
  }

  function quotaModelGroup(label: string): string {
    return label
      .split(' · ')
      .filter((segment) => quotaWindowPriority(segment) === 3)
      .join(' · ');
  }

  // Every window of one model group stays together, shortest window first, so a
  // Provider that reports separate allowances never interleaves them.
  function displayQuotaBuckets(buckets: QuotaBucket[]): QuotaBucket[] {
    const byWindow = buckets
      .map((bucket, sourceIndex) => ({ bucket, sourceIndex }))
      .sort(
        (left, right) =>
          quotaWindowPriority(left.bucket.label) - quotaWindowPriority(right.bucket.label) ||
          left.sourceIndex - right.sourceIndex
      );
    const groupOrder: string[] = [];
    for (const { bucket } of byWindow) {
      const group = quotaModelGroup(bucket.label);
      if (!groupOrder.includes(group)) groupOrder.push(group);
    }
    return byWindow
      .sort(
        (left, right) =>
          groupOrder.indexOf(quotaModelGroup(left.bucket.label)) -
          groupOrder.indexOf(quotaModelGroup(right.bucket.label))
      )
      .map(({ bucket }) => bucket);
  }

  function quotaTimelineProviders(
    currentOverview: UsageOverview,
    connectionStatuses: ConnectorStatus[]
  ): QuotaTimelineProvider[] {
    return displayProviders(currentOverview, connectionStatuses, agentProviderIndex).flatMap(
      (provider) => {
        const domains =
          provider.billingDomains.length > 0
            ? provider.billingDomains
            : [activeBillingDomain(provider, undefined)];
        return domains.flatMap((domain) => {
          const quotaBuckets = displayQuotaBuckets(domain.quotaBuckets);
          if (quotaBuckets.length === 0) return [];
          return [
            {
              providerId: provider.id,
              providerDisplayName: provider.displayName,
              billingDomainId: domain.id,
              billingDomainDisplayName: domain.displayName,
              observedAt: domain.freshness?.lastSuccessAt ?? provider.freshness.lastSuccessAt,
              quotaBuckets
            }
          ];
        });
      }
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
      lastCostObservedAt: null,
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
      currencyDisplay: 'narrowSymbol',
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
    const cost =
      segment.retailEquivalent.amount === null
        ? segment.reportedEstimate
        : segment.retailEquivalent;
    const value =
      metric === 'tokens'
        ? `${formatNumber(segment.recordedTokens)} ${t('tokens')}`
        : cost?.amount == null
          ? t('notAvailable')
          : formatMoney(cost.amount, cost.currency);
    const headlineScope =
      segment.includedInHeadline === false ? ` · ${t('separateFromHeadline')}` : '';
    return `${segment.providerDisplayName} · ${segment.billingDomainDisplayName}${headlineScope}: ${value}`;
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

  async function openModelDetail(id: string, trigger: HTMLButtonElement | null): Promise<void> {
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
        <button class="theme-toggle" on:click={toggleTheme} aria-label={t('themeToggleAria')}>
          <span class="theme-icon" aria-hidden="true"
            >{$themePreference === 'system' ? '◐' : $activeTheme === 'dark' ? '☾' : '☀'}</span
          >
          {themeLabel($themePreference)}
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

    {#if !effectiveOverview}
      <div
        id="token-model-costs-panel"
        data-testid="token-model-costs-panel"
        role="tabpanel"
        aria-labelledby="token-model-costs-tab"
        aria-busy="true"
      >
        <section class="token-money-workbench initial-workbench-loading">
          <p class="module-progress" role="status" data-testid="model-costs-initial-status">
            {t('loadingModelCosts')}
          </p>
        </section>
      </div>
    {:else if activeDashboardView === 'models' && overviewError && !overview}
      <div class="state error" role="alert">{t('error')}</div>
    {:else if effectiveOverview}
      {#if refreshError}
        <div class="inline-error" role="status">{t('refreshUnavailable')}</div>
      {/if}
      {#if activeDashboardView === 'agents' && !agentIndexLoading && agentProviderIndex.length === 0 && connectors.length === 0}
        <div class="state compact">{t('noProviders')}</div>
      {/if}
      {#if activeDashboardView === 'agents'}
        <div
          id="agent-usage-panel"
          data-testid="agent-usage-panel"
          role="tabpanel"
          aria-labelledby="agent-usage-tab"
        >
          <section class="providers" aria-label={t('providersLabel')}>
            {#each displayProviders(effectiveOverview, connectors, agentProviderIndex) as provider (provider.id)}
              {@const logo = providerLogoSources(provider.id)}
              {@const hasProviderData = Boolean(agentProviders[provider.id])}
              {@const initialProviderLoading =
                agentProviderLoading[provider.id] && !hasProviderData}
              {@const providerUpdating = agentProviderLoading[provider.id] && hasProviderData}
              {@const selectedDomain = activeBillingDomain(
                provider,
                selectedBillingDomains[provider.id]
              )}
              {@const domainFreshness = selectedDomain.freshness ?? provider.freshness}
              {@const domainCoverage = selectedDomain.coverage ?? provider.coverage}
              {@const domainConnector = connectorForDomain(
                connectors,
                provider.id,
                selectedDomain.id
              )}
              <article
                class="provider-card"
                class:provider-card-loading={initialProviderLoading}
                aria-busy={agentProviderLoading[provider.id]}
              >
                {#if initialProviderLoading}
                  <div
                    class="agent-card-skeleton-overlay"
                    data-testid={`agent-provider-skeleton-${provider.id}`}
                    aria-hidden="true"
                  >
                    <div class="agent-card-skeleton-content">
                      <div class="agent-skeleton-section-label">
                        <i class="agent-skeleton-block"></i>
                      </div>
                      <div class="agent-skeleton-quota-list">
                        {#each [0, 1, 2] as quotaSkeleton (quotaSkeleton)}
                          <div class="agent-skeleton-quota-row">
                            <div class="agent-skeleton-quota-copy">
                              <i class="agent-skeleton-block"></i>
                              <i class="agent-skeleton-block"></i>
                            </div>
                            <i class="agent-skeleton-block agent-skeleton-progress"></i>
                            <i class="agent-skeleton-block agent-skeleton-meta"></i>
                          </div>
                        {/each}
                      </div>
                    </div>
                  </div>
                {/if}
                <div class="provider-heading">
                  {#if logo}
                    <img
                      class="provider-logo"
                      data-provider-logo={provider.id}
                      src={logoSrc(logo, $activeTheme)}
                      alt=""
                    />
                  {/if}
                  <div class="provider-heading-copy">
                    <div class="provider-heading-top">
                      <h2 data-provider-logo={logo ? undefined : provider.id}>
                        {provider.displayName}
                      </h2>
                      <div class="provider-status">
                        <div class="coverage">
                          {quotaMetered(domainConnector)
                            ? coverageLevelLabel(domainCoverage.quota)
                            : t('noQuotaWindow')}
                        </div>
                        {#if domainConnector?.state === 'connected'}
                          <span
                            class="connection-chip"
                            data-testid={`connector-${domainConnector.id}`}
                          >
                            <span class="visually-hidden"
                              >{connectorStateLabel(domainConnector.state)}</span
                            >
                            <button
                              title={`${connectorStateLabel(domainConnector.state)} · ${t('manageConnection')}`}
                              aria-label={t('manageConnection')}
                              on:click={() => openSettings(`connector:${domainConnector.id}`)}
                            >
                              <span aria-hidden="true">⚙</span>
                            </button>
                          </span>
                        {/if}
                      </div>
                    </div>
                    <p
                      class="freshness"
                      data-status={providerUpdating
                        ? 'updating'
                        : domainFreshness.status === 'unavailable'
                          ? 'unavailable'
                          : 'available'}
                      role={providerUpdating ? 'status' : undefined}
                      data-testid={providerUpdating
                        ? `agent-provider-update-${provider.id}`
                        : undefined}
                    >
                      <span></span>
                      {#if providerUpdating}
                        {t('updating')}
                      {:else}
                        {domainFreshness.status === 'fresh'
                          ? t('updatedNow')
                          : domainFreshness.lastSuccessAt
                            ? t('updated')
                            : t('unavailable')}
                        {domainFreshness.lastSuccessAt
                          ? ` · ${formatReset(domainFreshness.lastSuccessAt)}`
                          : ''}
                      {/if}
                    </p>
                  </div>
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
                  {#if connector && connector.state !== 'connected'}
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
                  <div class="section-label">{t('quota')}</div>
                  {#if !quotaMetered(connector)}
                    <p class="quota-absent">{t('noQuotaWindowDetail')}</p>
                  {:else if domain.quotaBuckets.length === 0}
                    <p class="quota-absent">{t('noQuotaReported')}</p>
                  {/if}
                  <div class="quotas">
                    {#each displayQuotaBuckets(domain.quotaBuckets) as bucket (bucket.id)}
                      {@const normalizedUsed = clampPercent(bucket.usedPercent)}
                      <div class="quota-row">
                        <div class="quota-copy">
                          <strong>{bucket.label}</strong>
                          <span
                            >{normalizedUsed !== null ? formatNumber(normalizedUsed) : '—'}% {t(
                              'used'
                            )}</span
                          >
                        </div>
                        <div
                          class="progress"
                          class:progress-warning={(normalizedUsed ?? 0) >= 70 &&
                            (normalizedUsed ?? 0) < 90}
                          class:progress-critical={(normalizedUsed ?? 0) >= 90}
                          role="progressbar"
                          aria-label={bucket.label}
                          aria-valuemin="0"
                          aria-valuemax="100"
                          aria-valuenow={normalizedUsed ?? undefined}
                          aria-valuetext={normalizedUsed === null
                            ? t('notAvailable')
                            : `${formatNumber(normalizedUsed)}% ${t('used')}`}
                          aria-describedby={`quota-evidence-${provider.id}-${domain.id}-${bucket.id}`}
                        >
                          <span style={`width: ${normalizedUsed ?? 0}%`}></span>
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
                {/each}
              </article>
            {/each}
          </section>
          <QuotaTimelineChart
            providers={quotaTimelineProviders(effectiveOverview, connectors)}
            {locale}
            {timeZone}
            now={Date.parse(effectiveOverview.generatedAt)}
          />
        </div>
      {:else}
        <div
          id="token-model-costs-panel"
          data-testid="token-model-costs-panel"
          role="tabpanel"
          aria-labelledby="token-model-costs-tab"
        >
          {#if effectiveOverview.workbench}
            {@const workbench = effectiveOverview.workbench}
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

              <section
                class="usage-summary-board"
                data-testid="usage-summary-board"
                aria-label={t('usageOverview')}
                aria-busy={workbenchBusy}
              >
                {#if workbenchBusy}
                  <div
                    class="panel-progress"
                    role="status"
                    data-testid="workbench-summary-refresh-status"
                  >
                    <span class="visually-hidden">{t('updatingModelCosts')}</span>
                  </div>
                {/if}
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
                </div>
              </section>

              {#if usageWall}
                <UsageContributionWall
                  wall={usageWall}
                  {locale}
                  formatTokens={formatCompactNumber}
                  updating={usageWallLoading}
                />
              {/if}

              <div
                class="usage-overview-grid"
                data-testid="usage-analysis-grid"
                aria-busy={workbenchBusy}
              >
                {#if workbenchBusy}
                  <div
                    class="panel-progress"
                    role="status"
                    data-testid="workbench-analysis-refresh-status"
                  >
                    <span class="visually-hidden">{t('updatingModelCosts')}</span>
                  </div>
                {/if}
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
                class="model-ranking"
                data-testid="usage-breakdown"
                aria-labelledby="model-ranking-heading"
                aria-busy={workbenchBusy}
              >
                {#if workbenchBusy}
                  <div
                    class="panel-progress"
                    role="status"
                    data-testid="workbench-breakdown-refresh-status"
                  >
                    <span class="visually-hidden">{t('updatingModelCosts')}</span>
                  </div>
                {/if}
                <div class="ranking-heading">
                  <div>
                    <h3 id="model-ranking-heading">{t('breakdown')}</h3>
                  </div>
                  <div
                    class="segmented-control"
                    role="tablist"
                    aria-label={t('breakdownView')}
                    data-testid="breakdown-view-tabs"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={breakdownView === 'list'}
                      on:click={() => (breakdownView = 'list')}>{t('list')}</button
                    >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={breakdownView === 'treemap'}
                      on:click={() => (breakdownView = 'treemap')}>{t('treemap')}</button
                    >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={breakdownView === 'trend'}
                      on:click={() => (breakdownView = 'trend')}>{t('trendStacked')}</button
                    >
                  </div>
                </div>
                <div class="breakdown-header" aria-hidden="true">
                  <span>{t('model')}</span>
                  <span>{t('cost')}</span>
                  <span>{breakdownShareLabel()}</span>
                  <span>{t('tokens')}</span>
                </div>
                {#if breakdownView === 'treemap'}
                  <div class="treemap-wrap" role="tabpanel">
                    <ModelBreakdownTreemap
                      models={rankedModels(workbench, selectedTrendMetric)}
                      metric={selectedTrendMetric}
                      currency={workbench.comparisonCurrency}
                      {locale}
                      {formatUsageMetric}
                      {formatPercent}
                      onSelect={(modelId) => void openModelDetail(modelId, null)}
                    />
                    <p class="treemap-hint">{t('treemapHint')}</p>
                  </div>
                {:else if breakdownView === 'trend'}
                  <div class="treemap-wrap" role="tabpanel">
                    <ModelTrendStackedChart
                      models={rankedModels(workbench, selectedTrendMetric)}
                      metric={selectedTrendMetric}
                      currency={workbench.comparisonCurrency}
                      {locale}
                      {formatUsageMetric}
                      onSelect={(modelId) => void openModelDetail(modelId, null)}
                    />
                  </div>
                {:else}
                  <div role="tabpanel">
                    <ol class="ranking-list">
                      {#each rankedModels(workbench, selectedTrendMetric) as model (model.id)}
                        {@const modelLogo = providerLogoSources(model.providerId)}
                        {@const modelCost =
                          model.retailEquivalent.amount !== null
                            ? model.retailEquivalent
                            : (model.reportedEstimate ?? model.retailEquivalent)}
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
                                <img
                                  class="ranking-logo"
                                  data-provider-logo={model.providerId}
                                  src={logoSrc(modelLogo, $activeTheme)}
                                  alt=""
                                />
                              {/if}
                              <span>
                                <strong>{model.model}</strong>
                                <small
                                  >{model.providerDisplayName} · {model.billingDomainDisplayName}</small
                                >
                                {#if model.includedInHeadline === false}
                                  <small>{t('separateFromHeadline')}</small>
                                {/if}
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
                              data-label={breakdownShareLabel()}
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
                                  aria-label={`${model.model} ${breakdownShareLabel()}`}
                                  aria-valuemin="0"
                                  aria-valuemax="100"
                                  aria-valuenow={Math.round(modelShare * 1000) / 10}
                                >
                                  <i
                                    style={`width: ${Math.max(2, Math.min(100, modelShare * 100))}%`}
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
                  </div>
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
        class="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-heading"
        tabindex="-1"
        bind:this={settingsPanel}
      >
        <button class="settings-close" aria-label={t('closeSettings')} on:click={closeSettings}
          >×</button
        >
        <nav class="settings-sidebar" aria-label="Settings Categories">
          <div class="settings-sidebar-header">
            <p class="eyebrow">{t('settings')}</p>
            <h2 id="settings-heading">{t('settings')}</h2>
            <p class="settings-sidebar-subtitle">{t('settingsSubtitle')}</p>
          </div>

          <div class="settings-sidebar-nav">
            <button
              type="button"
              class="settings-nav-button"
              class:active={settingsTab === 'connections'}
              on:click={() => openSettings('connections', false)}
            >
              <span>{t('connections')}</span>
            </button>
            <button
              type="button"
              class="settings-nav-button"
              class:active={settingsTab === 'rates'}
              on:click={() => openSettings('rates', false)}
            >
              <span>{t('customRatesNav')}</span>
              {#if customRates.length > 0}
                <span class="nav-count">{customRates.length}</span>
              {/if}
            </button>
            <button
              type="button"
              class="settings-nav-button"
              class:active={settingsTab === 'monitoring'}
              on:click={() => openSettings('monitoring', false)}
            >
              <span>{t('monitoring')}</span>
            </button>
            <button
              type="button"
              class="settings-nav-button"
              class:active={settingsTab === 'diagnostics'}
              on:click={() => openSettings('diagnostics', false)}
            >
              <span>{t('diagnosticsNav')}</span>
            </button>
            <button
              type="button"
              class="settings-nav-button"
              class:active={settingsTab === 'privacy'}
              on:click={() => openSettings('privacy', false)}
            >
              <span>{t('privacy')}</span>
            </button>
          </div>
        </nav>

        <div class="settings-main">
          <header class="settings-main-header">
            <div class="settings-main-actions">
              {#if settingsTab === 'rates'}
                <button
                  type="button"
                  class="rates-refresh-button"
                  title={t('customRateRefreshTitle')}
                  aria-label={t('customRateRefreshTitle')}
                  disabled={loadingRates}
                  on:click={loadCustomRates}
                >
                  <span class:spin={loadingRates} aria-hidden="true">↻</span>
                  {t('customRateRefresh')}
                </button>
                <button
                  type="button"
                  class="add-rate-toggle-button"
                  data-testid="toggle-add-rate-button"
                  aria-expanded={showAddRateForm}
                  aria-controls="custom-rate-form"
                  on:click={toggleAddRateForm}
                >
                  {showAddRateForm ? t('customRateCancel') : t('customRateAddToggle')}
                </button>
              {/if}
            </div>
          </header>

          <div class="settings-content">
            {#if settingsTab === 'connections'}
              <section
                class="settings-tab-panel connections-section"
                aria-label={t('connections')}
                data-testid="settings-panel-connections"
                tabindex="-1"
              >
                {#if connectorsError}
                  <p class="settings-error" role="status">{t('connectorsUnavailable')}</p>
                {/if}
                <div class="settings-connections">
                  {#each connectors.filter((c) => c.id !== 'xai-api') as connector (connector.id)}
                    {@const logo = providerLogoSources(connector.target.provider.id)}
                    <article
                      class:settings-target-active={settingsTarget === `connector:${connector.id}`}
                      data-settings-target={`connector:${connector.id}`}
                      data-testid={`settings-connector-${connector.id}`}
                      tabindex="-1"
                    >
                      <div class="settings-connector-title">
                        <div class="settings-connector-identity">
                          {#if logo}
                            <img
                              class="settings-connector-logo"
                              data-provider-logo={connector.target.provider.id}
                              src={logoSrc(logo, $activeTheme)}
                              alt=""
                            />
                          {/if}
                          <strong>{connector.displayName}</strong>
                        </div>
                        <span>{connectorStateLabel(connector.state)}</span>
                      </div>
                      <div class="connection-actions">
                        {#if connector.state === 'discovered' || connector.state === 'skipped'}
                          <button
                            class="primary-action"
                            disabled={!connector.installed || pendingConnectorId === connector.id}
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
            {:else if settingsTab === 'rates'}
              <section
                class="settings-tab-panel rates-section"
                aria-label={t('customRates')}
                data-testid="settings-rates"
                tabindex="-1"
              >
                {#if customRatesError}
                  <p class="settings-error" role="status">{t('customRatesUnavailable')}</p>
                {/if}

                <div class="custom-rates-container">
                  {#if showAddRateForm}
                    <form
                      id="custom-rate-form"
                      class="custom-rate-form"
                      data-testid="custom-rate-form"
                      on:submit|preventDefault={saveCustomRate}
                    >
                      <div class="custom-rate-inputs">
                        <label>
                          <span>{t('customRateProvider')}</span>
                          <select
                            bind:value={rateProviderChoice}
                            on:change={handleProviderChoiceChange}
                          >
                            {#each defaultRateProviders as p (p.id)}
                              <option value={p.id}>{p.label} ({p.id})</option>
                            {/each}
                            <option value="custom">{t('customRateProviderOther')}</option>
                          </select>
                        </label>
                        {#if rateProviderChoice === 'custom'}
                          <label>
                            <span>{t('customRateProvider')} ID</span>
                            <input
                              type="text"
                              bind:value={newRateDraft.providerId}
                              placeholder={t('customRateProviderCustomPlaceholder')}
                              required
                            />
                          </label>
                        {/if}
                        <label>
                          <span>{t('customRateDomain')}</span>
                          <input
                            type="text"
                            bind:value={newRateDraft.billingDomainId}
                            placeholder={t('customRateDomainWildcard')}
                          />
                        </label>
                        <label>
                          <span>{t('customRateModel')}</span>
                          <input
                            type="text"
                            bind:value={newRateDraft.model}
                            placeholder="e.g. gpt-4o, qwen-max"
                            required
                          />
                        </label>
                        <label>
                          <span>{t('customRateInput')}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            bind:value={newRateDraft.inputRate}
                            placeholder="2.0"
                            required
                          />
                        </label>
                        <label>
                          <span>{t('customRateOutput')}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            bind:value={newRateDraft.outputRate}
                            placeholder="8.0"
                            required
                          />
                        </label>
                        <label>
                          <span>{t('customRateCacheRead')}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            bind:value={newRateDraft.cacheReadRate}
                            placeholder="0.5"
                          />
                        </label>
                      </div>
                      <div class="custom-rate-actions">
                        <button type="submit" class="button-primary" disabled={savingRate}>
                          {savingRate ? t('customRateUpdating') : t('customRateAdd')}
                        </button>
                        <button
                          type="button"
                          class="button-secondary"
                          disabled={savingRate}
                          on:click={cancelAddRate}
                        >
                          {t('customRateCancel')}
                        </button>
                      </div>
                    </form>
                  {/if}

                  {#if loadingRates && customRates.length === 0}
                    <small class="custom-rate-empty">{t('loading')}</small>
                  {:else if customRates.length === 0}
                    <div class="custom-rate-empty-container">
                      <p class="custom-rate-empty">{t('customRateEmpty')}</p>
                      {#if !showAddRateForm}
                        <button
                          type="button"
                          class="add-rate-button-empty"
                          data-testid="empty-add-custom-rate-button"
                          on:click={() => (showAddRateForm = true)}
                        >
                          {t('customRateAddToggle')}
                        </button>
                      {/if}
                    </div>
                  {:else}
                    <div class="custom-rates-list" data-testid="custom-rates-list">
                      {#each customRates as rate (rate.id)}
                        <article
                          class="custom-rate-card"
                          data-testid={`custom-rate-${rate.id}`}
                          class:settings-target-active={settingsTarget === `rate:${rate.id}`}
                        >
                          {#if editingRateId === rate.id}
                            <form
                              class="custom-rate-edit-form"
                              on:submit|preventDefault={updateCustomRate}
                            >
                              <div class="custom-rate-edit-header">
                                <strong>{rate.model}</strong>
                                <small
                                  >{rate.providerId} · {formatRateDomain(
                                    rate.billingDomainId,
                                    t('customRateDomainWildcard')
                                  )}</small
                                >
                              </div>
                              <div class="custom-rate-edit-fields">
                                <label>
                                  <span>{t('customRateDomain')}</span>
                                  <input
                                    type="text"
                                    bind:value={editRateDraft.billingDomainId}
                                    placeholder={t('customRateDomainWildcard')}
                                  />
                                </label>
                                <label>
                                  <span>{t('customRateInput')}</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    bind:value={editRateDraft.inputRate}
                                    required
                                  />
                                </label>
                                <label>
                                  <span>{t('customRateOutput')}</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    bind:value={editRateDraft.outputRate}
                                    required
                                  />
                                </label>
                                <label>
                                  <span>{t('customRateCacheRead')}</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    bind:value={editRateDraft.cacheReadRate}
                                  />
                                </label>
                              </div>
                              <div class="custom-rate-edit-actions">
                                <button type="submit" disabled={updatingRate}>
                                  {updatingRate ? t('customRateUpdating') : t('customRateSave')}
                                </button>
                                <button
                                  type="button"
                                  disabled={updatingRate}
                                  on:click={cancelEditRate}
                                >
                                  {t('customRateCancel')}
                                </button>
                              </div>
                            </form>
                          {:else}
                            <div class="custom-rate-header">
                              <div class="custom-rate-title-row">
                                <strong class="custom-rate-model-name">{rate.model}</strong>
                                <span class="custom-rate-provider-badge">{rate.providerId}</span>
                              </div>
                              <small class="custom-rate-domain-label"
                                >{rate.providerId} · {formatRateDomain(
                                  rate.billingDomainId,
                                  t('customRateDomainWildcard')
                                )}</small
                              >
                            </div>
                            <div class="custom-rate-details">
                              <div class="rate-metric">
                                <small>{t('customRateInput')}:</small>
                                <b>{formatRatePerMillion(rate.ratesPerMillion.input)}</b>
                              </div>
                              <div class="rate-metric">
                                <small>{t('customRateOutput')}:</small>
                                <b>{formatRatePerMillion(rate.ratesPerMillion.output)}</b>
                              </div>
                              <div class="rate-metric">
                                <small>{t('customRateCacheRead')}:</small>
                                <b>{formatRatePerMillion(rate.ratesPerMillion.cacheRead)}</b>
                              </div>
                            </div>
                            <div class="custom-rate-footer">
                              <small class="custom-rate-updated-time">
                                {t('customRateUpdated')}
                                {formatReset(rate.updatedAt)}
                              </small>
                              <div class="custom-rate-card-actions">
                                <button type="button" on:click={() => startEditRate(rate)}>
                                  {t('customRateEdit')}
                                </button>
                                <button
                                  type="button"
                                  disabled={deletingRateId === rate.id}
                                  on:click={() => deleteCustomRate(rate.id)}
                                >
                                  {deletingRateId === rate.id
                                    ? t('customRateDeleting')
                                    : t('customRateDelete')}
                                </button>
                              </div>
                            </div>
                          {/if}
                        </article>
                      {/each}
                    </div>
                  {/if}
                </div>
              </section>
            {:else if settingsTab === 'monitoring'}
              <section
                class="settings-tab-panel monitoring-section"
                aria-label={t('monitoring')}
                data-testid="settings-panel-monitoring"
                tabindex="-1"
              >
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
            {:else if settingsTab === 'diagnostics'}
              <section
                class="settings-tab-panel diagnostics-section"
                aria-label={t('diagnosticsNav')}
                data-testid="settings-panel-diagnostics"
                tabindex="-1"
              >
                {#if diagnosticsError}
                  <p class="settings-error" role="status">{t('diagnosticsUnavailable')}</p>
                {/if}
                {#if diagnostics}
                  <div class="diagnostics-grid">
                    {#each diagnostics.connectors.filter((diagnostic) => diagnostic.id !== 'xai-api' && !isAutomaticallyManagedCategory(diagnostic.category)) as diagnostic (diagnostic.id)}
                      <article
                        class:diagnostic-degraded={diagnostic.status === 'degraded'}
                        class:settings-target-active={settingsTarget ===
                          `diagnostic:${diagnostic.id}`}
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
                          <p>
                            {diagnostic.affectedCoverage.map(coverageDimensionLabel).join(' · ')}
                          </p>
                        {/if}
                        {#if diagnosticRecovery(diagnostic)}
                          <code>{diagnosticRecovery(diagnostic)}</code>
                        {/if}
                      </article>
                    {/each}
                  </div>
                {/if}
              </section>
            {:else if settingsTab === 'privacy'}
              <section
                class="settings-tab-panel privacy-section"
                aria-label={t('privacy')}
                data-testid="settings-panel-privacy"
                tabindex="-1"
              >
                {#if retentionError}
                  <p class="settings-error" role="status">{t('retentionUnavailable')}</p>
                {:else if retention}
                  <div class="retention-info-bar">
                    <small>
                      {retention.rawRetentionDays}
                      {t('retentionDays')} · {retention.rawObservations}
                      {t('rawObservations')} · {retention.dailyAggregates}
                      {t('dailyAggregates')}
                    </small>
                  </div>
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
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if selectedModelEntry}
    {@const model = selectedModelEntry}
    {@const modelCost =
      model.retailEquivalent.status !== 'unavailable'
        ? model.retailEquivalent
        : model.reportedEstimate}
    {@const priceSnapshots = model.priceSnapshots}
    {@const compositionTotals = model.composition}
    {@const trendEvidence = modelTrendEvidence(model)}
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
            <h2>{model.model}</h2>
            {#if model.includedInHeadline === false}
              <p>{t('separateFromHeadline')}</p>
            {/if}
          </div>
          <button aria-label={t('closeModelDetail')} on:click={closeModelDetail}>×</button>
        </div>

        <div class="model-detail-content">
          <div class="model-detail-summary" data-testid="model-detail-summary">
            <span>
              <small>{t('recordedTotal')}</small>
              <b>{formatNumber(model.tokenEvidence.recordedTokens)}</b>
            </span>
            <span>
              <small>{t('cost')}</small>
              <b>
                {modelCost.status !== 'unavailable'
                  ? formatMoney(modelCost.amount, modelCost.comparisonCurrency)
                  : t('notAvailable')}
              </b>
            </span>
            <span>
              <small>{t('observations')}</small>
              <b>{formatNumber(model.tokenEvidence.observationCount)}</b>
            </span>
          </div>

          {#if modelCost.status === 'unavailable'}
            <div class="model-custom-rate-prompt">
              <button
                type="button"
                class="configure-rate-button"
                on:click={() =>
                  configureCustomRateForModel(model.providerId, model.billingDomainId, model.model)}
              >
                + {t('setCustomRateForModel')}
              </button>
            </div>
          {/if}

          <section class="model-activity" aria-labelledby="model-activity-heading">
            <h3 id="model-activity-heading">{t('activityOverview')}</h3>
            <ModelDetailChart
              {compositionTotals}
              unclassifiedTokens={model.tokenEvidence.unclassifiedTokens}
              trend={model.trend}
              {trendEvidence}
              {locale}
              {formatNumber}
              {formatMoney}
            />
          </section>

          <section
            class="model-evidence-summary"
            data-testid="model-evidence-summary"
            aria-labelledby="model-evidence-heading"
          >
            <h3 id="model-evidence-heading">{t('evidenceSummary')}</h3>
            <div>
              <span>
                <small>{t('scope')}</small>
                <strong>
                  {model.tokenEvidence.usageScopes.map(usageScopeLabel).join(' + ') || t('unknown')}
                </strong>
              </span>
              <span>
                <small>{t('totalDerivation')}</small>
                <strong>
                  {model.tokenEvidence.totalDerivations.map(totalDerivationLabel).join(' + ') ||
                    t('unknown')}
                </strong>
              </span>
              <span>
                <small>{t('latestData')}</small>
                <strong>{formatReset(model.lastObservedAt)}</strong>
              </span>
              {#if priceSnapshots.length > 0}
                <span class="model-price-source">
                  <small>{t('priceSnapshot')}</small>
                  <strong>
                    {priceSnapshots
                      .map((snapshot) => `${snapshot.version} · ${snapshot.source}`)
                      .join(' + ')}
                  </strong>
                </span>
              {/if}
            </div>
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
    --selected: #5b74e6;
    --selected-text: #ffffff;
    --primary: #647cf0;
    --progress-track: #e2e6ed;
    --shadow-soft: 0 12px 34px rgba(31, 38, 56, 0.08);
    --shadow-raised: 0 18px 48px rgba(31, 38, 56, 0.12);
    --backdrop: rgba(18, 19, 18, 0.45);
    --success-bg: #e7f8f0;
    --success-border: #b4e4cd;
    --success-text: #178a54;
    --warning-bg: #fff8ed;
    --warning-border: #d9b47d;
    --warning-text: #74400f;
    --danger-bg: #fff4f2;
    --danger-border: #d8a29e;
    --danger-text: #922f2b;
    --focus: #315fd3;
    --wall-level-0: #dce1e9;
    --wall-level-1: #9be9a8;
    --wall-level-2: #40c463;
    --wall-level-3: #30a14e;
    --wall-level-4: #216e39;
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
  .settings-toggle,
  .theme-toggle {
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

  .theme-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .theme-icon {
    font-size: 0.85rem;
    line-height: 1;
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

  .segmented-control button[aria-pressed='true'],
  .segmented-control button[aria-selected='true'] {
    background: #29324b;
    color: #eef2ff;
  }

  .usage-overview-grid {
    position: relative;
    display: grid;
    grid-template-columns: minmax(340px, 0.42fr) minmax(0, 1fr);
    gap: 14px;
    align-items: stretch;
  }

  .usage-summary-board {
    position: relative;
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

  .custom-rates-container {
    display: grid;
    gap: 14px;
  }

  .rates-refresh-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: 1px solid var(--border-soft);
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    font-size: 0.68rem;
    cursor: pointer;
  }

  .rates-refresh-button:hover {
    color: var(--text-strong);
    border-color: var(--border);
  }

  .add-rate-toggle-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border: 1px solid var(--accent);
    border-radius: 7px;
    background: var(--accent-subtle, rgba(99, 102, 241, 0.12));
    color: var(--accent-text, #818cf8);
    font-size: 0.68rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .add-rate-toggle-button:hover {
    background: var(--accent);
    color: #ffffff;
  }

  .model-custom-rate-prompt {
    margin-top: 8px;
  }

  .configure-rate-button {
    width: 100%;
    padding: 6px 12px;
    border: 1px dashed var(--border);
    border-radius: 8px;
    background: var(--surface-subtle);
    color: var(--text-soft);
    font-size: 0.7rem;
    cursor: pointer;
    text-align: center;
  }

  .configure-rate-button:hover {
    color: var(--text-strong);
    border-color: var(--text-soft);
  }

  .custom-rate-form {
    display: grid;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--border-soft);
    border-radius: 14px;
    background: var(--surface-inset);
  }

  .custom-rate-inputs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 8px;
  }

  .custom-rate-inputs label {
    display: grid;
    gap: 4px;
    color: var(--muted);
    font-size: 0.63rem;
  }

  .custom-rate-inputs input,
  .custom-rate-inputs select {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-subtle);
    color: var(--text-strong);
    font-size: 0.72rem;
  }

  .custom-rate-actions {
    display: flex;
    gap: 8px;
  }

  .custom-rate-actions button,
  .custom-rate-card-actions button {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-subtle);
    color: var(--text-strong);
    font-size: 0.7rem;
    cursor: pointer;
  }

  .custom-rate-actions button:hover,
  .custom-rate-card-actions button:hover {
    border-color: var(--text-soft);
  }

  .custom-rate-actions .button-primary {
    background: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
  }

  .custom-rate-actions .button-primary:hover {
    filter: brightness(1.1);
  }

  .custom-rate-empty-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 28px 16px;
    border: 1px dashed var(--border-soft);
    border-radius: 12px;
    background: var(--surface-subtle);
  }

  .custom-rate-empty-container p {
    margin: 0;
  }

  .add-rate-button-empty {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-inset);
    color: var(--text-strong);
    font-size: 0.72rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .add-rate-button-empty:hover {
    border-color: var(--accent);
    color: var(--accent-text, #818cf8);
  }

  .custom-rate-empty {
    color: var(--muted);
    font-size: 0.72rem;
  }

  .custom-rates-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 10px;
  }

  .custom-rate-card {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border-soft);
    border-radius: 12px;
    background: var(--surface-inset);
    transition: border-color 0.15s ease;
  }

  .custom-rate-card:hover {
    border-color: var(--border);
  }

  .custom-rate-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  .custom-rate-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .custom-rate-header strong {
    color: var(--text-strong);
    font-size: 0.78rem;
  }

  .custom-rate-provider-badge {
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--surface-subtle);
    border: 1px solid var(--border-soft);
    color: var(--text-soft);
    font-size: 0.62rem;
    font-weight: 500;
  }

  .custom-rate-header small {
    color: var(--muted);
    font-size: 0.64rem;
  }

  .custom-rate-details {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--surface-subtle);
    font-size: 0.64rem;
  }

  .rate-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .rate-metric small {
    color: var(--muted);
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .rate-metric b {
    color: var(--text-strong);
    font-size: 0.68rem;
    font-weight: 600;
  }

  .custom-rate-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px solid var(--border-soft);
  }

  .custom-rate-updated-time {
    color: var(--muted);
    font-size: 0.6rem;
  }

  .custom-rate-edit-form {
    display: grid;
    gap: 10px;
  }

  .custom-rate-edit-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  .custom-rate-edit-header strong {
    color: var(--text-strong);
    font-size: 0.78rem;
  }

  .custom-rate-edit-header small {
    color: var(--muted);
    font-size: 0.64rem;
  }

  .custom-rate-edit-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 6px;
  }

  .custom-rate-edit-fields label {
    display: grid;
    gap: 3px;
    color: var(--muted);
    font-size: 0.62rem;
  }

  .custom-rate-edit-fields input {
    width: 100%;
    padding: 5px 6px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface-subtle);
    color: var(--text-strong);
    font-size: 0.7rem;
  }

  .custom-rate-edit-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .custom-rate-edit-actions button {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface-subtle);
    color: var(--text-strong);
    font-size: 0.68rem;
    cursor: pointer;
  }

  .model-ranking {
    position: relative;
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

  .treemap-wrap {
    margin: 2px 0 14px;
    padding: 12px;
    border: 1px solid rgba(122, 136, 164, 0.14);
    border-radius: 14px;
    background: var(--surface-inset);
  }

  .treemap-hint {
    margin: 8px 2px 0;
    color: var(--muted);
    font-size: 0.66rem;
    line-height: 1.4;
  }

  .breakdown-header,
  .ranking-list button {
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

  .ranking-logo {
    display: block;
    width: 30px;
    height: 30px;
    padding: 4px;
    object-fit: contain;
  }

  .ranking-logo[data-provider-logo='codex'],
  .ranking-logo[data-provider-logo='dsh'] {
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

  /* The refreshing state rides on the panel's top edge so cached content keeps
     its exact position: an in-flow notice would push every panel child down
     while a window switch loads. */
  .panel-progress {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    height: 2px;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--primary) 16%, transparent);
    pointer-events: none;
  }

  .panel-progress::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 32%;
    border-radius: inherit;
    background: var(--primary);
    animation: panel-progress 1.15s ease-in-out infinite;
  }

  @keyframes panel-progress {
    from {
      transform: translateX(-110%);
    }

    to {
      transform: translateX(420%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel-progress::after {
      width: 100%;
      animation: none;
    }
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
    border: 1px solid var(--success-border);
    border-radius: 13px;
    background: var(--success-bg);
  }

  .diagnostics-grid article.diagnostic-degraded {
    border-color: var(--warning-border);
    background: var(--warning-bg);
  }

  .diagnostics-grid article > div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .diagnostics-grid span,
  .diagnostics-grid small,
  .diagnostics-grid p {
    color: var(--muted);
    font-size: 0.68rem;
  }

  .diagnostics-grid p {
    margin: 0;
  }

  .diagnostics-grid code {
    color: var(--warning-text);
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

  .provider-card-loading {
    min-height: 400px;
  }

  .provider-card-loading > :not(.agent-card-skeleton-overlay):not(.provider-heading) {
    visibility: hidden;
  }

  .agent-card-skeleton-overlay {
    position: absolute;
    z-index: 2;
    inset: 74px 0 0;
    padding: 0 26px 26px;
    background: var(--surface);
  }

  .agent-card-skeleton-content {
    width: 100%;
  }

  .agent-skeleton-block {
    display: block;
    min-height: 14px;
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

  /* Mirrors the loaded card: the heading stays real, then the quota section
     label and its rows. */
  .agent-skeleton-section-label {
    padding-top: 20px;
  }

  .agent-skeleton-section-label .agent-skeleton-block {
    width: 76px;
    min-height: 12px;
  }

  .agent-skeleton-quota-list {
    margin-top: 12px;
  }

  .agent-skeleton-quota-row + .agent-skeleton-quota-row {
    margin-top: 20px;
  }

  .agent-skeleton-quota-copy {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .agent-skeleton-quota-copy .agent-skeleton-block:first-child {
    width: 58%;
  }

  .agent-skeleton-quota-copy .agent-skeleton-block:last-child {
    width: 24%;
    min-height: 11px;
  }

  .agent-skeleton-progress {
    min-height: 8px;
    margin: 10px 0 9px;
    border-radius: 999px;
  }

  .agent-skeleton-meta {
    width: 62%;
    min-height: 10px;
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

    .provider-card-loading:hover {
      border-color: var(--border);
      box-shadow: var(--shadow-soft);
      transform: none;
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

  .provider-heading {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .provider-heading-copy {
    min-width: 0;
    flex: 1;
  }

  /* The status cluster rides on the Agent name's own line, so it costs the card
     no extra height. */
  .provider-heading-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .provider-logo {
    display: block;
    width: 46px;
    height: 46px;
    flex: 0 0 46px;
    object-fit: contain;
  }

  /* Monochrome official marks keep a light plate so the reviewed asset stays
     legible in both themes without being recolored. */
  .provider-logo[data-provider-logo='codex'],
  .provider-logo[data-provider-logo='dsh'] {
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
    background: var(--success-text);
    box-shadow: 0 0 10px color-mix(in srgb, var(--success-text) 45%, transparent);
  }

  .freshness[data-status='unavailable'] span {
    background: #6e7480;
  }

  .freshness[data-status='updating'] span {
    background: var(--primary);
    box-shadow: 0 0 10px color-mix(in srgb, var(--primary) 55%, transparent);
    animation: status-pulse 1s ease-in-out infinite alternate;
  }

  .provider-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    margin-left: auto;
    gap: 6px;
  }

  /* Connected state and its management action live in one compact control so a
     long Agent name still shares the row with them. */
  .connection-chip {
    display: inline-flex;
    align-items: center;
  }

  .connection-chip button {
    display: inline-flex;
    width: 26px;
    height: 26px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--success-border);
    border-radius: 999px;
    background: var(--success-bg);
    color: var(--success-text);
    cursor: pointer;
    font-size: 0.82rem;
    line-height: 1;
  }

  .connection-chip button:hover {
    border-color: var(--success-text);
  }

  .connection-chip button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .coverage {
    padding: 4px 9px;
    border: 1px solid var(--success-border);
    border-radius: 999px;
    color: var(--success-text);
    font-size: 0.66rem;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .section-label {
    margin-top: auto;
    padding-top: 20px;
  }

  .quota-absent {
    margin: 0;
    color: #aab1bf;
    font-size: 0.76rem;
    line-height: 1.55;
  }

  .quota-row + .quota-row {
    margin-top: 20px;
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

  .settings-backdrop {
    position: fixed;
    z-index: 40;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--backdrop);
    backdrop-filter: blur(8px);
  }

  .model-detail-backdrop {
    position: fixed;
    z-index: 50;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--backdrop);
    backdrop-filter: blur(8px);
  }

  .model-detail-drawer {
    width: min(1280px, 100%);
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 20px;
    outline: none;
    background: var(--surface);
    box-shadow: 0 28px 80px rgba(0, 0, 0, 0.24);
  }

  .model-detail-header {
    position: sticky;
    z-index: 2;
    top: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    padding: 22px 24px 18px;
    border-bottom: 1px solid var(--border-soft);
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    backdrop-filter: blur(18px);
  }

  .model-detail-header h2,
  .model-detail-header p {
    margin: 0;
  }

  .model-detail-header h2 {
    margin-top: 5px;
    overflow-wrap: anywhere;
    color: var(--text-strong);
    font-size: 1.2rem;
  }

  .model-detail-header button {
    width: 36px;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--button);
    color: var(--text-strong);
    cursor: pointer;
    font-size: 1.15rem;
  }

  .model-detail-content {
    display: grid;
    gap: 16px;
    padding: 20px 24px 24px;
  }

  .model-detail-content section h3 {
    margin: 0 0 10px;
    color: var(--text-strong);
    font-size: 0.8rem;
  }

  .model-detail-summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .model-detail-summary span {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 13px 14px;
    border: 1px solid var(--border-soft);
    border-radius: 12px;
    background: var(--surface-inset);
  }

  .model-detail-summary small {
    overflow: hidden;
    color: var(--muted);
    font-size: 0.66rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-detail-summary b {
    overflow: hidden;
    color: var(--text-strong);
    font-size: 0.95rem;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-activity {
    position: relative;
    min-width: 0;
    padding: 14px 16px 4px;
    border: 1px solid var(--border-soft);
    border-radius: 14px;
    background: var(--surface-subtle);
  }

  .model-evidence-summary > div {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1px;
    overflow: hidden;
    border: 1px solid var(--border-soft);
    border-radius: 12px;
    background: var(--border-soft);
  }

  .model-evidence-summary span {
    display: grid;
    gap: 5px;
    min-width: 0;
    padding: 11px 12px;
    background: var(--surface-inset);
  }

  .model-evidence-summary small,
  .model-evidence-summary strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-evidence-summary small {
    color: var(--muted);
    font-size: 0.62rem;
  }

  .model-evidence-summary strong {
    color: var(--text);
    font-size: 0.7rem;
    font-weight: 600;
  }

  .model-evidence-summary .model-price-source {
    grid-column: auto;
  }

  .settings-dialog {
    position: relative;
    display: grid;
    grid-template-columns: 220px 1fr;
    width: min(880px, 94vw);
    height: min(640px, 86vh);
    max-height: calc(100vh - 48px);
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 20px;
    outline: none;
    background: var(--surface);
    box-shadow: 0 28px 80px rgba(0, 0, 0, 0.28);
  }

  .settings-sidebar {
    display: flex;
    flex-direction: column;
    padding: 24px 16px;
    border-right: 1px solid var(--border-soft);
    background: var(--surface-subtle);
    overflow-y: auto;
  }

  .settings-sidebar-header {
    margin-bottom: 20px;
    padding: 0 8px;
  }

  .settings-sidebar-header h2 {
    margin: 4px 0 6px;
    font-size: 1.15rem;
    color: var(--text-strong);
  }

  .settings-sidebar-header p {
    margin: 0;
  }

  .settings-sidebar-subtitle {
    color: var(--muted);
    font-size: 0.74rem;
    line-height: 1.4;
  }

  .settings-sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .settings-nav-button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--muted);
    font-size: 0.82rem;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .settings-nav-button:hover {
    color: var(--text-strong);
    background: var(--surface);
    border-color: var(--border-soft);
  }

  .settings-nav-button.active {
    color: var(--text-strong);
    background: var(--surface);
    border-color: var(--border);
    font-weight: 600;
  }

  .settings-nav-button .nav-count {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--surface-inset);
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 600;
  }

  .settings-nav-button.active .nav-count {
    background: var(--primary);
    color: #fff;
  }

  .settings-main {
    position: relative;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--surface);
  }

  .settings-main-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 64px 8px 24px;
    flex-shrink: 0;
    min-height: 52px;
  }

  .settings-main-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .settings-close {
    position: absolute;
    top: 16px;
    right: 24px;
    z-index: 2;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--surface-subtle);
    color: var(--text-strong);
    cursor: pointer;
    font-size: 1.25rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .settings-close:hover {
    border-color: var(--text-strong);
    background: var(--surface);
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 8px 24px 36px;
    min-height: 0;
  }

  .settings-tab-panel,
  .settings-dialog .settings-content > section {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0 solid var(--border) !important;
    border-radius: 0;
    background: transparent !important;
    box-shadow: none !important;
    outline: none !important;
  }

  .retention-info-bar {
    padding: 10px 14px;
    border: 1px solid var(--border-soft);
    border-radius: 10px;
    background: var(--surface-subtle);
    color: var(--muted);
    font-size: 0.72rem;
  }

  .settings-connections {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .settings-connections article {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 14px;
    padding: 14px 16px;
    border: 1px solid var(--border-soft);
    border-radius: 14px;
    outline: none;
    background: var(--surface-inset);
    transition: border-color 0.15s ease;
  }

  .settings-connections article:hover {
    border-color: var(--border);
  }

  .settings-connector-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .settings-connector-identity {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .settings-connector-identity strong {
    color: var(--text-strong);
    font-size: 0.86rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settings-connector-logo {
    display: block;
    width: 20px;
    height: 20px;
    object-fit: contain;
    flex: none;
  }

  .settings-connector-logo[data-provider-logo='codex'],
  .settings-connector-logo[data-provider-logo='dsh'] {
    border-radius: 4px;
    background: #fff;
    padding: 2px;
  }

  .settings-connector-title span {
    color: var(--muted);
    font-size: 0.68rem;
    font-weight: 500;
    flex: none;
  }

  .settings-dialog .monitoring-section,
  .settings-dialog .diagnostics-section,
  .settings-dialog .privacy-section {
    display: block;
    margin: 0;
  }

  .settings-dialog .monitoring-controls,
  .settings-dialog .privacy-actions {
    justify-content: flex-start;
  }

  .settings-target-active,
  [data-settings-target]:focus-visible {
    border-color: #6f89ef !important;
    box-shadow: 0 0 0 3px rgba(98, 126, 239, 0.17);
  }

  /* Theme surfaces stay neutral so Provider identity comes from official artwork and data. */
  .token-money-workbench,
  .settings-content > section {
    border-color: var(--border);
    background: var(--surface);
  }

  .settings-dialog .settings-content > section {
    margin: 0;
    background: var(--surface-subtle);
  }

  .inline-connection,
  .settings-connections article,
  .model-detail-summary span {
    border-color: var(--border-soft);
    background: var(--surface-inset);
  }

  .segmented-control,
  .history-toolbar,
  .domain-tabs {
    border-color: var(--border-soft);
    background: var(--surface-inset);
  }

  .refresh,
  .locale-toggle,
  .settings-toggle,
  .theme-toggle {
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
  .ranking-identity small,
  .breakdown-header,
  .usage-totals dt,
  .diagnostics-grid span,
  .diagnostics-grid small,
  .diagnostics-grid p,
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
  .settings-sidebar-subtitle,
  .settings-connector-title span {
    color: var(--muted);
  }

  .usage-toolbar p strong,
  .usage-headline > strong,
  .usage-totals h3,
  .usage-totals dd,
  .ranking-heading h3,
  .ranking-identity strong,
  .ranking-value strong,
  .inline-connection summary strong,
  .coverage-list strong,
  .model-detail-header button,
  .model-detail-content section h3,
  .model-detail-summary b,
  .settings-close {
    color: var(--text-strong);
  }

  .segmented-control button[aria-pressed='true'],
  .segmented-control button[aria-selected='true'],
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

  .settings-dialog .monitoring-controls label,
  .settings-dialog .privacy-actions button,
  .settings-dialog .privacy-actions label,
  .settings-dialog .connection-actions button {
    border-color: var(--border);
    background: var(--button);
    color: var(--text);
  }

  .settings-dialog .connection-actions button.primary-action {
    border-color: var(--primary);
    background: var(--primary);
    color: #fff;
  }

  .settings-dialog .privacy-actions button.danger-action {
    border-color: var(--danger-border);
    color: var(--danger-text);
  }

  .settings-dialog .settings-close {
    border-color: var(--border);
    color: var(--text-strong);
  }

  .model-detail-header {
    border-color: var(--border);
    background: color-mix(in srgb, var(--surface) 94%, transparent);
  }

  :global(html[data-theme='dark']) {
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
    --success-bg: #10241d;
    --success-border: #1e5c43;
    --success-text: #64dca8;
    --warning-bg: #211912;
    --warning-border: #684722;
    --warning-text: #f0bd83;
    --danger-bg: #241416;
    --danger-border: #71363a;
    --wall-level-0: #2d333b;
    --wall-level-1: #0e4429;
    --wall-level-2: #006d32;
    --wall-level-3: #26a641;
    --wall-level-4: #39d353;
    --danger-text: #ffaaa5;
    --focus: #9bb1ff;
  }

  :global(html[data-theme='dark']) :global(body)::before {
    opacity: 0.78;
  }

  @media (min-width: 1640px) {
    .providers {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .provider-card {
      padding: 20px;
    }

    .agent-card-skeleton-overlay {
      inset-block-start: 66px;
      padding-inline: 20px;
    }
  }

  @media (max-width: 759px) {
    .providers {
      grid-template-columns: 1fr;
    }

    .settings-dialog {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      width: min(100%, 100vw);
      height: 100%;
      max-height: 100vh;
      border-radius: 0;
      border: none;
    }

    .settings-sidebar {
      border-right: none;
      border-bottom: 1px solid var(--border-soft);
      padding: 14px 16px;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .settings-sidebar-header {
      display: none;
    }

    .settings-sidebar-nav {
      flex-direction: row;
      flex-wrap: nowrap;
      gap: 6px;
    }

    .settings-nav-button {
      flex-shrink: 0;
      width: auto;
      padding: 7px 12px;
      white-space: nowrap;
    }

    .settings-main-header {
      padding: 10px 16px 6px;
      min-height: 44px;
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

  @keyframes status-pulse {
    from {
      opacity: 0.45;
    }

    to {
      opacity: 1;
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
    .settings-toggle,
    .theme-toggle {
      min-height: 36px;
    }

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

    .usage-overview-grid {
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

    .ranking-heading {
      align-items: flex-start;
      flex-direction: column;
    }

    .breakdown-header,
    .ranking-list button {
      grid-template-columns: minmax(180px, 1.4fr) repeat(3, minmax(86px, 0.6fr));
    }

    .model-ranking {
      overflow-x: auto;
    }

    .breakdown-header,
    .ranking-list {
      min-width: 620px;
    }

    .model-detail-header,
    .model-detail-content {
      padding-right: 18px;
      padding-left: 18px;
    }

    .model-detail-backdrop {
      align-items: stretch;
      padding: 0;
    }

    .model-detail-drawer {
      max-height: 100vh;
      border-width: 0;
      border-radius: 0;
    }

    .model-detail-summary,
    .model-evidence-summary > div {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .model-evidence-summary .model-price-source {
      grid-column: span 2;
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

    .agent-skeleton-block {
      animation: none !important;
    }
  }
</style>
