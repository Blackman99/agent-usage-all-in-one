import { describe, expect, it } from 'vitest';

import {
  SETTINGS_TABS,
  resolveSettingsTab,
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
