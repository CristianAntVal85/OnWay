import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../components/use-page-title';
import { landingPath } from '../nav/navigation';
import { useCurrentUser } from '../session/session';

export function NotFoundPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  usePageTitle(t('notFound.title'));
  return (
    <>
      <h1>{t('notFound.title')}</h1>
      <p className="lead">{t('notFound.body')}</p>
      <Link className="button button-secondary" to={landingPath(user)}>
        {t('notFound.goHome')}
      </Link>
    </>
  );
}
