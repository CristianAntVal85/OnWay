import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { formatKm } from '../library/format';
import { RoadMix } from '../library/road-mix';
import { Dialog } from '../components/dialog';
import { Icon } from '../components/icon';
import { TextField } from '../components/text-field';
import { VertexList } from '../library/vertex-list';
import { Menu } from '../components/menu';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { errorMessage } from '../i18n/error-message';
import { editReducer, initialEdit, MapView, simplifyVertices, type MapMarker, type MapRoute, type Vertex } from '../map';
import { missionPath, PATHS, routePath } from '../nav/navigation';
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

  // Pintar desde una misión (`?mission=`, D-P3, doc 02 §4.3-B): del origen elegido al objetivo; al guardar, la ruta se añade a la misión.
  const missionId = editing ? null : params.get('mission');
  const mission = useQuery({
    queryKey: ['mission', missionId],
    queryFn: ({ signal }) => api.getMission({ params: { missionId: missionId! } }, { signal }),
    enabled: missionId !== null,
  });
  const origins = useMemo(() => (mission.data?.points ?? []).filter((point) => point.kind === 'origin'), [mission.data]);
  const [originId, setOriginId] = useState('');
  const selectedOrigin = origins.find((point) => point.id === originId) ?? origins[0];
  const missionClosed = mission.data !== undefined && !mission.data.actions.manageRoutes;

  const [state, dispatch] = useReducer(editReducer, undefined, () => initialEdit());
  // `null` mientras no se escribe nada: desde una misión se propone el nombre del origen y lo sigue (D-N1).
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? selectedOrigin?.name.slice(0, 160) ?? '';
  const [note, setNote] = useState('');
  const [nameMissing, setNameMissing] = useState(false);
  const [asNew, setAsNew] = useState(false);
  const [simplified, setSimplified] = useState(false);
  // Al dibujar, los puntos se unen en línea recta salvo que se pida unirlos por los caminos (H3): dibujar a mano se usa cuando el
  // camino no está en la red (D-P2). Al editar una versión, los vértices se guardan tal cual.
  const [snap, setSnap] = useState(false);
  // «Pintar ruta» (D-P1): activado, cada toque en el mapa añade un punto al final; desactivado, el mapa solo se mueve.
  const [paint, setPaint] = useState(!editing);

  // El primer punto es el origen elegido; cambiar de origen mueve ese primer punto.
  const placedOrigin = useRef<string | null>(null);
  const hasVertices = state.vertices.length > 0;
  useEffect(() => {
    if (!selectedOrigin || placedOrigin.current === selectedOrigin.id) return;
    const point: Vertex = [selectedOrigin.lon, selectedOrigin.lat];
    dispatch(placedOrigin.current === null || !hasVertices ? { type: 'reset', vertices: [point] } : { type: 'move', index: 0, point });
    placedOrigin.current = selectedOrigin.id;
  }, [selectedOrigin, hasVertices]);

  // La versión de partida entra una sola vez, simplificada si es muy larga.
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (!base.data || loaded === base.data.id) return;
    const all = base.data.geometry.coordinates.map(([lon, lat]) => [lon!, lat!] as Vertex);
    setSimplified(all.length > MAX_EDIT_VERTICES);
    dispatch({ type: 'reset', vertices: simplifyVertices(all, MAX_EDIT_VERTICES) });
    setLoaded(base.data.id);
  }, [base.data, loaded]);

  const title = editing ? t('routeEditor.editTitle', { name: route.data?.name ?? '' }) : mission.data ? t('routeEditor.mission.title', { name: mission.data.name }) : t('routeEditor.drawTitle');
  usePageTitle(title);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['routes'] });
    if (editing) await queryClient.invalidateQueries({ queryKey: ['route', routeId] });
  };
  const draw = useMutation({
    mutationFn: () =>
      api.createRoute({
        body: {
          source: 'drawn',
          name: name.trim(),
          geometry: lineOf(state.vertices),
          snapToPaths: snap,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(missionId ? { addToMission: { missionId, ...(selectedOrigin ? { originPointId: selectedOrigin.id } : {}) } } : {}),
        },
      }),
    onSuccess: async (created) => {
      await refresh();
      if (missionId) {
        await queryClient.invalidateQueries({ queryKey: ['missions'] });
        navigate(missionPath(missionId), { state: { routeDrawn: name.trim() } });
        return;
      }
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
  const markers = useMemo<MapMarker[]>(() => {
    if (!mission.data) return [];
    const list: MapMarker[] = [];
    if (selectedOrigin) list.push({ id: 'origin', kind: 'origin', lat: selectedOrigin.lat, lon: selectedOrigin.lon, label: selectedOrigin.name });
    list.push({ id: 'target', kind: 'target', lat: mission.data.target.lat, lon: mission.data.target.lon, label: t('routeEditor.mission.target') });
    return list;
  }, [mission.data, selectedOrigin, t]);
  const total = state.vertices.length;
  const enough = total >= 2;
  const tooManyToSnap = snapping && total > MAX_SNAP_POINTS;
  const pending = draw.isPending || saveVersion.isPending || derive.isPending;
  const failure = draw.error ?? saveVersion.error ?? derive.error;

  if (missionId && mission.isPending) return <LoadingState />;
  if (missionId && mission.isError) return <ErrorState error={mission.error} onRetry={() => void mission.refetch()} />;
  if (editing && (route.isPending || (Boolean(baseId) && base.isPending))) return <LoadingState />;
  if (editing && (route.isError || base.isError)) return <ErrorState error={route.error ?? base.error} onRetry={() => void (route.isError ? route.refetch() : base.refetch())} />;
  // Una ruta archivada no se edita y una misión cerrada no admite rutas nuevas (INV-11): solo se mira.
  const archived = (editing && route.data?.status === 'archived') || missionClosed;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!enough || tooManyToSnap) return;
    if (!editing) {
      if (!name.trim()) return setNameMissing(true);
      if (missionId && !selectedOrigin) return;
      draw.mutate();
      return;
    }
    saveVersion.mutate();
  };

  return (
    <>
      <p>
        <Link to={editing ? routePath(routeId) : missionId ? missionPath(missionId) : PATHS.routes}>{missionId ? t('routeEditor.mission.back') : t('routeDetail.back')}</Link>
      </p>
      <div className="page-heading">
        <h1>{title}</h1>
      </div>
      {missionClosed && (
        <p className="notice" role="status">
          {t('routeEditor.mission.closed', { name: mission.data!.name })}
        </p>
      )}
      {missionId && !missionClosed && origins.length === 0 && (
        <p className="notice" role="status">
          {t('routeEditor.mission.noOrigin')} <Link to={missionPath(missionId)}>{t('routeEditor.mission.back')}</Link>
        </p>
      )}
      {editing && archived && (
        <p className="notice" role="status">
          {t('routeDetail.archivedNotice')}
        </p>
      )}
      <div className="editor-layout page-wide">
        <div className="route-map">
          {!archived && <PaintToggle pressed={paint} onToggle={() => setPaint((value) => !value)} />}
          <MapView
            className="editor-map-view"
            label={t('routeEditor.mapLabel')}
            routes={mapLine}
            markers={markers}
            fitToMarkers={markers.length > 0}
            fitRoutesKey={editing ? (loaded ?? undefined) : undefined}
            onPick={archived || !paint ? undefined : (point) => dispatch({ type: 'append', point: [Number(point.lon.toFixed(7)), Number(point.lat.toFixed(7))] })}
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
          {simplified && <p className="notice">{t('routeEditor.simplifiedNote', { max: MAX_EDIT_VERTICES })}</p>}

          {!editing && (
            <TextField
              id="editor-name"
              label={t('routeEditor.nameLabel')}
              type="text"
              maxLength={160}
              required
              value={name}
              error={nameMissing ? t('routeEditor.nameRequired') : null}
              onChange={(event) => {
                setTypedName(event.target.value);
                setNameMissing(false);
              }}
            />
          )}
          {missionId && origins.length > 1 && (
            <div className="field">
              <label htmlFor="editor-origin">{t('routeEditor.mission.origin')}</label>
              <select id="editor-origin" value={selectedOrigin?.id ?? ''} onChange={(event) => setOriginId(event.target.value)}>
                {origins.map((point) => (
                  <option key={point.id} value={point.id}>
                    {point.name}
                  </option>
                ))}
              </select>
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
            {mission.data && !archived && (
              <button type="button" className="button button-secondary" onClick={() => dispatch({ type: 'append', point: [mission.data.target.lon, mission.data.target.lat] })}>
                <Icon name="flag" />
                <span>{t('routeEditor.mission.toTarget')}</span>
              </button>
            )}
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

          <VertexList vertices={state.vertices} selected={state.selected} dispatch={dispatch} />

          {!enough && <p className="form-note">{t('routeEditor.needTwo')}</p>}
          {failure && (
            <p className="field-error" role="alert">
              {errorMessage(t, failure)}
            </p>
          )}
          {!archived && (
            <div className="editor-toolbar editor-save">
              <button type="submit" className="button button-primary" disabled={!enough || pending || (missionId !== null && !selectedOrigin)}>
                {pending ? t('routeEditor.saving') : editing ? t('routeEditor.saveVersion') : t('routeEditor.save')}
              </button>
              {editing && (
                <Menu
                  label={t('routeEditor.saveOptions')}
                  icon="chevron-down"
                  iconOnly
                  align="end"
                  disabled={!enough || pending}
                  items={[{ id: 'as-new', label: t('routeEditor.saveAsNew'), icon: 'copy', onSelect: () => setAsNew(true) }]}
                />
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

/** El interruptor «Pintar ruta» (D-P1), encima del mapa para que se vea sin desplazarse también a 375 px. */
export function PaintToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="editor-map-toolbar">
      <button type="button" className="button button-secondary paint-toggle" aria-pressed={pressed} onClick={onToggle}>
        <Icon name="pencil" />
        <span>{t('routeEditor.paint')}</span>
      </button>
    </div>
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
