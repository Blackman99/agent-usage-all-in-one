export type SettingsTab = 'connections' | 'rates' | 'monitoring' | 'diagnostics' | 'privacy';

export const SETTINGS_TABS: readonly SettingsTab[] = [
  'connections',
  'rates',
  'monitoring',
  'diagnostics',
  'privacy'
] as const;

export interface SettingsTabDescriptor {
  readonly id: SettingsTab;
  readonly navKey: 'connections' | 'customRatesNav' | 'monitoring' | 'diagnosticsNav' | 'privacy';
  readonly headingKey: 'connections' | 'customRates' | 'monitoring' | 'diagnostics' | 'privacy';
  readonly subtitleKey:
    | 'connectionsSubtitle'
    | 'customRatesSubtitle'
    | 'monitoringSubtitle'
    | 'diagnosticsSubtitle'
    | 'privacySubtitle';
}

export const SETTINGS_TAB_DESCRIPTORS: readonly SettingsTabDescriptor[] = [
  {
    id: 'connections',
    navKey: 'connections',
    headingKey: 'connections',
    subtitleKey: 'connectionsSubtitle'
  },
  {
    id: 'rates',
    navKey: 'customRatesNav',
    headingKey: 'customRates',
    subtitleKey: 'customRatesSubtitle'
  },
  {
    id: 'monitoring',
    navKey: 'monitoring',
    headingKey: 'monitoring',
    subtitleKey: 'monitoringSubtitle'
  },
  {
    id: 'diagnostics',
    navKey: 'diagnosticsNav',
    headingKey: 'diagnostics',
    subtitleKey: 'diagnosticsSubtitle'
  },
  {
    id: 'privacy',
    navKey: 'privacy',
    headingKey: 'privacy',
    subtitleKey: 'privacySubtitle'
  }
] as const;

export function resolveSettingsTab(target: string | null | undefined): SettingsTab {
  if (!target || target === 'root' || target === 'connections') {
    return 'connections';
  }
  if (target.startsWith('connector')) {
    return 'connections';
  }
  if (target === 'rates') {
    return 'rates';
  }
  if (target === 'monitoring') {
    return 'monitoring';
  }
  if (target === 'diagnostics' || target.startsWith('diagnostic')) {
    return 'diagnostics';
  }
  if (target === 'privacy') {
    return 'privacy';
  }
  return 'connections';
}

export function isTargetInTab(target: string | null | undefined, tab: SettingsTab): boolean {
  return resolveSettingsTab(target) === tab;
}

export function shouldHighlightSettingsTarget(
  currentTarget: string | null | undefined,
  elementTarget: string
): boolean {
  if (!currentTarget) {
    return false;
  }
  return currentTarget === elementTarget;
}
