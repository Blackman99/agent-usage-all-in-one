import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

let home: string;
let launchUrl: string;
let daemonPid: number;

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'agent-usage-e2e-'));
  const result = await runPackagedCli(['--home', home, '--no-open']);
  if (result.exitCode !== 0) throw new Error(result.stderr || 'Unable to start packaged daemon');
  launchUrl = result.stdout.trim();
  const state = JSON.parse(await readFile(join(home, 'daemon.json'), 'utf8')) as { pid: number };
  daemonPid = state.pid;
});

test.afterAll(async () => {
  if (daemonPid) {
    try {
      process.kill(daemonPid, 'SIGTERM');
    } catch {
      // The daemon may already be stopped.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (home) await rm(home, { force: true, recursive: true });
});

test('keeps the Agent dashboard shell visible while cached usage loads', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.setViewportSize({ width: 1680, height: 1000 });
  let releaseOverview = () => {};
  const delayedOverview = new Promise<void>((resolve) => {
    releaseOverview = resolve;
  });
  await page.route('**/api/overview**', async (route) => {
    await delayedOverview;
    await route.continue();
  });

  await page.goto(freshLaunch.stdout.trim());

  const agentPanel = page.getByTestId('agent-usage-panel');
  await expect(agentPanel).toBeVisible();
  await expect(page.locator('.section-loading')).toHaveCount(0);
  for (const provider of [
    { id: 'codex', name: 'Codex' },
    { id: 'claude-code', name: 'Claude Code' },
    { id: 'opencode-go', name: 'OpenCode Go' },
    { id: 'grok', name: 'Grok' }
  ]) {
    await expect(
      agentPanel.getByRole('heading', { name: provider.name, exact: true })
    ).toBeVisible();
    await expect(agentPanel.locator(`[data-provider-logo="${provider.id}"]`)).toBeVisible();
    const skeleton = page.getByTestId(`agent-provider-skeleton-${provider.id}`);
    await expect(skeleton).toBeVisible();
    // The skeleton mirrors the loaded card: quota section only, since the
    // heading with its status control stays real while a Provider loads.
    await expect(skeleton.locator('.agent-skeleton-connection')).toHaveCount(0);
    await expect(skeleton.locator('.agent-skeleton-section-label')).toBeVisible();
    await expect(skeleton.locator('.agent-skeleton-quota-row')).toHaveCount(3);
    for (const quotaRow of await skeleton.locator('.agent-skeleton-quota-row').all()) {
      await expect(quotaRow.locator('.agent-skeleton-quota-copy')).toBeVisible();
      await expect(quotaRow.locator('.agent-skeleton-progress')).toBeVisible();
      await expect(quotaRow.locator('.agent-skeleton-meta')).toBeVisible();
    }
  }
  const skeletonCardHeights = await agentPanel
    .locator('.provider-card')
    .evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().height)));
  expect(Math.min(...skeletonCardHeights)).toBeGreaterThanOrEqual(400);
  await expect(page.getByTestId('agent-index-skeleton')).toHaveCount(0);
  await expect(agentPanel.locator('.agent-skeleton-heading')).toHaveCount(0);
  await expect(page.getByText('Loading cached agent usage…')).toHaveCount(0);

  releaseOverview();
  await expect(page.locator('.provider-card').first()).toBeVisible();
});

test('shows each Agent card as soon as that provider finishes loading', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  const fixture = historyOverviewFixture('7d', 700) as {
    providers: Array<Record<string, unknown>>;
  };
  const template = fixture.providers[0];
  const quotaBucket = {
    id: 'weekly',
    billingDomainId: 'api',
    label: 'Weekly limit',
    usedPercent: 25,
    resetsAt: '2026-09-03T17:38:00.000Z',
    authority: 'official-account',
    observedAt: '2026-08-29T12:00:00.000Z'
  };
  const codex = {
    ...template,
    id: 'codex',
    displayName: 'Codex Fast',
    quotaBuckets: [quotaBucket],
    billingDomains: (template.billingDomains as Array<Record<string, unknown>>).map(
      (domain, index) => (index === 0 ? { ...domain, quotaBuckets: [quotaBucket] } : domain)
    )
  };
  const claude = { ...template, id: 'claude-code', displayName: 'Claude Slow' };
  let releaseIndex = () => {};
  const delayedIndex = new Promise<void>((resolve) => {
    releaseIndex = resolve;
  });
  let releaseClaude = () => {};
  const delayedClaude = new Promise<void>((resolve) => {
    releaseClaude = resolve;
  });
  let legacyOpenCodeRequests = 0;
  let holdCodexUpdate = false;
  let releaseCodexUpdate = () => {};
  const delayedCodexUpdate = new Promise<void>((resolve) => {
    releaseCodexUpdate = resolve;
  });

  await page.route('**/api/overview/providers**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/overview/providers') {
      await delayedIndex;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: '2026-08-28T02:00:00.000Z',
          providers: [
            { id: 'codex', displayName: 'Codex Fast' },
            { id: 'claude-code', displayName: 'Claude Slow' },
            { id: 'opencode', displayName: 'OpenCode' }
          ]
        })
      });
      return;
    }
    if (pathname.endsWith('/opencode')) legacyOpenCodeRequests += 1;
    if (pathname.endsWith('/claude-code')) await delayedClaude;
    if (pathname.endsWith('/codex') && holdCodexUpdate) await delayedCodexUpdate;
    if (!pathname.endsWith('/codex') && !pathname.endsWith('/claude-code')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(pathname.endsWith('/claude-code') ? claude : codex)
    });
  });
  await page.route('**/api/refresh**', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ accepted: true })
    });
  });

  await page.goto(freshLaunch.stdout.trim());

  const codexCard = page.locator('.provider-card').filter({ hasText: 'Codex Fast' });
  await expect(codexCard).toBeVisible();
  await expect(page.getByTestId('agent-provider-skeleton-codex')).toHaveCount(0);
  releaseIndex();
  const claudeLoading = page.getByTestId('agent-provider-skeleton-claude-code');
  await expect(claudeLoading).toBeVisible();
  await expect(claudeLoading.locator('xpath=ancestor::article')).toBeVisible();
  await expect(
    claudeLoading.locator('xpath=ancestor::article').getByRole('heading', { name: 'Claude Slow' })
  ).toBeVisible();
  await expect(page.getByText('Loading cached agent usage…')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'OpenCode', exact: true })).toHaveCount(0);
  expect(legacyOpenCodeRequests).toBe(0);
  await expect(page.getByTestId('quota-timeline').locator('canvas')).toBeVisible();

  releaseClaude();
  await expect(page.getByTestId('agent-provider-skeleton-claude-code')).toHaveCount(0);
  const claudeCard = page.locator('.provider-card').filter({ hasText: 'Claude Slow' });
  await expect(claudeCard.getByRole('heading', { name: 'Claude Slow' })).toBeVisible();

  holdCodexUpdate = true;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByTestId('agent-provider-update-codex')).toHaveText('Updating');
  await expect(page.getByTestId('agent-provider-skeleton-codex')).toHaveCount(0);
  await expect(codexCard.getByRole('heading', { name: 'Codex Fast' })).toBeVisible();
  await expect(page.getByTestId('quota-timeline').locator('canvas')).toBeVisible();
  releaseCodexUpdate();
  await expect(page.getByTestId('agent-provider-update-codex')).toHaveCount(0);
});

test('does not reload an Agent on every processing poll while startup usage work is running', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  const fixture = historyOverviewFixture('7d', 700) as {
    providers: Array<Record<string, unknown>>;
  };
  const provider = fixture.providers[0];
  let providerRequests = 0;
  let processingRequests = 0;
  let processingMode: 'polling' | 'ready' = 'polling';

  await page.route('**/api/overview/providers**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/overview/providers') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: '2026-08-28T02:00:00.000Z',
          providers: [{ id: 'history-agent', displayName: 'History Agent' }]
        })
      });
      return;
    }
    if (pathname.endsWith('/history-agent')) {
      providerRequests += 1;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(provider) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/processing', async (route) => {
    processingRequests += 1;
    const usageState =
      processingMode === 'ready' ? 'ready' : processingRequests === 1 ? 'pending' : 'running';
    const module = (state: 'pending' | 'running' | 'ready') => ({
      state,
      startedAt: state === 'pending' ? null : '2026-08-28T02:00:00.000Z',
      completedAt: state === 'ready' ? '2026-08-28T02:00:01.000Z' : null,
      message: null
    });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        startedAt: '2026-08-28T02:00:00.000Z',
        hardRebuild: false,
        modules: {
          discovery: module('ready'),
          usage: module(usageState),
          pricing: module('ready'),
          retention: module('ready')
        }
      })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  await expect(page.getByRole('heading', { name: 'History Agent', exact: true })).toBeVisible();
  await expect.poll(() => providerRequests).toBe(1);
  await page.waitForTimeout(2_300);
  expect(processingRequests).toBeGreaterThanOrEqual(3);
  expect(providerRequests).toBe(1);

  processingMode = 'ready';
  processingRequests = 0;
  providerRequests = 0;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'History Agent', exact: true })).toBeVisible();
  await expect.poll(() => providerRequests).toBe(1);
  await page.waitForTimeout(200);
  expect(processingRequests).toBe(1);
  expect(providerRequests).toBe(1);
});

test('automatically refreshes once for unchanged degraded evidence', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  const fixture = historyOverviewFixture('7d', 700) as {
    providers: Array<Record<string, unknown>>;
  };
  const template = fixture.providers[0];
  let automaticRefreshRequests = 0;
  let collectionAttempts = 0;

  // Every collection succeeds partially: the last-success timestamps advance
  // while the same subscription quota stays unavailable.
  const degradedProvider = () => {
    collectionAttempts += 1;
    const lastSuccessAt = new Date(
      Date.parse('2026-08-29T12:00:00.000Z') + collectionAttempts * 1_000
    ).toISOString();
    const health = {
      status: 'degraded',
      errorCode: 'unavailable',
      message: 'History Agent quota is unavailable.',
      recovery: null
    };
    return {
      ...template,
      freshness: { status: 'fresh', lastSuccessAt },
      health,
      billingDomains: (template.billingDomains as Array<Record<string, unknown>>).map((domain) => ({
        ...domain,
        freshness: { status: 'fresh', lastSuccessAt },
        health
      }))
    };
  };

  await page.route('**/api/refresh**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('mode') === 'automatic') {
      automaticRefreshRequests += 1;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ accepted: true })
    });
  });
  await page.route('**/api/doctor', async (route) => {
    // Connector diagnostics settle after the first overview render.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-29T12:00:00.000Z',
        connectors: [
          {
            id: 'history-agent',
            providerId: 'history-agent',
            billingDomainId: 'api',
            status: 'degraded',
            category: 'unavailable',
            message: 'History Agent quota is unavailable.',
            recovery: null,
            affectedCoverage: ['quota'],
            lastAttemptAt: new Date().toISOString(),
            lastSuccessAt: new Date().toISOString()
          }
        ]
      })
    });
  });
  await page.route('**/api/overview**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/overview/providers') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: '2026-08-29T12:00:00.000Z',
          providers: [{ id: 'history-agent', displayName: 'History Agent' }]
        })
      });
      return;
    }
    if (pathname.startsWith('/api/overview/providers/')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(degradedProvider())
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...fixture, providers: [degradedProvider()] })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  await expect(page.getByRole('heading', { name: 'History Agent', exact: true })).toBeVisible();
  await expect.poll(() => automaticRefreshRequests).toBe(1);
  await page.waitForTimeout(2_000);
  expect(automaticRefreshRequests).toBe(1);
});

test('shows persisted provider usage and refreshes from the dashboard', async ({ page }) => {
  let refreshRequests = 0;
  await page.route('**/api/refresh**', async (route) => {
    refreshRequests += 1;
    await route.continue();
  });
  await page.goto(launchUrl);

  await expect(page).toHaveTitle('Agent Usage');
  await expect(page.getByRole('heading', { name: 'Agent Usage' })).toBeVisible();
  const demoProvider = page.locator('.provider-card').filter({ hasText: 'Demo Agent' });
  await expect(demoProvider.getByRole('heading', { name: 'Demo Agent' })).toBeVisible();
  await expect(page.getByText('42% used')).toBeVisible();
  await expect(demoProvider.locator('.token-total')).toHaveCount(0);
  await expect(page.locator('.quota-meta')).toContainText(/in 3 hours/);
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  await page
    .getByTestId('token-money-workbench')
    .getByRole('button', { name: 'Tokens', exact: true })
    .click();
  await expect(page.getByTestId('usage-headline').locator('strong')).toHaveAttribute(
    'aria-label',
    /[\d,]+ Tokens/
  );
  await page.getByRole('tab', { name: 'Agent usage' }).click();
  expect(refreshRequests).toBe(0);

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Updated just now')).toBeVisible();
});

