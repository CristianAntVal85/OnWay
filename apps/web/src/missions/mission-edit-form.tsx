import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, type OperationInput, type OperationOutput } from '@onway/contracts/client';
import { ErrorState, LoadingState } from '../components/states';
import type { ElevationLookup } from '../map';
import { useApi } from '../session/api-context';
import { writeFailureMessage } from './errors';
import { toTarget, type PickedPoint } from './point';
import { PointInput } from './point-input';

type Mission = OperationOutput<'getMission'>;
type Patch = OperationInput<'updateMission'>['body'];

const NAME_MIN = 3;
const NAME_MAX = 120;

interface Props {
  mission: Mission;
  /** Ubicación del objetivo en curso: la guarda la página para pintarla en el mapa y recibir los clics. */
  draft: PickedPoint | null;
  onDraft: (value: PickedPoint | null) => void;
  picking: boolean;
  onPicking: (on: boolean) => void;
  organizationCountry?: string | undefined;
  elevationLookup: ElevationLookup;
  onDone: () => void;
  onCancel: () => void;
  /** Vuelve a leer la misión (tras `STALE_RESOURCE`). */
  onReload: () => void;
}

/** Editar datos de la misión (RF-205): nombre, responsable, descripción y objetivo. Solo viaja lo que cambió, con `expectedUpdatedAt` (Q-10). */
export function MissionEditForm({ mission, draft, onDraft, picking, onPicking, organizationCountry, elevationLookup, onDone, onCancel, onReload }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const uid = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(mission.name);
  const [coordinatorId, setCoordinatorId] = useState(mission.coordinator?.id ?? '');
  const [description, setDescription] = useState(mission.description ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [unchanged, setUnchanged] = useState(false);

  useEffect(() => nameField.current?.focus(), []);

  const coordinators = useQuery({ queryKey: ['coordinators'], queryFn: ({ signal }) => api.listCoordinators({ signal }) });
  const options = coordinators.data?.items ?? [];
  // El responsable actual puede no estar entre los activos (p. ej. desactivado): se conserva su opción.
  const current = mission.coordinator;
  const withCurrent = current && !options.some((person) => person.id === current.id) ? [current, ...options] : options;

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= NAME_MIN && trimmedName.length <= NAME_MAX;

  const save = useMutation({
    mutationFn: async (patch: Patch) => api.updateMission({ params: { missionId: mission.id }, body: patch }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['missions'] });
      onDone();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'MISSION_CLOSED') void queryClient.invalidateQueries({ queryKey: ['missions'] });
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (save.isPending) return;
    setUnchanged(false);
    if (!nameValid || !draft || coordinatorId === '') {
      setShowErrors(true);
      const first = !nameValid ? nameField.current : form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-missing="true"] input, [data-missing="true"] button');
      first?.focus();
      return;
    }
    const moved = draft.lat !== mission.target.lat || draft.lon !== mission.target.lon;
    const patch: Patch = {
      ...(trimmedName !== mission.name ? { name: trimmedName } : {}),
      ...(coordinatorId !== (mission.coordinator?.id ?? '') ? { coordinatorId } : {}),
      ...(description.trim() !== (mission.description ?? '') ? { description: description.trim() || null } : {}),
      ...(moved ? { target: toTarget(draft) } : {}),
    };
    if (Object.keys(patch).length === 0) {
      setUnchanged(true);
      return;
    }
    save.mutate({ ...patch, expectedUpdatedAt: mission.updatedAt });
  };

  const failure = save.error;
  const duplicateName = failure instanceof ApiError && failure.code === 'DUPLICATE_NAME';
  const stale = failure instanceof ApiError && failure.code === 'STALE_RESOURCE';
  const alertText = !failure || duplicateName ? null : writeFailureMessage(t, failure);
  const nameError = duplicateName ? t('createMission.duplicateName') : showErrors && !nameValid ? t('createMission.nameInvalid') : null;
  const field = (suffix: string) => `${uid}-${suffix}`;

  return (
    <form ref={form} className="edit-form" onSubmit={onSubmit} noValidate aria-labelledby={field('title')}>
      <h2 id={field('title')}>{t('missionDetail.edit.title')}</h2>

      <div className="field">
        <label htmlFor={field('name')}>{t('createMission.name')}</label>
        <input
          id={field('name')}
          ref={nameField}
          type="text"
          autoComplete="off"
          maxLength={NAME_MAX + 40}
          value={name}
          aria-invalid={nameError !== null}
          aria-describedby={nameError ? field('name-error') : undefined}
          onChange={(event) => {
            setName(event.target.value);
            if (duplicateName) save.reset();
          }}
        />
        {nameError && (
          <p id={field('name-error')} className="field-error" role="alert">
            {nameError}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={field('coordinator')}>{t('createMission.coordinator')}</label>
        {coordinators.isPending && <LoadingState />}
        {coordinators.isError && <ErrorState error={coordinators.error} onRetry={() => void coordinators.refetch()} />}
        {coordinators.isSuccess && (
          <select id={field('coordinator')} value={coordinatorId} aria-invalid={showErrors && coordinatorId === ''} onChange={(event) => setCoordinatorId(event.target.value)}>
            <option value="" disabled>
              {t('createMission.coordinator')}
            </option>
            {withCurrent.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="field">
        <label htmlFor={field('description')}>{t('createMission.description')}</label>
        <textarea id={field('description')} rows={3} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} />
      </div>

      <fieldset className="point-group" data-missing={showErrors && !draft ? 'true' : undefined}>
        <legend>{t('createMission.objective')}</legend>
        <PointInput
          id={`target-${uid}`}
          value={draft}
          onChange={onDraft}
          picking={picking}
          onPicking={onPicking}
          organizationCountry={organizationCountry}
          elevationLookup={elevationLookup}
          error={showErrors && !draft ? t('createMission.objectiveRequired') : null}
        />
      </fieldset>

      <div role="alert" className="form-alert">
        {alertText && <p>{alertText}</p>}
        {unchanged && <p>{t('missionDetail.edit.noChanges')}</p>}
      </div>
      {stale && (
        <button type="button" className="button button-secondary" onClick={onReload}>
          {t('missionDetail.edit.reload')}
        </button>
      )}
      <div className="form-actions">
        <button type="submit" className="button button-primary" aria-disabled={save.isPending}>
          {save.isPending ? t('missionDetail.edit.saving') : t('missionDetail.edit.save')}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          {t('missionDetail.edit.cancel')}
        </button>
      </div>
    </form>
  );
}
