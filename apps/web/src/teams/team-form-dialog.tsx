import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { localityCode } from '@onway/contracts';
import { ApiError, type OperationOutput } from '@onway/contracts/client';
import { Dialog } from '../components/dialog';
import { TextField } from '../components/text-field';
import { errorMessage } from '../i18n/error-message';
import { useCreateTeam, useUpdateTeam } from './queries';

type Item = OperationOutput<'listTeams'>['items'][number];

const CODE_PATTERN = /^[A-Z0-9]{3}$/;

/** El campo en el que dice el servidor que chocan los datos (`details.field`, INV-23). */
const duplicateField = (error: unknown): 'name' | 'code' | null => {
  if (!(error instanceof ApiError) || error.code !== 'DUPLICATE_NAME') return null;
  return error.details?.['field'] === 'code' ? 'code' : 'name';
};

interface Props {
  /** Sin equipo, se crea uno; con él, se edita. */
  team?: Item;
  onClose: () => void;
}

/**
 * Crear o editar un equipo (RF-801, doc 02 §3.8): nombre, localidad y código de tres caracteres. Mientras nadie toque el código se propone el que sale de la
 * localidad (`localityCode`, D-E2). Cambiar el código de un equipo no toca los alias ya fijados (D-E6). El servidor decide si el nombre o el código chocan.
 */
export function TeamFormDialog({ team, onClose }: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const create = useCreateTeam();
  const update = useUpdateTeam(team?.id ?? '');
  const mutation = team ? update : create;
  const [name, setName] = useState(team?.name ?? '');
  const [locality, setLocality] = useState(team?.locality ?? '');
  const [code, setCode] = useState(team?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(Boolean(team));
  const [showErrors, setShowErrors] = useState(false);

  const trimmedName = name.trim();
  const trimmedLocality = locality.trim();
  const nameError = showErrors && trimmedName === '' ? t('teams.form.nameRequired') : null;
  const localityError = showErrors && trimmedLocality === '' ? t('teams.form.localityRequired') : null;
  const codeError = showErrors && !CODE_PATTERN.test(code) ? t('teams.form.codeInvalid') : null;

  const duplicate = duplicateField(mutation.error);
  const alert = mutation.isError && duplicate === null ? errorMessage(t, mutation.error) : null;

  const changeLocality = (value: string) => {
    setLocality(value);
    if (!codeTouched) setCode(value.trim() === '' ? '' : localityCode(value));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    if (trimmedName === '' || trimmedLocality === '' || !CODE_PATTERN.test(code)) {
      setShowErrors(true);
      const first = trimmedName === '' ? 'name' : trimmedLocality === '' ? 'locality' : 'code';
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    if (team) {
      const changes = {
        ...(trimmedName !== team.name ? { name: trimmedName } : {}),
        ...(trimmedLocality !== team.locality ? { locality: trimmedLocality } : {}),
        ...(code !== team.code ? { code } : {}),
      };
      if (Object.keys(changes).length === 0) return onClose();
      update.mutate(changes, { onSuccess: onClose });
    } else {
      create.mutate({ name: trimmedName, locality: trimmedLocality, code }, { onSuccess: onClose });
    }
  };

  return (
    <Dialog title={team ? t('teams.form.editTitle', { name: team.name }) : t('teams.form.createTitle')} onClose={() => !mutation.isPending && onClose()}>
      <form noValidate onSubmit={submit}>
        <TextField
          id={`${uid}-name`}
          label={t('teams.form.name')}
          required
          maxLength={120}
          autoComplete="off"
          data-autofocus=""
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={nameError ?? (duplicate === 'name' ? t('teams.form.duplicateName') : null)}
        />
        <TextField
          id={`${uid}-locality`}
          label={t('teams.form.locality')}
          required
          maxLength={120}
          autoComplete="off"
          value={locality}
          onChange={(event) => changeLocality(event.target.value)}
          error={localityError}
        />
        <TextField
          id={`${uid}-code`}
          label={t('teams.form.code')}
          required
          maxLength={3}
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(event) => {
            setCodeTouched(true);
            setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
          }}
          error={codeError ?? (duplicate === 'code' ? t('teams.form.duplicateCode') : null)}
        />
        {alert && (
          <p className="field-error" role="alert">
            {alert}
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={mutation.isPending}>
            {mutation.isPending ? t('teams.form.saving') : team ? t('teams.form.saveEdit') : t('teams.form.saveCreate')}
          </button>
          <button type="button" className="button button-secondary" disabled={mutation.isPending} onClick={onClose}>
            {t('teams.form.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
