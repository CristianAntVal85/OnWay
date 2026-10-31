import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import type { ElevationLookup } from '../map';
import { useApi } from '../session/api-context';
import { missionChangedMeanwhile, writeFailureMessage } from './errors';
import type { PickedPoint, PointKind } from './point';
import { PointInput } from './point-input';

type MissionPoint = OperationOutput<'getMission'>['points'][number];

const NAME_MAX = 120;
const NOTE_MAX = 1000;

interface Props {
  missionId: string;
  kind: PointKind;
  /** Con punto, se edita; sin él, se añade uno nuevo del tipo `kind`. */
  point?: MissionPoint;
  /** Ubicación en curso: la guarda la página para pintarla en el mapa y recibir los clics. */
  draft: PickedPoint | null;
  onDraft: (value: PickedPoint | null) => void;
  picking: boolean;
  onPicking: (on: boolean) => void;
  organizationCountry?: string | undefined;
  elevationLookup: ElevationLookup;
  onDone: (result: { action: 'added' | 'updated'; name: string }) => void;
  onCancel: () => void;
}

/** Alta y edición de un origen, punto intermedio o de reunión (RF-402, RF-403, RF-404). La altitud la calcula el servidor. */
export function PointForm({ missionId, kind, point, draft, onDraft, picking, onPicking, organizationCountry, elevationLookup, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const uid = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(point?.name ?? '');
  const [note, setNote] = useState(point?.note ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [unchanged, setUnchanged] = useState(false);

  useEffect(() => nameField.current?.focus(), []);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= NAME_MAX;

  const save = useMutation({
    mutationFn: async (location: PickedPoint) => {
      if (!point) {
        await api.createMissionPoint({ params: { missionId }, body: { kind, name: trimmedName, ...(note.trim() ? { note: note.trim() } : {}), lat: location.lat, lon: location.lon } });
        return 'added' as const;
      }
      const moved = location.lat !== point.lat || location.lon !== point.lon;
      const body = {
        ...(trimmedName !== point.name ? { name: trimmedName } : {}),
        ...(note.trim() !== (point.note ?? '') ? { note: note.trim() } : {}),
        ...(moved ? { lat: location.lat, lon: location.lon } : {}),
      };
      if (Object.keys(body).length === 0) return 'unchanged' as const;
      await api.updateMissionPoint({ params: { missionId, pointId: point.id }, body });
      return 'updated' as const;
    },
    onSuccess: async (action) => {
      if (action === 'unchanged') {
        setUnchanged(true);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['missions'] });
      onDone({ action, name: trimmedName });
    },
    onError: (error) => {
      if (missionChangedMeanwhile(error)) void queryClient.invalidateQueries({ queryKey: ['missions'] });
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (save.isPending) return;
    setUnchanged(false);
    if (!nameValid || !draft) {
      setShowErrors(true);
      const first = !nameValid ? nameField.current : form.current?.querySelector<HTMLElement>('[data-missing="true"] input, [data-missing="true"] button');
      first?.focus();
      return;
    }
    save.mutate(draft);
  };

  const title = point ? t('missionDetail.points.editTitle', { name: point.name }) : t(`missionDetail.points.addTitle.${kind}`);
  const nameError = showErrors && !nameValid ? t('missionDetail.points.nameRequired') : null;
  const field = (suffix: string) => `${uid}-${suffix}`;

  return (
    <form ref={form} className="point-form" onSubmit={onSubmit} noValidate>
      <fieldset className="point-group" data-kind={kind}>
        <legend>{title}</legend>
        <div className="field">
          <label htmlFor={field('name')}>{t('missionDetail.points.name')}</label>
          <input
            id={field('name')}
            ref={nameField}
            type="text"
            maxLength={NAME_MAX + 40}
            autoComplete="off"
            value={name}
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? field('name-error') : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {nameError && (
            <p id={field('name-error')} className="field-error" role="alert">
              {nameError}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={field('note')}>{t('missionDetail.points.note')}</label>
          <input id={field('note')} type="text" maxLength={NOTE_MAX} autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        <div data-missing={showErrors && !draft ? 'true' : undefined}>
          <PointInput
            id={`point-${uid}`}
            value={draft}
            onChange={onDraft}
            picking={picking}
            onPicking={onPicking}
            organizationCountry={organizationCountry}
            elevationLookup={elevationLookup}
            error={showErrors && !draft ? t('missionDetail.points.locationRequired') : null}
          />
        </div>
        <div role="alert" className="form-alert">
          {save.isError && <p>{writeFailureMessage(t, save.error)}</p>}
          {unchanged && <p>{t('missionDetail.points.noChanges')}</p>}
        </div>
        <div className="form-actions">
          <button type="submit" className="button button-primary" aria-disabled={save.isPending}>
            {save.isPending ? t('missionDetail.points.saving') : t('missionDetail.points.save')}
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            {t('missionDetail.points.cancel')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
