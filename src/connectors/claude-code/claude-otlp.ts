import type { ConnectorSnapshot, CostRecord, UsageObservation } from '../../core/types.js';
import {
  extractOtlpMetrics,
  extractOtlpResources,
  isDeltaTemporality,
  numericOtlpPointValue,
  otlpNanoToIso,
  otlpStringAttributes,
  type OtlpPoint
} from '../otlp.js';

interface UsageAggregate {
  timestamp: string;
  timePrecision: 'event' | 'unknown';
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export class ClaudeTelemetryError extends Error {
  readonly code = 'claude-otel-temporality-unsupported';
  readonly recovery =
    'Use agent-usage telemetry-env --provider claude-code to configure delta metrics.';

  constructor() {
    super('Cumulative Claude Code metrics cannot be safely added to local history.');
    this.name = 'ClaudeTelemetryError';
  }
}

export function parseClaudeOtlpMetrics(payload: unknown, receivedAt: Date): ConnectorSnapshot {
  const metrics = extractOtlpResources(payload).flatMap(extractOtlpMetrics);
  const usage = new Map<string, UsageAggregate>();
  const costs: CostRecord[] = [];

  for (const metric of metrics) {
    const points = Array.isArray(metric.sum?.dataPoints)
      ? (metric.sum.dataPoints as OtlpPoint[])
      : [];
    if (
      ['claude_code.token.usage', 'claude_code.cost.usage'].includes(String(metric.name)) &&
      !isDeltaTemporality(metric.sum?.aggregationTemporality)
    ) {
      throw new ClaudeTelemetryError();
    }
    for (const point of points) {
      const attributes = otlpStringAttributes(point.attributes);
      const model = attributes.get('model') ?? null;
      const nano = typeof point.timeUnixNano === 'string' ? point.timeUnixNano : null;
      const timestamp = nano ? otlpNanoToIso(nano) : receivedAt.toISOString();
      const value = numericOtlpPointValue(point);
      if (value === null || value < 0) continue;

      if (metric.name === 'claude_code.token.usage') {
        const type = attributes.get('type');
        if (!['input', 'output', 'cacheRead', 'cacheCreation'].includes(type ?? '')) continue;
        const key = `${nano ?? receivedAt.getTime()}:${model ?? 'unknown-model'}`;
        const aggregate = usage.get(key) ?? {
          timestamp,
          timePrecision: nano ? 'event' : 'unknown',
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
        const key = `${nano ?? receivedAt.getTime()}:${model ?? 'unknown-model'}`;
        costs.push({
          id: `claude-otel-cost:${key}`,
          sourceId: `claude-otel:${key}`,
          billingDomainId: 'subscription',
          observedAt: timestamp,
          kind: 'reported-estimate',
          amount: value,
          currency: 'USD',
          authority: 'local-observation',
          model,
          usageObservationId: `claude-otel:${key}`,
          priceSnapshot: {
            id: 'claude-code-otlp-reported-cost-v1',
            version: '2026-08-28',
            source: 'Claude Code official OTLP reported cost',
            canonicalModel: model,
            effectiveAt: '2026-08-28T00:00:00.000Z',
            effectiveUntil: null,
            currency: 'USD',
            ratesPerMillion: {
              input: null,
              output: null,
              reasoning: null,
              'cache-read': null,
              'cache-write': null
            }
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
    inputTokens: item.input,
    outputTokens: item.output,
    cacheReadTokens: item.cacheRead,
    cacheWriteTokens: item.cacheWrite,
    tokenSemantics: {
      reasoning: 'included-in-output',
      cacheRead: 'separate',
      cacheWrite: 'separate'
    },
    modelAttribution: item.model ? 'known' : 'unclassified',
    timePrecision: item.timePrecision,
    usageScope: 'this-mac',
    aggregationTemporality: 'delta',
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
