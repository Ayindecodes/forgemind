export const THEME_STORAGE_KEY = 'forgemind-theme';

export const themePreferences = ['system', 'dark', 'light'] as const;
export type ThemePreference = (typeof themePreferences)[number];

const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';

/**
 * Runs during HTML parsing, before first paint, so a saved theme never flashes.
 * It has to stay self-contained and must agree with readThemePreference and
 * resolveTheme below.
 */
export const themeScript = `(function(){var p;try{p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}var t=p==="dark"||p==="light"?p:matchMedia(${JSON.stringify(LIGHT_SCHEME_QUERY)}).matches?"light":"dark";document.documentElement.setAttribute("data-theme",t)})()`;

const listeners = new Set<() => void>();

// Keeps the choice working for this visit when storage is unavailable.
let unsavedPreference: ThemePreference | undefined;

function isThemePreference(value: unknown): value is ThemePreference {
  return themePreferences.some((preference) => preference === value);
}

export function readThemePreference(): ThemePreference {
  if (unsavedPreference) return unsavedPreference;

  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function resolveTheme(preference: ThemePreference) {
  if (preference !== 'system') return preference;

  return matchMedia(LIGHT_SCHEME_QUERY).matches ? 'light' : 'dark';
}

export function applyTheme() {
  document.documentElement.setAttribute(
    'data-theme',
    resolveTheme(readThemePreference()),
  );
  listeners.forEach((listener) => listener());
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
    unsavedPreference = undefined;
  } catch {
    unsavedPreference = preference;
  }

  applyTheme();
}

export function subscribeToTheme(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Follows OS theme changes and choices made in other tabs. */
export function watchThemeChanges() {
  const scheme = matchMedia(LIGHT_SCHEME_QUERY);
  const onStorage = ({ key }: StorageEvent) => {
    if (key === THEME_STORAGE_KEY) applyTheme();
  };

  scheme.addEventListener('change', applyTheme);
  window.addEventListener('storage', onStorage);

  return () => {
    scheme.removeEventListener('change', applyTheme);
    window.removeEventListener('storage', onStorage);
  };
}
