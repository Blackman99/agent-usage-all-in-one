import type { QuotaBucket } from '../core/types.js';

export type QuotaBucketDisplayKind = 'percent' | 'amount' | 'disabled' | 'unavailable';

export interface QuotaBucketDisplay {
  kind: QuotaBucketDisplayKind;
  primary: string;
  progressPercent: number | null;
  resetText: string | null;
}

export function formatQuotaMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    const digits = Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
    return `${currency} ${digits}`;
  }
}

export function quotaBucketDisplay(
  bucket: QuotaBucket,
  locale: string,
  copy: {
    used: string;
    unavailable: string;
    noMonthlyLimit: string;
    onDemandOff: string;
  }
): QuotaBucketDisplay {
  const resetText = bucket.resetLabel?.trim() || null;
  if (bucket.fallbackStatus === 'disabled') {
    return {
      kind: 'disabled',
      primary: copy.onDemandOff,
      progressPercent: null,
      resetText
    };
  }

  const currency = bucket.limitCurrency ?? 'USD';
  if (
    bucket.usedAmount !== null &&
    bucket.usedAmount !== undefined &&
    bucket.limitAmount !== null &&
    bucket.limitAmount !== undefined
  ) {
    return {
      kind: 'amount',
      primary: `${formatQuotaMoney(bucket.usedAmount, currency, locale)} / ${formatQuotaMoney(bucket.limitAmount, currency, locale)}`,
      progressPercent: bucket.usedPercent,
      resetText
    };
  }

  if (bucket.usedAmount !== null && bucket.usedAmount !== undefined) {
    return {
      kind: 'amount',
      primary: `${formatQuotaMoney(bucket.usedAmount, currency, locale)} · ${copy.noMonthlyLimit}`,
      progressPercent: null,
      resetText
    };
  }

  if (bucket.usedPercent !== null) {
    return {
      kind: 'percent',
      primary: `${bucket.usedPercent}% ${copy.used}`,
      progressPercent: bucket.usedPercent,
      resetText
    };
  }

  return {
    kind: 'unavailable',
    primary: copy.unavailable,
    progressPercent: null,
    resetText
  };
}
