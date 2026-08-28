import type {
  ConnectorFailure,
  ConnectorSnapshot,
  CostRecord,
  UsageObservation
} from '../../core/types.js';
import { grokBuildBillingDomain } from './grok-build-connector.js';

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
  sum?: { dataPoints?: unknown; aggregationTemporality?: unknown };
}

interface UsageAggregate {
  timestamp: string;
  timePrecision: 'event' | 'unknown';
  model: string | null;
  sessionId: string | null;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
}

export class GrokTelemetryError extends Error {
  readonly code: 'grok-otel-schema-unsupported' | 'grok-otel-temporality-unsupported';
  readonly recovery: string;

  constructor(code: GrokTelemetryError['code'], message: string, recovery: string) {
    super(message);
    this.name = 'GrokTelemetryError';
    this.code = code;
    this.recovery = recovery;
  }
}

export function parseGrokOtlpMetrics(payload: unknown, receivedAt: Date): ConnectorSnapshot {
  const resources = extractResources(payload);
  const versions = new Set(
    resources
      .map((resource) =>
        attributeMap(readProperty(resource, 'resource')?.attributes).get('grok_code.schema.version')
      )
      .filter((version): version is string => Boolean(version))
  );
  if (versions.size !== 1 || !versions.has('v1')) {
    throw new GrokTelemetryError(
      'grok-otel-schema-unsupported',
      'Grok Build returned an unsupported alpha telemetry schema.',
      'Update Agent Usage, or set Grok Build telemetry back to grok_code.schema.version v1.'
    );
  }

  const usage = new Map<string, UsageAggregate>();
  for (const resource of resources) {
    for (const metric of extractMetrics(resource)) {
      if (metric.name !== 'grok_code.token.usage') continue;
      if (!isDelta(metric.sum?.aggregationTemporality)) {
        throw new GrokTelemetryError(
          'grok-otel-temporality-unsupported',
          'Cumulative Grok Build metrics cannot be safely added to local history.',
          'Use agent-usage telemetry-env --provider grok to configure delta metrics.'
        );
      }
      const points = Array.isArray(metric.sum?.dataPoints)
        ? (metric.sum.dataPoints as OtlpPoint[])
        : [];
      for (const point of points) {
        const attributes = attributeMap(point.attributes);
        const type = attributes.get('type');
        if (!['input', 'output', 'reasoning', 'cache_read'].includes(type ?? '')) continue;
        const value = numericPointValue(point);
        if (value === null || value < 0) continue;
        const nano = typeof point.timeUnixNano === 'string' ? point.timeUnixNano : null;
        const model = attributes.get('model') ?? null;
        const sessionId = attributes.get('session.id') ?? null;
        const key = `${nano ?? receivedAt.getTime()}:${sessionId ?? 'unknown-session'}:${model ?? 'unknown-model'}`;
        const aggregate = usage.get(key) ?? {
          timestamp: nano ? nanoToIso(nano) : receivedAt.toISOString(),
          timePrecision: nano ? 'event' : 'unknown',
          model,
          sessionId,
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0
        };
        if (type === 'input') aggregate.input += value;
        if (type === 'output') aggregate.output += value;
        if (type === 'reasoning') aggregate.reasoning += value;
        if (type === 'cache_read') aggregate.cacheRead += value;
        usage.set(key, aggregate);
      }
    }
  }

  return snapshot(
    [...usage.entries()].map(([key, item]) => ({
      id: `grok-otel:${key}`,
      billingDomainId: 'grok-build-subscription',
      model: item.model,
      sessionId: item.sessionId,
      observedAt: item.timestamp,
      inputTokens: item.input,
      outputTokens: item.output,
      reasoningTokens: item.reasoning,
      cacheReadTokens: item.cacheRead,
      cacheWriteTokens: 0,
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
    })),
    [],
    receivedAt
  );
}

