import { describe, expect, it } from 'vitest';

import type { SecretStore } from '../../src/core/onboarding-types.js';
import {
  XaiApiConnector,
  XaiManagementApiClient
} from '../../src/connectors/xai-api/xai-api-connector.js';

describe('xAI Management API connector', () => {
  it('collects official cost, balance, spending limit, invoice, and invoice token data in one isolated domain', async () => {
    const secretStore = new MemorySecretStore('management-secret-value');
    const requests: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    const client = new XaiManagementApiClient({
      secretStore,
      clock: () => new Date('2026-08-28T02:00:00.000Z'),
      fetch: async (input, init) => {
        const url = String(input);
        requests.push({
          url,
          authorization: new Headers(init?.headers).get('authorization'),
          body: init?.body ? JSON.parse(String(init.body)) : null
        });
        return jsonResponse(responseFor(url));
      }
    });
    const snapshot = await new XaiApiConnector({
      accountClient: client,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    }).collect();

    expect(requests.map((request) => request.url)).toEqual([
      'https://management-api.x.ai/auth/management-keys/validation',
      'https://management-api.x.ai/v1/billing/teams/team-123/usage',
      'https://management-api.x.ai/v1/billing/teams/team-123/prepaid/balance',
      'https://management-api.x.ai/v1/billing/teams/team-123/postpaid/spending-limits',
      'https://management-api.x.ai/v1/billing/teams/team-123/postpaid/invoice/preview',
      'https://management-api.x.ai/v1/billing/teams/team-123/invoices?since.year=2026&since.month=7'
    ]);
    expect(
      requests.every((request) => request.authorization === 'Bearer management-secret-value')
    ).toBe(true);
    expect(requests[1].body).toMatchObject({
      analyticsRequest: {
        timeUnit: 'TIME_UNIT_DAY',
        values: [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }],
        groupBy: ['description']
      }
    });
    expect(snapshot.billingDomains).toEqual([{ id: 'xai-api', displayName: 'xAI API' }]);
    expect(snapshot.quotaBuckets).toEqual([
      expect.objectContaining({
        id: 'xai-api:monthly-spending-limit',
        billingDomainId: 'xai-api',
        label: 'Monthly invoiced spending limit',
        usedPercent: 12.5,
        limitAmount: 200,
        limitCurrency: 'USD',
        authority: 'official-account'
      })
    ]);
    expect(snapshot.usage).toEqual([
      expect.objectContaining({
        id: 'xai-invoice:invoice-1:grok-4.6',
        billingDomainId: 'xai-api',
        model: 'grok-4.6',
        inputTokens: 908,
        outputTokens: 534,
        cacheReadTokens: 300,
        reasoningTokens: 42,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        modelAttribution: 'known',
        timePrecision: 'billing-period',
        usageScope: 'account-wide',
        aggregationTemporality: 'delta',
        authority: 'official-account'
      })
    ]);
    expect(snapshot.usage[0]).not.toHaveProperty('totalTokens');
    expect(snapshot.costs).toEqual([
      expect.objectContaining({
        id: 'xai-usage:Chat grok-4.6:2026-08-27T00:00:00Z',
        sourceId: 'team-123:Chat grok-4.6:2026-08-27T00:00:00Z',
        billingDomainId: 'xai-api',
        kind: 'actual',
        amount: 2.5,
        currency: 'USD',
        authority: 'official-account'
      })
    ]);
    expect(snapshot.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'prepaid', amount: 45, currency: 'USD' }),
        expect.objectContaining({ kind: 'spending-limit', amount: 200, currency: 'USD' }),
        expect.objectContaining({ kind: 'current-invoice', amount: 25, currency: 'USD' })
      ])
    );
    expect(snapshot.invoices).toEqual([
      expect.objectContaining({
        id: 'invoice-1',
        number: 'INV-001',
        status: 'PAID',
        amount: 25,
        currency: 'USD'
      })
    ]);
    expect(snapshot.warnings).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('management-secret-value');
    expect(JSON.stringify(snapshot)).not.toContain('owner-user-private');
  });

  it('keeps successful account facts when usage is rate limited and marks history partial', async () => {
    const client = new XaiManagementApiClient({
      secretStore: new MemorySecretStore('secret'),
      clock: () => new Date('2026-08-28T02:00:00.000Z'),
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('/usage')) {
          return jsonResponse({ error: 'rate limited' }, 429, { 'retry-after': '60' });
        }
        return jsonResponse(responseFor(url));
      }
    });
    const snapshot = await new XaiApiConnector({ accountClient: client }).collect();

    expect(snapshot.costs).toEqual([]);
    expect(snapshot.balances).toEqual(
      expect.arrayContaining([expect.objectContaining({ amount: 45 })])
    );
    expect(snapshot.usage).toHaveLength(1);
    expect(snapshot.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'xai-api-rate-limited',
          recovery: expect.stringContaining('60')
        })
      ])
    );
  });

  it('returns a safe degraded domain when the management key is missing', async () => {
    const client = new XaiManagementApiClient({
      secretStore: new MemorySecretStore(null)
    });
    const snapshot = await new XaiApiConnector({ accountClient: client }).collect();

    expect(snapshot.billingDomains).toEqual([{ id: 'xai-api', displayName: 'xAI API' }]);
    expect(snapshot.usage).toEqual([]);
    expect(snapshot.costs).toEqual([]);
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'xai-management-key-missing' })
    ]);
  });
});

