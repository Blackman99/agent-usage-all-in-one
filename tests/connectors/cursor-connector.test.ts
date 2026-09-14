import { describe, expect, it } from 'vitest';

import { CursorConnector } from '../../src/connectors/cursor/cursor-connector.js';
import type { ParsedCursorUsage } from '../../src/connectors/cursor/cursor-usage-screen-client.js';
import { CursorAboutAccountClient } from '../../src/connectors/cursor/cursor-about-client.js';

describe('Cursor connector', () => {
  it('maps Included and On-Demand onto cursor-subscription and marks the snapshot complete', async () => {
    const connector = new CursorConnector({
      quotaClient: {
        readUsage: async (): Promise<ParsedCursorUsage> => ({
          kind: 'meters',
          included: { usedPercent: 47 },
          onDemand: {
            kind: 'fixed',
            usedAmount: 12.4,
            limitAmount: 20,
            currency: 'USD',
            usedPercent: 62
          },
          resetLabel: 'Resets Sep 15'
        })
      },
      accountClient: { readAccountIdentifier: async () => 'dev@example.com' },
      clock: () => new Date('2026-09-13T12:00:00.000Z')
    });

    await expect(connector.collect()).resolves.toMatchObject({
      provider: {
        id: 'cursor',
        displayName: 'Cursor',
        accountIdentifier: 'dev@example.com'
      },
      billingDomains: [{ id: 'cursor-subscription', displayName: 'Cursor subscription' }],
      completeQuotaBillingDomainIds: ['cursor-subscription'],
      quotaBuckets: [
        {
          id: 'included',
          label: 'Included',
          usedPercent: 47,
          resetLabel: 'Resets Sep 15',
          scope: 'account-wide',
          authority: 'official-client'
        },
        {
          id: 'on-demand',
          label: 'On-Demand',
          usedPercent: 62,
          usedAmount: 12.4,
          limitAmount: 20,
          limitCurrency: 'USD',
          fallbackStatus: 'enabled'
        }
      ],
      usage: [],
      costs: []
    });
  });

  it('emits a complete zero-window snapshot for an unmetered plan', async () => {
    const connector = new CursorConnector({
      quotaClient: { readUsage: async () => ({ kind: 'unmetered' }) }
    });
    await expect(connector.collect()).resolves.toMatchObject({
      completeQuotaBillingDomainIds: ['cursor-subscription'],
      quotaBuckets: [],
      warnings: []
    });
  });

  it('omits completeness and keeps a warning when /usage cannot be read', async () => {
    const connector = new CursorConnector({
      quotaClient: {
        async readUsage() {
          throw Object.assign(new Error('Cursor Agent CLI is not signed in.'), {
            code: 'cursor-not-logged-in',
            recovery: 'Run agent login, then retry.'
          });
        }
      }
    });
    const snapshot = await connector.collect();
    expect(snapshot.completeQuotaBillingDomainIds).toBeUndefined();
    expect(snapshot.quotaBuckets).toEqual([]);
    expect(snapshot.warnings).toEqual([expect.objectContaining({ code: 'cursor-not-logged-in' })]);
  });

  it('keeps quota when agent about cannot supply an account identifier', async () => {
    const connector = new CursorConnector({
      quotaClient: {
        readUsage: async () => ({
          kind: 'meters',
          included: { usedPercent: 10 },
          onDemand: { kind: 'disabled' },
          resetLabel: null
        })
      },
      accountClient: {
        async readAccountIdentifier() {
          throw new Error('about failed');
        }
      }
    });
    const snapshot = await connector.collect();
    expect(snapshot.provider.accountIdentifier).toBeNull();
    expect(snapshot.quotaBuckets.map((bucket) => bucket.id)).toEqual(['included', 'on-demand']);
    expect(snapshot.quotaBuckets[1]?.fallbackStatus).toBe('disabled');
  });
});

describe('Cursor about account client', () => {
  it('reads only userEmail from documented agent about JSON', async () => {
    const client = new CursorAboutAccountClient({
      runCommand: async (command, arguments_) => {
        expect(command).toBe('agent');
        expect(arguments_).toEqual(['about', '--format', 'json']);
        return JSON.stringify({
          userEmail: 'dev@example.com',
          subscriptionTier: 'Free',
          cliVersion: '2026.09.02'
        });
      }
    });
    await expect(client.readAccountIdentifier()).resolves.toBe('dev@example.com');
  });
});
