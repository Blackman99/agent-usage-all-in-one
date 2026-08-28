import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

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
  await page.route('**/api/refresh', async (route) => {
    refreshRequests += 1;
    await route.continue();
  });
  await page.goto(launchUrl);

  await expect(page).toHaveTitle('Agent Usage');
  await expect(page.getByRole('heading', { name: 'Agent Usage' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Demo Agent' })).toBeVisible();
  await expect(page.getByText('42% used')).toBeVisible();
  await expect(page.getByText('12,400')).toBeVisible();
  await expect(page.locator('.quota-meta')).toContainText(/in 3 hours/);
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

  const openCode = page.getByTestId('connector-opencode-go');
  await openCode.getByRole('button', { name: 'Skip' }).click();
  await expect(openCode.getByText('Skipped')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('connector-opencode-go').getByText('Skipped')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Local notifications' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Local notifications' }).uncheck();
});

test('renders Codex quota, total tokens, and the same actionable degraded state', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
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
  await expect(provider.getByText('5 hour', { exact: true })).toBeVisible();
  await expect(provider.getByText('Week', { exact: true })).toBeVisible();
  await expect(provider.getByText('1,250', { exact: true })).toBeVisible();
  await expect(provider).toContainText(/Scope:\s*Account-wide/);
  await expect(provider).toContainText(/Precision:\s*Day/);
  await expect(provider).toContainText(/Unclassified:\s*1,250/);
  await expect(provider.getByText('Codex account usage is unavailable.')).toBeVisible();
  await expect(provider.getByText('Run codex login, then refresh Agent Usage.')).toBeVisible();
  await provider.getByRole('button', { name: 'Review in settings' }).click();
  const diagnostic = page.getByTestId('settings-diagnostic-codex');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(diagnostic).toBeFocused();
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

test('labels OpenCode Go account quota separately from this-Mac token history', async ({
  page
}) => {
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
  await expect(provider.getByText('Scope: Account-wide')).toBeVisible();
  await expect(provider.getByText('Limit: $12 USD')).toBeVisible();
  await expect(provider.getByText('Use balance: Unknown')).toBeVisible();
  await expect(provider).toContainText('Source: Local observation');
  await expect(provider).toContainText(/Scope:\s*This Mac only/);
  await expect(provider).toContainText(/Precision:\s*Day/);
  await expect(provider.getByText('1,200')).toBeVisible();
});

test('keeps Claude All models and Fable-only quota separate from local OTLP tokens', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
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
  await expect(provider.getByText('Week · All models')).toBeVisible();
  await expect(provider.getByText('Week · Fable only')).toBeVisible();
  await expect(provider.getByText('Source: Official Client')).toHaveCount(3);
  await expect(provider).toContainText('Source: Local observation');
  await expect(provider).toContainText(/Scope:\s*This Mac only/);
  await expect(provider).toContainText(/Precision:\s*Event/);
  await expect(provider).toContainText(/Aggregation:\s*Delta/);
  await expect(provider.getByText('575')).toBeVisible();
});

test('renders Grok shared weekly quota and alpha telemetry without inventing a five-hour bucket', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/overview**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-08-28T02:00:00.000Z',
        providers: [
          {
            id: 'grok',
            displayName: 'Grok',
            freshness: { status: 'fresh', lastSuccessAt: '2026-08-28T02:00:00.000Z' },
            health: {
              status: 'degraded',
              errorCode: 'grok-billing-capability-unsupported',
              message: 'Live Grok billing is temporarily unavailable.',
              recovery: 'Open Grok Build and run /usage, then retry refresh.'
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
            billingDomains: grokBillingDomains
          }
        ]
      })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'Grok' });
  await expect(provider.getByText('Weekly limit')).toBeVisible();
  await expect(provider.getByText('Plan: SuperGrok Heavy')).toBeVisible();
  await expect(provider.getByText('5 hour', { exact: true })).toHaveCount(0);
  await expect(provider).toContainText('Source: Local observation');
  await expect(provider).toContainText(/Scope:\s*This Mac only/);
  await expect(provider).toContainText(/Precision:\s*Event/);
  await expect(provider).toContainText(/Aggregation:\s*Delta/);
  await expect(provider.getByText('Reasoning').locator('..').getByText('12')).toBeVisible();
  await expect(
    provider.getByText('Open Grok Build and run /usage, then retry refresh.')
  ).toBeVisible();
  await provider.getByRole('tab', { name: 'xAI API' }).click();
  await expect(provider.getByText('1,742')).toBeVisible();
  await expect(provider.getByText('$2.50')).toBeVisible();
  await expect(provider.getByText('$45.00')).toBeVisible();
  await expect(provider.getByText('Weekly limit')).toHaveCount(0);
  await provider.getByRole('tab', { name: 'Build / SuperGrok' }).click();
  await expect(provider.getByText('525')).toBeVisible();
  await expect(provider.getByText('$2.50')).toHaveCount(0);
});

