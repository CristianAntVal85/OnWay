import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DEFAULT_PREFERENCE, SYSTEM_LIGHT_QUERY, readStoredPreference, resolveTheme, storePreference, systemTheme, type ThemeName, type ThemePreference } from './theme';

interface ThemeValue {
  /** Lo que eligió la persona (o el oscuro por defecto). */
  preference: ThemePreference;
  /** El tema que se está pintando. */
  resolved: ThemeName;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function subscribeToSystem(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  let query: MediaQueryList;
  try {
    query = window.matchMedia(SYSTEM_LIGHT_QUERY);
  } catch {
    return () => undefined;
  }
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const readSystem = (): ThemeName => systemTheme(typeof window === 'undefined' ? null : window);

/**
 * Tema de la interfaz. La preferencia se guarda solo en este navegador (D-U6) y se aplica en `<html data-theme>`;
 * `public/theme-boot.js` ya lo ha fijado antes del primer pintado, aquí se mantiene al día. Con «Como el sistema» sigue
 * el cambio de `prefers-color-scheme` en vivo.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setStoredPreference] = useState<ThemePreference>(() => readStoredPreference(browserStorage()) ?? DEFAULT_PREFERENCE);
  const system = useSyncExternalStore(subscribeToSystem, readSystem, () => 'dark' as const);
  const resolved = resolveTheme(preference, system);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    // `theme-color` sigue al color de la cabecera del tema: se lee del CSS, sin repetir colores aquí.
    const color = window.getComputedStyle(root).getPropertyValue('--header-bg').trim();
    if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    storePreference(browserStorage(), next);
    setStoredPreference(next);
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('ThemeProvider ausente');
  return value;
}
