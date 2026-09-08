export type SettingsTab = 'connections' | 'rates' | 'monitoring' | 'diagnostics' | 'privacy';

export const SETTINGS_TABS: readonly SettingsTab[] = [
  'connections',
  'rates',
  'monitoring',
  'diagnostics',
  'privacy'
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
