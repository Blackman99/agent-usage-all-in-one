import { describe, expect, it } from 'vitest';

import {
  SETTINGS_TABS,
  SETTINGS_TAB_DESCRIPTORS,
  isTargetInTab,
  resolveSettingsTab,
  shouldHighlightSettingsTarget,
  type SettingsTab
} from '../../src/lib/settings-navigation.js';

describe('settings navigation routing', () => {
  it('defines the 5 first-class settings categories in order', () => {
    const expectedTabs: SettingsTab[] = [
      'connections',
      'rates',
      'monitoring',
      'diagnostics',
      'privacy'
    ];
    expect(SETTINGS_TABS).toEqual(expectedTabs);
  });

  it('defines descriptors for all 5 first-class categories with dedicated i18n keys', () => {
    expect(SETTINGS_TAB_DESCRIPTORS).toHaveLength(5);
    expect(SETTINGS_TAB_DESCRIPTORS.map((d) => d.id)).toEqual(SETTINGS_TABS);

    const diagnosticsDesc = SETTINGS_TAB_DESCRIPTORS.find((d) => d.id === 'diagnostics');
    expect(diagnosticsDesc).toEqual({
      id: 'diagnostics',
      navKey: 'diagnosticsNav',
      headingKey: 'diagnostics',
      subtitleKey: 'diagnosticsSubtitle'
    });

    const ratesDesc = SETTINGS_TAB_DESCRIPTORS.find((d) => d.id === 'rates');
    expect(ratesDesc).toEqual({
      id: 'rates',
      navKey: 'customRatesNav',
      headingKey: 'customRates',
      subtitleKey: 'customRatesSubtitle'
    });
  });

  it('determines whether a target belongs to a specific settings tab', () => {
    expect(isTargetInTab('connector:codex', 'connections')).toBe(true);
    expect(isTargetInTab('connector:codex', 'diagnostics')).toBe(false);
    expect(isTargetInTab('diagnostic:codex', 'diagnostics')).toBe(true);
    expect(isTargetInTab('diagnostic:codex', 'connections')).toBe(false);
    expect(isTargetInTab('rates', 'rates')).toBe(true);
    expect(isTargetInTab('rates', 'privacy')).toBe(false);
    expect(isTargetInTab('monitoring', 'monitoring')).toBe(true);
    expect(isTargetInTab('privacy', 'privacy')).toBe(true);
    expect(isTargetInTab(null, 'connections')).toBe(true);
    expect(isTargetInTab(null, 'diagnostics')).toBe(false);
  });

  it('determines whether an element target should receive active highlighting', () => {
    expect(shouldHighlightSettingsTarget('diagnostic:codex', 'diagnostic:codex')).toBe(true);
    expect(shouldHighlightSettingsTarget('diagnostic:codex', 'diagnostic:grok')).toBe(false);
    expect(shouldHighlightSettingsTarget('connector:xai-api', 'connector:xai-api')).toBe(true);
    expect(shouldHighlightSettingsTarget('rates', 'rates')).toBe(true);
    expect(shouldHighlightSettingsTarget(null, 'diagnostic:codex')).toBe(false);
    expect(shouldHighlightSettingsTarget(undefined, 'rates')).toBe(false);
  });

  it('resolves null, undefined, empty, and root targets to connections', () => {
    expect(resolveSettingsTab(null)).toBe('connections');
    expect(resolveSettingsTab(undefined)).toBe('connections');
    expect(resolveSettingsTab('')).toBe('connections');
    expect(resolveSettingsTab('root')).toBe('connections');
  });

  it('resolves connector targets to connections tab', () => {
    expect(resolveSettingsTab('connections')).toBe('connections');
    expect(resolveSettingsTab('connector:codex')).toBe('connections');
    expect(resolveSettingsTab('connector:xai-api')).toBe('connections');
    expect(resolveSettingsTab('connector:claude-code')).toBe('connections');
  });

  it('resolves rates target to rates tab', () => {
    expect(resolveSettingsTab('rates')).toBe('rates');
  });

  it('resolves monitoring target to monitoring tab', () => {
    expect(resolveSettingsTab('monitoring')).toBe('monitoring');
  });

  it('resolves diagnostic targets to diagnostics tab', () => {
    expect(resolveSettingsTab('diagnostics')).toBe('diagnostics');
    expect(resolveSettingsTab('diagnostic:codex')).toBe('diagnostics');
    expect(resolveSettingsTab('diagnostic:grok')).toBe('diagnostics');
  });

  it('resolves privacy target to privacy tab', () => {
    expect(resolveSettingsTab('privacy')).toBe('privacy');
  });

  it('falls back to connections for unknown targets', () => {
    expect(resolveSettingsTab('unknown-target')).toBe('connections');
  });
});
