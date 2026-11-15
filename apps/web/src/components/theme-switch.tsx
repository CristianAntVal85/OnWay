import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { THEME_PREFERENCES, type ThemePreference } from '../theme/theme';
import { useTheme } from '../theme/theme-context';
import { Icon } from './icon';

const LABEL_KEYS = {
  dark: 'account.themeDark',
  light: 'account.themeLight',
  system: 'account.themeSystem',
} as const satisfies Record<ThemePreference, string>;

/** Selector de tema con radios nativos (como el de idioma): se maneja con las flechas y se anuncia como grupo con la opción marcada. */
export function ThemeSwitch() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();
  const name = useId();
  return (
    <fieldset className="theme-switch">
      <legend>{t('account.theme')}</legend>
      <div className="segmented">
        {THEME_PREFERENCES.map((value) => (
          <label key={value} className="segment">
            <input type="radio" name={name} value={value} checked={preference === value} onChange={() => setPreference(value)} />
            <span>{t(LABEL_KEYS[value])}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Cambio rápido de tema en la cabecera (UI-simplificacion, D-S11): alterna oscuro y claro con un clic. El rótulo dice a qué tema se pasa.
 * «Como el sistema» sigue en Cuenta; si era la preferencia, el botón la sustituye por el tema contrario al que se ve.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolved, setPreference } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="header-button theme-toggle" aria-label={t(next === 'light' ? 'nav.themeToLight' : 'nav.themeToDark')} onClick={() => setPreference(next)}>
      <Icon name={resolved === 'dark' ? 'moon' : 'sun'} />
    </button>
  );
}
