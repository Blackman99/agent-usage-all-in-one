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
  const legacyTotalTokens = nullableTokenCount(observation.totalTokens, 'totalTokens');
  const totalDerivation =
    sourceReportedTotalTokens !== null
      ? ('source-reported' as const)
      : legacyTotalTokens !== null
        ? ('legacy-total' as const)
        : ('categorized' as const);
  const recordedTokens = sourceReportedTotalTokens ?? legacyTotalTokens ?? categorizedTokens;
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
    sourceReportedTotalTokens,
    tokenSemantics,
    modelAttribution,
    timePrecision: observation.timePrecision ?? 'unknown',
    usageScope: observation.usageScope ?? 'unknown',
    recordedTokens,
    unclassifiedTokens,
    totalDerivation
  };
}

function inferModelAttribution(model: string | null): TokenModelAttribution {
  const normalized = model?.trim().toLowerCase();
  return !normalized || normalized === 'all-models' || normalized === 'unknown'
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
