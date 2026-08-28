import type { DoctorReport, UsageOverview } from '../core/types.js';

export function staleDataSignature(
  currentOverview: UsageOverview,
  report: DoctorReport | null
): string | null {
  const staleSources = currentOverview.providers.flatMap((provider) => {
    const providerSources = [
      ...(provider.freshness.status === 'stale'
        ? [`provider:${provider.id}:freshness:${provider.freshness.lastSuccessAt ?? 'unknown'}`]
        : []),
      ...(provider.health.errorCode === 'stale' ? [`provider:${provider.id}:health:stale`] : [])
    ];
    const domainSources = provider.billingDomains.flatMap((domain) => [
      ...((domain.freshness ?? provider.freshness).status === 'stale'
        ? [
            `domain:${provider.id}:${domain.id}:freshness:${(domain.freshness ?? provider.freshness).lastSuccessAt ?? 'unknown'}`
          ]
        : []),
      ...((domain.health ?? provider.health).errorCode === 'stale'
        ? [`domain:${provider.id}:${domain.id}:health:stale`]
        : [])
    ]);
    return [...providerSources, ...domainSources];
  });
  const diagnosticSources = (report?.connectors ?? [])
    .filter((diagnostic) => diagnostic.category === 'stale')
    .map(
      (diagnostic) =>
        `diagnostic:${diagnostic.id}:${diagnostic.billingDomainId ?? 'provider'}:${diagnostic.lastSuccessAt ?? 'unknown'}`
    );
  const signature = [...new Set([...staleSources, ...diagnosticSources])].sort();
  return signature.length > 0 ? signature.join('|') : null;
}

export function createStaleRefreshController(refresh: () => void | Promise<void>): {
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
      const signature = staleDataSignature(overview, diagnostics);
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