test('puts usage first, keeps connection actions inside provider cards, and refreshes action state', async ({
  page
}) => {
  const requestCounts = { connectors: 0, overview: 0, doctor: 0 };
  let xaiConnected = false;
  await page.route('**/api/connectors', async (route) => {
    requestCounts.connectors += 1;
    const response = await route.fetch();
    const body = (await response.json()) as Array<Record<string, unknown>>;
    await route.fulfill({
      response,
      json: body.map((connector) =>
        connector.id === 'xai-api' && xaiConnected
          ? {
              ...connector,
              state: 'connected',
              secretReference: 'connector:xai-api',
              secretConfigured: true
            }
          : connector
      )
    });
  });
  await page.route('**/api/overview**', async (route) => {
    requestCounts.overview += 1;
    await route.continue();
  });
  await page.route('**/api/doctor', async (route) => {
    requestCounts.doctor += 1;
    await route.continue();
  });
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.goto(freshLaunch.stdout.trim());
  await expect(page.locator('.product-logo')).toHaveAttribute('src', '/brand/agent-usage-logo.svg');
  await expect(page.locator('.product-banner-art')).toHaveCount(0);

  const mainViews = page.getByRole('tablist', { name: 'Main views' });
  const agentUsageTab = mainViews.getByRole('tab', { name: 'Agent usage' });
  const modelCostsTab = mainViews.getByRole('tab', { name: 'Tokens & model costs' });
  await expect(agentUsageTab).toHaveAttribute('aria-selected', 'true');
  await expect(modelCostsTab).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('agent-usage-panel')).toBeVisible();
  await expect(page.getByTestId('token-model-costs-panel')).toHaveCount(0);

  await expect(page.getByRole('heading', { name: 'Connections' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Diagnostics' })).toHaveCount(0);
  for (const name of ['Codex', 'Claude Code', 'OpenCode Go', 'Grok']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('.monitoring-section')).toHaveCount(0);
  for (const providerId of ['codex', 'claude-code', 'opencode-go', 'grok']) {
    await expect(page.locator(`[data-provider-logo="${providerId}"]`)).toBeVisible();
  }
  await expect(page.locator('.provider-mark')).toHaveCount(0);
  await modelCostsTab.click();
  await expect(modelCostsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('agent-usage-panel')).toHaveCount(0);
  await expect(page.getByTestId('token-model-costs-panel')).toBeVisible();
  await expect(page.getByTestId('token-money-workbench')).toBeVisible();
  await agentUsageTab.click();
  await expect(page.getByTestId('connector-claude-code').getByText('Experimental')).toBeVisible();
  await expect(page.getByTestId('connector-codex').getByText('Official client')).toBeVisible();
  const settingsButton = page.getByRole('button', { name: 'Settings', exact: true });
  await settingsButton.click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Connections' })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();
  await expect(settings.getByTestId('settings-diagnostic-codex')).toBeVisible();
  const notificationSetting = page.getByRole('checkbox', { name: 'Local notifications' });
  await expect(notificationSetting).not.toBeChecked();
  await notificationSetting.check();
  await expect(notificationSetting).toBeChecked();
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await expect(settings).toHaveCount(0);
  await expect(settingsButton).toBeFocused();
  const deepLink = new URL(page.url());
  deepLink.searchParams.set('settings', 'diagnostic:codex');
  await page.goto(deepLink.toString());
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.getByTestId('settings-diagnostic-codex')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  await expect(settingsButton).toBeFocused();
  const grokProvider = page.locator('.provider-card').filter({ hasText: 'Grok' });
  await grokProvider.getByRole('tab', { name: 'xAI API' }).click();
  const xaiApi = grokProvider.getByTestId('connector-xai-api');
  await expect(xaiApi.getByText('Agent Usage Keychain')).toBeVisible();
  await expect(xaiApi.getByRole('button', { name: 'Connect' })).toBeDisabled();
  let xaiActionBody: unknown = null;
  await page.route('**/api/connectors/xai-api/action', async (route) => {
    xaiActionBody = route.request().postDataJSON();
    xaiConnected = true;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'xai-api',
        displayName: 'xAI API (Grok)',
        state: 'connected',
        installed: true,
        binaryPath: null,
        officialCredentialPresent: false,
        errorCode: null,
        lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
        secretReference: 'connector:xai-api',
        command: null,
        permissionDescription: 'Store a dedicated management key.',
        credentialOwner: 'agent-usage',
        experimental: false,
        expectedCoverage: ['tokens', 'actual-cost', 'history'],
        target: {
          provider: { id: 'grok', displayName: 'Grok' },
          billingDomain: { id: 'xai-api', displayName: 'xAI API' }
        },
        secretConfigured: true
      })
    });
  });
  const beforeAction = { ...requestCounts };
  await xaiApi.getByRole('textbox', { name: /Management API key/ }).fill('browser-fake-key');
  await xaiApi.getByRole('button', { name: 'Connect' }).click();
  expect(xaiActionBody).toEqual({ action: 'connect', secret: 'browser-fake-key' });
  // The connected state rides on the card's status control: visible as its
  // tooltip and title, and exposed to assistive technology as text.
  await expect(xaiApi.getByText('Connected')).toHaveCount(1);
  await expect(xaiApi.getByRole('button', { name: 'Manage connection' })).toHaveAttribute(
    'title',
    /Connected/
  );
  await expect(xaiApi).not.toContainText('browser-fake-key');
  await expect.poll(() => requestCounts.connectors).toBeGreaterThan(beforeAction.connectors);
  expect(requestCounts.overview).toBeGreaterThan(beforeAction.overview);
  expect(requestCounts.doctor).toBeGreaterThan(beforeAction.doctor);

  await xaiApi.getByRole('button', { name: 'Manage connection' }).click();
  const xaiSettings = page.getByTestId('settings-connector-xai-api');
  await xaiSettings
    .getByRole('textbox', { name: /Management API key/ })
    .fill('browser-replacement-key');
  await xaiSettings.getByRole('button', { name: 'Replace credential' }).click();
  expect(xaiActionBody).toEqual({ action: 'connect', secret: 'browser-replacement-key' });
  await page.getByRole('button', { name: 'Close settings' }).click();

  const openCode = page.getByTestId('connector-opencode-go');
  await openCode.getByRole('button', { name: 'Skip' }).click();
  await expect(openCode.getByText('Skipped')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('connector-opencode-go').getByText('Skipped')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Local notifications' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Local notifications' }).uncheck();
});

test('renders Codex quota without card diagnostics and keeps human actions in settings', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  let refreshRequests = 0;
  let refreshResponses = 0;
  await page.route('**/api/refresh**', async (route) => {
    refreshRequests += 1;
    const response = await route.fetch();
    refreshResponses += 1;
    await route.fulfill({ response });
  });
  await page.route('**/api/doctor', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-28T02:00:00.000Z',
        daemon: { status: 'healthy' },
        database: { status: 'healthy' },
        connectors: [
          {
            id: 'codex-stale',
            providerId: 'codex',
            billingDomainId: 'subscription',
            status: 'degraded',
            category: 'stale',
            message: 'Older Codex data is stale.',
            recovery: 'Refresh Codex.',
            affectedCoverage: ['quota'],
            lastAttemptAt: '2026-08-28T01:00:00.000Z',
            lastSuccessAt: '2026-08-27T02:00:00.000Z'
          },
          {
            id: 'codex',
            providerId: 'codex',
            billingDomainId: 'subscription',
            status: 'degraded',
            category: 'unauthorized',
            message: 'Codex account usage is unavailable.',
            recovery: 'Run codex login, then refresh Agent Usage.',
            affectedCoverage: ['quota', 'tokens', 'history'],
            lastAttemptAt: '2026-08-28T02:00:00.000Z',
            lastSuccessAt: '2026-08-27T02:00:00.000Z'
          }
        ],
        providers: []
      })
    });
  });
  await page.route('**/api/overview**', async (route) => {
    await fulfillOverview(route, {
      generatedAt: '2026-08-28T02:00:00.000Z',
      providers: [
        withTokenDomain(
          {
            id: 'codex',
            displayName: 'Codex',
            freshness: { status: 'stale', lastSuccessAt: '2026-08-27T02:00:00.000Z' },
            health: {
              status: 'degraded',
              errorCode: 'codex-account-unavailable',
              message: 'Codex account usage is unavailable.',
              recovery: 'Run codex login, then refresh Agent Usage.'
            },
            coverage: {
              quota: 'complete',
              tokens: 'complete',
              actualCost: 'unavailable',
              history: 'complete'
            },
            quotaBuckets: [
              {
                id: 'codex:primary',
                billingDomainId: 'subscription',
                label: '5 hour',
                usedPercent: 42,
                resetsAt: '2026-08-28T05:00:00.000Z',
                authority: 'official-account'
              },
              {
                id: 'codex:secondary',
                billingDomainId: 'subscription',
                label: 'Week',
                usedPercent: 18,
                resetsAt: '2026-09-01T00:00:00.000Z',
                authority: 'official-account'
              }
            ],
            tokenTotals: { total: 1250, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            tokenEvidence: tokenEvidenceFixture(
              { total: 1250 },
              {
                sourceReportedTokens: 1250,
                unclassifiedTokens: 1250,
                classifiedTokens: 0,
                classificationCoverage: 0,
                totalDerivations: ['source-reported'],
                timePrecisions: ['day'],
                usageScopes: ['account-wide']
              }
            ),
            tokenAuthority: 'official-account'
          },
          'subscription',
          'Codex subscription',
          '2026-08-27T02:00:00.000Z'
        )
      ]
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'Codex' });
  await expect(provider.getByRole('heading', { name: 'Codex', exact: true })).toBeVisible();
  await expect.poll(() => refreshRequests).toBe(1);
  await expect.poll(() => refreshResponses).toBe(1);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(refreshRequests).toBe(1);
  await expect(provider.getByText('Data is stale')).toHaveCount(0);
  await expect(provider.locator('.freshness')).toHaveAttribute('data-status', 'available');
  await expect(provider.locator('.freshness')).toContainText('Updated ·');
  await expect(page.locator('.risk-banner')).toHaveCount(0);
  await expect(page.getByText('Connection needs attention')).toHaveCount(0);
  await expect(provider.getByText('5 hour', { exact: true })).toBeVisible();
  await expect(provider.getByText('Week', { exact: true })).toBeVisible();
  await expectQuotaShowsOnlyReset(provider, 2);
  await expectProviderHasNoTokenDetail(provider);
  await expect(provider.locator('.degraded')).toHaveCount(0);
  await expect(provider.getByText('codex · Unauthorized')).toHaveCount(0);
  await expect(provider.getByText('Run codex login, then refresh Agent Usage.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const diagnostic = page.getByTestId('settings-diagnostic-codex');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(diagnostic).toBeVisible();
  await expect(page.getByTestId('settings-diagnostic-codex-stale')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByText('数据已过期')).toHaveCount(0);
  await expect(provider.locator('.freshness')).toContainText('更新于 ·');
});

test('keeps successful usage visible when an auxiliary settings request fails', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/retention', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });

  await page.goto(freshLaunch.stdout.trim());
  await expect(page.getByRole('heading', { name: 'Demo Agent' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toContainText(
    'Retention data is unavailable.'
  );
});

test('shows OpenCode Go account quota without duplicating its Token history', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/overview**', async (route) => {
    await fulfillOverview(route, {
      generatedAt: '2026-08-28T02:00:00.000Z',
      providers: [
        withTokenDomain(
          {
            id: 'opencode-go',
            displayName: 'OpenCode Go',
            freshness: { status: 'fresh', lastSuccessAt: '2026-08-28T02:00:00.000Z' },
            health: {
              status: 'healthy',
              errorCode: null,
              message: null,
              recovery: null
            },
            coverage: {
              quota: 'complete',
              tokens: 'complete',
              actualCost: 'unavailable',
              history: 'complete'
            },
            quotaBuckets: [
              {
                id: 'monthly',
                billingDomainId: 'go-subscription',
                label: 'Month',
                usedPercent: 50,
                resetsAt: '2026-09-28T00:00:00.000Z',
                authority: 'official-account',
                scope: 'account-wide',
                status: 'ok',
                limitAmount: 60,
                limitCurrency: 'USD',
                fallbackStatus: 'unknown'
              },
              {
                id: 'weekly',
                billingDomainId: 'go-subscription',
                label: 'Week',
                usedPercent: 40,
                resetsAt: '2026-09-01T00:00:00.000Z',
                authority: 'official-account',
                scope: 'account-wide',
                status: 'ok',
                limitAmount: 30,
                limitCurrency: 'USD',
                fallbackStatus: 'unknown'
              },
              {
                id: 'rolling',
                billingDomainId: 'go-subscription',
                label: '5 hour',
                usedPercent: 25,
                resetsAt: '2026-08-28T05:00:00.000Z',
                authority: 'official-account',
                scope: 'account-wide',
                status: 'ok',
                limitAmount: 12,
                limitCurrency: 'USD',
                fallbackStatus: 'unknown'
              }
            ],
            tokenTotals: {
              total: 1200,
              input: 700,
              output: 250,
              reasoning: 50,
              cacheRead: 200,
              cacheWrite: 0
            },
            tokenEvidence: tokenEvidenceFixture(
              { total: 1200 },
              {
                totalDerivations: ['categorized'],
                timePrecisions: ['day'],
                usageScopes: ['this-mac']
              }
            ),
            tokenAuthority: 'local-observation'
          },
          'go-subscription',
          'OpenCode Go subscription',
          '2026-08-28T01:59:00.000Z'
        )
      ]
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'OpenCode Go' });
  await expect(provider.locator('.quota-copy strong')).toHaveText(['5 hour', 'Week', 'Month']);
  await expectQuotaShowsOnlyReset(provider, 3);
  await expect(provider.getByRole('progressbar', { name: '5 hour' })).toHaveAccessibleDescription(
    /Source: Official account.*Aug 28/
  );
  await expectProviderHasNoTokenDetail(provider);
});

test('keeps Claude All models and Fable-only quota without duplicating local Token detail', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  let refreshRequests = 0;
  let refreshResponses = 0;
  await page.route('**/api/refresh**', async (route) => {
    refreshRequests += 1;
    const response = await route.fetch();
    refreshResponses += 1;
    await route.fulfill({ response });
  });
  await page.route('**/api/doctor', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-28T02:00:00.000Z',
        daemon: { status: 'healthy' },
        database: { status: 'healthy' },
        connectors: [
          {
            id: 'claude-code',
            providerId: 'claude-code',
            billingDomainId: 'subscription',
            status: 'degraded',
            category: 'unavailable',
            message: 'Claude Code subscription quota is unavailable.',
            recovery: 'Run doctor, check the connector, and retry refresh.',
            affectedCoverage: ['quota'],
            lastAttemptAt: '2026-08-28T02:00:00.000Z',
            lastSuccessAt: '2026-08-28T01:58:00.000Z'
          }
        ],
        providers: []
      })
    });
  });
  await page.route('**/api/overview**', async (route) => {
    await fulfillOverview(route, {
      generatedAt: '2026-08-28T02:00:00.000Z',
      providers: [
        withTokenDomain(
          {
            id: 'claude-code',
            displayName: 'Claude Code',
            freshness: { status: 'fresh', lastSuccessAt: '2026-08-28T02:00:00.000Z' },
            health: {
              status: 'degraded',
              errorCode: 'claude-subscription-quota-unavailable',
              message: 'Claude Code subscription quota is unavailable.',
              recovery: 'Run doctor, check the connector, and retry refresh.'
            },
            coverage: {
              quota: 'complete',
              tokens: 'partial',
              actualCost: 'unavailable',
              history: 'partial'
            },
            quotaBuckets: [
              {
                id: '5-hour-limit',
                billingDomainId: 'subscription',
                label: '5 hour',
                usedPercent: 42,
                resetsAt: '2026-08-28T04:13:00.000Z',
                authority: 'official-client',
                scope: 'account-wide'
              },
              {
                id: 'weekly-all-models',
                billingDomainId: 'subscription',
                label: 'Week · All models',
                usedPercent: 24,
                resetsAt: '2026-08-31T09:59:00.000Z',
                authority: 'official-client',
                scope: 'account-wide'
              },
              {
                id: 'weekly-fable-only',
                billingDomainId: 'subscription',
                label: 'Week · Fable only',
                usedPercent: 17,
                resetsAt: '2026-08-31T09:59:00.000Z',
                authority: 'official-client',
                scope: 'account-wide'
              }
            ],
            tokenTotals: {
              total: 575,
              input: 100,
              output: 25,
              cacheRead: 400,
              cacheWrite: 50
            },
            tokenEvidence: tokenEvidenceFixture(
              { total: 575 },
              {
                totalDerivations: ['categorized'],
                timePrecisions: ['event'],
                usageScopes: ['this-mac'],
                aggregationTemporalities: ['delta']
              }
            ),
            tokenAuthority: 'local-observation'
          },
          'subscription',
          'Claude subscription',
          '2026-08-28T01:58:00.000Z'
        )
      ]
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'Claude Code' });
  await expect.poll(() => refreshRequests).toBe(1);
  await expect.poll(() => refreshResponses).toBe(1);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(provider.getByText('Week · All models')).toBeVisible();
  await expect(provider.getByText('Week · Fable only')).toBeVisible();
  await expect(provider.locator('.degraded')).toHaveCount(0);
  await expect(provider.getByText('claude-code · Unavailable')).toHaveCount(0);
  await expect(
    provider.getByText('Run doctor, check the connector, and retry refresh.')
  ).toHaveCount(0);
  await expectQuotaShowsOnlyReset(provider, 3);
  const quotaEvidence = provider.getByText('Source: Official Client');
  await expect(quotaEvidence).toHaveCount(3);
  for (const evidence of await quotaEvidence.all()) await expect(evidence).toBeHidden();
  await expectProviderHasNoTokenDetail(provider);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('settings-diagnostic-claude-code')).toHaveCount(0);
});

