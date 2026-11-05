import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { THEME_PREFERENCES, type ThemePreference } from '../theme/theme';
import { useTheme } from '../theme/theme-context';

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