export function parseGrokHeadlessResult(payload: unknown, receivedAt: Date): ConnectorSnapshot {
  if (!isRecord(payload)) throw new Error('Invalid Grok headless result');
  const sessionId = stringValue(payload.sessionId) ?? stringValue(payload.session_id);
  const requestId = stringValue(payload.requestId) ?? stringValue(payload.request_id) ?? 'unknown';
  const aggregateUsage = isRecord(payload.usage) ? payload.usage : {};
  const aggregateTotal = optionalNonNegativeNumber(aggregateUsage.total_tokens);
  const reasoningTotal = nonNegativeNumber(aggregateUsage.reasoning_tokens);
  const modelUsage = isRecord(payload.modelUsage) ? payload.modelUsage : {};
  const modelEntries = Object.entries(modelUsage).filter(
    (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])
  );
  const entries: Array<[string, Record<string, unknown>]> =
    modelEntries.length > 0 ? modelEntries : [['unknown-model', aggregateUsage]];

  const usage: UsageObservation[] = entries.map(([model, raw]) => {
    const values = raw as Record<string, unknown>;
    const input = nonNegativeNumber(values.inputTokens ?? values.input_tokens);
    const output = nonNegativeNumber(values.outputTokens ?? values.output_tokens);
    const cacheRead = nonNegativeNumber(
      values.cacheReadInputTokens ?? values.cache_read_input_tokens
    );
    const cacheWrite = nonNegativeNumber(
      values.cacheCreationInputTokens ?? values.cache_creation_input_tokens
    );
    const sourceReportedTotalTokens =
      optionalNonNegativeNumber(values.totalTokens ?? values.total_tokens) ??
      (entries.length === 1 ? aggregateTotal : null);
    return {
      id: `grok-headless:${sessionId ?? 'unknown-session'}:${requestId}:${model}`,
      billingDomainId: 'grok-build-subscription',
      model: model === 'unknown-model' ? null : model,
      sessionId: sessionId ?? null,
      observedAt: receivedAt.toISOString(),
      inputTokens: input,
      outputTokens: output,
      reasoningTokens: entries.length === 1 ? reasoningTotal : 0,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      sourceReportedTotalTokens,
      tokenSemantics: {
        reasoning: 'included-in-output',
        cacheRead: 'separate',
        cacheWrite: 'separate'
      },
      modelAttribution: model === 'unknown-model' ? 'unclassified' : 'known',
      timePrecision: 'event',
      usageScope: 'this-mac',
      aggregationTemporality: 'delta',
      authority: 'local-observation'
    };
  });

  const warnings: ConnectorFailure[] = [];
  if (payload.usage_is_incomplete === true) {
    warnings.push({
      code: 'grok-headless-usage-incomplete',
      message: 'Grok Build reported incomplete headless usage.',
      recovery: 'Treat these token totals as a lower bound and retry the original export if needed.'
    });
  }
  return snapshot(usage, warnings, receivedAt);
}

function snapshot(
  usage: UsageObservation[],
  warnings: ConnectorFailure[],
  receivedAt: Date
): ConnectorSnapshot {
  return {
    provider: { id: 'grok', displayName: 'Grok' },
    billingDomains: [grokBuildBillingDomain()],
    quotaBuckets: [],
    usage,
    costs: [] as CostRecord[],
    warnings,
    observedAt: receivedAt.toISOString()
  };
}

function extractResources(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !Array.isArray(payload.resourceMetrics)) return [];
  return payload.resourceMetrics.filter(isRecord);
}

function extractMetrics(resource: Record<string, unknown>): OtlpMetric[] {
  if (!Array.isArray(resource.scopeMetrics)) return [];
  return resource.scopeMetrics
    .filter(isRecord)
    .flatMap((scope) => (Array.isArray(scope.metrics) ? (scope.metrics as OtlpMetric[]) : []));
}

function readProperty(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return isRecord(value[key]) ? value[key] : null;
}

function attributeMap(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(value)) return result;
  for (const attribute of value as OtlpAttribute[]) {
    if (typeof attribute.key === 'string' && typeof attribute.value?.stringValue === 'string') {
      if (['grok_code.schema.version', 'type', 'model', 'session.id'].includes(attribute.key)) {
        result.set(attribute.key, attribute.value.stringValue);
      }
    }
  }
  return result;
}

function isDelta(value: unknown): boolean {
  return value === 1 || value === 'AGGREGATION_TEMPORALITY_DELTA';
}

function numericPointValue(point: OtlpPoint): number | null {
  const value = point.asDouble ?? point.asInt;
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value: unknown): number {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function optionalNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nanoToIso(value: string): string {
  try {
    return new Date(Number(BigInt(value) / 1_000_000n)).toISOString();
  } catch {
    throw new Error('Invalid OTLP nanosecond timestamp');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
