import { describe, expect, it } from 'vitest';

import { clampPercent, percentFromUsedAndLimit } from '$core/quota-normalization.js';

describe('quota percentage normalization', () => {
  it('clamps values above 100 to 100', () => {
    expect(clampPercent(101)).toBe(100);
    expect(clampPercent(150.5)).toBe(100);
    expect(clampPercent(100.001)).toBe(100);
  });

  it('clamps values below 0 to 0', () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(-0.5)).toBe(0);
  });

  it('preserves valid percentage values within [0, 100]', () => {
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(42.5)).toBe(42.5);
    expect(clampPercent(100)).toBe(100);
  });

  it('returns null for null, undefined, and non-finite values', () => {
    expect(clampPercent(null)).toBeNull();
    expect(clampPercent(undefined)).toBeNull();
    expect(clampPercent(Number.NaN)).toBeNull();
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampPercent(Number.NEGATIVE_INFINITY)).toBeNull();
  });
});

describe('percent from used and limit amounts', () => {
  it('derives a clamped percent when both amounts are present and the limit is positive', () => {
    expect(percentFromUsedAndLimit(12.4, 20)).toBe(62);
    expect(percentFromUsedAndLimit(25, 20)).toBe(100);
  });

  it('does not invent a percent without a positive limit', () => {
    expect(percentFromUsedAndLimit(12.4, null)).toBeNull();
    expect(percentFromUsedAndLimit(12.4, 0)).toBeNull();
    expect(percentFromUsedAndLimit(null, 20)).toBeNull();
  });
});
