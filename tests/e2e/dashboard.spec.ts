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

test('shows independent connector onboarding and persists a skip decision', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.goto(freshLaunch.stdout.trim());

  await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();
  await expect(page.getByTestId('diagnostic-codex')).toBeVisible();
  for (const name of ['Codex', 'Claude Code', 'OpenCode Go', 'Grok', 'xAI API (Grok)']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByTestId('connector-claude-code').getByText('Experimental')).toBeVisible();
  await expect(page.getByTestId('connector-codex').getByText('Official client')).toBeVisible();
  const notificationSetting = page.getByRole('checkbox', { name: 'Local notifications' });
  await expect(notificationSetting).not.toBeChecked();
  await notificationSetting.check();
  await expect(notificationSetting).toBeChecked();
  const xaiApi = page.getByTestId('connector-xai-api');
  await expect(xaiApi.getByText('Agent Usage Keychain')).toBeVisible();
  await expect(xaiApi.getByRole('button', { name: 'Connect' })).toBeDisabled();
  let xaiActionBody: unknown = null;
  await page.route('**/api/connectors/xai-api/action', async (route) => {
    xaiActionBody = route.request().postDataJSON();
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
        secretConfigured: true
      })
    });
  });
  await xaiApi.getByRole('textbox', { name: /Management API key/ }).fill('browser-fake-key');
  await xaiApi.getByRole('button', { name: 'Connect' }).click();
  expect(xaiActionBody).toEqual({ action: 'connect', secret: 'browser-fake-key' });
  await expect(xaiApi.getByText('Connected')).toBeVisible();
  await expect(xaiApi).not.toContainText('browser-fake-key');

  const openCode = page.getByTestId('connector-opencode-go');
  await openCode.getByRole('button', { name: 'Skip' }).click();
  await expect(openCode.getByText('Skipped')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('connector-opencode-go').getByText('Skipped')).toBeVisible();
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
            tokenTotals: { total: 1250, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
          }
        ]
      })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'Codex' });
  await expect(provider.getByRole('heading', { name: 'Codex', exact: true })).toBeVisible();
  await expect(provider.getByText('5 hour', { exact: true })).toBeVisible();
  await expect(provider.getByText('Week', { exact: true })).toBeVisible();
  await expect(provider.getByText('1,250')).toBeVisible();
  await expect(provider.getByText('Codex account usage is unavailable.')).toBeVisible();
  await expect(provider.getByText('Run codex login, then refresh Agent Usage.')).toBeVisible();
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
              output: 300,
              cacheRead: 200,
              cacheWrite: 0
            },
            tokenAuthority: 'local-observation'
          }
        ]
      })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'OpenCode Go' });
  await expect(provider.getByText('Scope: Account-wide')).toBeVisible();
  await expect(provider.getByText('Limit: $12 USD')).toBeVisible();
  await expect(provider.getByText('Use balance: Unknown')).toBeVisible();
  await expect(provider.getByText('Source: Local Observation · This Mac only')).toBeVisible();
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
              tokens: 'complete',
              actualCost: 'unavailable',
              history: 'complete'
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
            tokenAuthority: 'local-observation'
          }
        ]
      })
    });
  });

  await page.goto(freshLaunch.stdout.trim());
  const provider = page.locator('.provider-card').filter({ hasText: 'Claude Code' });
  await expect(provider.getByText('Week · All models')).toBeVisible();
  await expect(provider.getByText('Week · Fable only')).toBeVisible();
  await expect(provider.getByText('Source: Official Client')).toHaveCount(3);
  await expect(provider.getByText('Source: Local Observation · This Mac only')).toBeVisible();
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
              tokens: 'complete',
              actualCost: 'unavailable',
              history: 'complete'
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
  await expect(provider.getByText('Source: Local Observation · This Mac only')).toBeVisible();
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
  await expect(page.getByText('Most constrained')).toBeVisible();
  await expect(page.getByText('Recommended agent')).toBeVisible();
  await expect(page.getByText('Advice only · never switches agents')).toBeVisible();
});

test('downloads a redacted export and clears only the selected local scope', async ({ page }) => {
  const freshLaunch = await runPackagedCli(['--home', home, '--no-open']);
  await page.goto(freshLaunch.stdout.trim());

  const privacy = page.getByRole('region', { name: 'Privacy & data' });
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
  await expect(page.getByRole('heading', { name: '连接' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '隐私与数据' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claude Code' })).toBeVisible();
  const demoCard = page.locator('.provider-card').filter({ hasText: 'Demo Agent' });
  await expect(demoCard).toContainText('完整');
  await expect(demoCard).toContainText('官方账户');
  await expect(demoCard).not.toContainText('Official Account');
  await page.getByRole('button', { name: 'EN' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

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
              exchangeRates: []
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
    tokenAuthority: 'local-observation',
    costs: [],
    balances: [],
    invoices: []
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
    invoices: []
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
