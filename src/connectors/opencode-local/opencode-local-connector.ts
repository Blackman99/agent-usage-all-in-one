import type {
  Connector,
  ConnectorFailure,
  ConnectorSnapshot,
  CostRecord,
  UsageObservation
} from '../../core/types.js';
import type {
  OpenCodeGoLocalHistoryClient,
  OpenCodeLocalRequest
} from '../opencode-go/opencode-go-connector.js';

export interface OpenCodeLocalConnectorOptions {
  localHistoryClient: OpenCodeGoLocalHistoryClient;
  clock?: () => Date;
}

export class OpenCodeLocalConnector implements Connector {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';
  readonly consentId = 'opencode-go';
  readonly #localHistoryClient: OpenCodeGoLocalHistoryClient;
  readonly #clock: () => Date;

  constructor(options: OpenCodeLocalConnectorOptions) {
    this.#localHistoryClient = options.localHistoryClient;
    this.#clock = options.clock ?? (() => new Date());
  }

  async collect(): Promise<ConnectorSnapshot> {
    const observedAt = this.#clock().toISOString();
    try {
      const requests = await this.#localHistoryClient.readHistory();
      return {
        provider: { id: this.id, displayName: this.displayName },
        billingDomains: [{ id: 'local-history', displayName: 'Local history' }],
        quotaBuckets: [],
        usage: requests.map(mapLocalUsage),
        usageReconciliation: {
          authoritativeIdPrefix: 'opencode-local-request:',
          retiredIdPrefixes: []
        },
        costs: requests.flatMap((request) =>
          request.cost === null ? [] : [mapLocalCost(request, request.cost)]
        ),
        observedAt
      };
    } catch (error) {
      return {
        provider: { id: this.id, displayName: this.displayName },
        billingDomains: [{ id: 'local-history', displayName: 'Local history' }],
        quotaBuckets: [],
        usage: [],
        costs: [],
        warnings: [safeFailure(error)],
        observedAt
      };
    }
  }
}

function mapLocalUsage(request: OpenCodeLocalRequest): UsageObservation {
  return {
    id: `opencode-local-request:${request.id}`,
    billingDomainId: 'local-history',
    model: request.model,
    observedAt: new Date(request.observedAtMs).toISOString(),
    inputTokens: request.inputTokens,
    outputTokens: request.outputTokens,
    reasoningTokens: request.reasoningTokens,
    cacheReadTokens: request.cacheReadTokens,
    cacheWriteTokens: request.cacheWriteTokens,
    tokenSemantics: {
      reasoning: 'separate',
      cacheRead: 'separate',
      cacheWrite: 'separate'
    },
    modelAttribution: 'known',
    timePrecision: 'event',
    usageScope: 'this-mac',
    aggregationTemporality: 'delta',
    authority: 'local-observation'
  };
}

function mapLocalCost(request: OpenCodeLocalRequest, cost: number): CostRecord {
  const usageObservationId = `opencode-local-request:${request.id}`;
  return {
    id: `opencode-local-request-cost:${request.id}`,
    sourceId: usageObservationId,
    billingDomainId: 'local-history',
    observedAt: new Date(request.observedAtMs).toISOString(),
    kind: 'reported-estimate',
    amount: cost,
    currency: 'USD',
    authority: 'local-observation',
    model: request.model,
    usageObservationId,
    priceSnapshot: {
      id: 'opencode-local-message-reported-cost-v1',
      version: '2026-08-29',
      source: 'OpenCode local message history reported cost',
      canonicalModel: request.model,
      effectiveAt: '2026-08-29T00:00:00.000Z',
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
  };
}

function safeFailure(error: unknown): ConnectorFailure {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    'recovery' in error &&
    typeof error.recovery === 'string'
  ) {
    return { code: error.code, message: error.message, recovery: error.recovery };
  }
  return {
    code: 'opencode-local-refresh-failed',
    message: 'OpenCode local history coverage is incomplete.',
    recovery: 'Run agent-usage doctor, then retry refresh.'
  };
}
