import { describe, expect, it } from 'vitest';

import { quotaBucketDisplay } from '../../src/lib/quota-bucket-display.js';
import type { QuotaBucket } from '../../src/core/types.js';

const copy = {
  used: 'used',
  unavailable: 'Unavailable',
  noMonthlyLimit: 'No monthly limit',
  onDemandOff: 'On-demand usage is off'
};

function bucket(overrides: Partial<QuotaBucket>): QuotaBucket {
  return {
    id: 'included',
    billingDomainId: 'cursor-subscription',
    label: 'Included',
    usedPercent: null,
    resetsAt: null,
    authority: 'official-client',
    ...overrides
  };
}

describe('quota bucket display', () => {
  it('shows percent used when that is the only quantity', () => {
    expect(
      quotaBucketDisplay(bucket({ usedPercent: 47, resetLabel: 'Resets Sep 15' }), 'en', copy)
    ).toEqual({
      kind: 'percent',
      primary: '47% used',
      progressPercent: 47,
      resetText: 'Resets Sep 15'
    });
  });

  it('shows used and limit amounts without treating a missing percent as zero', () => {
    expect(
      quotaBucketDisplay(
        bucket({
          id: 'on-demand',
          label: 'On-Demand',
          usedAmount: 12.4,
          limitAmount: 20,
          limitCurrency: 'USD',
          usedPercent: 62
        }),
        'en',
        copy
      )
    ).toMatchObject({
      kind: 'amount',
      primary: '$12.40 / $20',
      progressPercent: 62
    });
  });

  it('shows unlimited used dollars without a progress bar', () => {
    expect(
      quotaBucketDisplay(
        bucket({
          id: 'on-demand',
          label: 'On-Demand',
          usedAmount: 8,
          limitCurrency: 'USD'
        }),
        'en',
        copy
      )
    ).toEqual({
      kind: 'amount',
      primary: '$8 · No monthly limit',
      progressPercent: null,
      resetText: null
    });
  });

  it('keeps disabled on-demand wording instead of 0%', () => {
    expect(
      quotaBucketDisplay(
        bucket({
          id: 'on-demand',
          label: 'On-Demand',
          fallbackStatus: 'disabled'
        }),
        'en',
        copy
      )
    ).toEqual({
      kind: 'disabled',
      primary: 'On-demand usage is off',
      progressPercent: null,
      resetText: null
    });
  });
});
