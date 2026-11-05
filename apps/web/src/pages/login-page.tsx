import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { errorKey } from '@onway/i18n';
import { AuthFrame } from '../components/auth-frame';
import { usePageTitle } from '../components/use-page-title';
import { errorMessage } from '../i18n/error-message';
import { PATHS } from '../nav/navigation';
import { useLogin, useSession } from '../session/session';

type Field = 'email' | 'password';

/** Acceso (boceto 1) con sus enlaces a crear una cuenta y a recuperar la contraseña (H5-acceso). RF-101, RF-104. */
export function LoginPage() {
  const { t } = useTranslation();
  const location = useLocation();
  usePageTitle(t('login.title'));
  const from = typeof (location.state as { from?: unknown } | null)?.from === 'string' ? (location.state as { from: string }).from : null;
  return (
    <AuthFrame from={from}>
      <LoginForm />
    </AuthFrame>
  );
}

function LoginForm() {
  const { t } = useTranslation();
  const session = useSession();
  const login = useLogin();
  const [missing, setMissing] = useState<Field | null>(null);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);

  const notice = session.data?.status === 'anonymous' ? session.data.notice : null;
  const noticeText = notice === 'SESSION_EXPIRED' ? t('session.expired') : notice ? t(errorKey(notice)) : null;
  // Mensaje genérico en credenciales erróneas: el texto por `code` es el mismo exista o no la cuenta (RF-101).
  const failure = login.isError ? errorMessage(t, login.error) : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (login.isPending) return;
    const emailValue = email.current?.value.trim() ?? '';
    const passwordValue = password.current?.value ?? '';
    if (!emailValue) {
      setMissing('email');
      email.current?.focus();
      return;
    }
    if (!passwordValue) {
      setMissing('password');
      password.current?.focus();
      return;
    }
    setMissing(null);
    login.mutate({ email: emailValue, password: passwordValue }, { onError: () => password.current?.focus() });
  };

  return (
    <>
      <h1>{t('login.title')}</h1>
      {noticeText && (
        <p className="notice" role="status">
          {noticeText}
        </p>
      )}
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="login-email">{t('login.email')}</label>
          <input
            id="login-email"
            ref={email}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={missing === 'email'}
            aria-describedby={missing === 'email' ? 'login-email-error' : undefined}
          />
          {missing === 'email' && (
            <p id="login-email-error" className="field-error">
              {t('login.emailRequired')}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="login-password">{t('login.password')}</label>
          <input
            id="login-password"
            ref={password}
            name="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={missing === 'password'}
            aria-describedby={missing === 'password' ? 'login-password-error' : failure ? 'login-error' : undefined}
          />
          {missing === 'password' && (
            <p id="login-password-error" className="field-error">
              {t('login.passwordRequired')}
            </p>
          )}
        </div>
        <div role="alert" className="form-alert">
          {failure && <p id="login-error">{failure}</p>}
        </div>
        <button type="submit" className="button button-primary button-block" aria-disabled={login.isPending}>
          {login.isPending ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
      <div className="auth-links">
        <Link className="button-link" to={PATHS.forgotPassword}>
          {t('login.forgotPassword')}
        </Link>
        <Link className="button button-secondary button-block" to={PATHS.register}>
          {t('login.createAccount')}
        </Link>
      </div>
      <p className="demo-notice">{t('login.demoNotice')}</p>
    </>
  );
}
