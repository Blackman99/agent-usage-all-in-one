/**
 * Normalizes and clamps a quota usage percentage to the valid range [0, 100].
 * Returns null if the value is null, undefined, or not a finite number.
 */
export function clampPercent(value: number): number;
export function clampPercent(value: number | null): number | null;
export function clampPercent(value: number | null | undefined): number | null;
export function clampPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(100, Math.max(0, value));
}
