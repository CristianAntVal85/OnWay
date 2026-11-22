import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../components/text-field';
import { SectionCard } from '../components/section-card';
import { countryName } from '../i18n/country-name';
import { errorMessage } from '../i18n/error-message';
import { COUNTRIES, DOCUMENT_TYPES, PROFILE_FIELDS, changesOf, profileProblems, serverProfileProblems, type ProfileField, type ProfileProblems, type ProfileValues } from './form';
import { useUpdateMyProfile } from './queries';

interface ProfileFormProps {
  /** Lo guardado: el formulario vacío en el alta; los datos en claro al corregir. */
  initial: ProfileValues;
  /** El correo de la cuenta: se enseña, no se edita (INV-31). */
  email: string;
  onSaved: () => void;
  onCancel?: () => void;
}

/**
 * Formulario del alta y de «Corregir mis datos» (RF-807, doc 02 §3.9): datos personales, contacto y dirección, con el aviso de quién ve
 * cada cosa. Se valida en el cliente con los esquemas del contrato y el servidor decide igual; sus errores van a su campo.
 */
export function ProfileForm({ initial, email, onSaved, onCancel }: ProfileFormProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const save = useUpdateMyProfile();
  const [values, setValues] = useState<ProfileValues>(initial);
  const [problems, setProblems] = useState<ProfileProblems>({});
  const refs = useRef<Partial<Record<ProfileField, HTMLInputElement | HTMLSelectElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);

  const set = (field: ProfileField) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [field]: event.target.value }));
  const ref = (field: ProfileField) => (element: HTMLInputElement | HTMLSelectElement | null) => {
    refs.current[field] = element;
  };
  const focusFirst = (found: ProfileProblems) => refs.current[PROFILE_FIELDS.find((field) => found[field]) ?? 'fullName']?.focus();
  const error = (field: ProfileField) => (problems[field] ? t(`profile.errors.${problems[field]}`) : null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (save.isPending) return;
    const found = profileProblems(values);
    setProblems(found);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    const body = changesOf(values, initial);
    if (Object.keys(body).length === 0) {
      onSaved();
      return;
    }
    save.mutate(body, {
      onSuccess: onSaved,
      onError: (failure) => {
        const fromServer = serverProfileProblems(failure);
        setProblems(fromServer);
        if (Object.keys(fromServer).length > 0) focusFirst(fromServer);
        else alert.current?.focus();
      },
    });
  };

  const text = (field: Exclude<ProfileField, 'documentType' | 'country'>, extra: Record<string, unknown> = {}) => (
    <TextField
      id={`profile-${field}`}
      name={field}
      type="text"
      label={t(`profile.fields.${field}`)}
      inputRef={ref(field)}
      value={values[field]}
      onChange={set(field)}
      error={error(field)}
      aria-required={field === 'floor' ? undefined : 'true'}
      {...extra}
    />
  );
  const select = (field: 'documentType' | 'country', options: readonly { value: string; label: string }[]) => (
    <div className="field">
      <div className="field-label">
        <label htmlFor={`profile-${field}`}>{t(`profile.fields.${field}`)}</label>
      </div>
      <select id={`profile-${field}`} name={field} ref={ref(field)} value={values[field]} onChange={set(field)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
  const serverFailure = save.isError && Object.keys(serverProfileProblems(save.error)).length === 0;

  return (
    <form className="profile-form" onSubmit={onSubmit} noValidate>
      <p className="notice">{t('profile.whoSees')}</p>
      <SectionCard title={t('profile.blocks.personal')} icon="user" plain headingLevel={2}>
        {text('fullName', { autoComplete: 'name' })}
        {select(
          'documentType',
          DOCUMENT_TYPES.map((type) => ({ value: type, label: t(`profile.documentTypes.${type}`) })),
        )}
        {text('documentNumber', { autoComplete: 'off', autoCapitalize: 'characters', spellCheck: false })}
      </SectionCard>
      <SectionCard title={t('profile.blocks.contact')} icon="info" plain headingLevel={2}>
        {text('phone', { type: 'tel', autoComplete: 'tel', inputMode: 'tel' })}
        <TextField id="profile-email" name="email" type="email" label={t('profile.fields.email')} value={email} readOnly aria-describedby="profile-email-hint" />
        <p id="profile-email-hint" className="form-note">
          {t('profile.fields.emailHint')}
        </p>
      </SectionCard>
      <SectionCard title={t('profile.blocks.address')} icon="pin" plain headingLevel={2}>
        {text('street', { autoComplete: 'address-line1' })}
        <div className="field-row">
          {text('number', { autoComplete: 'off' })}
          {text('floor', { autoComplete: 'address-line2' })}
        </div>
        <div className="field-row">
          {text('postalCode', { autoComplete: 'postal-code' })}
          {text('locality', { autoComplete: 'address-level2' })}
        </div>
        {text('province', { autoComplete: 'address-level1' })}
        {select(
          'country',
          COUNTRIES.map((code) => ({ value: code, label: countryName(code, locale) })),
        )}
      </SectionCard>
      <div role="alert" className="form-alert" ref={alert} tabIndex={-1}>
        {serverFailure && <p>{errorMessage(t, save.error)}</p>}
      </div>
      <div className="form-actions">
        <button type="submit" className="button button-primary" aria-disabled={save.isPending}>
          {save.isPending ? t('profile.saving') : t('profile.save')}
        </button>
        {onCancel && (
          <button type="button" className="button button-secondary" onClick={onCancel}>
            {t('profile.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}
