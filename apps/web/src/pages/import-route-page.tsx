import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { OperationOutput } from '@onway/contracts/client';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { fileFailureMessage, MAX_UPLOAD_BYTES, uploadRouteFile } from '../library/upload';
import { formatKm } from '../library/format';
import { MapView, type MapRoute } from '../map';
import { errorMessage } from '../i18n/error-message';
import { formatMeters } from '../missions/format';
import { missionPath, PATHS, routePath } from '../nav/navigation';
import { useApi } from '../session/api-context';

type Preview = OperationOutput<'previewRouteImport'>;

/**
 * Importar una ruta (RF-510, boceto 9): subir el archivo, ver la vista previa que calcula el servidor (altitudes y métricas
 * propias; no se guarda nada) y guardarla como borrador con un nombre. Cada error del archivo se dice con su texto y no deja nada.
 */
export function ImportRoutePage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locale = i18n.resolvedLanguage ?? 'es';
  usePageTitle(t('routeImport.title'));

  // Desde una misión (`?mission=`, doc 02 §4.3-B): la ruta se añade a ella al guardarla, con su versión 1 fijada (RF-513).
  const missionId = useSearchParams()[0].get('mission');
  const mission = useQuery({
    queryKey: ['missions', 'detail', missionId],
    queryFn: ({ signal }) => api.getMission({ params: { missionId: missionId! } }, { signal }),
    enabled: missionId !== null,
  });
  const origins = (mission.data?.points ?? []).filter((point) => point.kind === 'origin');
  const missionClosed = mission.data !== undefined && !mission.data.actions.manageRoutes;
  const [originPointId, setOriginPointId] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [nameMissing, setNameMissing] = useState(false);
  const [prepared, setPrepared] = useState<{ fileId: string; preview: Preview } | null>(null);

  const prepare = useMutation({
    mutationFn: async (chosen: File) => {
      const ref = await uploadRouteFile(api, chosen);
      return { fileId: ref.id, preview: await api.previewRouteImport({ body: { fileId: ref.id } }) };
    },
    onSuccess: (result) => {
      setPrepared(result);
      setName((current) => current || result.preview.trackName || (file?.name ?? '').replace(/\.(gpx|kml)$/i, ''));
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api.createRoute({
        body: {
          source: 'import',
          name: name.trim(),
          fileId: prepared!.fileId,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(missionId ? { addToMission: { missionId, ...(originPointId ? { originPointId } : {}) } } : {}),
        },
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['routes'] });
      if (missionId) {
        await queryClient.invalidateQueries({ queryKey: ['missions'] });
        navigate(missionPath(missionId), { state: { routeAdded: name.trim() } });
        return;
      }
      navigate(routePath(created.routeId));
    },
  });

  const line: MapRoute[] = useMemo(
    () =>
      prepared
        ? [{ id: 'preview', name: name || t('routeImport.title'), tone: 'draft', line: prepared.preview.candidate.geometry.coordinates.map(([lon, lat]) => [lon!, lat!] as [number, number]) }]
        : [],
    [prepared, name, t],
  );

  const submitFile = (event: FormEvent) => {
    event.preventDefault();
    setFileError(null);
    if (!file) return setFileError(t('routeImport.noFile'));
    if (file.size > MAX_UPLOAD_BYTES) return setFileError(t('routeImport.tooLarge'));
    prepare.mutate(file);
  };
  const submitSave = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setNameMissing(true);
    save.mutate();
  };
  const reset = () => {
    setPrepared(null);
    setFile(null);
    prepare.reset();
    save.reset();
  };
  const metrics = prepared?.preview.candidate.metrics;

  const back = missionId ? <Link to={missionPath(missionId)}>{t('routeImport.mission.back')}</Link> : <Link to={PATHS.routes}>{t('routeDetail.back')}</Link>;
  if (missionId && mission.isPending) return <LoadingState label={t('routeImport.mission.loading')} />;
  if (missionId && mission.isError) {
    return (
      <>
        <ErrorState error={mission.error} onRetry={() => void mission.refetch()} />
        <p>{back}</p>
      </>
    );
  }
  if (missionId && missionClosed) {
    return (
      <>
        <p>{back}</p>
        <div className="page-heading">
          <h1>{t('routeImport.title')}</h1>
        </div>
        <p className="notice" role="status">
          {t('routeImport.mission.closed', { name: mission.data!.name })}
        </p>
      </>
    );
  }

  return (
    <>
      <p>{back}</p>
      <div className="page-heading">
        <h1>{t('routeImport.title')}</h1>
      </div>
      <div className="editor-layout page-wide">
        <div className="route-map">
          <MapView className="editor-map-view" label={t('routeImport.mapLabel')} routes={line} fitRoutesKey={prepared?.fileId} />
        </div>
        <div className="editor-panel">
          {!prepared && (
            <form onSubmit={submitFile} noValidate>
              <div className="field">
                <label htmlFor="import-file">{t('routeImport.fileLabel')}</label>
                <input
                  id="import-file"
                  type="file"
                  accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml"
                  aria-describedby="import-file-help"
                  aria-invalid={fileError !== null || prepare.isError || undefined}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setFileError(null);
                    prepare.reset();
                  }}
                />
                <p id="import-file-help" className="field-help">
                  {t('routeImport.fileHelp')}
                </p>
                {fileError && (
                  <p className="field-error" role="alert">
                    {fileError}
                  </p>
                )}
                {prepare.isError && (
                  <p className="field-error" role="alert">
                    {fileFailureMessage(t, prepare.error)}
                  </p>
                )}
              </div>
              <button type="submit" className="button button-primary" disabled={prepare.isPending}>
                {prepare.isPending ? t('routeImport.previewing') : t('routeImport.submit')}
              </button>
              {prepare.isPending && <p role="status">{t('routeImport.uploading')}</p>}
            </form>
          )}

          {prepared && metrics && (
            <form onSubmit={submitSave} noValidate>
              <section aria-labelledby="preview-title">
                <h2 id="preview-title">{t('routeImport.previewTitle')}</h2>
                <p>{t('routeImport.previewNothingSaved')}</p>
                {prepared.preview.trackName && <p>{t('routeImport.trackName', { name: prepared.preview.trackName })}</p>}
                <dl className="facts-grid">
                  <div>
                    <dt>{t('routeDetail.metrics.distance')}</dt>
                    <dd>{t('units.km', { value: formatKm(metrics.distanceM, locale) })}</dd>
                  </div>
                  <div>
                    <dt>{t('routeDetail.metrics.ascent')}</dt>
                    <dd>{t('units.m', { value: formatMeters(metrics.ascentM, locale) })}</dd>
                  </div>
                  <div>
                    <dt>{t('routeDetail.metrics.descent')}</dt>
                    <dd>{t('units.m', { value: formatMeters(metrics.descentM, locale) })}</dd>
                  </div>
                  <div>
                    <dt>{t('routeDetail.metrics.maxElevation')}</dt>
                    <dd>{t('units.m', { value: formatMeters(metrics.maxElevationM, locale) })}</dd>
                  </div>
                </dl>
                <ul className="import-warnings">
                  {prepared.preview.warnings.map((warning) => (
                    <li key={warning}>{t(`routeImport.warnings.${warning}`)}</li>
                  ))}
                </ul>
              </section>
              <div className="field">
                <label htmlFor="import-name">{t('routeImport.nameLabel')}</label>
                <input
                  id="import-name"
                  type="text"
                  maxLength={160}
                  value={name}
                  aria-invalid={nameMissing || undefined}
                  aria-describedby={nameMissing ? 'import-name-error' : undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameMissing(false);
                  }}
                />
                {nameMissing && (
                  <p id="import-name-error" className="field-error" role="alert">
                    {t('routeImport.nameRequired')}
                  </p>
                )}
              </div>
              {missionId && mission.data && (
                <>
                  <p className="field-help">{t('routeImport.mission.notice', { name: mission.data.name })}</p>
                  <div className="field">
                    <label htmlFor="import-origin">{t('routeImport.mission.origin')}</label>
                    <select id="import-origin" value={originPointId} onChange={(event) => setOriginPointId(event.target.value)}>
                      <option value="">{t('routeImport.mission.noOrigin')}</option>
                      {origins.map((origin) => (
                        <option key={origin.id} value={origin.id}>
                          {origin.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor="import-note">{t('routeImport.noteLabel')}</label>
                <textarea id="import-note" rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
              </div>
              {save.isError && (
                <p className="field-error" role="alert">
                  {errorMessage(t, save.error)}
                </p>
              )}
              <div className="editor-toolbar">
                <button type="submit" className="button button-primary" disabled={save.isPending}>
                  {save.isPending ? t('routeImport.saving') : t('routeImport.save')}
                </button>
                <button type="button" className="button button-secondary" disabled={save.isPending} onClick={reset}>
                  {t('routeImport.changeFile')}
                </button>
                <Link className="button button-secondary" to={missionId ? missionPath(missionId) : PATHS.routes}>
                  {t('routeImport.cancel')}
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
