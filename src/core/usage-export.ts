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
        inputTokens: history.tokenTotals.input,
        outputTokens: history.tokenTotals.output,
        reasoningTokens: history.tokenTotals.reasoning,
        cacheReadTokens: history.tokenTotals.cacheRead,
        cacheWriteTokens: history.tokenTotals.cacheWrite,
        costKind: null,
        amount: null,
        currency: null
      };
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
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costKind: cost.kind,
          amount: cost.amount,
          currency: cost.currency
        };
      });
      return [tokenRow, ...costRows];
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
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'costKind',
  'amount',
  'currency'
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
