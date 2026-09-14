export interface ChartIdentity {
  model: string | null;
  providerDisplayName: string;
  billingDomainDisplayName: string;
}

export function chartIdentityKey(
  providerId: string,
  billingDomainId: string,
  model: string | null | undefined,
  costPurpose: string | null = 'tokens'
): string {
  return `${providerId}:${billingDomainId}:${model ?? ''}:${costPurpose ?? 'tokens'}`;
}

export function qualifyChartNames(identities: ChartIdentity[]): string[] {
  const bases = identities.map(
    (identity) => identity.model?.trim() || identity.providerDisplayName
  );
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1);
  const used = new Set<string>();
  return identities.map((identity, index) => {
    const base = bases[index] ?? identity.providerDisplayName;
    if ((counts.get(base) ?? 0) === 1 && !used.has(base)) {
      used.add(base);
      return base;
    }
    const withProvider = identity.model
      ? `${identity.model} · ${identity.providerDisplayName}`
      : `${identity.providerDisplayName} · ${identity.billingDomainDisplayName}`;
    if (!used.has(withProvider)) {
      used.add(withProvider);
      return withProvider;
    }
    const withDomain = identity.model
      ? `${identity.model} · ${identity.providerDisplayName} · ${identity.billingDomainDisplayName}`
      : withProvider;
    if (!used.has(withDomain)) {
      used.add(withDomain);
      return withDomain;
    }
    let suffix = 2;
    let next = `${withDomain} #${suffix}`;
    while (used.has(next)) next = `${withDomain} #${++suffix}`;
    used.add(next);
    return next;
  });
}
