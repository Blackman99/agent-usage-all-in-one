import type { ConnectorSnapshot, CostRecord, UsageObservation } from '../../core/types.js';

interface OtlpAttribute {
  key?: unknown;
  value?: { stringValue?: unknown };
}

interface OtlpPoint {
  timeUnixNano?: unknown;
  asInt?: unknown;
  asDouble?: unknown;
  attributes?: unknown;
}

interface OtlpMetric {
  name?: unknown;
  sum?: { dataPoints?: unknown };
}

interface UsageAggregate {
  timestamp: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function parseClaudeOtlpMetrics(payload: unknown, receivedAt: Date): ConnectorSnapshot {
  const metrics = extractMetrics(payload);
  const usage = new Map<string, UsageAggregate>();
  const costs: CostRecord[] = [];

  for (const metric of metrics) {
    const points = Array.isArray(metric.sum?.dataPoints)
      ? (metric.sum.dataPoints as OtlpPoint[])
      : [];
    for (const point of points) {
      const attributes = attributeMap(point.attributes);
      const model = attributes.get('model') ?? 'unknown-model';
      const nano = typeof point.timeUnixNano === 'string' ? point.timeUnixNano : null;
      const timestamp = nano ? nanoToIso(nano) : receivedAt.toISOString();
      const value = numericPointValue(point);
      if (value === null || value < 0) continue;

      if (metric.name === 'claude_code.token.usage') {
        const type = attributes.get('type');
        if (!['input', 'output', 'cacheRead', 'cacheCreation'].includes(type ?? '')) continue;
        const key = `${nano ?? receivedAt.getTime()}:${model}`;
        const aggregate = usage.get(key) ?? {
          timestamp,
          model,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0
        };
        if (type === 'input') aggregate.input += value;
        if (type === 'output') aggregate.output += value;
        if (type === 'cacheRead') aggregate.cacheRead += value;
        if (type === 'cacheCreation') aggregate.cacheWrite += value;
        usage.set(key, aggregate);
      }
      if (metric.name === 'claude_code.cost.usage') {
        costs.push({
          id: `claude-otel-cost:${nano ?? receivedAt.getTime()}:${model}`,
          billingDomainId: 'subscription',
          observedAt: timestamp,
          kind: 'estimate',
          amount: value,
          currency: 'USD',
          authority: 'local-observation',
          priceSnapshot: {
            id: 'claude-code-otlp-reported-cost-v1',
            version: '2026-08-28',
            source: 'Claude Code official OTLP reported cost',
            effectiveAt: '2026-08-28T00:00:00.000Z'
          }
        });
      }
    }
  }

  const observations: UsageObservation[] = [...usage.entries()].map(([key, item]) => ({
    id: `claude-otel:${key}`,
    billingDomainId: 'subscription',
    model: item.model,
    observedAt: item.timestamp,
    totalTokens: item.input + item.output + item.cacheRead + item.cacheWrite,
    inputTokens: item.input,
    outputTokens: item.output,
    cacheReadTokens: item.cacheRead,
    cacheWriteTokens: item.cacheWrite,
    authority: 'local-observation'
  }));

  return {
    provider: { id: 'claude-code', displayName: 'Claude Code' },
    billingDomains: [{ id: 'subscription', displayName: 'Claude subscription' }],
    quotaBuckets: [],
    usage: observations,
    costs,
    observedAt: receivedAt.toISOString()
  };
}

function extractMetrics(payload: unknown): OtlpMetric[] {
  if (!payload || typeof payload !== 'object' || !('resourceMetrics' in payload)) return [];
  const resources: unknown[] = Array.isArray(payload.resourceMetrics)
    ? payload.resourceMetrics
    : [];
  return resources.flatMap((resource) => {
    if (!resource || typeof resource !== 'object' || !('scopeMetrics' in resource)) return [];
    const scopes: unknown[] = Array.isArray(resource.scopeMetrics) ? resource.scopeMetrics : [];
    return scopes.flatMap((scope) => {
      if (!scope || typeof scope !== 'object' || !('metrics' in scope)) return [];
      return Array.isArray(scope.metrics) ? (scope.metrics as OtlpMetric[]) : [];
    });
  });
}

function attributeMap(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(value)) return result;
  for (const attribute of value as OtlpAttribute[]) {
    if (
      typeof attribute.key === 'string' &&
      typeof attribute.value?.stringValue === 'string' &&
      ['type', 'model'].includes(attribute.key)
    ) {
      result.set(attribute.key, attribute.value.stringValue);
    }
  }
  return result;
}

function numericPointValue(point: OtlpPoint): number | null {
  const value = point.asDouble ?? point.asInt;
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function nanoToIso(value: string): string {
  try {
    return new Date(Number(BigInt(value) / 1_000_000n)).toISOString();
  } catch {
    throw new Error('Invalid OTLP nanosecond timestamp');
  }
}
