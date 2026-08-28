import type { DiagnosticCategory, DoctorReport, UsageOverview } from '../core/types.js';
import { classifyDiagnosticCategory } from '../core/diagnostic-category.js';

const automaticallyRefreshedCategories = new Set<DiagnosticCategory>([
  'stale',
  'timeout',
  'unavailable'
]);

const automaticallyManagedCategories = new Set<DiagnosticCategory>([
  ...automaticallyRefreshedCategories,
  'rate-limited'
]);

export function isAutomaticallyManagedCategory(category: DiagnosticCategory | null): boolean {
  return category !== null && automaticallyManagedCategories.has(category);
}

function automaticRefreshCategory(errorCode: string | null): DiagnosticCategory | null {
  return errorCode ? classifyDiagnosticCategory(errorCode, '') : null;
}

function billingDomainScope(providerId: string, billingDomainId: string): string {
  return `${providerId}:${billingDomainId}`;
}

function refreshableFreshnessSource(
  scope: string,
  status: 'fresh' | 'stale' | 'unavailable',
  lastSuccessAt: string | null,
  rateLimited: boolean
): string[] {
  return !rateLimited && (status === 'stale' || status === 'unavailable')
    ? [`${scope}:freshness:${status}:${lastSuccessAt ?? 'unknown'}`]
    : [];
}

function refreshableHealthSource(
  scope: string,
  errorCode: string | null,
  lastSuccessAt: string | null
): string[] {
  const category = automaticRefreshCategory(errorCode);
  return category && automaticallyRefreshedCategories.has(category)
    ? [`${scope}:health:${category}:${lastSuccessAt ?? 'unknown'}`]
    : [];
}

export function automaticRecoverySignature(
  currentOverview: UsageOverview,
  report: DoctorReport | null
): string | null {
  const rateLimitedProviders = new Set(
    (report?.connectors ?? [])
      .filter(
        (diagnostic) =>
          diagnostic.category === 'rate-limited' && diagnostic.billingDomainId === null
      )
      .map((diagnostic) => diagnostic.providerId)
  );
  const rateLimitedDomains = new Set(
    (report?.connectors ?? [])
      .filter(
        (diagnostic) =>
          diagnostic.category === 'rate-limited' && diagnostic.billingDomainId !== null
      )
      .map((diagnostic) =>
        billingDomainScope(diagnostic.providerId, diagnostic.billingDomainId ?? '')
      )
  );
  for (const provider of currentOverview.providers) {
    if (automaticRefreshCategory(provider.health.errorCode) === 'rate-limited') {
      if (provider.summaryBillingDomainId) {
        rateLimitedDomains.add(billingDomainScope(provider.id, provider.summaryBillingDomainId));
      } else {
        rateLimitedProviders.add(provider.id);
      }
    }
    for (const domain of provider.billingDomains) {
      if (domain.health && automaticRefreshCategory(domain.health.errorCode) === 'rate-limited') {
        rateLimitedDomains.add(billingDomainScope(provider.id, domain.id));
      }
    }
  }
  const automaticSources = currentOverview.providers.flatMap((provider) => {
    const providerRateLimited =
      rateLimitedProviders.has(provider.id) ||
      (provider.summaryBillingDomainId
        ? rateLimitedDomains.has(billingDomainScope(provider.id, provider.summaryBillingDomainId))
        : false);
    const providerSources = [
      ...refreshableFreshnessSource(
        `provider:${provider.id}`,
        provider.freshness.status,
        provider.freshness.lastSuccessAt,
        providerRateLimited
      )
    ];
    if (!providerRateLimited) {
      providerSources.push(
        ...refreshableHealthSource(
          `provider:${provider.id}`,
          provider.health.errorCode,
          provider.freshness.lastSuccessAt
        )
      );
    }
    const domainSources = provider.billingDomains.flatMap((domain) => {
      const freshness = domain.freshness ?? provider.freshness;
      const health = domain.health ?? provider.health;
      const domainRateLimited =
        rateLimitedProviders.has(provider.id) ||
        rateLimitedDomains.has(billingDomainScope(provider.id, domain.id)) ||
        automaticRefreshCategory(health.errorCode) === 'rate-limited';
      return [
        ...refreshableFreshnessSource(
          `domain:${provider.id}:${domain.id}`,
          freshness.status,
          freshness.lastSuccessAt,
          domainRateLimited
        ),
        ...(domainRateLimited
          ? []
          : refreshableHealthSource(
              `domain:${provider.id}:${domain.id}`,
              health.errorCode,
              freshness.lastSuccessAt
            ))
      ];
    });
    return [...providerSources, ...domainSources];
  });
  const diagnosticSources = (report?.connectors ?? [])
    .filter(
      (diagnostic) =>
        diagnostic.category !== null &&
        automaticallyRefreshedCategories.has(diagnostic.category) &&
        !rateLimitedProviders.has(diagnostic.providerId) &&
        !(
          diagnostic.billingDomainId &&
          rateLimitedDomains.has(
            billingDomainScope(diagnostic.providerId, diagnostic.billingDomainId)
          )
        )
    )
    .map(
      (diagnostic) =>
        `diagnostic:${diagnostic.id}:${diagnostic.billingDomainId ?? 'provider'}:${diagnostic.category}:${diagnostic.lastSuccessAt ?? 'unknown'}`
    );
  const signature = [...new Set([...automaticSources, ...diagnosticSources])].sort();
  return signature.length > 0 ? signature.join('|') : null;
}

export function createAutomaticRecoveryController(refresh: () => void | Promise<void>): {
  schedule: (
    overview: UsageOverview,
    diagnostics: DoctorReport | null,
    refreshing: boolean
  ) => void;
  dispose: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSignature: string | null = null;
  let disposed = false;

  return {
    schedule(overview, diagnostics, refreshing): void {
      if (disposed) return;
      const signature = automaticRecoverySignature(overview, diagnostics);
      if (!signature) {
        lastSignature = null;
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      if (refreshing || timer || signature === lastSignature) return;
      lastSignature = signature;
      timer = setTimeout(() => {
        timer = null;
        if (disposed) return;
        void refresh();
      }, 0);
    },
    dispose(): void {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}
