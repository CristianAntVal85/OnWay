import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { countryName } from '../i18n/country-name';
import { ROLE_LABEL_KEYS } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { useCurrentUser } from '../session/session';

/** Inicio provisional (H0): la organización de la sesión. El inicio informativo (RF-701) llega en H1. */
export function HomePage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const user = useCurrentUser();
  usePageTitle(t('home.title'));
  const org = useQuery({ queryKey: ['organization'], queryFn: ({ signal }) => api.getOrganization({ signal }) });

  return (
    <>
      <h1>{t('home.title')}</h1>
      {user.role && (
        <p className="lead">
          {t('account.signedInAs', { name: user.displayName })} ({t(ROLE_LABEL_KEYS[user.role])})
        </p>
      )}
      {org.isPending && <LoadingState />}
      {org.isError && <ErrorState error={org.error} onRetry={() => void org.refetch()} />}
      {org.data && (
        <section className="panel" aria-labelledby="org-heading">
          <h2 id="org-heading">{t('home.organization')}</h2>
          <dl className="facts">
            <div>
              <dt>{t('home.organization')}</dt>
              <dd>{org.data.name}</dd>
            </div>
            <div>
              <dt>{t('home.country')}</dt>
              <dd>{countryName(org.data.country, i18n.resolvedLanguage ?? 'es')}</dd>
            </div>
          </dl>
        </section>
      )}
    </>
  );
}