test('renders Grok shared weekly quota without duplicating telemetry or inventing a five-hour bucket', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  let refreshRequests = 0;
  let refreshResponses = 0;
  await page.route('**/api/refresh**', async (route) => {
    refreshRequests += 1;
    const response = await route.fetch();
    refreshResponses += 1;
    await route.fulfill({ response });
  });
  await page.route('**/api/doctor', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-28T02:00:00.000Z',
        daemon: { status: 'healthy' },
        database: { status: 'healthy' },
        connectors: [
          {
            id: 'grok',
            providerId: 'grok',
            billingDomainId: 'grok-build-subscription',
            status: 'degraded',
            category: 'stale',
            message: 'Build telemetry is stale.',
            recovery: 'Refresh Grok Build telemetry.',
            affectedCoverage: ['tokens'],
            lastAttemptAt: '2026-08-28T02:00:00.000Z',
            lastSuccessAt: null
          },
          {
            id: 'xai-api',
            providerId: 'grok',
            billingDomainId: 'xai-api',
            status: 'degraded',
            category: 'unauthorized',
            message: 'xAI API key rejected.',
            recovery: 'Replace the xAI API key.',
            affectedCoverage: ['tokens', 'actual-cost'],
            lastAttemptAt: '2026-08-28T02:00:00.000Z',
            lastSuccessAt: null
          }
        ],
        providers: []
      })
    });
  });
  await page.route('**/api/overview**', async (route) => {
    await fulfillOverview(route, {
      generatedAt: '2026-08-28T02:00:00.000Z',
      providers: [
        {
          id: 'grok',
          displayName: 'Grok',
          summaryBillingDomainId: 'grok-build-subscription',
          freshness: { status: 'fresh', lastSuccessAt: '2026-08-28T02:00:00.000Z' },
          health: {
            status: 'healthy',
            errorCode: null,
            message: null,
            recovery: null
          },
          coverage: {
            quota: 'complete',
            tokens: 'partial',
            actualCost: 'unavailable',
            history: 'partial'
          },
          quotaBuckets: [
            {
              id: 'grok-build:weekly',
              billingDomainId: 'grok-build-subscription',
              label: 'Weekly limit',
              usedPercent: 61.2,
              resetsAt: '2026-09-01T00:00:00.000Z',
              authority: 'official-client',
              scope: 'account-wide',
              status: 'SuperGrok Heavy'
            }
          ],
          tokenTotals: {
            total: 525,
            input: 100,
            output: 25,
            reasoning: 12,
            cacheRead: 400,
            cacheWrite: 0
          },
          tokenEvidence: tokenEvidenceFixture(
            { total: 525 },
            {
              totalDerivations: ['categorized'],
              timePrecisions: ['event'],
              usageScopes: ['this-mac'],
              aggregationTemporalities: ['delta']
            }
          ),
          tokenAuthority: 'local-observation',
          billingDomains: grokBillingDomains.map((domain) =>
            domain.id === 'grok-build-subscription'
              ? {
                  ...domain,
                  health: {
                    status: 'degraded',
                    errorCode: 'stale',
                    message: 'Build telemetry is stale.',
                    recovery: 'Refresh Grok Build telemetry.'
                  }
                }
              : domain
          )
        }
      ]
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'Grok' });
  await expect.poll(() => refreshRequests).toBe(1);
  await expect.poll(() => refreshResponses).toBe(1);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(refreshRequests).toBe(1);
  await expect(provider.getByText('Weekly limit')).toBeVisible();
  await expect(provider.getByText('Refresh Grok Build telemetry.')).toHaveCount(0);
  await expect(provider.getByText('Replace the xAI API key.')).toHaveCount(0);
  await expect(provider.getByRole('button', { name: 'Review in settings' })).toHaveCount(0);
  await expectQuotaShowsOnlyReset(provider, 1);
  await expect(provider.getByText('Plan: SuperGrok Heavy')).toHaveCount(0);
  await expect(provider.getByText('5 hour', { exact: true })).toHaveCount(0);
  await expectProviderHasNoTokenDetail(provider);
  await expect(provider.getByText('Replace the xAI API key.')).toHaveCount(0);
  await provider.getByRole('tab', { name: 'xAI API' }).click();
  await expect(provider.getByText('Replace the xAI API key.')).toHaveCount(0);
  await expect(provider.locator('.degraded')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('settings-diagnostic-xai-api')).toBeVisible();
  await expect(page.getByTestId('settings-diagnostic-grok')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expectProviderHasNoTokenDetail(provider);
  await expect(provider.getByText('Weekly limit')).toHaveCount(0);
  await provider.getByRole('tab', { name: 'Build / SuperGrok' }).click();
  await expect(provider.getByText('Weekly limit')).toBeVisible();
});

test('does not expose manual telemetry setup when Claude and Grok have no Token data', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/overview**', async (route) => {
    const tokenTotals = {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0
    };
    const domain = (id: string, displayName: string, quotaBuckets: unknown[] = []) => ({
      id,
      displayName,
      quotaBuckets,
      tokenTotals,
      tokenAuthority: 'local-observation',
      costs: [],
      balances: [],
      invoices: [],
      history: {
        window: '24h',
        start: '2026-08-27T02:00:00.000Z',
        end: '2026-08-28T02:00:00.000Z',
        timeZone: 'Asia/Shanghai',
        tokenTotals,
        models: [],
        days: [],
        costs: [],
        exchangeRates: [],
        authorities: id === 'grok-build-subscription' ? ['local-observation'] : [],
        lastObservedAt: null
      }
    });
    const provider = (id: 'claude-code' | 'grok', displayName: string) => {
      const billingDomainId = id === 'claude-code' ? 'subscription' : 'grok-build-subscription';
      const quotaBuckets = [
        {
          id: `${id}:weekly`,
          billingDomainId,
          label: 'Weekly limit',
          usedPercent: 41,
          resetsAt: '2026-09-01T00:00:00.000Z',
          authority: 'official-client',
          scope: 'account-wide'
        }
      ];
      return {
        id,
        displayName,
        freshness: { status: 'fresh', lastSuccessAt: '2026-08-28T02:00:00.000Z' },
        health: { status: 'healthy', errorCode: null, message: null, recovery: null },
        coverage: {
          quota: 'complete',
          tokens: 'unavailable',
          actualCost: 'unavailable',
          history: 'unavailable'
        },
        quotaBuckets,
        tokenTotals,
        tokenAuthority: 'local-observation',
        billingDomains:
          id === 'claude-code'
            ? [domain('subscription', 'Claude subscription', quotaBuckets)]
            : [
                domain('grok-build-subscription', 'Build / SuperGrok', quotaBuckets),
                domain('xai-api', 'xAI API')
              ]
      };
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-28T02:00:00.000Z',
        providers: [provider('claude-code', 'Claude Code'), provider('grok', 'Grok')]
      })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const claude = page.locator('.provider-card').filter({ hasText: 'Claude Code' });
  const grok = page.locator('.provider-card').filter({ hasText: 'Grok' });

  for (const provider of [claude, grok]) {
    await expectProviderHasNoTokenDetail(provider);
  }
  await expect(page.getByText('No token observations in this time window.')).toHaveCount(0);
  await expect(page.getByText(/agent-usage telemetry-env/)).toHaveCount(0);

  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  await expect(page.getByTestId('token-model-costs-panel')).toBeAttached();
  await expect(page.getByText('No token observations in this time window.')).toHaveCount(0);
  await expect(page.getByText(/agent-usage telemetry-env/)).toHaveCount(0);

  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByText('当前时间范围内没有 Token 观测数据。')).toHaveCount(0);
  await expect(page.getByText(/agent-usage telemetry-env/)).toHaveCount(0);
});

test('marks the workbench busy while background usage processing runs', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  let usageState: 'running' | 'ready' = 'running';
  await page.route('**/api/doctor', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-30T02:00:00.000Z',
        daemon: { status: 'healthy' },
        database: { status: 'healthy' },
        connectors: [],
        providers: []
      })
    });
  });
  await page.route('**/api/processing', async (route) => {
    const module = (state: 'running' | 'ready') => ({
      state,
      startedAt: '2026-08-30T02:00:00.000Z',
      completedAt: state === 'ready' ? '2026-08-30T02:00:01.000Z' : null,
      message: null
    });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        startedAt: '2026-08-30T02:00:00.000Z',
        hardRebuild: false,
        modules: {
          discovery: module('ready'),
          usage: module(usageState),
          pricing: module('ready'),
          retention: module('ready')
        }
      })
    });
  });
  await page.route('**/api/overview**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(historyOverviewFixture('7d', 700))
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  const workbench = page.getByTestId('token-money-workbench');
  await expect(workbench.getByTestId('usage-headline')).toBeVisible();
  // Cached numbers stay readable while the daemon keeps collecting.
  await expect(workbench.getByTestId('workbench-summary-refresh-status')).toBeVisible();
  await expect(workbench.getByTestId('usage-headline')).toContainText('9.00');

  usageState = 'ready';
  await expect(workbench.getByTestId('workbench-summary-refresh-status')).toHaveCount(0);
  await expect(workbench.getByTestId('workbench-analysis-refresh-status')).toHaveCount(0);
});

test('keeps the workbench steady during manual and window refreshes', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  let releaseManualRefresh = () => {};
  const delayedManualRefresh = new Promise<void>((resolve) => {
    releaseManualRefresh = resolve;
  });
  let releaseDelayedWindowRequest = () => {};
  const delayedWindowRequest = new Promise<void>((resolve) => {
    releaseDelayedWindowRequest = resolve;
  });
  await page.route('**/api/refresh**', async (route) => {
    await delayedManualRefresh;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/doctor', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-28T02:00:00.000Z',
        daemon: { status: 'healthy' },
        database: { status: 'healthy' },
        connectors: [],
        providers: []
      })
    });
  });
  await page.route('**/api/overview**', async (route) => {
    const window = new URL(route.request().url()).searchParams.get('window') ?? '7d';
    if (window === '30d') await delayedWindowRequest;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(historyOverviewFixture(window, window === '30d' ? 3000 : 700))
    });
  });

  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(freshLaunch.stdout.trim());
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  const workbench = page.getByTestId('token-money-workbench');
  await expect(workbench.getByTestId('usage-headline')).toBeVisible();
  await expect(workbench.getByTestId('usage-trend-chart')).toBeVisible();
  const settledBoxes = await workbenchPanelBoxes(page);
  const settledToolbarBox = await workbench.locator('.usage-toolbar').boundingBox();

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refreshing…', exact: true })).toBeVisible();
  // The workbench answers a manual refresh on its own panels, not only in the button.
  await expect(workbench.getByTestId('workbench-summary-refresh-status')).toBeVisible();
  await expect(workbench.getByTestId('workbench-analysis-refresh-status')).toBeVisible();
  await expect(workbench.getByTestId('workbench-breakdown-refresh-status')).toBeVisible();
  const manualRefreshStatusCount = await page.getByTestId('model-costs-refresh-status').count();
  const refreshingToolbarBox = await workbench.locator('.usage-toolbar').boundingBox();
  releaseManualRefresh();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  expect(manualRefreshStatusCount).toBe(0);
  expect(refreshingToolbarBox).toEqual(settledToolbarBox);
  expect(await workbenchPanelBoxes(page)).toEqual(settledBoxes);

  await workbench.getByRole('button', { name: '30d' }).click();
  await expect(workbench.getByTestId('workbench-summary-refresh-status')).toBeVisible();
  await expect(workbench.getByTestId('workbench-analysis-refresh-status')).toBeVisible();
  await expect(workbench.getByTestId('workbench-breakdown-refresh-status')).toBeVisible();
  // The refreshing state rides on each panel edge: cached content must not move.
  expect(await workbenchPanelBoxes(page)).toEqual(settledBoxes);

  releaseDelayedWindowRequest();
  await expect(workbench.getByTestId('workbench-summary-refresh-status')).toHaveCount(0);
  expect(await workbenchPanelBoxes(page)).toEqual(settledBoxes);
});

test('compares a declared plan price with the retail equivalent of the same window', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/overview**', async (route) => {
    const url = new URL(route.request().url());
    const fixture = historyOverviewFixture(
      url.searchParams.get('window') ?? '24h',
      100,
      url.searchParams.get('currency') ?? 'CNY',
      20
    ) as { workbench: { planValue: { unconfiguredDomains: unknown[] } } };
    // Codex can hold a plan price; the fixture's own History Agent cannot, so
    // only Codex may be offered here.
    fixture.workbench.planValue.unconfiguredDomains = [
      {
        providerId: 'codex',
        providerDisplayName: 'Codex',
        billingDomainId: 'subscription',
        billingDomainDisplayName: 'Subscription',
        recordedTokens: 500
      },
      {
        providerId: 'history-agent',
        providerDisplayName: 'History Agent',
        billingDomainId: 'api',
        billingDomainDisplayName: 'API',
        recordedTokens: 100
      }
    ];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) });
  });

  await page.goto(freshLaunch.stdout.trim());
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();

  const planValue = page.getByTestId('plan-value');
  await expect(planValue.getByRole('heading', { name: 'Subscription value' })).toBeVisible();
  await expect(planValue.getByTestId('plan-value-chart')).toBeVisible();
  await expect(planValue.getByTestId('plan-value-empty')).toHaveCount(0);

  const row = planValue.getByTestId('plan-value-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('History Agent · API');
  await expect(row).toContainText('History plan');
  await expect(row.getByTestId('plan-value-ratio')).toHaveText('5x');
  await expect(row).toContainText('Prorated plan cost');
  await expect(row).toContainText('Retail equivalent');
  await expect(planValue).toContainText('Plan price prorated to the selected window');

  // The subscription's own cycle is measured separately, and how far into that
  // cycle it sits stays visible beside the result.
  const period = row.getByTestId('plan-value-period');
  await expect(period).toContainText('This billing period');
  await expect(row.getByTestId('plan-value-period-progress')).toHaveText('16/31 days');
  await expect(period).toContainText('Earned back');
  await expect(period).toContainText('Behind the pace to pay for itself');

  const aside = planValue.getByTestId('plan-value-aside');
  await expect(aside).toContainText('Codex · Subscription');
  await expect(aside).not.toContainText('History Agent');

  // Every eligible billing domain can be given a price, and the metered xAI API
  // domain is never offered one.
  await planValue.getByRole('button', { name: 'Set your plan price in settings' }).first().click();
  const plans = page.getByTestId('settings-plans');
  await expect(plans.getByRole('heading', { name: 'Subscription plans' })).toBeVisible();
  await expect(plans.getByTestId('plan-domain-claude-code-subscription')).toBeVisible();
  await expect(plans.getByTestId('plan-domain-grok-grok-build-subscription')).toBeVisible();
  await expect(plans.getByTestId('plan-domain-grok-xai-api')).toHaveCount(0);
  await expect(
    plans.getByTestId('plan-domain-claude-code-subscription').getByRole('combobox').first()
  ).toContainText('Claude Max 20x');
});

