import { useTranslation } from 'react-i18next';

/** Marco del mapa mientras se descarga su código. */
export function LoadingStatus({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={['map-view', 'map-view-loading', className].filter(Boolean).join(' ')} role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{t('map.loading')}</p>
    </div>
  );
}
