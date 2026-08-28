import { redactSensitiveText } from './redaction.js';
import type { UsageExportArtifact, UsageExportRequest, UsageOverview } from './types.js';

export function buildUsageExport(
  overview: UsageOverview,
  request: UsageExportRequest,
  accountIdentifiers: Record<string, string> = {}
): UsageExportArtifact {
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
        freshness: provider.freshness.status,
        lastSuccessAt: provider.freshness.lastSuccessAt,
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
        priceContextTiers: null
      };
      const tokenObservationRows = [
        ...history.models.flatMap((model) =>
          model.observations.map((observation) => ({
            model: model.model,
            observation,
            classified: true
          }))
        ),
        ...(history.unclassified.observations ?? []).map((observation) => ({
          model: observation.model,
          observation,
          classified: false
        }))
      ].map(({ model, observation, classified }) => ({
        ...tokenRow,
        recordType: 'token-observation',
        recordId: observation.id,
        model,
        usageObservationId: observation.id,
        observedAt: observation.observedAt,
        timePrecision: observation.timePrecision,
        authority: observation.authority,
        totalTokens: observation.tokenTotals.total,
        recordedTokens: observation.recordedTokens,
        sourceReportedTokens: observation.sourceReportedTotalTokens,
        sourceReportedObservationCount: observation.sourceReportedTotalTokens === null ? 0 : 1,
        observationCount: 1,
        unclassifiedTokens: observation.unclassifiedTokens,
        classifiedTokens: classified ? observation.recordedTokens : 0,
        classificationCoverage:
          observation.recordedTokens + (classified ? observation.unclassifiedTokens : 0) === 0
            ? null
            : (classified ? observation.recordedTokens : 0) /
              (observation.recordedTokens + (classified ? observation.unclassifiedTokens : 0)),
        totalDerivations: [observation.totalDerivation],
        timePrecisions: [observation.timePrecision],
        usageScopes: null,
        aggregationTemporalities: null,
        inputTokens: observation.tokenTotals.input,
        outputTokens: observation.tokenTotals.output,
        reasoningTokens: observation.tokenTotals.reasoning,
        cacheReadTokens: observation.tokenTotals.cacheRead,
        cacheWriteTokens: observation.tokenTotals.cacheWrite
      }));
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
          )
        };
      });
      const costObservationRows = history.models.flatMap((model) =>
        model.priceEvidence.map((cost) => {
          const snapshot = cost.priceSnapshot;
          return {
            ...tokenRow,
            recordType: 'cost-observation',
            recordId: cost.id,
            model: model.model,
            usageObservationId: cost.usageObservationId,
            observedAt: cost.observedAt ?? null,
            timePrecision:
              model.observations.find((observation) => observation.id === cost.usageObservationId)
                ?.timePrecision ?? null,
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
            costPurpose: cost.kind,
            legacyPurposeUnknown: false,
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
            priceContextTiers: snapshot?.contextTier ? [snapshot.contextTier] : []
          };
        })
      );
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
  'priceContextTiers'
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
