import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@onway/contracts/client';
import { ChangePasswordRequest } from '@onway/contracts';
import { fieldErrorText } from '../access/field-error';
import { displayNameProblem, passwordConfirmProblem, passwordProblem, type FieldProblem } from '../access/validation';
import { SectionCard } from '../components/section-card';
import { TextField } from '../components/text-field';
import { errorMessage } from '../i18n/error-message';
import { useChangePassword, useUpdateMe } from './session';

/** Nombre visible de la cuenta (`updateMe`): el que se ve en la cabecera y en las listas del personal. */
export function DisplayNameForm({ current }: { current: string }) {
  const { t } = useTranslation();
  const update = useUpdateMe();
  const [value, setValue] = useState(current);
  const [problem, setProblem] = useState<FieldProblem | null>(null);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending) return;
    const found = displayNameProblem(value);
    setProblem(found);
    setSaved(false);
    if (found) {
      input.current?.focus();
      return;
    }
    if (value.trim() === current) {
      setSaved(true);
      return;
    }
    update.mutate({ displayName: value.trim() }, { onSuccess: () => setSaved(true) });
  };

  return (
    <form className="account-form" onSubmit={onSubmit} noValidate>
      <TextField
        id="account-display-name"
        name="displayName"
        type="text"
        label={t('account.displayName')}
        inputRef={input}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        error={problem ? fieldErrorText(t, 'displayName', problem) : null}
        autoComplete="nickname"
        aria-required="true"
      />
      <div role="alert" className="form-alert">
        {update.isError && <p>{errorMessage(t, update.error)}</p>}
      </div>
      <div role="status" className="notice-slot">
        {saved && <p className="notice">{t('account.nameSaved')}</p>}
      </div>
      <div className="form-actions">
        <button type="submit" className="button button-secondary" aria-disabled={update.isPending}>
          {t('account.saveName')}
        </button>
      </div>
    </form>
  );
}

type PasswordField = 'current' | 'next' | 'confirm';
type PasswordProblem = { field: PasswordField; text: string };

/**
 * Cambiar la contraseña (D-P5): actual, nueva y repetida, con las reglas del contrato (`ChangePasswordRequest`). Una contraseña actual
 * errónea cuenta como intento fallido en el servidor; al acertar, las demás sesiones se cierran y se dice.
 */
export function ChangePasswordForm() {
  const { t } = useTranslation();
  const change = useChangePassword();
  const [values, setValues] = useState<Record<PasswordField, string>>({ current: '', next: '', confirm: '' });
  const [problems, setProblems] = useState<PasswordProblem[]>([]);
  const [done, setDone] = useState(false);
  const refs = useRef<Partial<Record<PasswordField, HTMLInputElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);

  const local = (): PasswordProblem[] => {
    const out: PasswordProblem[] = [];
    if (!values.current) out.push({ field: 'current', text: t('account.password.currentRequired') });
    const next = passwordProblem(values.next);
    if (next) out.push({ field: 'next', text: fieldErrorText(t, 'password', next) });
    else if (values.current && !ChangePasswordRequest.safeParse({ currentPassword: values.current, newPassword: values.next }).success)
      out.push({ field: 'next', text: t('account.password.sameAsCurrent') });
    const confirm = passwordConfirmProblem(values.next, values.confirm);
    if (confirm) out.push({ field: 'confirm', text: fieldErrorText(t, 'passwordConfirm', confirm) });
    return out;
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (change.isPending) return;
    const found = local();
    setProblems(found);
    setDone(false);
    if (found.length > 0) {
      refs.current[found[0]!.field]?.focus();
      return;
    }
    change.mutate(
      { currentPassword: values.current, newPassword: values.next },
      {
        onSuccess: () => {
          setValues({ current: '', next: '', confirm: '' });
          setDone(true);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
            setProblems([{ field: 'current', text: t('account.password.wrongCurrent') }]);
            refs.current.current?.focus();
            return;
          }
          alert.current?.focus();
        },
      },
    );
  };

  const errorOf = (field: PasswordField) => problems.find((p) => p.field === field)?.text ?? null;
  const field = (name: PasswordField, autoComplete: string) => (
    <TextField
      id={`account-password-${name}`}
      name={name}
      type="password"
      label={t(`account.password.${name}`)}
      inputRef={(element) => {
        refs.current[name] = element;
      }}
      value={values[name]}
      onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
      error={errorOf(name)}
      autoComplete={autoComplete}
      aria-required="true"
    />
  );
  const unexpected = change.isError && !(change.error instanceof ApiError && change.error.code === 'INVALID_CREDENTIALS');

  return (
    <SectionCard title={t('account.password.title')} icon="shield">
      <form className="account-form" onSubmit={onSubmit} noValidate>
        {field('current', 'current-password')}
        {field('next', 'new-password')}
        {field('confirm', 'new-password')}
        <div role="alert" className="form-alert" ref={alert} tabIndex={-1}>
          {unexpected && <p>{errorMessage(t, change.error)}</p>}
        </div>
        <div role="status" className="notice-slot">
          {done && <p className="notice">{t('account.password.done')}</p>}
        </div>
        <div className="form-actions">
          <button type="submit" className="button button-primary" aria-disabled={change.isPending}>
            {change.isPending ? t('account.password.saving') : t('account.password.submit')}
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
