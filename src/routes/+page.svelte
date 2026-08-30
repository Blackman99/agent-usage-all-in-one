<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';

  import type {
    AgentProviderIndex,
    BillingDomainOverview,
    CoverageLevel,
    DataAuthority,
    BillingHistory,
    DoctorReport,
    HistoryModelObservation,
    HistoryModelPriceEvidence,
    HistoryWindow,
    MonitoringSettings,
    PlanBillingPeriod,
    PlanSettings,
    ProcessingStatus,
    ProviderOverview,
    QuotaBucket,
    RetentionStatus,
    TokenTotals,
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
  import {
    activeTheme,
    initTheme,
    setThemePreference,
    themePreference,
    type ThemePreference
  } from '$lib/theme.js';
  import ModelDetailChart from '$lib/ModelDetailChart.svelte';
  import ModelBreakdownTreemap from '$lib/ModelBreakdownTreemap.svelte';
  import ModelTrendStackedChart from '$lib/ModelTrendStackedChart.svelte';
  import PlanValueChart from '$lib/PlanValueChart.svelte';
  import ProviderShareChart from '$lib/ProviderShareChart.svelte';
  import QuotaTimelineChart from '$lib/QuotaTimelineChart.svelte';
  import type { QuotaTimelineProvider } from '$lib/quota-timeline.js';
  import { buildPlanValueRanking, type PlanValueFormatters } from '$lib/plan-value.js';
  import { trendSegmentColor } from '$lib/usage-trend.js';
  import UsageTrendChart from '$lib/UsageTrendChart.svelte';
  import '$lib/dashboard-polish.css';

  const DEFAULT_AGENT_PROVIDERS: AgentProviderIndex['providers'] = [
    { id: 'codex', displayName: 'Codex' },
    { id: 'claude-code', displayName: 'Claude Code' },
    { id: 'opencode-go', displayName: 'OpenCode Go' },
    { id: 'grok', displayName: 'Grok' }
  ];
  const DEFAULT_AGENT_PROVIDER_IDS = new Set(
    DEFAULT_AGENT_PROVIDERS.map((provider) => provider.id)
  );

  interface PlanDraft {
    selection: string;
    amount: string;
    currency: string;
    billingPeriod: PlanBillingPeriod;
    anchorDate: string;
  }

  let locale: Locale = 'en';
  let metaDescription: string;
  let overview: UsageOverview | null = null;
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
  let planSettings: PlanSettings | null = null;
  let planError = false;
  let planDrafts: Record<string, PlanDraft> = {};
  let pendingPlanDomain: string | null = null;
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
  $: planValueCurrency = effectiveOverview?.workbench?.comparisonCurrency ?? selectedCurrency;
  $: planValueFormatters = createPlanValueFormatters(planValueCurrency, locale);
  // Only billing domains that can actually hold a declared price are offered:
  // OpenCode local history, for one, is cross-Provider local usage with no plan.
  $: planEligibleKeys = new Set(
    (planSettings?.domains ?? []).map((domain) =>
      planDomainKey(domain.providerId, domain.billingDomainId)
    )
  );
  $: planValueUnconfigured = (
    effectiveOverview?.workbench?.planValue?.unconfiguredDomains ?? []
  ).filter((domain) =>
    planEligibleKeys.has(planDomainKey(domain.providerId, domain.billingDomainId))
  );
  $: planValueRanking = effectiveOverview?.workbench?.planValue
    ? buildPlanValueRanking(
        effectiveOverview.workbench.planValue,
        trendSegmentColor,
        planValueFormatters,
        t('planCustom')
      )
    : [];

  onMount(async () => {
    initTheme();
    locale = detectLocale(navigator.language);
    document.documentElement.lang = locale;
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    selectedWindow = storedWindow();
    selectedCurrency = storedCurrency();
    await Promise.all([
      loadOverview(),
      loadAgentProviders(),
      loadConnectors(),
      loadMonitoring(),
      loadPlanSettings(),
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
      const visibleProviders = index.providers.filter((provider) => provider.id !== 'opencode');
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
      await Promise.all([loadOverview(), loadAgentProviders(), loadDiagnostics()]);
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

  async function loadPlanSettings(): Promise<void> {
    try {
      const response = await fetch('/api/plans');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      planSettings = (await response.json()) as PlanSettings;
      planDrafts = planDraftsFor(planSettings);
      planError = false;
    } catch {
      planError = true;
    }
  }

  function planDomainKey(providerId: string, billingDomainId: string): string {
    return `${providerId}:${billingDomainId}`;
  }

  function planDraftsFor(settings: PlanSettings): Record<string, PlanDraft> {
    const subscriptions = new Map(
      settings.subscriptions.map((subscription) => [
        planDomainKey(subscription.providerId, subscription.billingDomainId),
        subscription
      ])
    );
    return Object.fromEntries(
      settings.domains.map((domain) => {
        const key = planDomainKey(domain.providerId, domain.billingDomainId);
        const subscription = subscriptions.get(key);
        const selection = subscription
          ? (subscription.priceSource === 'catalog-preset' && subscription.planId) || 'custom'
          : 'none';
        return [
          key,
          {
            selection,
            amount: subscription ? String(subscription.amount) : '',
            currency: subscription?.currency ?? 'USD',
            billingPeriod: subscription?.billingPeriod ?? 'monthly',
            anchorDate: subscription?.anchorDate ?? ''
          }
        ];
      })
    );
  }

  function updatePlanDraft(key: string, changes: Partial<PlanDraft>): void {
    const current = planDrafts[key];
    if (!current) return;
    const next = { ...current, ...changes };
    if (changes.selection && changes.selection !== 'custom' && changes.selection !== 'none') {
      const preset = planSettings?.domains
        .flatMap((domain) => domain.presets)
        .find((entry) => entry.id === changes.selection);
      if (preset) {
        next.amount = String(preset.amount);
        next.currency = preset.currency;
        next.billingPeriod = preset.billingPeriod;
      }
    }
    planDrafts = { ...planDrafts, [key]: next };
  }

  async function savePlanDraft(providerId: string, billingDomainId: string): Promise<void> {
    const key = planDomainKey(providerId, billingDomainId);
    const draft = planDrafts[key];
    if (!draft) return;
    const amount = Number(draft.amount);
    const plan =
      draft.selection === 'none'
        ? null
        : {
            planId: draft.selection === 'custom' ? null : draft.selection,
            amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
            currency: draft.currency,
            billingPeriod: draft.billingPeriod,
            anchorDate: draft.anchorDate === '' ? null : draft.anchorDate
          };
    pendingPlanDomain = key;
    try {
      const response = await fetch('/api/plans', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId, billingDomainId, plan })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      planSettings = (await response.json()) as PlanSettings;
      planDrafts = planDraftsFor(planSettings);
      planError = false;
      await loadOverview();
    } catch {
      planError = true;
    } finally {
      pendingPlanDomain = null;
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
      }
      if (processingModuleBecameReady(previous, next, 'pricing')) {
        void loadOverview();
      }
      if (processingModuleBecameReady(previous, next, 'retention')) {
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

  function nonOverlappingComposition(
    observations: HistoryModelObservation[],
    fallback: TokenTotals
  ): TokenTotals {
    if (observations.length === 0) {
      return {
        ...fallback,
        total: fallback.input + fallback.output + fallback.cacheRead + fallback.cacheWrite
      };
    }
    const totals: TokenTotals = {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0
    };
    for (const observation of observations) {
      totals.input += observation.tokenTotals.input;
      totals.output += observation.tokenTotals.output;
      if (observation.tokenSemantics.reasoning === 'separate') {
        totals.reasoning += observation.tokenTotals.reasoning;
      }
      if (observation.tokenSemantics.cacheRead === 'separate') {
        totals.cacheRead += observation.tokenTotals.cacheRead;
      }
      if (observation.tokenSemantics.cacheWrite === 'separate') {
        totals.cacheWrite += observation.tokenTotals.cacheWrite;
      }
    }
    totals.total =
      totals.input + totals.output + totals.reasoning + totals.cacheRead + totals.cacheWrite;
    return totals;
  }

  function uniquePriceSnapshots(priceEvidence: HistoryModelPriceEvidence[]) {
    const seen = Object.create(null) as Record<string, boolean>;
    return priceEvidence.flatMap((evidence) => {
      const snapshot = evidence.priceSnapshot;
      if (!snapshot || seen[snapshot.id]) return [];
      seen[snapshot.id] = true;
      return [snapshot];
    });
  }

  function modelTrendEvidence(
    model: UsageOverview['workbench']['modelRanking']['entries'][number]
  ) {
    const recordedTokens = model.trend.map(() => 0);
    for (const observation of model.observations) {
      let low = 0;
      let high = model.trend.length - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const bucket = model.trend[middle];
        if (observation.observedAt < bucket.start) {
          high = middle - 1;
        } else if (observation.observedAt >= bucket.end) {
          low = middle + 1;
        } else {
          recordedTokens[middle] += observation.recordedTokens;
          break;
        }
      }
    }
    return model.trend.map((bucket, index) => {
      const selectedCost =
        bucket.retailEquivalent.status !== 'unavailable' && bucket.retailEquivalent.amount !== null
          ? bucket.retailEquivalent
          : (bucket.reportedEstimate ?? bucket.retailEquivalent);
      return {
        recordedTokens: bucket.gap ? null : recordedTokens[index],
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

  function logoSrc(sources: { dark: string; light: string }): string {
    return $activeTheme === 'dark' ? sources.dark : sources.light;
  }

  function displayProviders(
    currentOverview: UsageOverview,
    connectionStatuses: ConnectorStatus[],
    indexedProviders: AgentProviderIndex['providers'] = []
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
    for (const indexedProvider of indexedProviders) {
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

  function formatPlanPeriodRange(start: string, end: string): string {
    const format = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    return `${format.format(new Date(start))} – ${format.format(new Date(end))}`;
  }

  function createPlanValueFormatters(currency: string, activeLocale: Locale): PlanValueFormatters {
    return {
      money: (amount) => (amount === null ? t('notAvailable') : formatMoney(amount, currency)),
      tokens: (value) =>
        value === null ? t('notAvailable') : `${formatCompactNumber(value)} ${t('tokens')}`,
      ratio: (value, bound) => {
        if (value === null) return t('notAvailable');
        const formatted = `${new Intl.NumberFormat(activeLocale, {
          maximumFractionDigits: value < 10 ? 1 : 0
        }).format(value)}x`;
        return bound === 'lower' ? `≥ ${formatted}` : formatted;
      }
    };
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
                      src={logoSrc(logo)}
                      alt=""
                    />
                  {/if}
                  <div class="provider-heading-copy">
                    <div class="provider-heading-top">
                      <h2 data-provider-logo={logo ? undefined : provider.id}>
                        {provider.displayName}
                      </h2>
                      <div class="provider-status">
                        <div class="coverage">{coverageLevelLabel(domainCoverage.quota)}</div>
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

              {#if workbench.planValue}
                <section
                  class="plan-value"
                  data-testid="plan-value"
                  aria-labelledby="plan-value-heading"
                  aria-busy={workbenchBusy}
                >
                  <div class="plan-value-heading">
                    <h3 id="plan-value-heading">{t('planValue')}</h3>
                    <small>{t('planValueSubtitle')}</small>
                  </div>

                  {#if workbench.planValue.entries.length === 0}
                    <div class="plan-value-empty" data-testid="plan-value-empty">
                      <p>{t('planValueEmpty')}</p>
                      <button type="button" on:click={() => openSettings('plans')}>
                        {t('planValueEmptyAction')}
                      </button>
                    </div>
                  {:else}
                    <div class="plan-value-body">
                      <PlanValueChart
                        planValue={workbench.planValue}
                        {locale}
                        formatters={planValueFormatters}
                      />

                      <ol class="plan-value-ranking" data-testid="plan-value-ranking">
                        {#each planValueRanking as row (row.key)}
                          <li data-testid="plan-value-row">
                            <div class="plan-value-row-heading">
                              <span class="plan-value-name">
                                <span class="plan-value-swatch" style={`background:${row.color}`}
                                ></span>
                                <strong>{row.name}</strong>
                                <small>{row.planLabel}</small>
                              </span>
                              <span
                                class="plan-value-ratio"
                                class:plan-value-below={row.ratio !== null && !row.beatsBreakEven}
                                data-testid="plan-value-ratio">{row.ratioLabel}</span
                              >
                            </div>
                            <div
                              class="plan-value-meter"
                              role="img"
                              aria-label={`${t('planValueRatio')} ${row.ratioLabel}`}
                            >
                              <span
                                class="plan-value-meter-fill"
                                style={`width:${row.meterPercent}%;background:${row.color}`}
                              ></span>
                              <span
                                class="plan-value-break-even"
                                style={`left:${row.breakEvenPercent}%`}
                                title={t('planValueBreakEven')}
                              ></span>
                            </div>
                            <dl class="plan-value-facts">
                              <div>
                                <dt>{t('planValuePaid')}</dt>
                                <dd>{row.paidLabel}</dd>
                              </div>
                              <div>
                                <dt>{t('planValueWorth')}</dt>
                                <dd>{row.worthLabel}</dd>
                              </div>
                              <div>
                                <dt>{t('planValueEffectiveUnitPrice')}</dt>
                                <dd>{row.effectiveUnitPriceLabel}</dd>
                              </div>
                              <div>
                                <dt>{t('planValueRetailUnitPrice')}</dt>
                                <dd>{row.retailUnitPriceLabel}</dd>
                              </div>
                              {#if row.savingsLabel}
                                <div>
                                  <dt>
                                    {row.savingsIsLoss
                                      ? t('planValueOverpaid')
                                      : t('planValueSavings')}
                                  </dt>
                                  <dd>{row.savingsLabel} · {t('planValuePerMillion')}</dd>
                                </div>
                              {/if}
                            </dl>
                            {#if row.period}
                              <div class="plan-value-period" data-testid="plan-value-period">
                                <div class="plan-value-period-heading">
                                  <span>
                                    {t('planPeriodLabel')} · {formatPlanPeriodRange(
                                      row.period.start,
                                      row.period.end
                                    )}
                                  </span>
                                  <span data-testid="plan-value-period-progress">
                                    {Math.floor(row.period.elapsedDays)}/{Math.round(
                                      row.period.totalDays
                                    )}
                                    {t('planPeriodDays')}
                                  </span>
                                </div>
                                <div
                                  class="plan-value-meter plan-value-period-meter"
                                  role="img"
                                  aria-label={`${t('planPeriodEarnedBack')} ${
                                    row.period.earnedLabel
                                  } / ${row.period.periodCostLabel}`}
                                >
                                  <span
                                    class="plan-value-meter-fill"
                                    style={`width:${row.period.earnedPercent}%;background:${row.color}`}
                                  ></span>
                                  <span
                                    class="plan-value-pace"
                                    style={`left:${row.period.elapsedPercent}%`}
                                    title={row.period.onPace
                                      ? t('planPeriodOnPace')
                                      : t('planPeriodBehindPace')}
                                  ></span>
                                </div>
                                <small class:plan-value-behind={!row.period.onPace}>
                                  {t('planPeriodEarnedBack')}
                                  {row.period.earnedLabel} / {row.period.periodCostLabel} · {row
                                    .period.onPace
                                    ? t('planPeriodOnPace')
                                    : t('planPeriodBehindPace')}
                                </small>
                              </div>
                            {/if}
                            {#if row.bound === 'lower'}
                              <p class="plan-value-caveat">{t('planValuePartial')}</p>
                            {:else if row.bound === 'unavailable'}
                              <p class="plan-value-caveat">{t('planValueUnavailable')}</p>
                            {/if}
                          </li>
                        {/each}
                      </ol>
                    </div>
                    <p class="plan-value-note">{t('planValueWindowNote')}</p>
                  {/if}

                  {#if workbench.planValue.meteredDomains.length > 0 || planValueUnconfigured.length > 0}
                    <ul class="plan-value-aside" data-testid="plan-value-aside">
                      {#each workbench.planValue.meteredDomains as domain (`${domain.providerId}:${domain.billingDomainId}`)}
                        <li>
                          <strong
                            >{domain.providerDisplayName} · {domain.billingDomainDisplayName}</strong
                          >
                          <span>{t('planValueMetered')}</span>
                          <span
                            >{t('actualCost')} · {formatMoney(
                              domain.actualCost.amount,
                              workbench.comparisonCurrency
                            )}</span
                          >
                        </li>
                      {/each}
                      {#each planValueUnconfigured as domain (`${domain.providerId}:${domain.billingDomainId}`)}
                        <li>
                          <strong
                            >{domain.providerDisplayName} · {domain.billingDomainDisplayName}</strong
                          >
                          <span>{t('planValueUnconfigured')}</span>
                          <button type="button" on:click={() => openSettings('plans')}>
                            {t('planValueEmptyAction')}
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </section>
              {/if}

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
                                  src={logoSrc(modelLogo)}
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

          <section
            class="plans-section"
            aria-labelledby="plans-heading"
            data-settings-target="plans"
            data-testid="settings-plans"
            class:settings-target-active={settingsTarget === 'plans'}
            tabindex="-1"
          >
            <div class="settings-section-heading">
              <h2 id="plans-heading">{t('plans')}</h2>
              <p>{t('plansSubtitle')}</p>
            </div>
            {#if planError}
              <p class="settings-error" role="status">{t('plansUnavailable')}</p>
            {/if}
            {#if planSettings}
              <div class="plan-settings">
                {#each planSettings.domains as domain (`${domain.providerId}:${domain.billingDomainId}`)}
                  {@const key = planDomainKey(domain.providerId, domain.billingDomainId)}
                  {@const draft = planDrafts[key]}
                  {@const saved = planSettings.subscriptions.find(
                    (subscription) =>
                      subscription.providerId === domain.providerId &&
                      subscription.billingDomainId === domain.billingDomainId
                  )}
                  <article
                    data-testid={`plan-domain-${domain.providerId}-${domain.billingDomainId}`}
                  >
                    <div class="plan-settings-heading">
                      <strong>{domain.providerDisplayName}</strong>
                      <small>{domain.billingDomainDisplayName}</small>
                    </div>
                    {#if draft}
                      <label>
                        <span>{t('planPreset')}</span>
                        <select
                          value={draft.selection}
                          on:change={(event) =>
                            updatePlanDraft(key, { selection: event.currentTarget.value })}
                        >
                          <option value="none">{t('planNone')}</option>
                          {#each domain.presets as preset (preset.id)}
                            <option value={preset.id}>{preset.displayName}</option>
                          {/each}
                          <option value="custom">{t('planCustom')}</option>
                        </select>
                      </label>
                      {#if draft.selection !== 'none'}
                        <div class="plan-settings-price">
                          <label>
                            <span>{t('planAmount')}</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={draft.amount}
                              on:input={(event) =>
                                updatePlanDraft(key, { amount: event.currentTarget.value })}
                            />
                          </label>
                          <label>
                            <span>{t('planCurrency')}</span>
                            <input
                              type="text"
                              maxlength="3"
                              value={draft.currency}
                              on:input={(event) =>
                                updatePlanDraft(key, {
                                  currency: event.currentTarget.value.toUpperCase()
                                })}
                            />
                          </label>
                          <label>
                            <span>{t('planPeriod')}</span>
                            <select
                              value={draft.billingPeriod}
                              on:change={(event) =>
                                updatePlanDraft(key, {
                                  billingPeriod: event.currentTarget.value as PlanBillingPeriod
                                })}
                            >
                              <option value="monthly">{t('planPeriodMonthly')}</option>
                              <option value="annual">{t('planPeriodAnnual')}</option>
                            </select>
                          </label>
                        </div>
                        <label>
                          <span>{t('planAnchorDate')}</span>
                          <input
                            type="date"
                            value={draft.anchorDate}
                            on:input={(event) =>
                              updatePlanDraft(key, { anchorDate: event.currentTarget.value })}
                          />
                          <small>{t('planAnchorHint')}</small>
                        </label>
                      {/if}
                      <div class="plan-settings-actions">
                        <button
                          type="button"
                          disabled={pendingPlanDomain === key}
                          on:click={() => savePlanDraft(domain.providerId, domain.billingDomainId)}
                        >
                          {draft.selection === 'none' ? t('planClear') : t('planSave')}
                        </button>
                        {#if saved}
                          <small>
                            {saved.priceSource === 'catalog-preset'
                              ? t('planPresetSource')
                              : t('planUserEntered')}
                          </small>
                        {/if}
                      </div>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
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
    {@const modelCost =
      model.retailEquivalent.status !== 'unavailable'
        ? model.retailEquivalent
        : model.reportedEstimate}
    {@const priceSnapshots = uniquePriceSnapshots(model.priceEvidence)}
    {@const compositionTotals = nonOverlappingComposition(model.observations, model.tokenTotals)}
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

  .plan-value {
    position: relative;
    margin-top: 14px;
    padding: 20px;
    border: 1px solid var(--border-soft);
    border-radius: 18px;
    background: var(--surface-subtle);
  }

  .plan-value-heading {
    display: grid;
    gap: 5px;
    margin-bottom: 14px;
  }

  .plan-value-heading h3 {
    margin: 0;
    color: var(--text-strong);
    font-size: 0.9rem;
  }

  .plan-value-heading small {
    color: var(--muted);
    font-size: 0.64rem;
  }

  .plan-value-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(320px, 0.85fr);
    gap: 18px;
    align-items: start;
  }

  .plan-value-ranking {
    display: grid;
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .plan-value-ranking li {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid rgba(122, 136, 164, 0.14);
    border-radius: 14px;
    background: var(--surface-inset);
  }

  .plan-value-row-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .plan-value-name {
    display: flex;
    align-items: baseline;
    gap: 7px;
    min-width: 0;
  }

  .plan-value-name strong {
    color: var(--text-strong);
    font-size: 0.78rem;
    font-weight: 560;
  }

  .plan-value-name small {
    overflow: hidden;
    color: var(--muted);
    font-size: 0.64rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan-value-swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    align-self: center;
    flex: none;
  }

  .plan-value-ratio {
    color: var(--text-strong);
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .plan-value-ratio.plan-value-below {
    color: var(--muted);
  }

  .plan-value-meter {
    position: relative;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 55%, transparent);
  }

  .plan-value-meter-fill {
    display: block;
    height: 100%;
    border-radius: 999px;
  }

  .plan-value-break-even {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 1px;
    background: var(--muted);
  }

  .plan-value-period {
    display: grid;
    gap: 6px;
    padding-top: 9px;
    border-top: 1px solid var(--border-soft);
  }

  .plan-value-period-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    color: var(--muted);
    font-size: 0.62rem;
  }

  .plan-value-period-meter {
    height: 5px;
  }

  .plan-value-pace {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    border-radius: 1px;
    background: var(--text-strong);
    opacity: 0.55;
  }

  .plan-value-period small {
    color: var(--muted);
    font-size: 0.62rem;
    font-variant-numeric: tabular-nums;
  }

  .plan-value-period small.plan-value-behind {
    color: color-mix(in srgb, var(--muted) 55%, #d98b6a);
  }

  .plan-settings label small {
    color: var(--muted);
    font-size: 0.58rem;
    line-height: 1.4;
  }

  .plan-value-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 10px;
    margin: 0;
  }

  .plan-value-facts dt {
    color: var(--muted);
    font-size: 0.6rem;
  }

  .plan-value-facts dd {
    margin: 3px 0 0;
    color: var(--text-strong);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .plan-value-caveat,
  .plan-value-note {
    margin: 8px 2px 0;
    color: var(--muted);
    font-size: 0.63rem;
    line-height: 1.45;
  }

  .plan-value-empty {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    padding: 18px;
    border: 1px dashed var(--border);
    border-radius: 14px;
  }

  .plan-value-empty p {
    margin: 0;
    color: var(--muted);
    font-size: 0.74rem;
  }

  .plan-value-aside {
    display: grid;
    gap: 8px;
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }

  .plan-value-aside li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    padding-top: 8px;
    border-top: 1px solid var(--border-soft);
    color: var(--muted);
    font-size: 0.66rem;
  }

  .plan-value-aside strong {
    color: var(--text-strong);
    font-weight: 550;
  }

  .plan-settings {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
  }

  .plan-settings article {
    display: grid;
    align-content: start;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--border-soft);
    border-radius: 14px;
    background: var(--surface-inset);
  }

  .plan-settings-heading {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .plan-settings-heading strong {
    color: var(--text-strong);
    font-size: 0.78rem;
  }

  .plan-settings-heading small {
    color: var(--muted);
    font-size: 0.64rem;
  }

  .plan-settings label {
    display: grid;
    gap: 5px;
    color: var(--muted);
    font-size: 0.63rem;
  }

  .plan-settings-price {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr) minmax(0, 1fr);
    gap: 8px;
  }

  .plan-settings input,
  .plan-settings select {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-subtle);
    color: var(--text-strong);
    font-size: 0.72rem;
  }

  .plan-settings-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .plan-settings-actions small {
    color: var(--muted);
    font-size: 0.6rem;
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
    justify-content: flex-end;
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
    gap: 16px;
    padding: 24px 30px 48px;
  }

  .settings-content > section {
    padding: 20px;
    border: 1px solid var(--border-soft);
    border-radius: 16px;
    background: var(--surface);
  }

  .settings-section-heading {
    display: grid;
    gap: 6px;
    margin-bottom: 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border-soft);
  }

  .settings-drawer .settings-content > section {
    background: var(--surface-subtle);
  }

  .settings-section-heading h2,
  .settings-section-heading p {
    margin: 0;
  }

  .settings-section-heading p {
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
  .settings-content > section {
    border-color: var(--border);
    background: var(--surface);
  }

  .settings-drawer .settings-content > section {
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

  .settings-drawer .monitoring-controls label,
  .settings-drawer .privacy-actions button,
  .settings-drawer .privacy-actions label,
  .settings-drawer .connection-actions button {
    border-color: var(--border);
    background: var(--button);
    color: var(--text);
  }

  .settings-drawer .connection-actions button.primary-action {
    border-color: var(--primary);
    background: var(--primary);
    color: #fff;
  }

  .settings-drawer .privacy-actions button.danger-action {
    border-color: var(--danger-border);
    color: var(--danger-text);
  }

  .settings-drawer .settings-close {
    border-color: var(--border);
    color: var(--text-strong);
  }

  .model-detail-header,
  .settings-header {
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

    .plan-value {
      padding: 16px;
    }

    .plan-value-body {
      grid-template-columns: 1fr;
    }

    .plan-settings-price {
      grid-template-columns: 1fr;
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
