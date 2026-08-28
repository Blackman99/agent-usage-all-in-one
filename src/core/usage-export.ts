import { redactSensitiveText } from './redaction.js';
import type { UsageExportArtifact, UsageExportRequest, UsageOverview } from './types.js';

export function buildUsageExport(
  overview: UsageOverview,
  request: UsageExportRequest,
  accountIdentifiers: Record<string, string> = {}
): UsageExportArtifact {
  const usageObservationAliases = new Map<string, string>();
  const costObservationAliases = new Map<string, string>();
  const usageObservationAlias = (
    providerId: string,
    billingDomainId: string,
    observationId: string | null | undefined
  ): string | null => {
    if (!observationId) return null;
    const key = `${providerId}\u0000${billingDomainId}\u0000${observationId}`;
    const existing = usageObservationAliases.get(key);
    if (existing) return existing;
    const alias = `usage-observation-${usageObservationAliases.size + 1}`;
    usageObservationAliases.set(key, alias);
    return alias;
  };
  const costObservationAlias = (
    providerId: string,
    billingDomainId: string,
    costId: string
  ): string => {
    const key = `${providerId}\u0000${billingDomainId}\u0000${costId}`;
    const existing = costObservationAliases.get(key);
    if (existing) return existing;
    const alias = `cost-observation-${costObservationAliases.size + 1}`;
    costObservationAliases.set(key, alias);
    return alias;
  };
  const rows = overview.providers.flatMap((provider) =>
    provider.billingDomains.flatMap((domain) => {
      const history = domain.history;
      const tokenAuthority = exportAuthority(
        history.authorities ??
          (domain.tokenAuthority && domain.tokenAuthority !== 'mixed'
            ? [domain.tokenAuthority]
            : [])
      );
      const tokenRow = {
        window: history.window,
        windowStart: history.start,
        windowEnd: history.end,
        timeZone: history.timeZone,
        provider: redactSensitiveText(provider.displayName),
        billingDomain: redactSensitiveText(domain.displayName),
        ...(request.includeAccountIdentifiers
          ? { accountIdentifier: accountIdentifiers[provider.id] ?? null }
          : {}),
        freshness: domain.freshness.status,
        lastSuccessAt: domain.freshness.lastSuccessAt,
        recordType: 'tokens',
        recordId: null,
        model: null,
        usageObservationId: null,
        observedAt: history.lastObservedAt ?? null,
        timePrecision: null,
        authority: tokenAuthority,
        totalTokens: history.tokenTotals.total,
        recordedTokens: history.tokenEvidence.recordedTokens,
        sourceReportedTokens: history.tokenEvidence.sourceReportedTokens,
        sourceReportedObservationCount: history.tokenEvidence.sourceReportedObservationCount,
        observationCount: history.tokenEvidence.observationCount,
        unclassifiedTokens: history.tokenEvidence.unclassifiedTokens,
        classifiedTokens: history.tokenEvidence.classifiedTokens,
        classificationCoverage: history.tokenEvidence.classificationCoverage,
        totalDerivations: history.tokenEvidence.totalDerivations,
        timePrecisions: history.tokenEvidence.timePrecisions,
        usageScopes: history.tokenEvidence.usageScopes,
        aggregationTemporalities: history.tokenEvidence.aggregationTemporalities,
        reasoningSemantics: null,
        cacheReadSemantics: null,
        cacheWriteSemantics: null,
        inputTokens: history.tokenTotals.input,
        outputTokens: history.tokenTotals.output,
        reasoningTokens: history.tokenTotals.reasoning,
        cacheReadTokens: history.tokenTotals.cacheRead,
        cacheWriteTokens: history.tokenTotals.cacheWrite,
        costKind: null,
        costPurpose: null,
        legacyPurposeUnknown: false,
        amount: null,
        currency: null,
        pricedTokens: null,
        unpricedTokens: null,
        pricingCoverage: null,
        priceVersions: null,
        priceCanonicalModels: null,
        priceEffectiveAts: null,
        priceEffectiveUntils: null,
        priceCurrencies: null,
        priceRatesPerMillion: null,
        priceSourceUrls: null,
        priceContextTiers: null,
        priceLineItems: null,
        calculatedAt: null
      };
      const modelObservations = history.models.flatMap((model) =>
        model.observations.map((observation) => ({
          model: model.model,
          observation
        }))
      );
      const modelObservationIds = new Set(
        modelObservations.map(({ observation }) => observation.id)
      );
      const tokenObservationRows = [
        ...modelObservations,
        ...(history.unclassified.observations ?? [])
          .filter((observation) => !modelObservationIds.has(observation.id))
          .map((observation) => ({
            model: observation.model,
            observation
          }))
      ].map(({ model, observation }) => {
        const recordedTokens = observation.recordedTokens;
        const classifiedTokens = observation.classifiedTokens;
        const exportId = usageObservationAlias(provider.id, domain.id, observation.id);
        return {
          ...tokenRow,
          recordType: 'token-observation',
          recordId: exportId,
          model,
          usageObservationId: exportId,
          observedAt: observation.observedAt,
          timePrecision: observation.timePrecision,
          authority: observation.authority,
          totalTokens: recordedTokens,
          recordedTokens,
          sourceReportedTokens: observation.sourceReportedTotalTokens,
          sourceReportedObservationCount: observation.sourceReportedTotalTokens === null ? 0 : 1,
          observationCount: 1,
          unclassifiedTokens: observation.unclassifiedTokens,
          classifiedTokens,
          classificationCoverage: recordedTokens === 0 ? null : classifiedTokens / recordedTokens,
          totalDerivations: [observation.totalDerivation],
          timePrecisions: [observation.timePrecision],
          usageScopes: [observation.usageScope],
          aggregationTemporalities: [observation.aggregationTemporality],
          reasoningSemantics: observation.tokenSemantics.reasoning,
          cacheReadSemantics: observation.tokenSemantics.cacheRead,
          cacheWriteSemantics: observation.tokenSemantics.cacheWrite,
          inputTokens: observation.tokenTotals.input,
          outputTokens: observation.tokenTotals.output,
          reasoningTokens: observation.tokenTotals.reasoning,
          cacheReadTokens: observation.tokenTotals.cacheRead,
          cacheWriteTokens: observation.tokenTotals.cacheWrite
        };
      });
      const observationsById = new Map([
        ...history.models.flatMap((model) =>
          model.observations.map((observation) => [observation.id, observation] as const)
        ),
        ...(history.unclassified.observations ?? []).map(
          (observation) => [observation.id, observation] as const
        )
      ]);
      const costRows = history.costs.map((cost) => {
        const authorities = domain.costs
          .filter(
            (candidate) =>
              candidate.kind === cost.kind &&
              candidate.currency.toUpperCase() === cost.currency.toUpperCase() &&
              candidate.observedAt >= history.start &&
              candidate.observedAt < history.end
          )
          .map((candidate) => candidate.authority);
        return {
          ...tokenRow,
          recordType: 'cost',
          observedAt: cost.observedAt ?? null,
          authority: exportAuthority(authorities),
          totalTokens: null,
          recordedTokens: cost.pricingEvidence?.recordedTokens ?? null,
          sourceReportedTokens: null,
          sourceReportedObservationCount: null,
          observationCount: null,
          unclassifiedTokens: null,
          classifiedTokens: null,
          classificationCoverage: null,
          totalDerivations: null,
          timePrecisions: null,
          usageScopes: null,
          aggregationTemporalities: null,
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costKind: cost.kind,
          costPurpose: cost.kind === 'legacy-unknown' ? null : cost.kind,
          legacyPurposeUnknown: cost.kind === 'legacy-unknown',
          amount: cost.amount,
          currency: cost.currency,
          pricedTokens: cost.pricingEvidence?.pricedTokens ?? null,
          unpricedTokens: cost.pricingEvidence?.unpricedTokens ?? null,
          pricingCoverage: cost.pricingEvidence?.pricingCoverage ?? null,
          priceVersions: cost.priceSnapshots.map((snapshot) => snapshot.version),
          priceCanonicalModels: cost.priceSnapshots.map((snapshot) => snapshot.canonicalModel),
          priceEffectiveAts: cost.priceSnapshots.map((snapshot) => snapshot.effectiveAt),
          priceEffectiveUntils: cost.priceSnapshots.map((snapshot) => snapshot.effectiveUntil),
          priceCurrencies: cost.priceSnapshots.map((snapshot) => snapshot.currency),
          priceRatesPerMillion: cost.priceSnapshots.map((snapshot) =>
            JSON.stringify(snapshot.ratesPerMillion)
          ),
          priceSourceUrls: cost.priceSnapshots.flatMap((snapshot) =>
            snapshot.sourceUrl ? [snapshot.sourceUrl] : []
          ),
          priceContextTiers: cost.priceSnapshots.flatMap((snapshot) =>
            snapshot.contextTier ? [snapshot.contextTier] : []
          ),
          priceLineItems: null,
          calculatedAt: null
        };
      });
      const costObservationRows = domain.costs
        .filter((cost) => cost.observedAt >= history.start && cost.observedAt < history.end)
        .map((cost) => {
          const snapshot = cost.priceSnapshot ?? null;
          const observation = cost.usageObservationId
            ? observationsById.get(cost.usageObservationId)
            : null;
          return {
            ...tokenRow,
            recordType: 'cost-observation',
            recordId: costObservationAlias(provider.id, domain.id, cost.id),
            model: cost.model ?? null,
            usageObservationId: usageObservationAlias(
              provider.id,
              domain.id,
              cost.usageObservationId
            ),
            observedAt: cost.observedAt ?? null,
            timePrecision: observation?.timePrecision ?? null,
            authority: cost.authority,
            totalTokens: null,
            recordedTokens: null,
            sourceReportedTokens: null,
            sourceReportedObservationCount: null,
            observationCount: null,
            unclassifiedTokens: null,
            classifiedTokens: null,
            classificationCoverage: null,
            totalDerivations: null,
            timePrecisions: null,
            usageScopes: null,
            aggregationTemporalities: null,
            inputTokens: null,
            outputTokens: null,
            reasoningTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            costKind: cost.kind,
            costPurpose: cost.kind === 'legacy-unknown' ? null : cost.kind,
            legacyPurposeUnknown: cost.kind === 'legacy-unknown',
            amount: cost.amount,
            currency: cost.currency,
            pricedTokens: cost.pricedTokens,
            unpricedTokens: null,
            pricingCoverage: null,
            priceVersions: snapshot ? [snapshot.version] : [],
            priceCanonicalModels: snapshot ? [snapshot.canonicalModel] : [],
            priceEffectiveAts: snapshot ? [snapshot.effectiveAt] : [],
            priceEffectiveUntils: snapshot ? [snapshot.effectiveUntil] : [],
            priceCurrencies: snapshot ? [snapshot.currency] : [],
            priceRatesPerMillion: snapshot ? [JSON.stringify(snapshot.ratesPerMillion)] : [],
            priceSourceUrls: snapshot?.sourceUrl ? [snapshot.sourceUrl] : [],
            priceContextTiers: snapshot?.contextTier ? [snapshot.contextTier] : [],
            priceLineItems: cost.lineItems ? JSON.stringify(cost.lineItems) : null,
            calculatedAt: cost.calculatedAt ?? null
          };
        });
      return [tokenRow, ...tokenObservationRows, ...costRows, ...costObservationRows];
    })
  );
  const generatedDay = overview.generatedAt.slice(0, 10);
  const filename = `agent-usage-${request.window ?? '24h'}-${generatedDay}.${request.format}`;
  if (request.format === 'csv') {
    return {
      format: 'csv',
      filename,
      contentType: 'text/csv; charset=utf-8',
      body: rowsToCsv(rows)
    };
  }
  const firstHistory = overview.providers[0]?.billingDomains[0]?.history;
  return {
    format: 'json',
    filename,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({
      version: 2,
      generatedAt: overview.generatedAt,
      query: {
        window: request.window ?? '24h',
        timeZone: firstHistory?.timeZone ?? request.timeZone ?? 'UTC',
        start: firstHistory?.start ?? null,
        end: firstHistory?.end ?? overview.generatedAt
      },
      privacy: {
        accountIdentifiersIncluded: Boolean(request.includeAccountIdentifiers),
        secretsIncluded: false
      },
      rows
    })
  };
}