test('switches 24-hour, 7-day, and 30-day token and cost history without mixing cost kinds', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  const requestedWindows: string[] = [];
  const requestedCurrencies: string[] = [];
  let releaseDelayedWindowRequest = () => {};
  const delayedWindowRequest = new Promise<void>((resolve) => {
    releaseDelayedWindowRequest = resolve;
  });
  await page.route('**/api/doctor', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-28T02:00:00.000Z',
        daemon: { status: 'healthy' },
        database: { status: 'healthy' },
        connectors: [],
        providers: []
      })
    });
  });
  await page.route('**/api/overview**', async (route) => {
    const url = new URL(route.request().url());
    const window = url.searchParams.get('window') ?? '24h';
    const currency = url.searchParams.get('currency') ?? 'CNY';
    requestedWindows.push(window);
    requestedCurrencies.push(currency);
    const total = window === '24h' ? 100 : window === '7d' ? 700 : 3000;
    if (window === '24h') await delayedWindowRequest;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(historyOverviewFixture(window, total, currency, 20))
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'History Agent' });
  await expectProviderHasNoTokenDetail(provider);
  await expect(page.getByRole('heading', { name: 'Recent usage summary' })).toHaveCount(0);
  const risk = page.getByRole('region', { name: 'Capacity outlook' });
  await expect(risk).toHaveCount(0);
  await expect(page.getByText('Recommended agent')).toHaveCount(0);
  await expect(page.getByText('Advice only · never switches agents')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  const workbench = page.getByTestId('token-money-workbench');
  await expect(workbench.getByRole('heading', { name: 'Tokens & model costs' })).toBeVisible();
  await expect(workbench.getByTestId('usage-headline')).toContainText('¥9.00');
  // The headline carries the amount alone: no authority, coverage, or metric caption.
  await expect(workbench.getByTestId('usage-headline')).not.toContainText('API retail equivalent');
  await expect(workbench.getByTestId('trend-mode')).toHaveCount(0);
  await expect(workbench.getByTestId('usage-trend-chart')).toBeVisible();
  const retailTrend = workbench
    .getByTestId('usage-trend-chart')
    .locator('[data-cost-purpose="retail-equivalent"]');
  const reportedTrend = workbench
    .getByTestId('usage-trend-chart')
    .locator('[data-cost-purpose="reported-estimate"]');
  await expect(retailTrend).toHaveCount(1);
  await expect(reportedTrend).toHaveCount(1);
  await expect(retailTrend).not.toHaveAttribute('style', /transparent/);
  await expect(reportedTrend).toHaveAttribute('style', /fill: transparent/);
  // The legend names each Provider billing domain once; the dashed plot line
  // keeps the reported-estimate series distinct.
  await expect(workbench.locator('.trend-legend span')).toHaveCount(1);
  await expect(workbench.locator('.trend-legend')).not.toContainText('Provider-reported estimate');
  const providerShareData = workbench.getByRole('table', { name: 'Provider share' });
  await expect(providerShareData).toContainText('History Agent');
  await expect(providerShareData).not.toContainText('Unknown Agent');
  await workbench.getByRole('button', { name: 'Tokens', exact: true }).click();
  await expect(workbench.getByTestId('usage-headline')).toContainText('700');
  await expect(providerShareData).toContainText('700 Tokens');
  await expect(providerShareData).not.toContainText('Unknown Agent');
  await workbench.getByRole('button', { name: '24h' }).click();
  await expect(workbench.getByTestId('workbench-summary-refresh-status')).toBeVisible();
  await expect(workbench.getByTestId('workbench-analysis-refresh-status')).toBeVisible();
  await expect(workbench.getByTestId('workbench-breakdown-refresh-status')).toBeVisible();
  await expect(workbench.getByRole('button', { name: '24h' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(workbench.getByTestId('usage-headline')).toBeVisible();
  releaseDelayedWindowRequest();
  await expect(workbench.getByTestId('workbench-summary-refresh-status')).toHaveCount(0);
  await expect(workbench.getByTestId('usage-headline')).toContainText('100');
  await workbench.getByRole('button', { name: '7d' }).click();
  await expect(workbench.getByTestId('usage-headline')).toContainText('700');
  await workbench.getByRole('button', { name: '30d' }).click();
  await expect(workbench.getByTestId('usage-headline')).toContainText('3,000');
  await expect(workbench.getByTestId('usage-totals')).toContainText('Input');
  await expect(workbench.getByTestId('usage-totals')).toContainText('Output');
  await expect(workbench.getByTestId('usage-totals')).toContainText('Cache read');
  await expect(workbench.getByText('Subscription', { exact: true })).toHaveCount(0);
  await workbench.getByRole('button', { name: 'USD' }).click();
  await expect.poll(() => requestedCurrencies.at(-1)).toBe('USD');
  await workbench.getByRole('button', { name: 'Cost', exact: true }).click();
  await expect(workbench.getByTestId('usage-headline')).toContainText('$1.25');
  const trendTable = workbench.getByRole('table', { name: 'Trend data' });
  await expect(trendTable).toContainText('Gap');
  // The accessible trend table carries the same names and amounts as the plot.
  await expect(trendTable).toContainText('History Agent · API: $1.25');
  await expect(trendTable).not.toContainText('Billing period');
  await page.reload();
  await expect.poll(() => requestedWindows.at(-1)).toBe('30d');
  await expect.poll(() => requestedCurrencies.at(-1)).toBe('USD');
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  await expect(workbench.getByRole('button', { name: 'USD' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(workbench.getByTestId('usage-headline')).toContainText('$1.25');
});

test('shows known token categories when classification coverage is partial', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  const overview = historyOverviewFixture('30d', 120, 'USD') as {
    workbench: {
      tokenBreakdown: {
        status: 'available' | 'partial' | 'unavailable';
        tokenTotals: {
          total: number;
          input: number;
          output: number;
          reasoning: number;
          cacheRead: number;
          cacheWrite: number;
        };
        classificationCoverage: number | null;
        authorities: string[];
        lastObservedAt: string | null;
      };
    };
  };
  overview.workbench.tokenBreakdown = {
    status: 'partial',
    tokenTotals: {
      total: 120,
      input: 50,
      output: 20,
      reasoning: 10,
      cacheRead: 15,
      cacheWrite: 5
    },
    classificationCoverage: 100 / 120,
    authorities: ['local-observation'],
    lastObservedAt: '2026-08-29T03:47:00.000Z'
  };

  await page.route('**/api/overview**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(overview) });
  });

  await page.goto(freshLaunch.stdout.trim());
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  const totals = page.getByTestId('usage-totals');

  await expect(totals.getByText('Input', { exact: true }).locator('..').locator('dd')).toHaveText(
    '50'
  );
  await expect(totals.getByText('Output', { exact: true }).locator('..').locator('dd')).toHaveText(
    '20'
  );
  await expect(
    totals.getByText('Reasoning', { exact: true }).locator('..').locator('dd')
  ).toHaveText('10');
  await expect(
    totals.getByText('Cache read', { exact: true }).locator('..').locator('dd')
  ).toHaveText('15');
  await expect(
    totals.getByText('Cache write', { exact: true }).locator('..').locator('dd')
  ).toHaveText('5');
  // Classification coverage is no longer printed beside the totals.
  await expect(totals).not.toContainText('83.3%');

  overview.workbench.tokenBreakdown = {
    status: 'unavailable',
    tokenTotals: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    classificationCoverage: null,
    authorities: [],
    lastObservedAt: null
  };
  await page.reload();
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  await expect(
    page.getByTestId('usage-totals').getByText('Input', { exact: true }).locator('..').locator('dd')
  ).toHaveText('Unavailable');
});

test('supports hover, time-axis zoom, drag panning, and reset on the cost trend', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/doctor', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-28T02:00:00.000Z',
        daemon: { status: 'healthy' },
        database: { status: 'healthy' },
        connectors: [],
        providers: []
      })
    });
  });
  await page.route('**/api/overview**', async (route) => {
    const url = new URL(route.request().url());
    const window = url.searchParams.get('window') ?? '7d';
    const currency = url.searchParams.get('currency') ?? 'CNY';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(historyOverviewFixture(window, 700, currency, 20))
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  const workbench = page.getByTestId('token-money-workbench');
  const plot = workbench.getByTestId('trend-plot');
  await expect(plot).toHaveAttribute('data-total-buckets', '7');
  await expect(plot).toHaveAttribute('data-visible-buckets', '7');

  const plotBox = await plot.boundingBox();
  if (!plotBox) throw new Error('Trend plot has no visible bounds.');
  await page.mouse.move(plotBox.x + 4, plotBox.y + plotBox.height / 2);
  const tooltip = workbench.getByTestId('trend-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Bucket 1');
  await expect(tooltip).toContainText('History Agent');
  await expect(tooltip).toContainText('¥9.00');

  await page.mouse.move(plotBox.x + plotBox.width / 2, plotBox.y + plotBox.height / 2);
  await plot.dispatchEvent('wheel', {
    deltaY: -500,
    clientX: plotBox.x + plotBox.width / 2
  });
  await expect
    .poll(async () => Number(await plot.getAttribute('data-visible-buckets')))
    .toBeLessThan(7);
  const startBeforePan = Number(await plot.getAttribute('data-viewport-start'));
  await page.mouse.move(plotBox.x + plotBox.width * 0.75, plotBox.y + plotBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(plotBox.x + plotBox.width * 0.25, plotBox.y + plotBox.height / 2);
  await page.mouse.up();
  await expect
    .poll(async () => Number(await plot.getAttribute('data-viewport-start')))
    .toBeGreaterThan(startBeforePan);

  const resetTimeAxis = workbench.getByRole('button', { name: 'Reset time axis' });
  await expect(resetTimeAxis).toBeEnabled();
  await resetTimeAxis.click();
  await expect(plot).toHaveAttribute('data-visible-buckets', '7');
  await expect(plot).toHaveAttribute('data-viewport-start', '0');
});

test('downloads a redacted export and clears only the selected local scope', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.goto(freshLaunch.stdout.trim());

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const privacy = page.getByRole('dialog', { name: 'Settings' }).getByRole('region', {
    name: 'Privacy & data'
  });
  await expect(privacy).toBeVisible();
  await expect(privacy).toContainText('90 day raw retention');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('agent-usage-7d.json');
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const body = await readFile(downloadPath!, 'utf8');
  expect(JSON.parse(body)).toMatchObject({
    privacy: { accountIdentifiersIncluded: false, secretsIncluded: false }
  });
  expect(body).not.toContain('connector:');
  expect(body).not.toContain('agent-usage:history-window');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear local usage' }).click();
  // Known Agents keep their cards; the cleared scope is reported in Settings.
  await expect(page.getByTestId('agent-usage-panel')).toBeVisible();
  await expect(privacy).toContainText('0 raw observations');
});

test('shows isolated model ranking and returns focus after keyboard detail review', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/overview**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(historyOverviewFixture('7d', 2900, 'USD'))
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  const ranking = page.getByTestId('usage-breakdown');
  await expect(ranking.getByRole('heading', { name: 'Breakdown' })).toBeVisible();
  await expect(ranking.locator('.breakdown-header')).toContainText('Model');
  const rows = ranking.getByTestId('model-ranking-row');
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText('fable-model');
  await expect(rows.first()).toContainText('Claude Code · Subscription');
  await expect(rows.first().locator('img')).toHaveAttribute('src', '/brands/claude.svg');

  await page
    .getByTestId('token-money-workbench')
    .getByRole('button', {
      name: 'Tokens',
      exact: true
    })
    .click();
  await expect(rows.first()).toContainText('shared-model');
  await expect(rows.first()).toContainText('Codex · Subscription');
  await expect(rows.first()).toContainText('Unavailable');
  await expect(rows.first().locator('img')).toHaveAttribute('src', '/brands/openai.svg');
  await expect(rows.filter({ hasText: 'model-five' })).toHaveCount(1);
  // Unclassified usage is no longer surfaced under the ranking.
  await expect(ranking.getByText('Unclassified usage')).toHaveCount(0);

  await page
    .getByTestId('token-money-workbench')
    .getByRole('button', {
      name: 'Cost',
      exact: true
    })
    .click();
  await expect(rows.first()).toContainText('fable-model');
  const grokRow = rows.filter({ hasText: 'Grok · xAI API' });
  // The page renders in the light system theme here, so Grok uses its dark ink mark.
  await expect(grokRow.locator('img')).toHaveAttribute('src', '/brands/grok-dark.svg');
  await expect(grokRow).toContainText('Separate domain · not included in headline');
  await expect(grokRow).not.toContainText('Provider-reported estimate');
  await expect(grokRow).toContainText('$3.00');
  await expect(rows.filter({ hasText: 'shared-model' })).toHaveCount(2);
  await expect(rows.filter({ hasText: 'model-five' })).toHaveCount(1);

  // The breakdown keeps a single model dimension: no Model/Day switch remains.
  await expect(ranking.getByRole('button', { name: 'Day', exact: true })).toHaveCount(0);
  await expect(ranking.getByRole('button', { name: 'Model', exact: true })).toHaveCount(0);
  await expect(ranking.getByTestId('day-breakdown-row')).toHaveCount(0);
  await page
    .getByTestId('token-money-workbench')
    .getByRole('button', { name: 'Tokens', exact: true })
    .click();
  await page
    .getByTestId('token-money-workbench')
    .getByRole('button', { name: 'Cost', exact: true })
    .click();

  const fableRow = rows.filter({ hasText: 'fable-model' });
  await fableRow.focus();
  await fableRow.press('Enter');
  const detail = page.getByRole('dialog', { name: 'Model detail: fable-model' });
  await expect(detail).toBeVisible();
  await expect(detail).toBeFocused();
  await expect(page.locator('.shell')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(detail.getByRole('button', { name: 'Close model detail' })).toBeFocused();
  await expect(detail).toContainText('Claude Code · Subscription');
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(fableRow).toBeFocused();
});

