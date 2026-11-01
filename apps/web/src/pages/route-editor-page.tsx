import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { formatKm } from '../library/format';
import { RoadMix } from '../library/road-mix';
import { Dialog } from '../components/dialog';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { errorMessage } from '../i18n/error-message';
import { editReducer, initialEdit, MapView, simplifyVertices, type MapRoute, type Vertex } from '../map';
import { PATHS, routePath } from '../nav/navigation';
import { useApi } from '../session/api-context';

/** Lo más que se edita a mano: una versión de miles de puntos se simplifica (el servidor vuelve a medir al guardar). */
export const MAX_EDIT_VERTICES = 150;
/** Lo más que el servidor une siguiendo los caminos de una vez (`snapRoute` y `createRoute` con `snapToPaths`). */
export const MAX_SNAP_POINTS = 50;

const lineOf = (vertices: readonly Vertex[]) => ({ type: 'LineString' as const, coordinates: vertices.map(([lon, lat]) => [lon, lat] as [number, number]) });

/**
 * Dibujar una ruta (RF-505, RF-510) y editar una versión (RF-516): vértices en el mapa, que se añaden con un toque, se arrastran,
 * se insertan tocando un tramo y se borran, con «deshacer»; también se escriben sus coordenadas en una lista, sin ratón. Solo se envían
 * los vértices: el servidor mide. Guardar una edición crea la versión siguiente; «guardar como nueva ruta» deriva una copia.
 */
