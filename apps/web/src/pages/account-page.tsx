import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../components/language-switch';
import { ErrorState } from '../components/states';
import { ThemeSwitch } from '../components/theme-switch';
import { usePageTitle } from '../components/use-page-title';
import { ROLE_LABEL_KEYS } from '../nav/navigation';
import { ChangePasswordForm, DisplayNameForm } from '../session/account-forms';
import { useCurrentUser, useLogout, useUpdateMe } from '../session/session';

/**
 * Cuenta: quién soy, nombre visible, idioma (en la cuenta y en este navegador, D-P6), tema (solo en este navegador, D-U6), cambiar la
 * contraseña (D-P5) y cerrar sesión.
 */
export function AccountPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const logout = useLogout();
  const saveLocale = useUpdateMe();
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
      <DisplayNameForm current={user.displayName} />
      <LanguageSwitch onChange={(locale) => saveLocale.mutate({ locale })} />
      <div role="status" className="notice-slot">
        {saveLocale.isError && <p className="notice">{t('account.languageNotSaved')}</p>}
      </div>
      <ThemeSwitch />
      <ChangePasswordForm />
      {logout.isError && <ErrorState error={logout.error} />}
      <button type="button" className="button button-primary" aria-disabled={logout.isPending} onClick={() => !logout.isPending && logout.mutate()}>
        {t('account.logout')}
      </button>
    </>
  );
}
