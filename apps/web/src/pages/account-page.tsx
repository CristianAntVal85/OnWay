import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../components/language-switch';
import { ErrorState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { ROLE_LABEL_KEYS } from '../nav/navigation';
import { useCurrentUser, useLogout } from '../session/session';

/** Cuenta: quién soy, idioma (solo en este navegador, D-H0-21) y cerrar sesión. */
export function AccountPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const logout = useLogout();
  usePageTitle(t('account.title'));
  return (
    <>
      <h1>{t('account.title')}</h1>
      <p className="lead">{t('account.signedInAs', { name: user.displayName })}</p>
      <dl className="facts panel">
        <div>
          <dt>{t('account.email')}</dt>
          <dd>{user.email}</dd>
        </div>
        {user.role && (
          <div>
            <dt>{t('account.role')}</dt>
            <dd>{t(ROLE_LABEL_KEYS[user.role])}</dd>
          </div>
        )}
        {user.organization && (
          <div>
            <dt>{t('account.organization')}</dt>
            <dd>{user.organization.name}</dd>
          </div>
        )}
      </dl>
      <LanguageSwitch />
      {logout.isError && <ErrorState error={logout.error} />}
      <button type="button" className="button button-primary" aria-disabled={logout.isPending} onClick={() => !logout.isPending && logout.mutate()}>
        {t('account.logout')}
      </button>
    </>
  );
}
