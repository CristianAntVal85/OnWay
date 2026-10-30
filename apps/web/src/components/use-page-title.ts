import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** Título de la pestaña: «Sección · OnWay». Ayuda a orientarse con lectores de pantalla y con varias pestañas. */
export function usePageTitle(title: string) {
  const { t } = useTranslation();
  const app = t('app.name');
  useEffect(() => {
    document.title = title ? `${title} · ${app}` : app;
  }, [title, app]);
}