export function RouteEditorPage({ mode }: { mode: 'draw' | 'edit' }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { routeId = '' } = useParams();
  const [params] = useSearchParams();
  const editing = mode === 'edit';

  const route = useQuery({ queryKey: ['route', routeId], queryFn: ({ signal }) => api.getRoute({ params: { routeId } }, { signal }), enabled: editing });
  const baseId = params.get('base') ?? route.data?.versions[0]?.id ?? '';
  const base = useQuery({
    queryKey: ['route', routeId, 'version', baseId],
    queryFn: ({ signal }) => api.getRouteVersion({ params: { routeId, versionId: baseId } }, { signal }),
    enabled: editing && Boolean(baseId),
  });

  const [state, dispatch] = useReducer(editReducer, undefined, () => initialEdit());
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [nameMissing, setNameMissing] = useState(false);
  const [asNew, setAsNew] = useState(false);
  const [simplified, setSimplified] = useState(false);
  const [coordinateError, setCoordinateError] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Al dibujar, los puntos se unen siguiendo los caminos (H3); al editar una versión, los vértices se guardan tal cual.
  const [snap, setSnap] = useState(true);

  // La versión de partida entra una sola vez, simplificada si es muy larga.
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (!base.data || loaded === base.data.id) return;
    const all = base.data.geometry.coordinates.map(([lon, lat]) => [lon!, lat!] as Vertex);
    setSimplified(all.length > MAX_EDIT_VERTICES);
    dispatch({ type: 'reset', vertices: simplifyVertices(all, MAX_EDIT_VERTICES) });
    setLoaded(base.data.id);
  }, [base.data, loaded]);

  usePageTitle(editing ? t('routeEditor.editTitle', { name: route.data?.name ?? '' }) : t('routeEditor.drawTitle'));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['routes'] });
    if (editing) await queryClient.invalidateQueries({ queryKey: ['route', routeId] });
  };
  const draw = useMutation({
    mutationFn: () => api.createRoute({ body: { source: 'drawn', name: name.trim(), geometry: lineOf(state.vertices), snapToPaths: snap, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: async (created) => {
      await refresh();
      navigate(routePath(created.routeId));
    },
  });
  const saveVersion = useMutation({
    mutationFn: () => api.createRouteVersion({ params: { routeId }, body: { baseVersionId: baseId, geometry: lineOf(state.vertices), ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: async (created) => {
      await refresh();
      navigate(`${routePath(routeId)}?v=${created.versionId}`);
    },
  });
  const derive = useMutation({
    mutationFn: (newName: string) =>
      api.deriveRoute({ params: { routeId }, body: { name: newName, fromVersionId: baseId, geometry: lineOf(state.vertices), ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: async (created) => {
      await refresh();
      navigate(routePath(created.routeId));
    },
  });

  // La vista previa de la ruta unida por los caminos: el servidor la calcula y la mide (`snapRoute`); aquí solo se enseña.
  const preview = useMutation({
    mutationFn: () => api.snapRoute({ body: { points: state.vertices.map(([lon, lat]) => ({ lat, lon })) } }),
  });
  const { reset: resetPreview } = preview;
  useEffect(() => {
    resetPreview();
  }, [state.vertices, snap, resetPreview]);
  const snapping = !editing && snap;

  const mapLine: MapRoute[] = useMemo(() => {
    const lines: MapRoute[] = state.vertices.length >= 2 ? [{ id: 'edit', name: t('routeEditor.mapLabel'), tone: 'draft', line: state.vertices }] : [];
    if (preview.data) lines.push({ id: 'snapped', name: t('routeEditor.snapPreviewMapLabel'), tone: 'compare-a', line: preview.data.geometry.coordinates.map(([lon, lat]) => [lon!, lat!] as const) });
    return lines;
  }, [preview.data, state.vertices, t]);
  const total = state.vertices.length;
  const enough = total >= 2;
  const tooManyToSnap = snapping && total > MAX_SNAP_POINTS;
  const pending = draw.isPending || saveVersion.isPending || derive.isPending;
  const failure = draw.error ?? saveVersion.error ?? derive.error;

  if (editing && (route.isPending || (Boolean(baseId) && base.isPending))) return <LoadingState />;
  if (editing && (route.isError || base.isError)) return <ErrorState error={route.error ?? base.error} onRetry={() => void (route.isError ? route.refetch() : base.refetch())} />;
  const archived = editing && route.data?.status === 'archived';

  const commit = (index: number, axis: 0 | 1, text: string) => {
    const value = Number(text.replace(',', '.'));
    const limit = axis === 0 ? 180 : 90;
    if (text.trim() === '' || !Number.isFinite(value) || Math.abs(value) > limit) {
      setCoordinateError(index);
      return;
    }
    setCoordinateError(null);
    const current = state.vertices[index]!;
    if (current[axis] === value) return;
    dispatch({ type: 'move', index, point: axis === 0 ? [value, current[1]] : [current[0], value] });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!enough || tooManyToSnap) return;
    if (!editing) {
      if (!name.trim()) return setNameMissing(true);
      draw.mutate();
      return;
    }
    saveVersion.mutate();
  };

  return (
    <>
      <p>
        <Link to={editing ? routePath(routeId) : PATHS.routes}>{t('routeDetail.back')}</Link>
      </p>
      <div className="page-heading">
        <h1>{editing ? t('routeEditor.editTitle', { name: route.data?.name ?? '' }) : t('routeEditor.drawTitle')}</h1>
      </div>
      {archived && (
        <p className="notice" role="status">
          {t('routeDetail.archivedNotice')}
        </p>
      )}
      <div className="editor-layout">
        <div className="route-map">
          <MapView
            className="editor-map-view"
            label={t('routeEditor.mapLabel')}
            routes={mapLine}
            fitRoutesKey={editing ? (loaded ?? undefined) : undefined}
            onPick={archived ? undefined : (point) => dispatch({ type: 'append', point: [Number(point.lon.toFixed(7)), Number(point.lat.toFixed(7))] })}
            editor={
              archived
                ? undefined
                : {
                    vertices: state.vertices,
                    selected: state.selected,
                    onMove: (index, point) => dispatch({ type: 'move', index, point: [Number(point.lon.toFixed(7)), Number(point.lat.toFixed(7))] }),
                    onInsert: (index, point) => dispatch({ type: 'insert', index, point: [Number(point.lon.toFixed(7)), Number(point.lat.toFixed(7))] }),
                    onSelect: (index) => dispatch({ type: 'select', index }),
                    onRemove: (index) => dispatch({ type: 'remove', index }),
                    labelFor: (index) => t('routeEditor.markerLabel', { n: index + 1, total }),
                  }
            }
          />
        </div>

        <form className="editor-panel" onSubmit={submit} noValidate>
          <p>{t('routeEditor.help')}</p>
          {simplified && <p className="notice">{t('routeEditor.simplifiedNote', { max: MAX_EDIT_VERTICES })}</p>}

          {!editing && (
            <div className="field">
              <label htmlFor="editor-name">{t('routeEditor.nameLabel')}</label>
              <input
                id="editor-name"
                type="text"
                maxLength={160}
                value={name}
                aria-invalid={nameMissing || undefined}
                aria-describedby={nameMissing ? 'editor-name-error' : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameMissing(false);
                }}
              />
              {nameMissing && (
                <p id="editor-name-error" className="field-error" role="alert">
                  {t('routeEditor.nameRequired')}
                </p>
              )}
            </div>
          )}
          <div className="field">
            <label htmlFor="editor-note">{t('routeEditor.noteLabel')}</label>
            <textarea id="editor-note" rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>

          {!editing && !archived && (
            <section aria-labelledby="snap-title" className="snap-panel">
              <h2 id="snap-title">{t('routeEditor.snapLabel')}</h2>
              <label className="check">
                <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> {t('routeEditor.snapLabel')}
              </label>
              <p className="field-help">{t('routeEditor.snapHelp', { max: MAX_SNAP_POINTS })}</p>
              {snap && (
                <>
                  <button type="button" className="button button-secondary" disabled={!enough || tooManyToSnap || preview.isPending} onClick={() => preview.mutate()}>
                    {preview.isPending ? t('routeEditor.snapComputing') : t('routeEditor.snapPreview')}
                  </button>
                  {tooManyToSnap && (
                    <p className="field-error" role="alert">
                      {t('routeEditor.snapTooMany', { max: MAX_SNAP_POINTS })}
                    </p>
                  )}
                  {preview.isError && (
                    <div role="alert" className="field-error">
                      <p>{errorMessage(t, preview.error)}</p>
                      <p>{t('routeEditor.snapFailedHint')}</p>
                    </div>
                  )}
                  {preview.data && (
                    <div role="status" className="snap-result">
                      <p>
                        {t('routeEditor.snapResult', {
                          distance: t('units.km', { value: formatKm(preview.data.metrics.distanceM, locale) }),
                          ascent: t('units.m', { value: Math.round(preview.data.metrics.ascentM) }),
                          descent: t('units.m', { value: Math.round(preview.data.metrics.descentM) }),
                        })}
                      </p>
                      <RoadMix mix={preview.data.roadMix} />
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <div className="editor-toolbar">
            <button type="button" className="button button-secondary" disabled={state.history.length === 0} onClick={() => dispatch({ type: 'undo' })}>
              {t('routeEditor.undo')}
            </button>
            <button type="button" className="button button-secondary" disabled={state.selected === null} onClick={() => state.selected !== null && dispatch({ type: 'remove', index: state.selected })}>
              {t('routeEditor.removeSelected')}
            </button>
          </div>
          <p role="status" className="selection-hint">
            {t('routeEditor.verticesCount', { count: total })} · {state.selected === null ? t('routeEditor.noneSelected') : t('routeEditor.selectedVertex', { n: state.selected + 1 })}
          </p>

          {total > 0 && (
            <section aria-labelledby="vertices-title">
              <h2 id="vertices-title">{t('routeEditor.verticesTitle')}</h2>
              <div className="vertex-scroll">
                <table className="vertex-table">
                  <tbody>
                    {state.vertices.map(([lon, lat], index) => (
                      <tr key={`${index}-${lon}-${lat}`} data-selected={state.selected === index || undefined}>
                        <th scope="row">
                          <button
                            type="button"
                            className="button-link"
                            aria-pressed={state.selected === index}
                            onClick={() => dispatch({ type: 'select', index: state.selected === index ? null : index })}
                          >
                            {index + 1}
                          </button>
                        </th>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={t('routeEditor.latLabel', { n: index + 1 })}
                            aria-invalid={coordinateError === index || undefined}
                            value={drafts[`${index}:1`] ?? String(lat)}
                            onChange={(event) => setDrafts((previous) => ({ ...previous, [`${index}:1`]: event.target.value }))}
                            onBlur={(event) => {
                              commit(index, 1, event.target.value);
                              setDrafts((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== `${index}:1`)));
                            }}
                            onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), event.currentTarget.blur())}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={t('routeEditor.lonLabel', { n: index + 1 })}
                            aria-invalid={coordinateError === index || undefined}
                            value={drafts[`${index}:0`] ?? String(lon)}
                            onChange={(event) => setDrafts((previous) => ({ ...previous, [`${index}:0`]: event.target.value }))}
                            onBlur={(event) => {
                              commit(index, 0, event.target.value);
                              setDrafts((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== `${index}:0`)));
                            }}
                            onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), event.currentTarget.blur())}
                          />
                        </td>
                        <td>
                          <button type="button" className="button button-secondary" aria-label={t('routeEditor.removeVertex', { n: index + 1 })} onClick={() => dispatch({ type: 'remove', index })}>
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {coordinateError !== null && (
                <p className="field-error" role="alert">
                  {t('routeEditor.invalidCoordinates')}
                </p>
              )}
            </section>
          )}

          {!enough && <p className="field-help">{t('routeEditor.needTwo')}</p>}
          {failure && (
            <p className="field-error" role="alert">
              {errorMessage(t, failure)}
            </p>
          )}
          {!archived && (
            <div className="editor-toolbar">
              <button type="submit" className="button button-primary" disabled={!enough || pending}>
                {pending ? t('routeEditor.saving') : editing ? t('routeEditor.saveVersion') : t('routeEditor.save')}
              </button>
              {editing && (
                <button type="button" className="button button-secondary" disabled={!enough || pending} onClick={() => setAsNew(true)}>
                  {t('routeEditor.saveAsNew')}
                </button>
              )}
            </div>
          )}
        </form>
      </div>

      {asNew && (
        <SaveAsNewDialog
          defaultName={`${route.data?.name ?? ''} (2)`}
          pending={derive.isPending}
          error={derive.error}
          onSave={(value) => derive.mutate(value)}
          onClose={() => !derive.isPending && setAsNew(false)}
        />
      )}
    </>
  );
}

function SaveAsNewDialog({ defaultName, pending, error, onSave, onClose }: { defaultName: string; pending: boolean; error: unknown; onSave: (name: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultName);
  const [missing, setMissing] = useState(false);
  return (
    <Dialog title={t('routeEditor.deriveTitle')} description={t('routeEditor.deriveDescription')} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return setMissing(true);
          onSave(name.trim());
        }}
      >
        <div className="field">
          <label htmlFor="save-as-new-name">{t('routeEditor.nameLabel')}</label>
          <input
            id="save-as-new-name"
            data-autofocus
            type="text"
            maxLength={160}
            value={name}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? 'save-as-new-error' : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setMissing(false);
            }}
          />
          {missing && (
            <p id="save-as-new-error" className="field-error" role="alert">
              {t('routeEditor.nameRequired')}
            </p>
          )}
        </div>
        {error !== null && error !== undefined && <p role="alert">{errorMessage(t, error)}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={pending}>
            {pending ? t('routeEditor.saving') : t('routeEditor.saveAsNew')}
          </button>
          <button type="button" className="button button-secondary" disabled={pending} onClick={onClose}>
            {t('routeEditor.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
