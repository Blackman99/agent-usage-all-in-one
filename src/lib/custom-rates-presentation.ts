export interface CustomRateDraft {
  providerId: string;
  billingDomainId: string;
  model: string;
  inputRate: string;
  outputRate: string;
  cacheReadRate: string;
}

export function shouldOpenAddRateForm(
  target: string | null | undefined,
  hasConfiguredDraft = false
): boolean {
  if (hasConfiguredDraft) {
    return true;
  }
  return target === 'rates:add';
}

export function createDefaultRateDraft(defaults: Partial<CustomRateDraft> = {}): CustomRateDraft {
  return {
    providerId: defaults.providerId ?? 'codex',
    billingDomainId: defaults.billingDomainId ?? '',
    model: defaults.model ?? '',
    inputRate: defaults.inputRate ?? '',
    outputRate: defaults.outputRate ?? '',
    cacheReadRate: defaults.cacheReadRate ?? '0'
  };
}

export function resolveRateProviderChoice(
  providerId: string,
  defaultProviders: readonly { id: string }[]
): string {
  return defaultProviders.some((p) => p.id === providerId) ? providerId : 'custom';
}

export function formatRateDomain(
  domainId: string | null | undefined,
  wildcardLabel: string
): string {
  if (!domainId || domainId === '*') {
    return wildcardLabel;
  }
  return domainId;
}

export function formatRatePerMillion(rate: number): string {
  return `$${rate}/M`;
}

export function isRateDraftValid(draft: CustomRateDraft, providerChoice: string): boolean {
  const provider = providerChoice === 'custom' ? draft.providerId.trim() : providerChoice.trim();
  if (!provider) {
    return false;
  }
  if (!draft.model.trim()) {
    return false;
  }
  const inputRate = parseFloat(draft.inputRate);
  if (isNaN(inputRate) || inputRate < 0 || draft.inputRate.trim() === '') {
    return false;
  }
  const outputRate = parseFloat(draft.outputRate);
  if (isNaN(outputRate) || outputRate < 0 || draft.outputRate.trim() === '') {
    return false;
  }
  if (draft.cacheReadRate.trim() !== '') {
    const cacheRate = parseFloat(draft.cacheReadRate);
    if (isNaN(cacheRate) || cacheRate < 0) {
      return false;
    }
  }
  return true;
}