test('presents model detail as a compact visual summary instead of long visible lists', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/overview**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(historyOverviewFixture('30d', 2900, 'USD'))
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  const ranking = page.getByTestId('usage-breakdown');
  const breakdownViewTabs = ranking.getByTestId('breakdown-view-tabs');
  await expect(breakdownViewTabs.getByRole('tab', { name: 'List', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await breakdownViewTabs.getByRole('tab', { name: 'Treemap', exact: true }).click();
  await expect(ranking.getByTestId('model-breakdown-treemap')).toBeVisible();
  await expect(ranking.getByTestId('model-ranking-row')).toHaveCount(0);
  await breakdownViewTabs.getByRole('tab', { name: 'Stacked trend', exact: true }).click();
  await expect(ranking.getByTestId('model-trend-stacked')).toBeVisible();
  await expect(ranking.getByTestId('model-breakdown-treemap')).toHaveCount(0);
  await breakdownViewTabs.getByRole('tab', { name: 'List', exact: true }).click();
  await expect(ranking.getByTestId('model-ranking-row')).toHaveCount(6);
  const fableRow = page.getByTestId('model-ranking-row').filter({ hasText: 'fable-model' });
  await fableRow.click();

  const detail = page.getByRole('dialog', { name: 'Model detail: fable-model' });
  const visual = detail.getByTestId('model-detail-visual');
  const detailBox = await detail.boundingBox();
  const visualBox = await visual.boundingBox();
  expect(detailBox?.width).toBeGreaterThanOrEqual(1100);
  expect(visualBox?.height).toBeGreaterThanOrEqual(380);
  await expect(visual).toHaveAttribute('data-chart-engine', 'echarts');
  await expect(visual).toHaveAttribute('aria-label', /Token breakdown/);
  await expect(visual.locator('canvas')).toBeVisible();
  const desktopCompositionLayout = await modelDetailCompositionLayout(visual.locator('canvas'));
  expect(
    desktopCompositionLayout.legendTop,
    JSON.stringify(desktopCompositionLayout)
  ).not.toBeNull();
  expect(
    desktopCompositionLayout.gap,
    JSON.stringify(desktopCompositionLayout)
  ).toBeGreaterThanOrEqual(8);
  await expect(detail).toContainText('Activity overview');
  await expect(detail.getByTestId('model-detail-summary')).toContainText('Recorded total 450');
  await expect(detail.getByTestId('model-detail-summary')).toContainText('Cost');
  await expect(detail.getByTestId('model-detail-summary')).not.toContainText('Local observation');
  await expect(detail.getByTestId('model-detail-summary')).toContainText('$4.00');
  await expect(detail.getByTestId('model-detail-summary')).toContainText('Observations 1');
  await expect(detail.getByTestId('model-evidence-summary')).toContainText('This Mac only');
  await expect(detail.getByTestId('model-evidence-summary')).toContainText(
    '2026-08-01 · Official fixture pricing'
  );
  await expect(
    detail.getByTestId('model-evidence-summary').locator('.model-price-source strong')
  ).toHaveText('2026-08-01 · Official fixture pricing');
  await expect(detail.locator('.model-observations')).toHaveCount(0);
  await expect(detail.locator('.model-trend-table')).toHaveCount(0);
  const tokenBreakdown = detail.getByRole('table', { name: 'Token breakdown' });
  await expect(tokenBreakdown.getByRole('row').filter({ hasText: 'Input' })).toContainText('320');
  await expect(tokenBreakdown.getByRole('row').filter({ hasText: 'Output' })).toContainText('80');
  await expect(tokenBreakdown.getByRole('row').filter({ hasText: 'Unclassified' })).toContainText(
    '50'
  );
  await expect(detail.getByRole('table', { name: 'Model trend' })).toContainText('Gap');
  await expect(detail.getByRole('table', { name: 'Model trend' })).toContainText('$4.00');
  await expect(detail.getByRole('table', { name: 'Model trend' })).not.toContainText('Estimate');
  await expect(detail.getByText('Audit details')).toHaveCount(0);
  await expect(detail.getByRole('table', { name: 'Provider evidence' })).toHaveCount(0);
  await expect(detail.getByRole('table', { name: 'Price line items' })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await detail.boundingBox())?.width).toBe(390);
  await expect
    .poll(() => detail.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(0);
  const compactCompositionLayout = await modelDetailCompositionLayout(visual.locator('canvas'));
  expect(
    compactCompositionLayout.legendTop,
    JSON.stringify(compactCompositionLayout)
  ).not.toBeNull();
  expect(
    compactCompositionLayout.gap,
    JSON.stringify(compactCompositionLayout)
  ).toBeGreaterThanOrEqual(8);
});

test('opens the model detail shell promptly with a large evidence history', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  const fixture = historyOverviewFixture('30d', 2900, 'USD') as {
    workbench: {
      modelRanking: {
        entries: Array<{
          model: string;
          observations: Array<{ id: string; observedAt: string; [key: string]: unknown }>;
          priceEvidence: Array<{ id: string; [key: string]: unknown }>;
          tokenEvidence: { observationCount: number };
        }>;
      };
    };
  };
  const model = fixture.workbench.modelRanking.entries.find(
    (entry) => entry.model === 'fable-model'
  );
  if (!model?.observations[0] || !model.priceEvidence[0]) {
    throw new Error('Expected the performance fixture to include model audit evidence');
  }
  const observation = model.observations[0];
  const price = model.priceEvidence[0];
  model.observations = Array.from({ length: 12_000 }, (_, index) => ({
    ...observation,
    id: `large-observation-${index}`,
    observedAt: '2026-08-01T00:30:00.000Z'
  }));
  model.priceEvidence = Array.from({ length: 4_000 }, (_, index) => ({
    ...price,
    id: `large-price-${index}`,
    usageObservationId: `large-observation-${index}`
  }));
  model.tokenEvidence.observationCount = model.observations.length;

  await page.route('**/api/overview**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) });
  });
  await page.goto(freshLaunch.stdout.trim());
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  const fableRow = page.getByTestId('model-ranking-row').filter({ hasText: 'fable-model' });

  const clickToFrameMs = await fableRow.evaluate(
    (button) =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() => {
          const startedAt = performance.now();
          (button as HTMLButtonElement).click();
          requestAnimationFrame(() => resolve(performance.now() - startedAt));
        });
      })
  );

  expect(clickToFrameMs).toBeLessThan(500);
  await expect(page.getByRole('dialog', { name: 'Model detail: fable-model' })).toBeVisible();
});

test('follows system theme and keeps the usage dashboard responsive with local official artwork', async ({
  page
}) => {
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol !== 'data:') {
      externalRequests.push(request.url());
    }
  });
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/overview**', async (route) => {
    await fulfillOverview(
      route,
      historyOverviewFixture('7d', 12_400, 'CNY') as {
        providers: Array<Record<string, unknown>>;
      }
    );
  });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(freshLaunch.stdout.trim());

  const gridColumnCount = () =>
    page.locator('.providers').evaluate((element) => {
      return getComputedStyle(element).gridTemplateColumns.split(' ').length;
    });
  await expect.poll(gridColumnCount).toBe(2);
  const lightBackground = await page.locator('body').evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, image: style.backgroundImage, value: style.backgroundColor };
  });
  expect(lightBackground.image).toBe('none');
  await expect
    .poll(() =>
      page
        .locator('.provider-card')
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundImage)
    )
    .toBe('none');
  for (const providerId of ['codex', 'claude-code', 'opencode-go', 'grok']) {
    const logo = page.locator(`img[data-provider-logo="${providerId}"]`).first();
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('src', /^\/brands\//);
  }
  await expect(page.locator('img[data-provider-logo="opencode-go"]').first()).toHaveAttribute(
    'src',
    '/brands/opencode-light.svg'
  );
  await expect(page.locator('img[data-provider-logo="grok"]').first()).toHaveAttribute(
    'src',
    '/brands/grok-dark.svg'
  );
  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  await page
    .getByTestId('token-money-workbench')
    .getByRole('button', { name: 'Tokens', exact: true })
    .click();
  await expect(page.getByTestId('usage-headline')).toContainText('12.4K');
  await expect(page.getByTestId('usage-headline').locator('strong')).toHaveAttribute(
    'aria-label',
    '12,400 Tokens'
  );
  await page.getByRole('tab', { name: 'Agent usage' }).click();
  await expect(page.getByTestId('agent-usage-panel')).toBeVisible();
  expect(
    await page
      .locator('img[data-provider-logo="opencode-go"]')
      .first()
      .evaluate((image) => new URL((image as HTMLImageElement).src).pathname)
  ).toBe('/brands/opencode-light.svg');
  expect(
    await page
      .locator('img[data-provider-logo="grok"]')
      .first()
      .evaluate((image) => new URL((image as HTMLImageElement).src).pathname)
  ).toBe('/brands/grok-dark.svg');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(gridColumnCount).toBe(2);
  await page.setViewportSize({ width: 1680, height: 1000 });
  await expect.poll(gridColumnCount).toBe(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(gridColumnCount).toBe(1);
  const overflowingElements = await page.locator('body *').evaluateAll((elements) =>
    elements
      .filter(
        (element) =>
          !element.closest('.trend-data') &&
          element.getBoundingClientRect().right > window.innerWidth + 1
      )
      .map((element) => ({
        className: element.getAttribute('class'),
        right: Math.round(element.getBoundingClientRect().right),
        tagName: element.tagName
      }))
  );
  expect(overflowingElements).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );

  await page.emulateMedia({ colorScheme: 'dark' });
  // The resolved theme is applied by the theme store, so wait for it to land.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkBackground = await page.locator('body').evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, image: style.backgroundImage, value: style.backgroundColor };
  });
  expect(darkBackground.image).toBe('none');
  expect(darkBackground.value).not.toBe(lightBackground.value);
  expect(darkBackground.color).not.toBe(lightBackground.color);
  await expect
    .poll(() =>
      page
        .locator('img[data-provider-logo="opencode-go"]')
        .first()
        .evaluate((image) => {
          const source = (image as HTMLImageElement).src;
          return source ? new URL(source).pathname : '';
        })
    )
    .toBe('/brands/opencode-dark.svg');
  await expect
    .poll(() =>
      page
        .locator('img[data-provider-logo="grok"]')
        .first()
        .evaluate((image) => {
          const source = (image as HTMLImageElement).src;
          return source ? new URL(source).pathname : '';
        })
    )
    .toBe('/brands/grok-light.svg');
  expect(externalRequests).toEqual([]);
  // A malformed Provider payload used to throw and freeze every later update.
  expect(pageErrors).toEqual([]);
});

test('presents the dashboard as a cohesive hierarchy across its primary views', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/overview**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(historyOverviewFixture('7d', 12_400, 'CNY'))
    });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(freshLaunch.stdout.trim());

  const logo = page.locator('.product-logo');
  const primaryViews = page.getByRole('tablist', { name: 'Main views' });
  const headerActions = page.locator('.header-actions');
  const controlCenterSpread = async () => {
    const boxes = await Promise.all([
      logo.boundingBox(),
      primaryViews.boundingBox(),
      headerActions.boundingBox()
    ]);
    if (boxes.some((box) => box === null)) return Number.POSITIVE_INFINITY;
    const centers = boxes.map((box) => box!.y + box!.height / 2);
    return Math.round(Math.max(...centers) - Math.min(...centers));
  };
  await expect.poll(controlCenterSpread).toBeLessThanOrEqual(4);

  const shellLayout = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.product-header');
    const providers = document.querySelector<HTMLElement>('.providers');
    if (!header || !providers) throw new Error('Dashboard shell is unavailable');
    return {
      headerPosition: getComputedStyle(header).position,
      providerAlignment: getComputedStyle(providers).alignItems
    };
  });
  expect(shellLayout).toEqual({
    headerPosition: 'sticky',
    providerAlignment: 'stretch'
  });

  const providerSurface = await page
    .locator('.provider-card')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: Number.parseFloat(style.borderRadius)
      };
    });
  const pageBackground = await page
    .locator('body')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(providerSurface.backgroundColor).not.toBe(pageBackground);
  expect(providerSurface.borderRadius).toBeGreaterThanOrEqual(22);

  await page.getByRole('tab', { name: 'Tokens & model costs' }).click();
  const workbenchFrame = await page.getByTestId('token-money-workbench').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      padding: style.padding,
      borderTopWidth: style.borderTopWidth,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow
    };
  });
  expect(workbenchFrame).toEqual({
    padding: '0px',
    borderTopWidth: '0px',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    boxShadow: 'none'
  });
  const summaryBoard = page.getByTestId('usage-summary-board');
  const analysisGrid = page.getByTestId('usage-analysis-grid');
  await expect(summaryBoard).toBeVisible();
  await expect(analysisGrid).toBeVisible();
  const [summaryBox, analysisBox] = await Promise.all([
    summaryBoard.boundingBox(),
    analysisGrid.boundingBox()
  ]);
  expect(summaryBox).not.toBeNull();
  expect(analysisBox).not.toBeNull();
  expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(analysisBox!.y);
  const visualHierarchy = await page.evaluate(() => {
    const headline = document.querySelector<HTMLElement>('.usage-headline > strong');
    const summary = document.querySelector<HTMLElement>('.usage-summary-board');
    if (!headline || !summary) throw new Error('Usage summary is unavailable');
    const headlineStyle = getComputedStyle(headline);
    return {
      headlineWhiteSpace: headlineStyle.whiteSpace,
      headlineOverflowWrap: headlineStyle.overflowWrap,
      summaryShadow: getComputedStyle(summary).boxShadow
    };
  });
  expect(visualHierarchy.headlineWhiteSpace).toBe('nowrap');
  expect(visualHierarchy.headlineOverflowWrap).toBe('normal');
  expect(visualHierarchy.summaryShadow).not.toBe('none');
  const providerShareChart = page.getByTestId('provider-share-chart');
  await expect(providerShareChart).toHaveAttribute('data-chart-engine', 'echarts');
  await expect(providerShareChart.locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('usage-provider-summary')).toHaveCount(0);
  const providerChartBox = await providerShareChart.boundingBox();
  expect(providerChartBox).not.toBeNull();
  await providerShareChart.hover({
    position: { x: providerChartBox!.width / 2, y: providerChartBox!.height * 0.12 }
  });
  await expect(providerShareChart.locator('.provider-share-tooltip')).toContainText(
    'History Agent'
  );
  await page.mouse.move(0, 0);
  await expect(providerShareChart.locator('.provider-share-tooltip')).toBeHidden();
  await providerShareChart.hover({
    position: { x: providerChartBox!.width / 2, y: providerChartBox!.height - 10 }
  });
  await expect(providerShareChart.locator('.provider-share-tooltip')).toHaveText(
    /History Agent.*100%/
  );
  await expect(providerShareChart.locator('.provider-share-tooltip')).not.toContainText('Source:');
  await page.mouse.move(0, 0);
  await expect(providerShareChart.locator('.provider-share-tooltip')).toBeHidden();
  await expect(page.getByTestId('model-share-meter').first()).toHaveAttribute('role', 'meter');
  for (const selector of [
    '.usage-summary-board',
    '.usage-summary',
    '.workbench-trend',
    '.model-ranking'
  ]) {
    const surface = await page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: Number.parseFloat(style.borderRadius)
      };
    });
    expect(surface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(surface.borderRadius).toBeGreaterThanOrEqual(16);
  }
});

