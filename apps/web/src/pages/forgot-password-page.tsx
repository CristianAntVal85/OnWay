import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { fieldErrorText } from '../access/field-error';
import { emailProblem, serverProblems, type FieldProblem } from '../access/validation';
import { AuthFrame } from '../components/auth-frame';
import { TextField } from '../components/text-field';
import { usePageTitle } from '../components/use-page-title';
import { errorMessage } from '../i18n/error-message';
import { PATHS } from '../nav/navigation';
import { useForgotPassword } from '../session/session';

/** Recuperar contraseña (Q-33): pide el correo y responde siempre lo mismo, exista o no la cuenta. */
export function ForgotPasswordPage() {
  return (
    <AuthFrame>
      <ForgotPasswordForm />
    </AuthFrame>
  );
}

function ForgotPasswordForm() {
  const { t } = useTranslation();
  const forgot = useForgotPassword();
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<FieldProblem | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const sent = useRef<HTMLHeadingElement>(null);
  const done = forgot.isSuccess;
  usePageTitle(t('recovery.forgotTitle'));

  useEffect(() => {
    if (done) sent.current?.focus();
  }, [done]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (forgot.isPending) return;
    const found = emailProblem(email);
    setProblem(found);
    setFailure(null);
    if (found) {
      field.current?.focus();
      return;
    }
    forgot.mutate(
      { email: email.trim() },
      {
        onError: (error) => {
          // Solo el formato del correo y el límite de peticiones se distinguen; nunca si la cuenta existe (D-A3).
          const fromServer = serverProblems(error, { email: 'email' });
          if (fromServer.email) {
            setProblem(fromServer.email);
            field.current?.focus();
            return;
          }
          setFailure(errorMessage(t, error));
          alert.current?.focus();
        },
      },
    );
  };

  if (done)
    return (
      <>
        <h1 ref={sent} tabIndex={-1}>
          {t('recovery.forgotTitle')}
        </h1>
        <p className="notice" role="status">
          {t('recovery.forgotSent')}
        </p>
        <Link className="button button-primary" to={PATHS.login}>
          {t('recovery.backToLogin')}
        </Link>
      </>
    );

  return (
    <>
      <h1>{t('recovery.forgotTitle')}</h1>
      <p>{t('recovery.forgotIntro')}</p>
      <form onSubmit={onSubmit} noValidate>
        <TextField
          id="forgot-email"
          name="email"
          type="email"
          label={t('recovery.email')}
          inputRef={field}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={problem ? fieldErrorText(t, 'email', problem) : null}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-required="true"
        />
        <div role="alert" className="form-alert" ref={alert} tabIndex={-1}>
          {failure && <p>{failure}</p>}
        </div>
        <button type="submit" className="button button-primary button-block" aria-disabled={forgot.isPending}>
          {forgot.isPending ? t('recovery.forgotSubmitting') : t('recovery.forgotSubmit')}
        </button>
      </form>
      <div className="auth-links">
        <Link className="button-link" to={PATHS.login}>
          {t('recovery.backToLogin')}
        </Link>
      </div>
    </>
  );
}
