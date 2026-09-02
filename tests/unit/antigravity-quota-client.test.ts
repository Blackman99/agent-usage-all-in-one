import { describe, expect, it } from 'vitest';
import {
  AntigravityQuotaClient,
  mapQuotaGroups
} from '../../src/server/antigravity-quota-client.js';

describe('AntigravityQuotaClient', () => {
  it('maps official Gemini and 3P quota groups to normalized QuotaBuckets', () => {
    const rawGroups = [
      {
        displayName: 'Gemini Models',
        description: 'Models within this group: Gemini Flash, Gemini Pro',
        buckets: [
          {
            bucketId: 'gemini-weekly',
            displayName: 'Weekly Limit Remaining',
            window: 'weekly',
            remainingFraction: 0.8298,
            resetTime: '2026-09-09T04:01:34Z'
          },
          {
            bucketId: 'gemini-5h',
            displayName: 'Five Hour Limit Remaining',
            window: '5h',
            remainingFraction: 0.2636,
            resetTime: '2026-09-02T14:56:41Z'
          }
        ]
      },
      {
        displayName: 'Claude and GPT models',
        description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
        buckets: [
          {
            bucketId: '3p-weekly',
            displayName: 'Weekly Limit Remaining',
            window: 'weekly',
            remainingFraction: 1.0,
            resetTime: '2026-09-09T11:35:16Z'
          },
          {
            bucketId: '3p-5h',
            displayName: 'Five Hour Limit Remaining',
            window: '5h',
            remainingFraction: 1.0,
            resetTime: '2026-09-02T16:35:16Z'
          }
        ]
      }
    ];

    const buckets = mapQuotaGroups(rawGroups);

    expect(buckets).toEqual([
      {
        id: 'gemini-weekly',
        billingDomainId: 'code-assist-subscription',
        label: 'Week',
        usedPercent: 17,
        windowDurationMinutes: 10_080,
        resetsAt: '2026-09-09T04:01:34Z',
        authority: 'official-client',
        scope: 'account-wide'
      },
      {
        id: 'gemini-5h',
        billingDomainId: 'code-assist-subscription',
        label: '5 hour',
        usedPercent: 74,
        windowDurationMinutes: 300,
        resetsAt: '2026-09-02T14:56:41Z',
        authority: 'official-client',
        scope: 'account-wide'
      },
      {
        id: '3p-weekly',
        billingDomainId: 'code-assist-subscription',
        label: 'Claude / GPT · Week',
        usedPercent: 0,
        windowDurationMinutes: 10_080,
        resetsAt: '2026-09-09T11:35:16Z',
        authority: 'official-client',
        scope: 'account-wide'
      },
      {
        id: '3p-5h',
        billingDomainId: 'code-assist-subscription',
        label: 'Claude / GPT · 5 hour',
        usedPercent: 0,
        windowDurationMinutes: 300,
        resetsAt: '2026-09-02T16:35:16Z',
        authority: 'official-client',
        scope: 'account-wide'
      }
    ]);
  });

  it('queries candidate port with mock fetch function', async () => {
    const mockFetch = async () =>
      ({
        ok: true,
        json: async () => ({
          response: {
            groups: [
              {
                displayName: 'Gemini Models',
                buckets: [
                  {
                    bucketId: 'gemini-5h',
                    displayName: 'Five Hour Limit Remaining',
                    window: '5h',
                    remainingFraction: 0.5,
                    resetTime: '2026-09-02T15:00:00Z'
                  }
                ]
              }
            ]
          }
        })
      }) as unknown as Response;

    const client = new AntigravityQuotaClient({
      ports: [12345],
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const quota = await client.readQuota();
    expect(quota).toHaveLength(1);
    expect(quota?.[0]).toMatchObject({
      id: 'gemini-5h',
      label: '5 hour',
      usedPercent: 50,
      windowDurationMinutes: 300,
      resetsAt: '2026-09-02T15:00:00Z',
      authority: 'official-client'
    });
  });

  it('returns null when all candidate ports fail or are unavailable', async () => {
    const mockFetch = async () => {
      throw new Error('Connection refused');
    };

    const client = new AntigravityQuotaClient({
      ports: [99999],
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const quota = await client.readQuota();
    expect(quota).toBeNull();
  });
});
