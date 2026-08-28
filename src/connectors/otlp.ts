export interface OtlpPoint {
  timeUnixNano?: unknown;
  asInt?: unknown;
  asDouble?: unknown;
  attributes?: unknown;
}

export interface OtlpMetric {
  name?: unknown;
  sum?: { dataPoints?: unknown; aggregationTemporality?: unknown };
}

interface OtlpAttribute {
  key?: unknown;
  value?: { stringValue?: unknown };
}

export function extractOtlpResources(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !Array.isArray(payload.resourceMetrics)) return [];
  return payload.resourceMetrics.filter(isRecord);
}

export function extractOtlpMetrics(resource: Record<string, unknown>): OtlpMetric[] {
  if (!Array.isArray(resource.scopeMetrics)) return [];
  return resource.scopeMetrics
    .filter(isRecord)
    .flatMap((scope) => (Array.isArray(scope.metrics) ? (scope.metrics as OtlpMetric[]) : []));
}

export function otlpStringAttributes(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(value)) return result;
  for (const attribute of value as OtlpAttribute[]) {
    if (typeof attribute.key === 'string' && typeof attribute.value?.stringValue === 'string') {
      result.set(attribute.key, attribute.value.stringValue);
    }
  }
  return result;
}

export function isDeltaTemporality(value: unknown): boolean {
  return value === 1 || value === 'AGGREGATION_TEMPORALITY_DELTA';
}

export function numericOtlpPointValue(point: OtlpPoint): number | null {
  const value = point.asDouble ?? point.asInt;
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

export function otlpNanoToIso(value: string): string {
  try {
    return new Date(Number(BigInt(value) / 1_000_000n)).toISOString();
  } catch {
    throw new Error('Invalid OTLP nanosecond timestamp');
  }
}

export function readRecord(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  return isRecord(value[key]) ? value[key] : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
