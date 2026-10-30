import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../components/use-page-title';
import { useCurrentUser } from '../session/session';
import { LaterPage } from './later-page';

/** Mi perfil (rescatista). El formulario de alta llega en H5 (D-H0-19): hoy solo se avisa de que el perfil está incompleto. */
export function ProfilePage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const incomplete = user.profileStatus === 'incomplete';
  usePageTitle(incomplete ? t('profile.completeTitle') : t('nav.myProfile'));
  if (!incomplete) return <LaterPage section="nav.myProfile" />;
  return (
    <>
      <h1>{t('profile.completeTitle')}</h1>
      <p className="lead">{t('profile.completeBody')}</p>
    </>
  );
}
