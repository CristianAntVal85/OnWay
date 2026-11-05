// Tema de la interfaz (UI-rediseno, D-U1, D-U5, D-U6, D-U13): lógica pura, sin React ni DOM más allá de lo que recibe.
// `public/theme-boot.js` repite la clave y los valores (es un script clásico, sin importaciones): una prueba vigila que coincidan.

/** Clave del navegador donde se guarda la preferencia (solo en este navegador, como el idioma: D-H0-21). */
export const THEME_STORAGE_KEY = 'onway.theme';

/** Lista cerrada de lo que se puede guardar. `system` es la única que sigue a `prefers-color-scheme` (D-U13). */
export const THEME_PREFERENCES = ['dark', 'light', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Temas que se pueden pintar: el valor de `data-theme` en `<html>`. */
export type ThemeName = 'dark' | 'light';

/** Sin elección guardada se ve el oscuro (D-U13). */
export const DEFAULT_PREFERENCE: ThemePreference = 'dark';

type ReadStore = Pick<Storage, 'getItem'>;
type WriteStore = Pick<Storage, 'setItem'>;

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Lo guardado, validado contra la lista cerrada antes de usarlo; cualquier otra cosa, o un almacenamiento que falla, es «sin elección». */
export function readStoredPreference(storage: ReadStore | null): ThemePreference | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
}

export function storePreference(storage: WriteStore | null, preference: ThemePreference): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Navegación privada o almacenamiento bloqueado: la elección vale solo mientras la página siga abierta.
  }
}

/** Consulta con la que el sistema anuncia el tema claro. */
export const SYSTEM_LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Lo que dice el sistema: claro solo si lo anuncia con `prefers-color-scheme: light`; sin señal o sin `matchMedia`, el oscuro por defecto. */
export function systemTheme(win: Pick<Window, 'matchMedia'> | null): ThemeName {
  try {
    if (typeof win?.matchMedia !== 'function') return 'dark';
    return win.matchMedia(SYSTEM_LIGHT_QUERY).matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** El tema que se pinta: la elección explícita, o la del sistema solo si la preferencia es `system`. */
export function resolveTheme(preference: ThemePreference, system: ThemeName): ThemeName {
  return preference === 'system' ? system : preference;
}