test('keeps narrow keyboard flows labelled, constrained, and reduced-motion safe', async ({
  page
}) => {
  let delayRefresh = false;
  await page.route('**/api/refresh**', async (route) => {
    if (delayRefresh) await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(freshLaunch.stdout.trim());
  await expect(page.getByRole('main')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Refresh' }).click();

  const quota = page.getByRole('progressbar', { name: '5 hour' });
  await expect(quota).toHaveAttribute('aria-valuenow', '42');
  await expect(quota).toHaveAttribute('aria-valuetext', '42% used');

  const mainViews = page.getByRole('tablist', { name: 'Main views' });
  const agentUsageTab = mainViews.getByRole('tab', { name: 'Agent usage' });
  const modelCostsTab = mainViews.getByRole('tab', { name: 'Tokens & model costs' });
  await agentUsageTab.focus();
  await agentUsageTab.press('ArrowRight');
  await expect(modelCostsTab).toBeFocused();
  await expect(modelCostsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('table', { name: /Trend data · 7d/ })).toBeAttached();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);
  const narrowTokenLayout = await page.evaluate(() => {
    const headline = document.querySelector<HTMLElement>('.usage-headline > strong');
    const values = [
      ...document.querySelectorAll<HTMLElement>(
        '.model-ranking .ranking-value strong, .model-ranking .day-value'
      )
    ];
    if (!headline || values.length === 0) throw new Error('Token details are unavailable');
    return {
      headlineOverflow: headline.scrollWidth - headline.clientWidth,
      values: values.map((value) => {
        const style = getComputedStyle(value);
        return {
          overflowWrap: style.overflowWrap,
          whiteSpace: style.whiteSpace
        };
      })
    };
  });
  expect(narrowTokenLayout.headlineOverflow).toBeLessThanOrEqual(0);
  expect(narrowTokenLayout.values).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ overflowWrap: 'anywhere', whiteSpace: 'normal' })
    ])
  );
  await expect
    .poll(() =>
      page
        .locator('.model-ranking')
        .evaluate((element) => element.scrollWidth - element.clientWidth)
    )
    .toBeLessThanOrEqual(0);
  await modelCostsTab.press('ArrowLeft');
  await expect(agentUsageTab).toBeFocused();
  await expect(agentUsageTab).toHaveAttribute('aria-selected', 'true');

  const grok = page.locator('.provider-card').filter({ hasText: 'Grok' });
  const buildTab = grok.getByRole('tab', { name: 'Build / SuperGrok' });
  const apiTab = grok.getByRole('tab', { name: 'xAI API' });
  await buildTab.focus();
  await buildTab.press('ArrowRight');
  await expect(apiTab).toBeFocused();
  await expect(apiTab).toHaveAttribute('aria-selected', 'true');

  const settingsButton = page.getByRole('button', { name: 'Settings', exact: true });
  await settingsButton.focus();
  const focusStyle = await settingsButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe('none');
  expect(focusStyle.outlineWidth).not.toBe('0px');
  await settingsButton.press('Enter');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeFocused();
  await expect(page.locator('.shell')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(settings.getByRole('button', { name: 'Clear local usage' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(settings.getByRole('button', { name: 'Close settings' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settingsButton).toBeFocused();
  await expect(page.locator('.shell')).not.toHaveAttribute('inert', '');

  delayRefresh = true;
  await settingsButton.press('Tab');
  await page.getByRole('button', { name: 'Refresh' }).click();
  const refreshButton = page.getByRole('button', { name: 'Refreshing…' });
  await expect(refreshButton).toBeVisible();
  await expect(refreshButton.locator('span')).toHaveCSS('animation-name', 'none');
});

test('switches the complete catalog to Simplified Chinese without translating provider labels', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.goto(freshLaunch.stdout.trim());

  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  const mainViews = page.getByRole('tablist', { name: '主要视图' });
  await expect(mainViews.getByRole('tab', { name: 'Agent 用量' })).toBeVisible();
  await expect(mainViews.getByRole('tab', { name: 'Token 与模型费用' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '连接' })).toHaveCount(0);
  await expect(page.getByText('连接设置').first()).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '隐私与数据' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claude Code' })).toBeVisible();
  const demoCard = page.locator('.provider-card').filter({ hasText: 'Demo Agent' });
  await expect(demoCard).toContainText('完整');
  await expect(demoCard).toContainText('官方账户');
  await expect(demoCard).not.toContainText('Official Account');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

async function expectQuotaShowsOnlyReset(provider: Locator, bucketCount: number): Promise<void> {
  const quotaMetadata = provider.locator('.quota-meta');
  await expect(quotaMetadata).toHaveCount(bucketCount);
  await expect(quotaMetadata.locator('span')).toHaveCount(bucketCount);
  for (const metadata of await quotaMetadata.all()) {
    await expect(metadata).toContainText('Resets');
    await expect(metadata).not.toContainText(/Source:|Scope:|Plan:|Limit:|Use balance:/);
  }
}

async function expectProviderHasNoTokenDetail(provider: Locator): Promise<void> {
  await expect(
    provider.locator(
      '.token-scope, .token-total, .token-breakdown, .token-unavailable, .billing-records, .history-rankings'
    )
  ).toHaveCount(0);
}

function withTokenDomain<
  T extends {
    quotaBuckets: unknown[];
    tokenTotals: Record<string, number>;
    tokenEvidence?: Record<string, unknown>;
    tokenAuthority: string;
  }
>(
  provider: T,
  id: string,
  displayName: string,
  observedAt: string
): T & { billingDomains: unknown[] } {
  const tokenEvidence =
    provider.tokenEvidence ?? tokenEvidenceFixture({ total: provider.tokenTotals.total });
  return {
    ...provider,
    summaryBillingDomainId: id,
    tokenEvidence,
    billingDomains: [
      {
        id,
        displayName,
        quotaBuckets: provider.quotaBuckets,
        tokenTotals: provider.tokenTotals,
        tokenEvidence,
        tokenAuthority: provider.tokenAuthority,
        costs: [],
        balances: [],
        invoices: [],
        history: tokenHistoryFixture(
          provider.tokenTotals,
          [provider.tokenAuthority],
          observedAt,
          [],
          tokenEvidence
        )
      }
    ]
  };
}

function tokenHistoryFixture(
  tokenTotals: Record<string, number>,
  authorities: string[],
  lastObservedAt: string | null,
  costs: unknown[] = [],
  tokenEvidence: Record<string, unknown> = tokenEvidenceFixture({ total: tokenTotals.total })
): unknown {
  return {
    window: '24h',
    start: '2026-08-27T02:00:00.000Z',
    end: '2026-08-28T02:00:00.000Z',
    timeZone: 'Asia/Shanghai',
    tokenTotals,
    tokenEvidence,
    models: [],
    days: [],
    costs,
    exchangeRates: [],
    authorities,
    lastObservedAt
  };
}

function tokenEvidenceFixture(
  tokenTotals: { total: number },
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    recordedTokens: tokenTotals.total,
    sourceReportedTokens: 0,
    sourceReportedObservationCount: 0,
    observationCount: tokenTotals.total > 0 ? 1 : 0,
    unclassifiedTokens: 0,
    classifiedTokens: tokenTotals.total,
    classificationCoverage: tokenTotals.total > 0 ? 1 : null,
    totalDerivations: tokenTotals.total > 0 ? ['legacy-total'] : [],
    timePrecisions: tokenTotals.total > 0 ? ['unknown'] : [],
    usageScopes: tokenTotals.total > 0 ? ['unknown'] : [],
    aggregationTemporalities: tokenTotals.total > 0 ? ['unknown'] : [],
    ...overrides
  };
}

function historyOverviewFixture(
  window: string,
  total: number,
  currency = 'CNY',
  remainingPercent = 40
): unknown {
  const pricedTokens = Math.max(0, total - 100);
  const tokenTotals = {
    total,
    input: total,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0
  };
  const tokenEvidence = tokenEvidenceFixture(
    { total },
    {
      totalDerivations: ['categorized'],
      timePrecisions: ['day', 'billing-period'],
      usageScopes: ['account-wide']
    }
  );
  const mostConstrained = {
    providerId: 'history-agent',
    displayName: 'History Agent',
    billingDomainId: 'api',
    bucketId: 'daily',
    label: 'Daily limit',
    remainingPercent,
    resetsAt: '2026-08-28T06:00:00.000Z',
    forecast: null,
    authority: 'official-account',
    observedAt: '2026-08-28T01:57:00.000Z'
  };
  return {
    generatedAt: '2026-08-28T02:00:00.000Z',
    workbench: tokenMoneyWorkbenchFixture(window, total, currency),
    globalSummary: {
      window,
      recordedTokens: total,
      tokenEvidence,
      apiRetailEquivalent: {
        status: 'available',
        amount: 1.25,
        currency: 'USD',
        pricingCoverage: total === 0 ? null : pricedTokens / total
      },
      mostConstrained,
      latestObservedAt: '2026-08-28T01:57:00.000Z',
      generatedAt: '2026-08-28T02:00:00.000Z',
      contributions: [
        {
          providerId: 'history-agent',
          providerDisplayName: 'History Agent',
          billingDomainId: 'api',
          billingDomainDisplayName: 'API',
          includedInHeadline: true,
          recordedTokens: total,
          tokenEvidence
        }
      ]
    },
    riskSummary: {
      mostConstrained,
      recommendation: {
        providerId: 'history-agent',
        displayName: 'History Agent',
        billingDomainId: 'api',
        score: remainingPercent,
        readOnly: true,
        reasonKeys: ['highest-safe-capacity'],
        evidence: {
          remainingPercent,
          freshness: 'fresh',
          forecastCoverage: 'insufficient'
        }
      }
    },
    providers: [
      {
        id: 'history-agent',
        displayName: 'History Agent',
        summaryBillingDomainId: 'api',
        freshness: { status: 'fresh', lastSuccessAt: '2026-08-28T02:00:00.000Z' },
        health: { status: 'healthy', errorCode: null, message: null, recovery: null },
        coverage: {
          quota: 'unavailable',
          tokens: 'complete',
          actualCost: 'complete',
          history: 'complete'
        },
        quotaBuckets: [],
        tokenTotals,
        tokenEvidence,
        tokenAuthority: 'official-account',
        billingDomains: [
          {
            id: 'api',
            displayName: 'API',
            quotaBuckets: [],
            tokenTotals,
            tokenEvidence,
            tokenAuthority: 'official-account',
            costs: [],
            balances: [],
            invoices: [],
            history: {
              window,
              start: '2026-07-29T02:00:00.000Z',
              end: '2026-08-28T02:00:00.000Z',
              timeZone: 'Asia/Shanghai',
              tokenTotals,
              tokenEvidence,
              models: [{ model: 'top-model', tokenTotals, tokenEvidence }],
              days: [{ day: '2026-08-28', tokenTotals, tokenEvidence, costs: [] }],
              costs: [
                {
                  kind: 'actual',
                  currency: 'USD',
                  amount: 2.5,
                  convertedAmount: 18,
                  comparisonCurrency: 'CNY',
                  conversionUnavailableReason: null,
                  priceSnapshots: []
                },
                {
                  kind: 'subscription',
                  currency: 'USD',
                  amount: 20,
                  convertedAmount: 144,
                  comparisonCurrency: 'CNY',
                  conversionUnavailableReason: null,
                  priceSnapshots: [],
                  authorities: ['official-account'],
                  observedAt: '2026-08-01T00:00:00.000Z'
                },
                {
                  kind: 'reported-estimate',
                  currency: 'USD',
                  amount: 0.42,
                  convertedAmount: 3.02,
                  comparisonCurrency: 'CNY',
                  conversionUnavailableReason: null,
                  priceSnapshots: []
                },
                {
                  kind: 'retail-equivalent',
                  currency: 'USD',
                  amount: 1.25,
                  convertedAmount: 9,
                  comparisonCurrency: 'CNY',
                  conversionUnavailableReason: null,
                  pricingEvidence: {
                    pricedTokens,
                    unpricedTokens: total - pricedTokens,
                    recordedTokens: total,
                    pricingCoverage: total === 0 ? null : pricedTokens / total
                  },
                  authorities: ['estimate'],
                  observedAt: '2026-08-28T01:57:00.000Z',
                  priceSnapshots: [
                    {
                      id: 'price-v1',
                      version: '2026-08-01',
                      source: 'Official retail pricing',
                      effectiveAt: '2026-08-01T00:00:00.000Z'
                    }
                  ]
                }
              ],
              exchangeRates: [],
              authorities: ['official-account'],
              lastObservedAt: '2026-08-28T01:57:00.000Z'
            }
          }
        ]
      }
    ]
  };
}

function tokenMoneyWorkbenchFixture(window: string, total: number, currency: string): unknown {
  const comparison =
    currency === 'USD'
      ? { actual: 2.5, reported: 0.0042, retail: 1.25 }
      : {
          actual: 18,
          reported: 0.03024,
          retail: 9
        };
  const bucketCount = window === '24h' ? 24 : window === '7d' ? 7 : 30;
  const metric = (
    purpose: 'actual' | 'reported-estimate' | 'retail-equivalent',
    amount: number,
    nativeAmount: number,
    authority: string
  ) => ({
    purpose,
    status: 'available',
    amount,
    comparisonCurrency: currency,
    nativeAmounts: [{ currency: 'USD', amount: nativeAmount, records: 1, knownRecords: 1 }],
    authorities: [authority],
    observedAt: '2026-08-28T01:57:00.000Z',
    records: 1,
    knownRecords: 1,
    amountCoverage: 1,
    pricingCoverage: purpose === 'retail-equivalent' ? Math.max(0, total - 100) / total : null,
    pricedTokens: purpose === 'retail-equivalent' ? Math.max(0, total - 100) : 0,
    recordedTokens: total,
    conversionUnavailableReasons: [],
    exchangeRates:
      currency === 'CNY'
        ? [
            {
              id: 'usd-cny',
              baseCurrency: 'USD',
              quoteCurrency: 'CNY',
              rate: 7.2,
              observedAt: '2026-08-28T01:00:00.000Z',
              source: 'Test rate'
            }
          ]
        : []
  });
  return {
    window,
    start: '2026-07-29T02:00:00.000Z',
    end: '2026-08-28T02:00:00.000Z',
    timeZone: 'Asia/Shanghai',
    comparisonCurrency: currency,
    recordedTokens: total,
    costs: {
      actual: metric('actual', comparison.actual, 2.5, 'official-account'),
      reportedEstimate: metric(
        'reported-estimate',
        comparison.reported,
        0.0042,
        'local-observation'
      ),
      retailEquivalent: metric('retail-equivalent', comparison.retail, 1.25, 'estimate')
    },
    trend: {
      granularity: window === '24h' ? 'hour' : 'day',
      buckets: Array.from({ length: bucketCount }, (_, index) => ({
        start: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        end: `2026-08-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`,
        label: `Bucket ${index + 1}`,
        gap: index > 0,
        segments:
          index === 0
            ? [
                {
                  providerId: 'history-agent',
                  providerDisplayName: 'History Agent',
                  billingDomainId: 'api',
                  billingDomainDisplayName: 'API',
                  includedInHeadline: true,
                  recordedTokens: total,
                  observationCount: 1,
                  timePrecisions: ['billing-period'],
                  retailEquivalent: {
                    status: 'available',
                    amount: comparison.retail,
                    currency
                  },
                  reportedEstimate: {
                    status: 'available',
                    amount: comparison.reported,
                    currency
                  }
                }
              ]
            : []
      }))
    },
    providerSummary: [
      {
        providerId: 'history-agent',
        providerDisplayName: 'History Agent',
        billingDomainId: 'api',
        billingDomainDisplayName: 'API',
        includedInHeadline: true,
        recordedTokens: total,
        tokenShare: 1,
        retailEquivalent: metric('retail-equivalent', comparison.retail, 1.25, 'estimate'),
        retailShare: 1,
        authorities: ['official-account'],
        lastObservedAt: '2026-08-28T01:57:00.000Z'
      },
      {
        providerId: 'unknown-agent',
        providerDisplayName: 'Unknown Agent',
        billingDomainId: 'api',
        billingDomainDisplayName: 'API',
        includedInHeadline: true,
        recordedTokens: null,
        tokenShare: null,
        retailEquivalent: {
          ...metric('retail-equivalent', 0, 0, 'estimate'),
          status: 'unavailable',
          amount: null,
          nativeAmounts: [],
          authorities: [],
          observedAt: null,
          records: 0,
          knownRecords: 0,
          amountCoverage: null,
          pricingCoverage: 0,
          pricedTokens: 0
        },
        retailShare: null,
        authorities: ['local-observation'],
        lastObservedAt: '2026-08-28T01:57:00.000Z'
      }
    ],
    tokenBreakdown: {
      status: 'available',
      tokenTotals: {
        total,
        input: total * 0.8,
        output: total * 0.2,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0
      },
      classificationCoverage: 1,
      authorities: ['official-account'],
      lastObservedAt: '2026-08-28T01:57:00.000Z'
    },
    dayBreakdown: Array.from({ length: bucketCount }, (_, index) => ({
      start: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      end: `2026-08-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`,
      label: index === 1 ? 'Cost only' : `Bucket ${index + 1}`,
      gap: index > 0,
      recordedTokens: index === 0 ? total : null,
      tokenShare: index === 0 ? 1 : null,
      retailEquivalent:
        index === 0
          ? metric('retail-equivalent', comparison.retail, 1.25, 'estimate')
          : index === 1
            ? metric('retail-equivalent', currency === 'USD' ? 0.5 : 3.6, 0.5, 'estimate')
            : {
                ...metric('retail-equivalent', 0, 0, 'estimate'),
                status: 'unavailable',
                amount: null,
                records: 0,
                knownRecords: 0,
                amountCoverage: null,
                pricingCoverage: null
              },
      retailShare: index === 0 ? 1 : index === 1 ? 0.5 / comparison.retail : null,
      authorities: index === 0 ? ['official-account'] : [],
      lastObservedAt: index === 0 ? '2026-08-28T01:57:00.000Z' : null
    })),
    modelRanking: modelRankingFixture(currency, bucketCount),
    planValue: {
      windowDays: 30,
      comparisonCurrency: currency,
      catalogVersion: '2026-08-30',
      entries: [
        {
          providerId: 'history-agent',
          providerDisplayName: 'History Agent',
          billingDomainId: 'api',
          billingDomainDisplayName: 'API',
          includedInHeadline: true,
          plan: {
            planId: 'history-plan',
            displayName: 'History plan',
            amount: 20,
            currency: 'USD',
            billingPeriod: 'monthly',
            priceSource: 'catalog-preset',
            updatedAt: '2026-08-01T00:00:00.000Z'
          },
          windowDays: 30,
          windowPlanCost: {
            status: 'available',
            amount: comparison.retail / 5,
            nativeAmount: 0.25,
            nativeCurrency: 'USD',
            comparisonCurrency: currency,
            conversionUnavailableReason: null,
            exchangeRates: []
          },
          recordedTokens: total,
          retailEquivalent: metric('retail-equivalent', comparison.retail, 1.25, 'estimate'),
          valueRatio: 5,
          ratioBound: 'exact',
          status: 'available',
          effectiveUnitPrice: comparison.retail / 5 / (total / 1_000_000),
          retailUnitPrice: comparison.retail / (total / 1_000_000),
          pricingCoverage: 1,
          authorities: ['official-account'],
          lastObservedAt: '2026-08-28T01:57:00.000Z',
          billingPeriod: {
            start: '2026-08-12T00:00:00.000Z',
            end: '2026-09-12T00:00:00.000Z',
            elapsedDays: 16,
            totalDays: 31,
            progress: 16 / 31,
            periodCost: {
              status: 'available',
              amount: comparison.retail,
              nativeAmount: 20,
              nativeCurrency: 'USD',
              comparisonCurrency: currency,
              conversionUnavailableReason: null,
              exchangeRates: []
            },
            recordedTokens: total,
            retailEquivalent: metric('retail-equivalent', comparison.retail / 2, 1.25, 'estimate'),
            breakEvenRatio: 0.5,
            ratioBound: 'exact'
          }
        }
      ],
      meteredDomains: [],
      unconfiguredDomains: []
    }
  };
}

function modelRankingFixture(currency: string, bucketCount: number): unknown {
  const models = [
    ['codex', 'Codex', 'subscription', 'Subscription', 'shared-model', 500, null],
    ['claude-code', 'Claude Code', 'subscription', 'Subscription', 'fable-model', 400, 4],
    ['opencode-go', 'OpenCode Go', 'subscription', 'Subscription', 'open-model', 400, 2],
    ['grok', 'Grok', 'xai-api', 'xAI API', 'shared-model', 300, null],
    ['codex', 'Codex', 'subscription', 'Subscription', 'model-four', 200, null],
    ['codex', 'Codex', 'subscription', 'Subscription', 'model-five', 100, null]
  ] as const;
  const entries = models.map(
    ([
      providerId,
      providerDisplayName,
      billingDomainId,
      billingDomainDisplayName,
      model,
      tokens,
      amount
    ]) => {
      const id = `${providerId}::${billingDomainId}::${model}`;
      const tokenTotals = {
        total: tokens,
        input: tokens * 0.8,
        output: tokens * 0.2,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0
      };
      const tokenEvidence = tokenEvidenceFixture(tokenTotals, {
        recordedTokens: model === 'fable-model' ? 450 : tokens,
        sourceReportedTokens: model === 'fable-model' ? 450 : tokens,
        sourceReportedObservationCount: 1,
        classifiedTokens: tokens,
        unclassifiedTokens: model === 'fable-model' ? 50 : 0,
        classificationCoverage: model === 'fable-model' ? 400 / 450 : 1,
        totalDerivations: ['source-reported'],
        timePrecisions: ['event'],
        usageScopes: ['this-mac']
      });
      const convertedAmount = amount === null ? null : currency === 'USD' ? amount : amount * 7.2;
      const retailEquivalent = {
        purpose: 'retail-equivalent',
        status: amount === null ? 'unavailable' : 'available',
        amount: convertedAmount,
        comparisonCurrency: currency,
        nativeAmounts:
          amount === null ? [] : [{ currency: 'USD', amount, records: 1, knownRecords: 1 }],
        authorities: amount === null ? [] : ['estimate'],
        observedAt: '2026-08-28T00:30:00.000Z',
        records: amount === null ? 0 : 1,
        knownRecords: amount === null ? 0 : 1,
        amountCoverage: amount === null ? null : 1,
        pricingCoverage: amount === null ? 0 : 1,
        pricedTokens: amount === null ? 0 : tokens,
        recordedTokens: tokens,
        conversionUnavailableReasons: [],
        exchangeRates: []
      };
      const reportedEstimate = {
        ...retailEquivalent,
        purpose: 'reported-estimate',
        status: providerId === 'grok' ? 'available' : 'unavailable',
        amount: providerId === 'grok' ? (currency === 'USD' ? 3 : 21.6) : null,
        nativeAmounts:
          providerId === 'grok'
            ? [{ currency: 'USD', amount: 3, records: 1, knownRecords: 1 }]
            : [],
        authorities: providerId === 'grok' ? ['local-observation'] : [],
        records: providerId === 'grok' ? 1 : 0,
        knownRecords: providerId === 'grok' ? 1 : 0,
        amountCoverage: providerId === 'grok' ? 1 : null,
        pricingCoverage: null,
        pricedTokens: 0
      };
      return {
        id,
        providerId,
        providerDisplayName,
        billingDomainId,
        billingDomainDisplayName,
        includedInHeadline: billingDomainId !== 'xai-api',
        model,
        tokenTotals,
        tokenEvidence,
        tokenShare: billingDomainId === 'xai-api' ? null : tokens / 2900,
        retailEquivalent,
        reportedEstimate,
        retailShare: amount === null ? null : amount / 9,
        authorities: ['local-observation'],
        lastObservedAt: '2026-08-28T00:30:00.000Z',
        observations: [
          {
            id: `${model}-observation`,
            observedAt: '2026-08-28T00:30:00.000Z',
            authority: 'local-observation',
            timePrecision: 'event',
            sourceReportedTotalTokens: model === 'fable-model' ? 450 : tokens,
            recordedTokens: model === 'fable-model' ? 450 : tokens,
            classifiedTokens: tokens,
            unclassifiedTokens: model === 'fable-model' ? 50 : 0,
            usageScope: 'this-mac',
            aggregationTemporality: 'delta',
            tokenSemantics: {
              reasoning: 'included-in-output',
              cacheRead: 'separate',
              cacheWrite: 'separate'
            },
            totalDerivation: 'source-reported',
            tokenTotals
          }
        ],
        priceEvidence:
          model === 'fable-model'
            ? [
                {
                  id: 'fable-retail',
                  kind: 'retail-equivalent',
                  currency: 'USD',
                  amount: 4,
                  convertedAmount,
                  comparisonCurrency: currency,
                  conversionUnavailableReason: null,
                  priceSnapshots: [],
                  authorities: ['estimate'],
                  observedAt: '2026-08-28T00:30:00.000Z',
                  records: 1,
                  knownRecords: 1,
                  usageObservationId: 'fable-model-observation',
                  pricedTokens: 400,
                  lineItems: [
                    { tokenKind: 'input', tokens: 320, ratePerMillion: 10000, amount: 3.2 },
                    { tokenKind: 'output', tokens: 80, ratePerMillion: 10000, amount: 0.8 }
                  ],
                  priceSnapshot: {
                    id: 'fable-price',
                    version: '2026-08-01',
                    source: 'Official fixture pricing',
                    canonicalModel: 'fable-model',
                    effectiveAt: '2026-08-01T00:00:00.000Z',
                    effectiveUntil: null,
                    currency: 'USD',
                    ratesPerMillion: {
                      input: 10_000,
                      output: 10_000,
                      reasoning: null,
                      'cache-read': null,
                      'cache-write': null
                    }
                  },
                  authority: 'estimate',
                  calculatedAt: '2026-08-28T00:31:00.000Z'
                }
              ]
            : [],
        trend: Array.from({ length: bucketCount }, (_, index) => ({
          start: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
          end: `2026-08-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`,
          label: `Bucket ${index + 1}`,
          gap: index > 0,
          authorities: index === 0 ? ['local-observation'] : [],
          lastObservedAt: index === 0 ? '2026-08-28T00:30:00.000Z' : null,
          tokenTotals:
            index === 0 ? tokenTotals : { ...tokenTotals, total: 0, input: 0, output: 0 },
          retailEquivalent: {
            status: index === 0 && amount !== null ? 'available' : 'unavailable',
            amount: index === 0 ? convertedAmount : null,
            comparisonCurrency: currency,
            pricingCoverage: index === 0 && amount !== null ? 1 : null,
            authorities: index === 0 && amount !== null ? ['estimate'] : [],
            observedAt: index === 0 && amount !== null ? '2026-08-28T00:31:00.000Z' : null
          },
          reportedEstimate: {
            status: 'unavailable',
            amount: null,
            comparisonCurrency: currency,
            pricingCoverage: null,
            authorities: [],
            observedAt: null
          }
        }))
      };
    }
  );
  return {
    byTokens: entries.map((entry) => entry.id),
    byCost: [entries[1], entries[3], entries[2], entries[0], entries[4], entries[5]].map(
      (entry) => entry.id
    ),
    byRetailEquivalent: [
      entries[1],
      entries[3],
      entries[2],
      entries[0],
      entries[4],
      entries[5]
    ].map((entry) => entry.id),
    entries,
    unclassified: [
      {
        providerId: 'codex',
        providerDisplayName: 'Codex',
        billingDomainId: 'subscription',
        billingDomainDisplayName: 'Subscription',
        includedInHeadline: true,
        tokenTotals: {
          total: 1000,
          input: 800,
          output: 200,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0
        },
        tokenEvidence: tokenEvidenceFixture(
          { total: 1000 },
          { totalDerivations: ['source-reported'], timePrecisions: ['event'] }
        ),
        tokenShare: 1000 / 2900,
        authorities: ['local-observation'],
        lastObservedAt: '2026-08-28T00:30:00.000Z'
      }
    ]
  };
}

const grokBillingDomains = [
  {
    id: 'grok-build-subscription',
    displayName: 'Build / SuperGrok',
    freshness: { status: 'fresh', lastSuccessAt: '2026-08-28T01:56:00.000Z' },
    health: { status: 'healthy', errorCode: null, message: null, recovery: null },
    coverage: {
      quota: 'complete',
      tokens: 'partial',
      actualCost: 'unavailable',
      history: 'partial'
    },
    quotaBuckets: [
      {
        id: 'grok-build:weekly',
        billingDomainId: 'grok-build-subscription',
        label: 'Weekly limit',
        usedPercent: 61.2,
        resetsAt: '2026-09-01T00:00:00.000Z',
        authority: 'official-client',
        scope: 'account-wide',
        status: 'SuperGrok Heavy'
      }
    ],
    tokenTotals: {
      total: 525,
      input: 100,
      output: 25,
      reasoning: 12,
      cacheRead: 400,
      cacheWrite: 0
    },
    tokenEvidence: tokenEvidenceFixture(
      { total: 525 },
      {
        totalDerivations: ['categorized'],
        timePrecisions: ['event'],
        usageScopes: ['this-mac'],
        aggregationTemporalities: ['delta']
      }
    ),
    tokenAuthority: 'local-observation',
    costs: [],
    balances: [],
    invoices: [],
    forecasts: [],
    forecastCoverage: 'insufficient',
    history: tokenHistoryFixture(
      {
        total: 525,
        input: 100,
        output: 25,
        reasoning: 12,
        cacheRead: 400,
        cacheWrite: 0
      },
      ['local-observation'],
      '2026-08-28T01:56:00.000Z',
      [],
      tokenEvidenceFixture(
        { total: 525 },
        {
          totalDerivations: ['categorized'],
          timePrecisions: ['event'],
          usageScopes: ['this-mac'],
          aggregationTemporalities: ['delta']
        }
      )
    )
  },
  {
    id: 'xai-api',
    displayName: 'xAI API',
    freshness: { status: 'stale', lastSuccessAt: '2026-08-28T00:00:00.000Z' },
    health: {
      status: 'degraded',
      errorCode: 'unauthorized',
      message: 'xAI API key rejected.',
      recovery: 'Replace the xAI API key.'
    },
    coverage: {
      quota: 'unavailable',
      tokens: 'complete',
      actualCost: 'complete',
      history: 'complete'
    },
    quotaBuckets: [],
    tokenTotals: {
      total: 1742,
      input: 908,
      output: 534,
      reasoning: 42,
      cacheRead: 300,
      cacheWrite: 0
    },
    tokenEvidence: tokenEvidenceFixture(
      { total: 1742 },
      {
        totalDerivations: ['categorized'],
        timePrecisions: ['billing-period'],
        usageScopes: ['account-wide'],
        aggregationTemporalities: ['delta']
      }
    ),
    tokenAuthority: 'official-account',
    costs: [
      {
        id: 'usage-day',
        billingDomainId: 'xai-api',
        observedAt: '2026-08-28T00:00:00.000Z',
        kind: 'actual',
        amount: 2.5,
        currency: 'USD',
        authority: 'official-account'
      }
    ],
    balances: [
      {
        id: 'balance',
        billingDomainId: 'xai-api',
        observedAt: '2026-08-28T02:00:00.000Z',
        kind: 'prepaid',
        amount: 45,
        currency: 'USD',
        authority: 'official-account'
      }
    ],
    invoices: [],
    forecasts: [],
    forecastCoverage: 'insufficient',
    history: tokenHistoryFixture(
      {
        total: 1742,
        input: 908,
        output: 534,
        reasoning: 42,
        cacheRead: 300,
        cacheWrite: 0
      },
      ['official-account'],
      '2026-08-01T00:00:00.000Z',
      [
        {
          kind: 'actual',
          currency: 'USD',
          amount: 2.5,
          convertedAmount: null,
          comparisonCurrency: 'CNY',
          conversionUnavailableReason: 'missing-rate',
          priceSnapshots: [],
          authorities: ['official-account'],
          observedAt: '2026-08-28T00:00:00.000Z'
        }
      ],
      tokenEvidenceFixture(
        { total: 1742 },
        {
          totalDerivations: ['categorized'],
          timePrecisions: ['billing-period'],
          usageScopes: ['account-wide'],
          aggregationTemporalities: ['delta']
        }
      )
    )
  }
];

test('keeps settings controls readable in the light theme', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  if (freshLaunch.exitCode !== 0)
    throw new Error(freshLaunch.stderr || 'Unable to start test daemon');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(freshLaunch.stdout.trim());
  await expect(page.getByRole('heading', { name: 'Agent Usage' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  const controlColors = await settings.evaluate((dialog) => {
    const bodyStyle = getComputedStyle(document.body);
    const section = dialog.querySelector<HTMLElement>('.settings-content > section');
    if (!section) throw new Error('Missing settings section');
    const sectionStyle = getComputedStyle(section);
    const read = (selector: string) => {
      const element = dialog.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing settings control: ${selector}`);
      const style = getComputedStyle(element);
      return { color: style.color, border: style.borderTopColor };
    };
    return {
      monitoring: read('.monitoring-controls label'),
      connection: read('.connection-actions button:not(.primary-action)'),
      privacy: read('.privacy-actions button'),
      text: bodyStyle.color,
      border: sectionStyle.borderTopColor
    };
  });

  expect(controlColors.monitoring.color).toBe(controlColors.text);
  expect(controlColors.connection.color).toBe(controlColors.text);
  expect(controlColors.privacy.color).toBe(controlColors.text);
  expect(controlColors.monitoring.border).toBe(controlColors.border);
  expect(controlColors.connection.border).toBe(controlColors.border);
  expect(controlColors.privacy.border).toBe(controlColors.border);
});

test('keeps provider cards and their final quota rows aligned without forecasts', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/connectors', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/overview**', async (route) => {
    const tokenTotals = {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0
    };
    const specs = [
      ['codex', 'Codex', 'subscription', ['5 hour', 'Week', 'Spark · Week']],
      [
        'claude-code',
        'Claude Code',
        'subscription',
        ['5 hour', 'Week · All models', 'Week · Fable only']
      ],
      ['opencode-go', 'OpenCode Go', 'go-subscription', ['5 hour', 'Week', 'Month']],
      ['grok', 'Grok', 'grok-build-subscription', ['Weekly limit']]
    ] as const;
    const providers = specs.map(([id, displayName, domainId, labels]) => {
      const quotaBuckets = labels.map((label, index) => ({
        id: `${id}:${index}`,
        billingDomainId: domainId,
        label,
        usedPercent: 25 + index * 20,
        resetsAt: '2026-09-01T00:00:00.000Z',
        authority: 'official-client'
      }));
      const forecasts = [
        {
          bucketId: quotaBuckets.at(-1)?.id,
          label: labels.at(-1),
          willLastUntilReset: false,
          confidence: 'high',
          predictedExhaustionAt: '2026-08-30T00:00:00.000Z',
          evidence: { samples: 12, windowEnd: '2026-08-29T00:00:00.000Z' }
        }
      ];
      const domain = {
        id: domainId,
        displayName,
        quotaBuckets,
        tokenTotals,
        tokenAuthority: null,
        costs: [],
        balances: [],
        invoices: [],
        forecasts,
        forecastCoverage: 'complete'
      };
      return {
        id,
        displayName,
        summaryBillingDomainId: domainId,
        freshness: { status: 'fresh', lastSuccessAt: '2026-08-29T00:00:00.000Z' },
        health: { status: 'healthy', errorCode: null, message: null, recovery: null },
        coverage: {
          quota: 'complete',
          tokens: 'unavailable',
          actualCost: 'unavailable',
          history: 'unavailable'
        },
        quotaBuckets,
        tokenTotals,
        tokenAuthority: null,
        billingDomains: [domain],
        forecasts,
        forecastCoverage: 'complete'
      };
    });
    const pathname = new URL(route.request().url()).pathname;
    const providerPrefix = '/api/overview/providers/';
    const body =
      pathname === '/api/overview/providers'
        ? {
            generatedAt: '2026-08-29T00:00:00.000Z',
            providers: providers.map(({ id, displayName }) => ({ id, displayName }))
          }
        : pathname.startsWith(providerPrefix)
          ? providers.find(
              (provider) =>
                provider.id === decodeURIComponent(pathname.slice(providerPrefix.length))
            )
          : { generatedAt: '2026-08-29T00:00:00.000Z', providers };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(freshLaunch.stdout.trim());
  const cards = page.locator('.provider-card');
  await expect(cards).toHaveCount(4);
  await expect(page.locator('.forecast-list')).toHaveCount(0);
  const geometry = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const rows = element.querySelectorAll<HTMLElement>('.quota-row');
      return {
        height: Math.round(element.getBoundingClientRect().height),
        quotaBottom: Math.round(rows[rows.length - 1].getBoundingClientRect().bottom)
      };
    })
  );
  expect(new Set(geometry.map(({ height }) => height)).size).toBe(1);
  expect(new Set(geometry.map(({ quotaBottom }) => quotaBottom)).size).toBe(1);
});

test('compares provider quota reset windows on an interactive homepage timeline', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/connectors', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/overview**', async (route) => {
    const specifications = [
      {
        id: 'codex',
        displayName: 'Codex',
        domainId: 'subscription',
        buckets: [
          ['codex:primary', '5 hour', 20, 300, '2026-08-29T15:00:00.000Z'],
          ['codex:secondary', 'Week', 40, 10_080, '2026-09-01T00:00:00.000Z'],
          ['spark:secondary', 'GPT-5.3-Codex-Spark · Week', 70, 10_080, '2026-09-02T00:00:00.000Z']
        ]
      },
      {
        id: 'claude-code',
        displayName: 'Claude Code',
        domainId: 'subscription',
        buckets: [
          ['five-hour', '5 hour', 10, 300, '2026-08-29T14:00:00.000Z'],
          ['week-all', 'Week · All models', 35, 10_080, '2026-09-01T00:00:00.000Z'],
          ['week-fable', 'Week · Fable only', 80, 10_080, '2026-09-01T00:00:00.000Z']
        ]
      },
      {
        id: 'opencode-go',
        displayName: 'OpenCode Go',
        domainId: 'go-subscription',
        buckets: [
          ['rolling', '5 hour', 5, 300, '2026-08-29T13:00:00.000Z'],
          ['weekly', 'Week', 50, 10_080, '2026-09-01T00:00:00.000Z'],
          ['monthly', 'Month', 60, 43_200, '2026-09-20T00:00:00.000Z']
        ]
      },
      {
        id: 'grok',
        displayName: 'Grok',
        domainId: 'grok-build-subscription',
        buckets: [['grok-build:weekly', 'Weekly limit', 65, 10_080, '2026-09-01T00:00:00.000Z']]
      }
    ] as const;
    const providers = specifications.map((specification) => {
      const quotaBuckets = specification.buckets.map(
        ([id, label, usedPercent, windowDurationMinutes, resetsAt]) => ({
          id,
          billingDomainId: specification.domainId,
          label,
          usedPercent,
          windowDurationMinutes,
          resetsAt,
          authority: 'official-account'
        })
      );
      const domain = {
        id: specification.domainId,
        displayName: specification.domainId,
        freshness: { status: 'fresh', lastSuccessAt: '2026-08-29T12:00:00.000Z' },
        health: { status: 'healthy', errorCode: null, message: null, recovery: null },
        coverage: {
          quota: 'complete',
          tokens: 'unavailable',
          actualCost: 'unavailable',
          history: 'unavailable'
        },
        quotaBuckets,
        tokenTotals: { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        tokenAuthority: null,
        costs: [],
        balances: [],
        invoices: [],
        forecasts: [],
        forecastCoverage: 'insufficient'
      };
      return {
        id: specification.id,
        displayName: specification.displayName,
        summaryBillingDomainId: specification.domainId,
        freshness: domain.freshness,
        health: domain.health,
        coverage: domain.coverage,
        quotaBuckets,
        tokenTotals: domain.tokenTotals,
        tokenAuthority: null,
        billingDomains: specification.id === 'opencode-go' ? [domain] : [],
        forecasts: [],
        forecastCoverage: 'insufficient'
      };
    });
    const pathname = new URL(route.request().url()).pathname;
    const providerPrefix = '/api/overview/providers/';
    if (pathname === '/api/overview/providers') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: '2026-08-29T12:00:00.000Z',
          providers: providers.map(({ id, displayName }) => ({ id, displayName }))
        })
      });
      return;
    }
    if (pathname.startsWith(providerPrefix)) {
      const providerId = decodeURIComponent(pathname.slice(providerPrefix.length));
      const provider = providers.find((candidate) => candidate.id === providerId);
      await route.fulfill({
        status: provider ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(provider ?? {})
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ generatedAt: '2026-08-29T12:00:00.000Z', providers })
    });
  });

  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(freshLaunch.stdout.trim());
  const timeline = page.getByTestId('quota-timeline');
  await expect(timeline).toBeVisible();
  expect(
    await timeline.evaluate((element) => {
      const providers = element.parentElement?.querySelector('.providers');
      return Boolean(
        providers && providers.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    })
  ).toBe(true);
  await expect(timeline).toHaveAttribute('data-chart-engine', 'echarts');
  await expect(
    page.locator('.provider-card').filter({ hasText: 'Codex' }).getByText('Week', { exact: true })
  ).toBeVisible();
  await expect(
    page.locator('.provider-card').filter({ hasText: 'Claude Code' }).getByText('Week · All models')
  ).toBeVisible();
  await expect(
    page.locator('.provider-card').filter({ hasText: 'Grok' }).getByText('Weekly limit')
  ).toBeVisible();
  await expect(timeline).toHaveAttribute('data-lane-count', '4');
  await expect(timeline.getByRole('heading', { name: 'Quota timeline' })).toBeVisible();
  await expect(timeline.getByRole('button', { name: 'Weekly' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(timeline.locator('canvas')).toBeVisible();
  await expect
    .poll(async () => await quotaTimelineLaneBandCount(timeline.locator('canvas')))
    .toBe(4);
  await expect(timeline.locator('.quota-timeline-data')).toContainText('Grok');

  const originalRange = await timeline.locator('.quota-timeline-range').textContent();
  await timeline.getByRole('button', { name: 'Previous period' }).click();
  await expect(timeline.locator('.quota-timeline-range')).not.toHaveText(originalRange ?? '');
  await timeline.getByRole('button', { name: 'Today' }).click();
  await expect(timeline.locator('.quota-timeline-range')).toHaveText(originalRange ?? '');

  await timeline.getByRole('button', { name: '5 hour' }).click();
  await expect(timeline).toHaveAttribute('data-lane-count', '3');
  await expect
    .poll(async () => await quotaTimelineLaneBandCount(timeline.locator('canvas')))
    .toBe(3);
  await expect(timeline.getByRole('button', { name: '5 hour' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(timeline.locator('.quota-timeline-data')).not.toContainText('Grok');
});

async function fulfillOverview(
  route: Route,
  overview: { generatedAt?: string; providers: Array<Record<string, unknown>> }
): Promise<void> {
  const generatedAt = overview.generatedAt ?? '2026-08-28T02:00:00.000Z';
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === '/api/overview/providers') {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt,
        providers: overview.providers.map((provider) => ({
          id: provider.id,
          displayName: provider.displayName
        }))
      })
    });
    return;
  }
  const providerPrefix = '/api/overview/providers/';
  if (pathname.startsWith(providerPrefix)) {
    const providerId = decodeURIComponent(pathname.slice(providerPrefix.length));
    const provider = overview.providers.find((candidate) => candidate.id === providerId);
    await route.fulfill({
      status: provider ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(provider ?? {})
    });
    return;
  }
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ generatedAt, ...overview })
  });
}

async function workbenchPanelBoxes(
  page: Page
): Promise<Record<string, { x: number; y: number; width: number; height: number }>> {
  return await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Expected a rendered ${selector}`);
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    return {
      headline: box('[data-testid="usage-headline"]'),
      totals: box('[data-testid="usage-totals"]'),
      providerShare: box('[data-testid="usage-analysis-grid"] .usage-summary'),
      trend: box('[data-testid="usage-trend-chart"]'),
      breakdown: box('[data-testid="usage-breakdown"] .ranking-heading')
    };
  });
}

async function quotaTimelineLaneBandCount(canvas: Locator): Promise<number> {
  return await canvas.evaluate((element) => {
    const chartCanvas = element as HTMLCanvasElement;
    const context = chartCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Expected a readable quota timeline canvas');
    const { width, height } = chartCanvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    const plotLeft = Math.floor(width * 0.2);
    const painted = Math.floor((width - plotLeft) * 0.3);
    const laneBandMinimumHeight = 8;
    let bands = 0;
    let bandHeight = 0;
    for (let y = 0; y < height; y += 1) {
      let filled = 0;
      for (let x = plotLeft; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] > 20) filled += 1;
      }
      // Lane bars span most of the plot; split lines are one row tall.
      if (filled > painted) bandHeight += 1;
      else {
        if (bandHeight >= laneBandMinimumHeight) bands += 1;
        bandHeight = 0;
      }
    }
    return bandHeight >= laneBandMinimumHeight ? bands + 1 : bands;
  });
}

async function modelDetailCompositionLayout(canvas: Locator): Promise<{
  width: number;
  height: number;
  pieBottom: number;
  legendTop: number | null;
  gap: number | null;
}> {
  return await canvas.evaluate((element) => {
    const chartCanvas = element as HTMLCanvasElement;
    const context = chartCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Expected a readable model-detail canvas');
    const { width, height } = chartCanvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    const compositionColors = new Set([
      '111,143,247',
      '225,154,108',
      '155,124,244',
      '82,197,164',
      '224,184,79'
    ]);
    const rowCounts = Array.from({ length: height }, () => 0);
    const compositionRight = Math.floor(width * 0.45);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < compositionRight; x += 1) {
        const offset = (y * width + x) * 4;
        if (
          compositionColors.has(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`)
        ) {
          rowCounts[y] += 1;
        }
      }
    }
    const bands: Array<{ top: number; bottom: number }> = [];
    for (let row = 0; row < rowCounts.length; row += 1) {
      if (rowCounts[row] === 0) continue;
      const previous = bands.at(-1);
      if (previous && previous.bottom === row - 1) previous.bottom = row;
      else bands.push({ top: row, bottom: row });
    }
    const groups: Array<{ top: number; bottom: number }> = [];
    for (const band of bands) {
      const previous = groups.at(-1);
      if (previous && band.top - previous.bottom <= 4) previous.bottom = band.bottom;
      else groups.push({ ...band });
    }
    const pieGroup = groups.toSorted(
      (left, right) => right.bottom - right.top - (left.bottom - left.top)
    )[0];
    if (!pieGroup) throw new Error('Expected rendered Token composition sectors');
    const pieBottom = pieGroup.bottom;
    const legendTop = groups.find((group) => group.top > pieBottom)?.top ?? -1;
    return {
      width,
      height,
      pieBottom,
      legendTop: legendTop === -1 ? null : legendTop,
      gap: legendTop === -1 ? null : legendTop - pieBottom - 1
    };
  });
}

async function runPackagedCli(arguments_: string[]): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, ['dist/cli.js', ...arguments_], {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: '1', AGENT_USAGE_DEMO: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