test('explains how to enable Claude and Grok token collection instead of showing false zeroes', async ({
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
    await expect(provider.getByText('No token observations in this time window.')).toBeVisible();
    await expect(provider.locator('.tokens')).toHaveCount(0);
  }
  await expect(
    claude.getByText('eval "$(agent-usage telemetry-env --provider claude-code)"')
  ).toBeVisible();
  await expect(grok.getByText('eval "$(agent-usage telemetry-env --provider grok)"')).toBeVisible();

  await grok.getByRole('tab', { name: 'xAI API' }).click();
  await expect(grok.getByText('agent-usage telemetry-env --provider grok')).toHaveCount(0);
  await expect(grok.getByText('No token observations in this time window.')).toBeVisible();

  await page.getByRole('button', { name: '中文' }).click();
  await expect(claude.getByText('当前时间范围内没有 Token 观测数据。')).toBeVisible();
  await expect(grok.getByText('当前时间范围内没有 Token 观测数据。')).toBeVisible();
});

test('switches 24-hour, 7-day, and 30-day token and cost history without mixing cost kinds', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.route('**/api/overview**', async (route) => {
    const window = new URL(route.request().url()).searchParams.get('window') ?? '24h';
    const total = window === '24h' ? 100 : window === '7d' ? 700 : 3000;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(historyOverviewFixture(window, total))
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'History Agent' });
  await expect(
    provider.getByText('Total').locator('..').getByText('100', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: '7d' }).click();
  await expect(
    provider.getByText('Total').locator('..').getByText('700', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: '30d' }).click();
  await expect(
    provider.getByText('Total').locator('..').getByText('3,000', { exact: true })
  ).toBeVisible();
  await expect(provider.getByText('actual · Native')).toBeVisible();
  await expect(provider.getByText('estimate · Native')).toBeVisible();
  await expect(
    provider.getByText('Price version: 2026-08-01 · Official retail pricing')
  ).toBeVisible();
  await expect(provider.getByText('top-model')).toBeVisible();
  await expect(provider.getByText('2026-08-28')).toBeVisible();
  await expect(page.getByText('Most constrained')).toHaveCount(0);
  await expect(page.getByText('Recommended agent')).toHaveCount(0);
  await expect(page.getByText('Advice only · never switches agents')).toHaveCount(0);
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
  expect(download.suggestedFilename()).toBe('agent-usage-24h.json');
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const body = await readFile(downloadPath!, 'utf8');
  expect(JSON.parse(body)).toMatchObject({
    privacy: { accountIdentifiersIncluded: false, secretsIncluded: false }
  });
  expect(body).not.toContain('connector:');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear local usage' }).click();
  await expect(page.getByText('No providers have reported usage yet.')).toBeVisible();
  await expect(privacy).toContainText('0 raw observations');
});

test('switches the complete catalog to Simplified Chinese without translating provider labels', async ({
  page
}) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.goto(freshLaunch.stdout.trim());

  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
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
  await page.getByRole('button', { name: 'EN' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

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

function historyOverviewFixture(window: string, total: number): unknown {
  const tokenTotals = {
    total,
    input: total,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0
  };
  return {
    generatedAt: '2026-08-28T02:00:00.000Z',
    riskSummary: {
      mostConstrained: {
        providerId: 'history-agent',
        displayName: 'History Agent',
        billingDomainId: 'api',
        bucketId: 'daily',
        label: 'Daily limit',
        remainingPercent: 40,
        resetsAt: '2026-08-28T06:00:00.000Z',
        forecast: null
      },
      recommendation: {
        providerId: 'history-agent',
        displayName: 'History Agent',
        billingDomainId: 'api',
        score: 40,
        readOnly: true,
        reasonKeys: ['highest-safe-capacity'],
        evidence: {
          remainingPercent: 40,
          freshness: 'fresh',
          forecastCoverage: 'insufficient'
        }
      }
    },
    providers: [
      {
        id: 'history-agent',
        displayName: 'History Agent',
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
        tokenAuthority: 'official-account',
        billingDomains: [
          {
            id: 'api',
            displayName: 'API',
            quotaBuckets: [],
            tokenTotals,
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
              models: [{ model: 'top-model', tokenTotals }],
              days: [{ day: '2026-08-28', tokenTotals, costs: [] }],
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
                  kind: 'estimate',
                  currency: 'USD',
                  amount: 1.25,
                  convertedAmount: 9,
                  comparisonCurrency: 'CNY',
                  conversionUnavailableReason: null,
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

const grokBillingDomains = [
  {
    id: 'grok-build-subscription',
    displayName: 'Build / SuperGrok',
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
    quotaBuckets: [],
    tokenTotals: {
      total: 1742,
      input: 908,
      output: 534,
      reasoning: 42,
      cacheRead: 300,
      cacheWrite: 0
    },
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
      '2026-08-28T00:00:00.000Z',
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
      ]
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
