import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useReducer, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Icon } from '../components/icon';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { errorMessage } from '../i18n/error-message';
import { formatKm } from '../library/format';
import { VertexList } from '../library/vertex-list';
import { alongRoute, cutAtDistance, cutAtPoint, editReducer, initialEdit, MAX_CUT_OFFSET_M, MapView, type MapMarker, type MapRoute, type Vertex } from '../map';
import { missionPath, routePath } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { PaintToggle } from './route-editor-page';

/** Lo más que se pinta a mano de una vez (`continueFrom.points`, D-P8). */
export const MAX_HAND_POINTS = 200;

const fixed = (point: { lat: number; lon: number }): Vertex => [Number(point.lon.toFixed(7)), Number(point.lat.toFixed(7))];

/**
 * Continuar a mano (RF-505, D-P4): se conserva la versión de partida desde el inicio hasta un corte y desde ahí se pintan puntos que
 * se unen en línea recta. Primero se elige el corte (tocando la ruta o con «Conservar los primeros N km»); después, con «Pintar ruta»,
 * cada toque añade un punto. Guardar crea la versión siguiente: el servidor toma la parte conservada de la versión guardada, no de
 * aquí, y mide el conjunto (regla 6). La proyección y el corte vienen de `src/map/cut.ts` (regla 9); aquí solo se enseñan.
 */
