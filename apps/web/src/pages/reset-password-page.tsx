import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@onway/contracts/client';
import { fieldErrorText } from '../access/field-error';
import { newPasswordProblems, serverProblems, type Problems } from '../access/validation';
import { AuthFrame } from '../components/auth-frame';
import { TextField } from '../components/text-field';
import { usePageTitle } from '../components/use-page-title';
import { errorMessage } from '../i18n/error-message';
import { PATHS } from '../nav/navigation';
import { useResetPassword } from '../session/session';

type Field = 'password' | 'passwordConfirm';

/** El token viaja en el fragmento de la dirección (`#token=…`): el navegador no lo envía al servidor ni en `Referer`. */
function tokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? '';
}

/** Nueva contraseña con el enlace recibido por correo (Q-33). */
export function ResetPasswordPage() {
  return (
    <AuthFrame>
      <ResetPasswordForm />
    </AuthFrame>
  );
}

function ResetPasswordForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const reset = useResetPassword();
  // El token se lee una vez y se guarda aquí; la dirección se limpia justo después.
  const [token] = useState(() => tokenFromHash(hash));
  const [values, setValues] = useState({ password: '', passwordConfirm: '' });
  const [problems, setProblems] = useState<Problems<Field>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // `replace`: no se añade una entrada al historial y la que tenía el token queda sin él (history.replaceState).
  useEffect(() => {
    if (hash) navigate({ hash: '' }, { replace: true });
  }, [hash, navigate]);

  // Un enlace sin token y uno rechazado por el servidor (usado, caducado, mal formado) dan exactamente la misma pantalla.
  const invalidLink = !token || (reset.isError && reset.error instanceof ApiError && reset.error.code === 'INVALID_RESET_TOKEN');
  const done = reset.isSuccess;
  usePageTitle(invalidLink ? t('recovery.invalidLinkTitle') : done ? t('recovery.resetDoneTitle') : t('recovery.resetTitle'));

  useEffect(() => {
    if (invalidLink || done) heading.current?.focus();
  }, [invalidLink, done]);

  const set = (field: Field) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [field]: event.target.value }));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reset.isPending) return;
    const found = newPasswordProblems(values);
    setProblems(found);
    setFailure(null);
    if (found.password || found.passwordConfirm) {
      refs.current[found.password ? 'password' : 'passwordConfirm']?.focus();
      return;
    }
    reset.mutate(
      { token, newPassword: values.password },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'INVALID_RESET_TOKEN') return;
          // Contraseña débil para el servidor: el error queda en el campo y no se pierde lo escrito (una contraseña débil no gasta el token).
          const fromServer = serverProblems(error, { newPassword: 'password' });
          if (fromServer.password) {
            setProblems(fromServer);
            refs.current['password']?.focus();
            return;
          }
          setFailure(errorMessage(t, error));
          alert.current?.focus();
        },
      },
    );
  };

  if (invalidLink)
    return (
      <>
        <h1 ref={heading} tabIndex={-1}>
          {t('recovery.invalidLinkTitle')}
        </h1>
        <p className="form-alert" role="alert">
          {t('errors.INVALID_RESET_TOKEN')}
        </p>
        <Link className="button button-primary" to={PATHS.forgotPassword}>
          {t('recovery.requestAnother')}
        </Link>
        <div className="auth-links">
          <Link className="button-link" to={PATHS.login}>
            {t('recovery.backToLogin')}
          </Link>
        </div>
      </>
    );

  if (done)
    return (
      <>
        <h1 ref={heading} tabIndex={-1}>
          {t('recovery.resetDoneTitle')}
        </h1>
        <p className="lead">{t('recovery.resetDoneBody')}</p>
        <Link className="button button-primary" to={PATHS.login}>
          {t('recovery.toLogin')}
        </Link>
      </>
    );

  const error = (field: Field) => {
    const problem = problems[field];
    return problem ? fieldErrorText(t, field, problem) : null;
  };
  const ref = (field: Field) => (element: HTMLInputElement | null) => {
    refs.current[field] = element;
  };

  return (
    <>
      <h1>{t('recovery.resetTitle')}</h1>
      <p>{t('recovery.resetIntro')}</p>
      <form onSubmit={onSubmit} noValidate>
        <TextField
          id="reset-password"
          name="newPassword"
          type="password"
          label={t('recovery.newPassword')}
          inputRef={ref('password')}
          value={values.password}
          onChange={set('password')}
          error={error('password')}
          autoComplete="new-password"
          aria-required="true"
        />
        <TextField
          id="reset-password-confirm"
          name="newPasswordConfirm"
          type="password"
          label={t('recovery.newPasswordConfirm')}
          inputRef={ref('passwordConfirm')}
          value={values.passwordConfirm}
          onChange={set('passwordConfirm')}
          error={error('passwordConfirm')}
          autoComplete="new-password"
          aria-required="true"
        />
        <div role="alert" className="form-alert" ref={alert} tabIndex={-1}>
          {failure && <p>{failure}</p>}
        </div>
        <button type="submit" className="button button-primary button-block" aria-disabled={reset.isPending}>
          {reset.isPending ? t('recovery.resetSubmitting') : t('recovery.resetSubmit')}
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
