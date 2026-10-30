import { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Blaze } from '../components/blaze';
import { ErrorState } from '../components/states';
import { MAIN_ID } from '../components/skip-link';
import { usePageTitle } from '../components/use-page-title';
import { landingPath } from '../nav/navigation';
import { useCurrentUser, useLogout } from '../session/session';

/** Espera de aprobación (RF-106, doc 02 §3.1): la cuenta pendiente no ve nada más y solo puede cerrar sesión (INV-25). */
export function WaitingPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const logout = useLogout();
  const { key } = useLocation();
  const main = useRef<HTMLElement>(null);
  usePageTitle(t('waiting.title'));
  // Se llega aquí tras iniciar sesión: el foco pasa al contenido (en una recarga se respeta el orden normal).
  useEffect(() => {
    if (key !== 'default') main.current?.focus();
  }, [key]);
  if (user.nextStep !== 'awaiting-approval') return <Navigate to={landingPath(user)} replace />;
  return (
    <div className="single">
      <header className="single-brand">
        <Blaze />
        <span className="brand-name">{t('app.name')}</span>
      </header>
      <main id={MAIN_ID} tabIndex={-1} ref={main} className="single-main">
        <h1>{t('waiting.title')}</h1>
        <p className="lead">{t('waiting.body')}</p>
        {logout.isError && <ErrorState error={logout.error} />}
        <button type="button" className="button button-primary" aria-disabled={logout.isPending} onClick={() => !logout.isPending && logout.mutate()}>
          {t('waiting.logout')}
        </button>
      </main>
    </div>
  );
}
