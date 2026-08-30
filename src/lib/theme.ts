import { writable, type Readable, type Writable } from 'svelte/store';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_EVENT = 'agent-usage:theme-changed';
export const THEME_STORAGE_KEY = 'agent-usage:theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function storedPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

function systemDark(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemDark() ? 'dark' : 'light';
}

const preferenceStore: Writable<ThemePreference> = writable(storedPreference());
const themeStore: Writable<ResolvedTheme> = writable('light');

export const themePreference: Readable<ThemePreference> = preferenceStore;
export const activeTheme: Readable<ResolvedTheme> = themeStore;

let currentPreference: ThemePreference = storedPreference();
let systemListenerBound = false;

function apply(theme: ResolvedTheme): void {
  if (typeof window === 'undefined') return;
  const root = window.document.documentElement;
  root.dataset.theme = theme;
  try {
    root.style.colorScheme = theme;
  } catch {
    // colorScheme is widely supported; a failure must not block theming.
  }
}

function publish(theme: ResolvedTheme): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme } }));
}

function sync(): void {
  const theme = resolveTheme(currentPreference);
  preferenceStore.set(currentPreference);
  themeStore.set(theme);
  apply(theme);
}

function watchSystemChanges(): void {
  if (systemListenerBound || typeof window === 'undefined') return;
  systemListenerBound = true;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', () => {
    if (currentPreference !== 'system') return;
    const theme = resolveTheme('system');
    themeStore.set(theme);
    apply(theme);
    publish(theme);
  });
}

/** Initialize theme before first paint to avoid a flash; wires up the OS listener once. */
export function initTheme(): void {
  currentPreference = storedPreference();
  sync();
  watchSystemChanges();
}

/** Set the user preference; resolves and applies immediately. */
export function setThemePreference(next: ThemePreference): void {
  currentPreference = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // A disabled preference store must not block theming.
    }
  }
  sync();
  publish(resolveTheme(next));
}
