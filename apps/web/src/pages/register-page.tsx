import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@onway/contracts/client';
import { fieldErrorText } from '../access/field-error';
import { REGISTER_FIELDS, registerProblems, serverProblems, type Problems, type RegisterField } from '../access/validation';
import { AuthFrame } from '../components/auth-frame';
import { TextField } from '../components/text-field';
import { usePageTitle } from '../components/use-page-title';
import { errorMessage } from '../i18n/error-message';
import { useLocale } from '../i18n/use-locale';
import { PATHS } from '../nav/navigation';
import { useRegister } from '../session/session';

const EMPTY: Record<RegisterField, string> = { email: '', displayName: '', password: '', passwordConfirm: '', inviteCode: '' };

/** Campos del cuerpo del servidor -> campo de la pantalla. */
const SERVER_FIELDS: Readonly<Record<string, RegisterField>> = {
  email: 'email',
  displayName: 'displayName',
  password: 'password',
  passwordConfirm: 'passwordConfirm',
  inviteCode: 'inviteCode',
};

/** Registro con código de invitación (RF-104, doc 02 §3.1). Nunca abre sesión ni concede rol (RN-25). */
export function RegisterPage() {
  return (
    <AuthFrame>
      <RegisterForm />
    </AuthFrame>
  );
}

function RegisterForm() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const register = useRegister();
  const [values, setValues] = useState(EMPTY);
  const [problems, setProblems] = useState<Problems<RegisterField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const refs = useRef<Partial<Record<RegisterField, HTMLInputElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);
  const received = useRef<HTMLHeadingElement>(null);
  const done = register.isSuccess;
  usePageTitle(done ? t('register.receivedTitle') : t('register.title'));

  // «Solicitud recibida» sustituye al formulario: el foco pasa a su título.
  useEffect(() => {
    if (done) received.current?.focus();
  }, [done]);

  const set = (field: RegisterField) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [field]: event.target.value }));
  const focusFirst = (found: Problems<RegisterField>) => refs.current[REGISTER_FIELDS.find((field) => found[field]) ?? 'email']?.focus();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (register.isPending) return;
    const found = registerProblems(values);
    setProblems(found);
    setFailure(null);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    register.mutate(
      {
        email: values.email.trim(),
        displayName: values.displayName.trim(),
        password: values.password,
        passwordConfirm: values.passwordConfirm,
        // El servidor compara el código tal cual (mayúsculas y guiones incluidos): solo se recortan los espacios de los extremos.
        inviteCode: values.inviteCode.trim(),
        locale,
      },
      {
        onError: (error) => {
          const fromServer = serverProblems(error, SERVER_FIELDS);
          setProblems(fromServer);
          if (Object.keys(fromServer).length > 0) {
            focusFirst(fromServer);
            return;
          }
          // Código inválido y correo repetido dan el mismo REGISTRATION_FAILED: un solo texto, sin decir cuál fue (doc 02 §3.1).
          setFailure(error instanceof ApiError && error.code === 'REGISTRATION_FAILED' ? t('register.failed') : errorMessage(t, error));
          alert.current?.focus();
        },
      },
    );
  };

  if (done)
    return (
      <>
        <h1 ref={received} tabIndex={-1}>
          {t('register.receivedTitle')}
        </h1>
        <p className="lead">{t('register.receivedBody')}</p>
        <Link className="button button-primary" to={PATHS.login}>
          {t('register.toLogin')}
        </Link>
      </>
    );

  const error = (field: RegisterField) => (problems[field] ? fieldErrorText(t, field, problems[field]) : null);
  const ref = (field: RegisterField) => (element: HTMLInputElement | null) => {
    refs.current[field] = element;
  };

  return (
    <>
      <h1>{t('register.title')}</h1>
      <p>{t('register.intro')}</p>
      <form onSubmit={onSubmit} noValidate>
        <TextField
          id="register-email"
          name="email"
          type="email"
          label={t('register.email')}
          inputRef={ref('email')}
          value={values.email}
          onChange={set('email')}
          error={error('email')}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-required="true"
        />
        <TextField
          id="register-name"
          name="displayName"
          type="text"
          label={t('register.displayName')}
          inputRef={ref('displayName')}
          value={values.displayName}
          onChange={set('displayName')}
          error={error('displayName')}
          autoComplete="name"
          aria-required="true"
        />
        <TextField
          id="register-password"
          name="password"
          type="password"
          label={t('register.password')}
          inputRef={ref('password')}
          value={values.password}
          onChange={set('password')}
          error={error('password')}
          autoComplete="new-password"
          aria-required="true"
        />
        <TextField
          id="register-password-confirm"
          name="passwordConfirm"
          type="password"
          label={t('register.passwordConfirm')}
          inputRef={ref('passwordConfirm')}
          value={values.passwordConfirm}
          onChange={set('passwordConfirm')}
          error={error('passwordConfirm')}
          autoComplete="new-password"
          aria-required="true"
        />
        <TextField
          id="register-invite"
          name="inviteCode"
          type="text"
          label={t('register.inviteCode')}
          inputRef={ref('inviteCode')}
          value={values.inviteCode}
          onChange={set('inviteCode')}
          error={error('inviteCode')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-required="true"
        />
        <div role="alert" className="form-alert" ref={alert} tabIndex={-1}>
          {failure && <p>{failure}</p>}
        </div>
        <button type="submit" className="button button-primary button-block" aria-disabled={register.isPending}>
          {register.isPending ? t('register.submitting') : t('register.submit')}
        </button>
      </form>
      <div className="auth-links">
        <Link className="button-link" to={PATHS.login}>
          {t('register.haveAccount')}
        </Link>
      </div>
    </>
  );
}
