import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@onway/contracts/client';
import { Dialog } from '../components/dialog';
import { fileFailureMessage, MAX_UPLOAD_BYTES, uploadRouteFile } from '../library/upload';
import { useApi } from '../session/api-context';
import { writeFailureMessage } from './errors';

const KINDS = ['origin', 'waypoint', 'rendezvous'] as const;

interface Props {
  missionId: string;
  onClose: () => void;
  onImported: (count: number) => void;
}

/** Importar puntos de una misión desde un GPX o KML (RF-405): se sube el archivo y se crean los puntos con nombre, con la altitud del servidor. */
export function ImportPointsDialog({ missionId, onClose, onImported }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<(typeof KINDS)[number]>('waypoint');
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async (chosen: File) => {
      const ref = await uploadRouteFile(api, chosen);
      return api.importMissionPoints({ params: { missionId }, body: { fileId: ref.id, kind } });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['missions'] });
      onImported(result.items.length);
      onClose();
    },
    onError: (error) => {
      // La misión puede haberse cerrado mientras tanto: se vuelve a leer para que la página lo refleje.
      if (error instanceof ApiError && (error.code === 'MISSION_CLOSED' || error.code === 'NOT_FOUND')) void queryClient.invalidateQueries({ queryKey: ['missions'] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (!file) return setProblem(t('missionDetail.importPoints.noFile'));
    if (file.size > MAX_UPLOAD_BYTES) return setProblem(t('missionDetail.importPoints.tooLarge'));
    run.mutate(file);
  };

  const failure = run.error;
  return (
    <Dialog title={t('missionDetail.importPoints.title')} description={t('missionDetail.importPoints.description')} onClose={() => !run.isPending && onClose()}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="import-points-kind">{t('missionDetail.importPoints.kindLabel')}</label>
          <select id="import-points-kind" value={kind} onChange={(event) => setKind(event.target.value as (typeof KINDS)[number])}>
            {KINDS.map((id) => (
              <option key={id} value={id}>
                {t(`missionDetail.points.kinds.${id}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="import-points-file">{t('missionDetail.importPoints.fileLabel')}</label>
          <input
            id="import-points-file"
            data-autofocus
            type="file"
            accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml"
            aria-invalid={problem !== null || undefined}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setProblem(null);
              run.reset();
            }}
          />
        </div>
        {problem && (
          <p className="field-error" role="alert">
            {problem}
          </p>
        )}
        {failure && (
          <p className="field-error" role="alert">
            {failure instanceof ApiError && failure.code === 'MISSION_CLOSED' ? writeFailureMessage(t, failure) : fileFailureMessage(t, failure) || writeFailureMessage(t, failure)}
          </p>
        )}
        {run.isPending && <p role="status">{t('missionDetail.importPoints.uploading')}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={run.isPending}>
            {run.isPending ? t('missionDetail.importPoints.working') : t('missionDetail.importPoints.submit')}
          </button>
          <button type="button" className="button button-secondary" disabled={run.isPending} onClick={onClose}>
            {t('missionDetail.importPoints.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
