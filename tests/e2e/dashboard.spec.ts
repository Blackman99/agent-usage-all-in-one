import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Locator } from '@playwright/test';

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
  expect(refreshRequests).toBe(1);

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
  await expect(page.locator('.product-banner-art')).toHaveAttribute(
    'src',
    '/brand/agent-usage-banner.svg'
  );

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
  await expect(xaiApi.getByText('Connected')).toBeVisible();
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
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
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
      })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'Codex' });
  await expect(provider.getByRole('heading', { name: 'Codex', exact: true })).toBeVisible();
  await expect.poll(() => refreshRequests).toBe(2);
  await expect.poll(() => refreshResponses).toBe(2);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(refreshRequests).toBe(2);
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
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
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
      })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'OpenCode Go' });
  await expectQuotaShowsOnlyReset(provider, 1);
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
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
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
      })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'Claude Code' });
  await expect.poll(() => refreshRequests).toBe(2);
  await expect.poll(() => refreshResponses).toBe(2);
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
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
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
      })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'Grok' });
  await expect.poll(() => refreshRequests).toBe(2);
  await expect.poll(() => refreshResponses).toBe(2);
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(refreshRequests).toBe(2);
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

test('switches 24-hour, 7-day, and 30-day token and cost history without mixing cost kinds', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  const requestedWindows: string[] = [];
  const requestedCurrencies: string[] = [];
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
  await expect(workbench.getByTestId('usage-headline')).toContainText('CN¥9.00');
  await expect(workbench.getByTestId('usage-headline')).toContainText('API retail equivalent');
  await expect(workbench.getByTestId('usage-trend-chart')).toBeVisible();
  await expect(workbench.getByTestId('usage-provider-summary')).toContainText('History Agent');
  const unknownProvider = workbench
    .getByTestId('usage-provider-summary')
    .locator('li')
    .filter({ hasText: 'Unknown Agent' });
  await expect(unknownProvider).toContainText('Unavailable');
  await expect(unknownProvider).not.toContainText('$0.00');
  await workbench.getByRole('button', { name: 'Tokens', exact: true }).click();
  await expect(workbench.getByTestId('usage-headline')).toContainText('700');
  await expect(workbench.getByTestId('trend-mode')).toHaveText('Recorded tokens');
  await expect(unknownProvider).toContainText('Unavailable');
  await expect(unknownProvider).not.toContainText('0 Tokens');
  await workbench.getByRole('button', { name: '24h' }).click();
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
  await expect(workbench.getByTestId('trend-mode')).toHaveText('API retail equivalent');
  const trendTable = workbench.getByRole('table', { name: 'Trend data' });
  await expect(trendTable).toContainText('Gap');
  await expect(trendTable).toContainText('Billing period');
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
  await expect(page.getByText('No providers have reported usage yet.')).toBeVisible();
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
  await expect(ranking.getByRole('button', { name: 'Model', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const rows = ranking.getByTestId('model-ranking-row');
  await expect(rows).toHaveCount(5);
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
  await expect(ranking.getByText('Unclassified usage')).toBeVisible();
  await expect(ranking.getByText('1,000 Tokens')).toBeVisible();

  await page
    .getByTestId('token-money-workbench')
    .getByRole('button', {
      name: 'Cost',
      exact: true
    })
    .click();
  await expect(rows.first()).toContainText('fable-model');
  const grokRow = rows.filter({ hasText: 'Grok · xAI API' });
  await expect(grokRow.locator('img')).toHaveCount(0);
  await expect(grokRow).toContainText('Separate domain · not included in headline');
  await expect(grokRow).toContainText('Provider-reported estimate');
  await expect(grokRow).toContainText('$3.00');
  await expect(rows.filter({ hasText: 'shared-model' })).toHaveCount(2);

  await ranking.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(ranking.getByTestId('day-breakdown-row')).toHaveCount(2);
  await expect(ranking).toContainText('Bucket 1');
  const costOnlyDay = ranking.getByTestId('day-breakdown-row').filter({ hasText: 'Cost only' });
  await expect(costOnlyDay).toContainText('Unavailable');
  await page
    .getByTestId('token-money-workbench')
    .getByRole('button', { name: 'Tokens', exact: true })
    .click();
  await expect(ranking.getByTestId('day-breakdown-row')).toHaveCount(1);
  await ranking.getByRole('button', { name: 'Model', exact: true }).click();

  const fableRow = rows.filter({ hasText: 'fable-model' });
  await fableRow.focus();
  await fableRow.press('Enter');
  const detail = page.getByRole('dialog', { name: 'Model detail: fable-model' });
  await expect(detail).toBeVisible();
  await expect(detail).toBeFocused();
  await expect(page.locator('.shell')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(detail.getByRole('button', { name: 'Close model detail' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(detail.getByRole('button', { name: 'Close model detail' })).toBeFocused();
  await expect(detail).toContainText('Claude Code · Subscription');
  await expect(detail).toContainText('Recorded total 400');
  await expect(detail).toContainText('Recorded total 450');
  await expect(detail).toContainText('Classified 400');
  await expect(detail).toContainText('Unclassified 50');
  await expect(detail.locator('.model-detail-summary')).toContainText(
    'Source-reported total Unavailable'
  );
  await expect(detail.locator('.model-observations article')).toContainText(
    'Source-reported total 450'
  );
  await expect(detail).toContainText('Scope This Mac only');
  await expect(detail).toContainText('Aggregation Delta');
  await expect(detail).toContainText('Input · 320 · $3.20');
  await expect(detail).toContainText('2026-08-01 · Official fixture pricing');
  await expect(detail).toContainText('Local observation · Event');
  await expect(detail.getByRole('table', { name: 'Model trend' })).toContainText('Gap');
  await expect(detail.getByRole('table', { name: 'Model trend' })).toContainText(
    'Local observation'
  );
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(fableRow).toBeFocused();
});

test('follows system theme and keeps the usage dashboard responsive with local official artwork', async ({
  page
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol !== 'data:') {
      externalRequests.push(request.url());
    }
  });
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/overview**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(historyOverviewFixture('7d', 12_400, 'CNY'))
    });
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
  for (const providerId of ['codex', 'claude-code', 'opencode-go']) {
    const logo = page.locator(`picture[data-provider-logo="${providerId}"]`).first();
    await expect(logo).toBeVisible();
    await expect(logo.locator('img')).toHaveAttribute('src', /^\/brands\//);
  }
  await expect(
    page.locator('picture[data-provider-logo="opencode-go"] source').first()
  ).toHaveAttribute('srcset', '/brands/opencode-light.svg');
  await expect(page.locator('picture[data-provider-logo="grok"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Grok', exact: true })).toHaveAttribute(
    'data-provider-logo',
    'grok'
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
  expect(
    await page
      .locator('picture[data-provider-logo="opencode-go"] img')
      .first()
      .evaluate((image) => new URL((image as HTMLImageElement).currentSrc).pathname)
  ).toBe('/brands/opencode-light.svg');
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
        .locator('picture[data-provider-logo="opencode-go"] img')
        .first()
        .evaluate((image) => {
          const source = (image as HTMLImageElement).currentSrc;
          return source ? new URL(source).pathname : '';
        })
    )
    .toBe('/brands/opencode-dark.svg');
  expect(externalRequests).toEqual([]);
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
    modelRanking: modelRankingFixture(currency, bucketCount)
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
            pricingCoverage: index === 0 && amount !== null ? 1 : null
          }
        }))
      };
    }
  );
  return {
    byTokens: entries.slice(0, 5).map((entry) => entry.id),
    byCost: [entries[1], entries[3], entries[2], entries[0], entries[4]].map((entry) => entry.id),
    byRetailEquivalent: [entries[1], entries[3], entries[2], entries[0], entries[4]].map(
      (entry) => entry.id
    ),
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
