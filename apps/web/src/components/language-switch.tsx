import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@onway/i18n';
import { useLocale } from '../i18n/use-locale';

/** Selector de idioma con radios nativos: se maneja con las flechas y se anuncia como grupo. */
export function LanguageSwitch() {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();
  const name = useId();
  const label = (code: Locale) => (code === 'es' ? t('account.languageEs') : t('account.languageFr'));
  return (
    <fieldset className="language-switch">
      <legend>{t('account.language')}</legend>
      <div className="segmented">
        {LOCALES.map((code) => (
          <label key={code} className="segment">
            <input type="radio" name={name} value={code} checked={locale === code} onChange={() => setLocale(code)} lang={code} />
            <span lang={code}>{label(code)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