function exportAuthority(values: string[]): string {
  const unique = [...new Set(values.filter(Boolean))].sort();
  return unique.length === 0 ? 'unavailable' : unique.length === 1 ? unique[0] : 'mixed';
}

const CSV_COLUMNS = [
  'window',
  'windowStart',
  'windowEnd',
  'timeZone',
  'provider',
  'billingDomain',
  'accountIdentifier',
  'freshness',
  'lastSuccessAt',
  'recordType',
  'recordId',
  'model',
  'usageObservationId',
  'observedAt',
  'timePrecision',
  'authority',
  'totalTokens',
  'recordedTokens',
  'sourceReportedTokens',
  'sourceReportedObservationCount',
  'observationCount',
  'unclassifiedTokens',
  'classifiedTokens',
  'classificationCoverage',
  'totalDerivations',
  'timePrecisions',
  'usageScopes',
  'aggregationTemporalities',
  'reasoningSemantics',
  'cacheReadSemantics',
  'cacheWriteSemantics',
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'costKind',
  'costPurpose',
  'legacyPurposeUnknown',
  'amount',
  'currency',
  'pricedTokens',
  'unpricedTokens',
  'pricingCoverage',
  'priceVersions',
  'priceCanonicalModels',
  'priceEffectiveAts',
  'priceEffectiveUntils',
  'priceCurrencies',
  'priceRatesPerMillion',
  'priceSourceUrls',
  'priceContextTiers',
  'priceLineItems',
  'calculatedAt'
] as const;

function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  return [
    CSV_COLUMNS.join(','),
    ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(row[column])).join(','))
  ].join('\n');
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
