import type { DiagnosticCategory } from './types.js';

export function classifyDiagnosticCategory(code: string, message: string): DiagnosticCategory {
  const value = `${code} ${message}`.toLowerCase();
  if (/missing|binary|not[ -]?installed/.test(value)) return 'missing-binary';
  if (/not[ -]?configured|credential.*missing|key.*missing/.test(value)) {
    return 'not-configured';
  }
  if (/unauthori[sz]ed|permission|forbidden|\b401\b|\b403\b/.test(value)) {
    return 'unauthorized';
  }
  if (/unsupported|capability/.test(value)) return 'unsupported';
  if (/schema|shape|parse/.test(value)) return 'schema-mismatch';
  if (/rate[ -]?limit|\b429\b/.test(value)) return 'rate-limited';
  if (/timeout|timed out/.test(value)) return 'timeout';
  if (/stale/.test(value)) return 'stale';
  return 'unavailable';
}
