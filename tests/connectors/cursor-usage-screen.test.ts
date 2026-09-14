import { describe, expect, it } from 'vitest';

import {
  parseCursorUsageScreen,
  CursorUsageAdapterError,
  ScreenReaderCursorQuotaClient
} from '../../src/connectors/cursor/cursor-usage-screen-client.js';

describe('Cursor /usage screen parser', () => {
  it('reads Included percent and On-Demand used/limit from the standard table', () => {
    expect(
      parseCursorUsageScreen(
        [
          'Usage · Pro',
          'Resets Sep 15',
          'Monthly plan and on-demand usage',
          'Category          Current     Usage',
          'Included          47% used    ████░░░░',
          '  Auto            30% used    ██░░░░░░',
          '  API             12% used    █░░░░░░░',
          'On-Demand         $12.40 / $20',
          '$7.60 remaining',
          'View in dashboard: cursor.com/dashboard'
        ].join('\n')
      )
    ).toEqual({
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
    });
  });

  it('reads compact Included/Auto/API/On-Demand labels and disabled on-demand', () => {
    expect(
      parseCursorUsageScreen(
        [
          'Usage · Current plan',
          'Resets Sep 15',
          'Included: 47% used',
          'Auto: 30% used',
          'API: 12% used',
          'On-Demand: Disabled',
          'On-demand usage is off'
        ].join('\n')
      )
    ).toEqual({
      kind: 'meters',
      included: { usedPercent: 47 },
      onDemand: { kind: 'disabled' },
      resetLabel: 'Resets Sep 15'
    });
  });

  it('treats unlimited on-demand as used dollars without a percent', () => {
    expect(
      parseCursorUsageScreen(
        [
          'Usage · Ultra',
          'Resets Oct 1',
          'Included          12% used',
          'On-Demand         $8',
          'No monthly limit'
        ].join('\n')
      )
    ).toMatchObject({
      kind: 'meters',
      included: { usedPercent: 12 },
      onDemand: { kind: 'unlimited', usedAmount: 8, currency: 'USD' },
      resetLabel: 'Resets Oct 1'
    });
  });

  it('returns an unmetered complete snapshot for the official not-available sentence', () => {
    expect(
      parseCursorUsageScreen('Usage details are not available for this plan in the CLI.')
    ).toEqual({ kind: 'unmetered' });
  });

  it('returns an unmetered complete snapshot for the enterprise spend chart', () => {
    expect(
      parseCursorUsageScreen(
        [
          'Usage · Enterprise',
          'Personal spend for the current billing period',
          'Current cycle     $120',
          'Previous period   $90'
        ].join('\n')
      )
    ).toEqual({ kind: 'unmetered' });
  });

  it('fails closed when the account is not logged in', () => {
    expect(() => parseCursorUsageScreen('Not logged in. Run /login first.')).toThrow(
      CursorUsageAdapterError
    );
    try {
      parseCursorUsageScreen('Not logged in. Run /login first.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'cursor-not-logged-in' });
    }
  });

  it('fails closed when labels cannot be parsed', () => {
    expect(() => parseCursorUsageScreen('Cursor Agent\nAsk\nAuto')).toThrow(
      CursorUsageAdapterError
    );
  });

  it('joins vertically painted letters before matching official sentences', () => {
    const painted = `${['U', 's', 'a', 'g', 'e', ' ', 'd', 'e', 't', 'a', 'i', 'l', 's', ' '].join('\n')}are not available for this plan in the CLI.`;
    expect(parseCursorUsageScreen(painted)).toEqual({ kind: 'unmetered' });
  });

  it('treats a standard table header without Included percent as an unmetered snapshot', () => {
    expect(
      parseCursorUsageScreen(
        [
          'Monthly plan and on-demand usage',
          'I',
          'A',
          'O',
          'View in dashboard: cursor.com/dashboard?tab=usage'
        ].join('\n')
      )
    ).toEqual({ kind: 'unmetered' });
  });

  it('runs the official agent in a throwaway directory with an English locale', async () => {
    const client = new ScreenReaderCursorQuotaClient({
      command: '/usr/local/bin/agent',
      timeoutMs: 1_000,
      runSession: async (session) => {
        expect(session.command).toBe('/usr/local/bin/agent');
        expect(session.cwd).toMatch(/agent-usage-cursor-/);
        expect(session.env.LC_ALL).toBe('en_US.UTF-8');
        expect(session.env.LANG).toBe('en_US.UTF-8');
        expect(session.env.INK_SCREEN_READER).toBe('true');
        return [
          'Usage · Pro',
          'Resets Sep 15',
          'Included          47% used',
          'On-Demand         $12.40 / $20'
        ].join('\n');
      }
    });

    await expect(client.readUsage()).resolves.toMatchObject({
      kind: 'meters',
      included: { usedPercent: 47 }
    });
  });
});
