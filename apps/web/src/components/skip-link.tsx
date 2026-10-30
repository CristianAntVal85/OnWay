import { useTranslation } from 'react-i18next';

export const MAIN_ID = 'main';

/** Primer elemento enfocable de toda página: salta la barra y va al contenido. */
export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a className="skip-link" href={`#${MAIN_ID}`}>
      {t('nav.skipToContent')}
    </a>
  );
}