function responseFor(url: string): unknown {
  if (url.endsWith('/auth/management-keys/validation')) {
    return {
      apiKeyId: 'management-key-id',
      teamId: 'team-123',
      scope: 'SCOPE_TEAM',
      scopeId: 'team-123',
      ownerUserId: 'owner-user-private'
    };
  }
  if (url.endsWith('/usage')) {
    return {
      timeSeries: [
        {
          group: ['Chat grok-4.6'],
          groupLabels: ['Chat grok-4.6'],
          dataPoints: [{ timestamp: '2026-08-27T00:00:00Z', values: [2.5] }]
        }
      ],
      limitReached: false
    };
  }
  if (url.endsWith('/prepaid/balance')) return { changes: [], total: { val: '-4500' } };
  if (url.endsWith('/postpaid/spending-limits')) {
    return { spendingLimits: { effectiveSl: { val: '20000' } } };
  }
  if (url.endsWith('/postpaid/invoice/preview')) {
    return {
      coreInvoice: { amountBeforeVat: '2500' },
      effectiveSpendingLimit: '20000',
      defaultCredits: '0',
      billingCycle: { year: 2026, month: 8 }
    };
  }
  if (url.includes('/invoices')) {
    return {
      invoices: [
        {
          teamId: 'team-123',
          invoiceId: 'invoice-1',
          invoiceNumber: 'INV-001',
          createTime: '2026-08-01T00:00:00Z',
          invoiceStatus: 'PAID',
          subtotal: '2500',
          tax: '0',
          total: '2500',
          lines: [
            {
              description: 'Chat grok-4.6',
              unitType: 'Prompt text tokens',
              numUnits: '908'
            },
            {
              description: 'Chat grok-4.6',
              unitType: 'Completion text tokens',
              numUnits: '534'
            },
            {
              description: 'Chat grok-4.6',
              unitType: 'Cached prompt text tokens',
              numUnits: '300'
            },
            {
              description: 'Chat grok-4.6',
              unitType: 'Reasoning tokens',
              numUnits: '42'
            }
          ]
        }
      ]
    };
  }
  throw new Error(`Unhandled fixture URL: ${url}`);
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

class MemorySecretStore implements SecretStore {
  constructor(private readonly value: string | null) {}

  async set(): Promise<void> {}

  async has(): Promise<boolean> {
    return this.value !== null;
  }

  async get(): Promise<string | null> {
    return this.value;
  }

  async delete(): Promise<void> {}
}
