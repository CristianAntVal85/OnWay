import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import type { NavLabelKey } from '../nav/navigation';

/** Secciones de la barra cuyo contenido llega en hitos posteriores (misiones H2, rutas H3, equipos y administración H5…). */
export function LaterPage({ section }: { section: NavLabelKey }) {
  const { t } = useTranslation();
  usePageTitle(t(section));
  return (
    <>
      <h1>{t(section)}</h1>
      <EmptyState title={t('later.title')}>{t('later.body')}</EmptyState>
    </>
  );
}
