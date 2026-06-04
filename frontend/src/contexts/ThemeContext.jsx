import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const THEME_KEY = 'theme_preference';
export const THEME_PREFERENCES = ['system', 'light', 'dark'];

const ThemeContext = createContext(null);
const validPreferences = new Set(THEME_PREFERENCES);

const canUseDOM = () => typeof window !== 'undefined' && typeof document !== 'undefined';

const getSystemTheme = () => {
  if (!canUseDOM()) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const resolveTheme = (preference) => (preference === 'system' ? getSystemTheme() : preference);

const getStoredThemePreference = () => {
  if (!canUseDOM()) return 'system';

  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return validPreferences.has(value) ? value : 'system';
  } catch {
    return 'system';
  }
};

export function ThemeProvider({ children }) {
  const [themePreference, setThemePreferenceState] = useState(getStoredThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(themePreference));

  useEffect(() => {
    setResolvedTheme(resolveTheme(themePreference));
  }, [themePreference]);

  useEffect(() => {
    if (!canUseDOM() || themePreference !== 'system') return undefined;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => setResolvedTheme(resolveTheme('system'));

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [themePreference]);

  useEffect(() => {
    if (!canUseDOM()) return;

    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setThemePreference = useCallback((nextPreference) => {
    if (!validPreferences.has(nextPreference)) return;

    try {
      window.localStorage.setItem(THEME_KEY, nextPreference);
    } catch {
      // localStorage may be unavailable in hardened browser contexts.
    }

    setThemePreferenceState(nextPreference);
  }, []);

  const value = useMemo(
    () => ({
      themePreference,
      resolvedTheme,
      setThemePreference,
    }),
    [themePreference, resolvedTheme, setThemePreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}