export function RouteContinuePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { routeId = '' } = useParams();
  const [params] = useSearchParams();
  const missionId = params.get('mission');

  const route = useQuery({ queryKey: ['route', routeId], queryFn: ({ signal }) => api.getRoute({ params: { routeId } }, { signal }) });
  const baseId = params.get('base') ?? route.data?.versions[0]?.id ?? '';
  const base = useQuery({
    queryKey: ['route', routeId, 'version', baseId],
    queryFn: ({ signal }) => api.getRouteVersion({ params: { routeId, versionId: baseId } }, { signal }),
    enabled: Boolean(baseId),
  });
  const mission = useQuery({
    queryKey: ['mission', missionId],
    queryFn: ({ signal }) => api.getMission({ params: { missionId: missionId! } }, { signal }),
    enabled: missionId !== null,
  });

  const line = useMemo(() => (base.data?.geometry.coordinates ?? []).map(([lon, lat]) => [lon!, lat!] as Vertex), [base.data]);
  const along = useMemo(() => alongRoute(line), [line]);
  const totalM = along.at(-1) ?? 0;

  const [cut, setCut] = useState<number | null>(null);
  const [tooFar, setTooFar] = useState(false);
  // Hasta elegir el corte, tocar el mapa elige el corte; después, «Pintar ruta» se activa y cada toque añade un punto (D-P1).
  const [paint, setPaint] = useState(false);
  const [hand, dispatch] = useReducer(editReducer, undefined, () => initialEdit());
  const [note, setNote] = useState('');
  const [kmDraft, setKmDraft] = useState<string | null>(null);

  const chooseCut = (index: number) => {
    setTooFar(false);
    setKmDraft(null);
    setCut(index);
    if (cut === null) setPaint(true);
  };
  const pickOnMap = (point: { lat: number; lon: number }) => {
    if (paint && cut !== null) return dispatch({ type: 'append', point: fixed(point) });
    const index = cutAtPoint(line, point);
    if (index === null) return setTooFar(true);
    chooseCut(index);
  };

  const save = useMutation({
    mutationFn: () => {
      const [lon, lat] = line[cut!]!;
      return api.createRouteVersion({
        params: { routeId },
        body: {
          baseVersionId: baseId,
          continueFrom: { cutPoint: { lat, lon }, points: hand.vertices.map(([pointLon, pointLat]) => ({ lat: pointLat, lon: pointLon })) },
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['routes'] });
      await queryClient.invalidateQueries({ queryKey: ['route', routeId] });
      if (missionId) {
        await queryClient.invalidateQueries({ queryKey: ['missions'] });
        navigate(missionPath(missionId), { state: { versionDraft: { name: route.data?.name ?? '', number: created.versionNumber } } });
        return;
      }
      navigate(`${routePath(routeId)}?v=${created.versionId}`);
    },
  });

  const name = route.data?.name ?? '';
  usePageTitle(t('routeContinue.title', { name }));

  const mapRoutes = useMemo<MapRoute[]>(() => {
    if (line.length < 2) return [];
    if (cut === null) return [{ id: 'base', name: t('routeContinue.baseLabel'), tone: 'compare-a', line }];
    const lines: MapRoute[] = [{ id: 'kept', name: t('routeContinue.keptLabel'), tone: 'compare-a', line: line.slice(0, cut + 1) }];
    if (cut < line.length - 1) lines.push({ id: 'dropped', name: t('routeContinue.droppedLabel'), tone: 'archived', line: line.slice(cut) });
    if (hand.vertices.length > 0) lines.push({ id: 'hand', name: t('routeContinue.handLabel'), tone: 'draft', line: [line[cut]!, ...hand.vertices] });
    return lines;
  }, [cut, hand.vertices, line, t]);
  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    if (cut !== null) list.push({ id: 'cut', kind: 'waypoint', lat: line[cut]![1], lon: line[cut]![0], label: t('routeContinue.cutLabel') });
    if (mission.data) list.push({ id: 'target', kind: 'target', lat: mission.data.target.lat, lon: mission.data.target.lon, label: t('routeEditor.mission.target') });
    return list;
  }, [cut, line, mission.data, t]);

  if (route.isPending || (Boolean(baseId) && base.isPending) || (missionId !== null && mission.isPending)) return <LoadingState />;
  if (route.isError || base.isError || mission.isError) {
    const failed = route.isError ? route : base.isError ? base : mission;
    return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
  }
  const archived = route.data.status === 'archived';
  const back = missionId ? missionPath(missionId) : routePath(routeId);
  const tooMany = hand.vertices.length > MAX_HAND_POINTS;
  const ready = cut !== null && hand.vertices.length > 0 && !tooMany;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready && !save.isPending) save.mutate();
  };
  // Con la coma o el punto del idioma, como el resto de cifras; al escribir se aceptan los dos.
  const kmValue = kmDraft ?? (cut === null ? '' : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(along[cut]! / 1000));
  const commitKm = (text: string) => {
    const km = Number(text.replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(km)) return setKmDraft(null);
    const index = cutAtDistance(line, km * 1000);
    if (index === null) return setTooFar(true);
    chooseCut(index);
  };

  return (
    <>
      <p>
        <Link to={back}>{missionId ? t('routeEditor.mission.back') : t('routeDetail.back')}</Link>
      </p>
      <div className="page-heading">
        <h1>{t('routeContinue.title', { name })}</h1>
      </div>
      {archived && (
        <p className="notice" role="status">
          {t('routeDetail.archivedNotice')}
        </p>
      )}
      <div className="editor-layout page-wide">
        <div className="route-map">
          {!archived && cut !== null && <PaintToggle pressed={paint} onToggle={() => setPaint((value) => !value)} />}
          <MapView
            className="editor-map-view"
            label={t('routeContinue.mapLabel')}
            routes={mapRoutes}
            markers={markers}
            fitRoutesKey={base.data?.id}
            {...(archived ? {} : { onPick: pickOnMap })}
            {...(archived || cut === null
              ? {}
              : {
                  editor: {
                    vertices: hand.vertices,
                    selected: hand.selected,
                    onMove: (index: number, point: { lat: number; lon: number }) => dispatch({ type: 'move', index, point: fixed(point) }),
                    onInsert: (index: number, point: { lat: number; lon: number }) => dispatch({ type: 'insert', index, point: fixed(point) }),
                    onSelect: (index: number | null) => dispatch({ type: 'select', index }),
                    onRemove: (index: number) => dispatch({ type: 'remove', index }),
                    labelFor: (index: number) => t('routeEditor.markerLabel', { n: index + 1, total: hand.vertices.length }),
                  },
                })}
          />
        </div>

        <form className="editor-panel" onSubmit={submit} noValidate>
          <section aria-labelledby="continue-cut-title">
            <h2 id="continue-cut-title">{t('routeContinue.cutTitle')}</h2>
            <div className="field">
              <label htmlFor="continue-km">{t('routeContinue.keepLabel', { total: formatKm(totalM, locale) })}</label>
              <input
                id="continue-km"
                type="text"
                inputMode="decimal"
                disabled={archived}
                value={kmValue}
                aria-invalid={tooFar || undefined}
                aria-describedby={tooFar ? 'continue-cut-error' : undefined}
                onChange={(event) => setKmDraft(event.target.value)}
                onBlur={(event) => commitKm(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), commitKm(event.currentTarget.value))}
              />
              {tooFar && (
                <p id="continue-cut-error" className="field-error" role="alert">
                  {t('routeContinue.cutTooFar', { max: MAX_CUT_OFFSET_M })}
                </p>
              )}
            </div>
            <p role="status" className="selection-hint">
              {cut === null ? t('routeContinue.noCut') : t('routeContinue.kept', { distance: t('units.km', { value: formatKm(along[cut]!, locale) }) })}
            </p>
          </section>

          {cut !== null && !archived && (
            <section aria-labelledby="continue-hand-title">
              <h2 id="continue-hand-title">{t('routeContinue.handTitle')}</h2>
              <div className="editor-toolbar">
                {mission.data && (
                  <button type="button" className="button button-secondary" onClick={() => dispatch({ type: 'append', point: [mission.data.target.lon, mission.data.target.lat] })}>
                    <Icon name="flag" />
                    <span>{t('routeEditor.mission.toTarget')}</span>
                  </button>
                )}
                <button type="button" className="button button-secondary" disabled={hand.history.length === 0} onClick={() => dispatch({ type: 'undo' })}>
                  {t('routeEditor.undo')}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={hand.selected === null}
                  onClick={() => hand.selected !== null && dispatch({ type: 'remove', index: hand.selected })}
                >
                  {t('routeEditor.removeSelected')}
                </button>
              </div>
              <p role="status" className="selection-hint">
                {t('routeContinue.handCount', { count: hand.vertices.length })}
              </p>
              <VertexList vertices={hand.vertices} selected={hand.selected} dispatch={dispatch} headingLevel={3} />
              {tooMany && (
                <p className="field-error" role="alert">
                  {t('routeContinue.tooMany', { max: MAX_HAND_POINTS })}
                </p>
              )}
            </section>
          )}

          {!archived && (
            <>
              <div className="field">
                <label htmlFor="continue-note">{t('routeEditor.noteLabel')}</label>
                <textarea id="continue-note" rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
              </div>
              {save.isError && (
                <p className="field-error" role="alert">
                  {errorMessage(t, save.error)}
                </p>
              )}
              <div className="editor-toolbar editor-save">
                <button type="submit" className="button button-primary" disabled={!ready || save.isPending}>
                  {save.isPending ? t('routeEditor.saving') : t('routeEditor.saveVersion')}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </>
  );
}
