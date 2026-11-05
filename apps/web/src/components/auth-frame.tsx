import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Blaze } from './blaze';
import { LanguageSwitch } from './language-switch';
import { LoadingState } from './states';
import { MAIN_ID } from './skip-link';
import { postLoginPath } from '../nav/navigation';
import { useSession } from '../session/session';

/**
 * Marco de las vistas públicas (acceso, registro, recuperar contraseña): marca, contenido y selector de idioma.
 * Con una sesión iniciada no tiene sentido ninguna de ellas: lleva adonde corresponde, como el acceso (`from` = a dónde iba).
 */
export function AuthFrame({ from = null, children }: { from?: string | null; children: ReactNode }) {
  const { t } = useTranslation();
  const session = useSession();
  if (session.isPending)
    return (
      <main id={MAIN_ID} tabIndex={-1} className="full-page">
        <LoadingState />
      </main>
    );
  if (session.data?.status === 'authenticated') return <Navigate to={postLoginPath(session.data.user, from)} replace />;
  return (
    <div className="login">
      <header className="login-brand">
        <Blaze size="lg" />
        <div>
          <p className="wordmark">{t('app.name')}</p>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
      </header>
      <main id={MAIN_ID} tabIndex={-1} className="login-main">
        {children}
        <LanguageSwitch />
      </main>
    </div>
  );
}
