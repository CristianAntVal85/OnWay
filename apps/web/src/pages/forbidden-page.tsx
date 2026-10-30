import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../components/use-page-title';
import { landingPath } from '../nav/navigation';
import { useCurrentUser } from '../session/session';

/** «Sin acceso»: el rol no puede abrir esta dirección (D-H0-20). */
export function ForbiddenPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  usePageTitle(t('forbidden.title'));
  return (
    <>
      <h1>{t('forbidden.title')}</h1>
      <p className="lead">{t('forbidden.body')}</p>
      <Link className="button button-secondary" to={landingPath(user)}>
        {t('forbidden.goHome')}
      </Link>
    </>
  );
}
