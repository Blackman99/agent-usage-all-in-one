import type {
  NormalizedUsageObservation,
  TokenModelAttribution,
  TokenSemantics,
  UsageObservation
} from './types.js';

const LEGACY_TOKEN_SEMANTICS: TokenSemantics = {
  reasoning: 'included-in-output',
  cacheRead: 'separate',
  cacheWrite: 'separate'
};

export function normalizeTokenObservation(
  observation: UsageObservation
): NormalizedUsageObservation {
  const inputTokens = tokenCount(observation.inputTokens, 'inputTokens');
  const outputTokens = tokenCount(observation.outputTokens, 'outputTokens');
  const reasoningTokens = tokenCount(observation.reasoningTokens ?? 0, 'reasoningTokens');
  const cacheReadTokens = tokenCount(observation.cacheReadTokens, 'cacheReadTokens');
  const cacheWriteTokens = tokenCount(observation.cacheWriteTokens, 'cacheWriteTokens');
  const cacheWriteTokenBreakdown = observation.cacheWriteTokenBreakdown
    ? {
        fiveMinute: tokenCount(
          observation.cacheWriteTokenBreakdown.fiveMinute,
          'cacheWriteTokenBreakdown.fiveMinute'
        ),
        oneHour: tokenCount(
          observation.cacheWriteTokenBreakdown.oneHour,
          'cacheWriteTokenBreakdown.oneHour'
        )
      }
    : null;
  if (
    cacheWriteTokenBreakdown &&
    cacheWriteTokenBreakdown.fiveMinute + cacheWriteTokenBreakdown.oneHour !== cacheWriteTokens
  ) {
    throw new Error('cacheWriteTokenBreakdown must equal cacheWriteTokens');
  }
  const tokenSemantics = observation.tokenSemantics ?? LEGACY_TOKEN_SEMANTICS;
  const categorizedTokens =
    inputTokens +
    outputTokens +
    (tokenSemantics.reasoning === 'separate' ? reasoningTokens : 0) +
    (tokenSemantics.cacheRead === 'separate' ? cacheReadTokens : 0) +
    (tokenSemantics.cacheWrite === 'separate' ? cacheWriteTokens : 0);
  const sourceReportedTotalTokens = nullableTokenCount(
    observation.sourceReportedTotalTokens,
    'sourceReportedTotalTokens'
  );
  const reconciledRemainderTokens = nullableTokenCount(
    observation.reconciledRemainderTokens,
    'reconciledRemainderTokens'
  );
  if (sourceReportedTotalTokens !== null && reconciledRemainderTokens !== null) {
    throw new Error(
      'sourceReportedTotalTokens and reconciledRemainderTokens are mutually exclusive'
    );
  }
  if (sourceReportedTotalTokens !== null && sourceReportedTotalTokens < categorizedTokens) {
    throw new Error(
      'sourceReportedTotalTokens must be greater than or equal to categorized tokens'
    );
  }
  if (reconciledRemainderTokens !== null && categorizedTokens !== 0) {
    throw new Error('reconciledRemainderTokens must not contain categorized tokens');
  }
  const totalDerivation =
    sourceReportedTotalTokens !== null
      ? ('source-reported' as const)
      : reconciledRemainderTokens !== null
        ? ('reconciled-remainder' as const)
        : ('categorized' as const);
  const recordedTokens =
    sourceReportedTotalTokens ?? reconciledRemainderTokens ?? categorizedTokens;
  const inferredModelAttribution = inferModelAttribution(observation.model);
  const modelAttribution =
    inferredModelAttribution === 'unclassified'
      ? 'unclassified'
      : (observation.modelAttribution ?? inferredModelAttribution);
  const unclassifiedTokens =
    modelAttribution === 'unclassified'
      ? recordedTokens
      : Math.max(0, recordedTokens - categorizedTokens);

  return {
    ...observation,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheWriteTokenBreakdown,
    sourceReportedTotalTokens,
    reconciledRemainderTokens,
    tokenSemantics,
    modelAttribution,
    timePrecision: observation.timePrecision ?? 'unknown',
    usageScope: observation.usageScope ?? 'unknown',
    aggregationTemporality: observation.aggregationTemporality ?? 'unknown',
    recordedTokens,
    unclassifiedTokens,
    totalDerivation
  };
}

function inferModelAttribution(model: string | null): TokenModelAttribution {
  const normalized = model?.trim().toLowerCase();
  return !normalized ||
    normalized === 'all-models' ||
    normalized === 'unknown' ||
    normalized === 'unknown-model'
    ? 'unclassified'
    : 'known';
}

function nullableTokenCount(value: number | null | undefined, field: string): number | null {
  return value === null || value === undefined ? null : tokenCount(value, field);
}

function tokenCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}
