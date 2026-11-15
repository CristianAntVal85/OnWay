import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useReducer, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { OperationOutput } from '@onway/contracts/client';
import { Icon } from '../components/icon';
import { PageHeader } from '../components/page-header';
import { SectionCard } from '../components/section-card';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { useElevationLookup } from '../hooks/use-elevation-lookup';
import { errorMessage } from '../i18n/error-message';
import { formatKm } from '../library/format';
import { RoadMix } from '../library/road-mix';
import { VertexTable } from '../library/vertex-table';
import { editReducer, initialEdit, MapView, type MapMarker, type MapRoute, type Vertex } from '../map';
import { PointInput } from '../missions/point-input';
import type { PickedPoint } from '../missions/point';
import { missionPath, PATHS, routePath } from '../nav/navigation';
import { useApi } from '../session/api-context';

type Zone = OperationOutput<'listAvoidZones'>['items'][number];
type Job = OperationOutput<'getJob'>;
type FailureCode = keyof typeof FAILURE_KEYS;

const FAILURE_KEYS = {
  NO_ROUTE_POSSIBLE: 'generate.failure.NO_ROUTE_POSSIBLE',
  OUTSIDE_COVERAGE: 'generate.failure.OUTSIDE_COVERAGE',
  ROUTING_UNAVAILABLE: 'generate.failure.ROUTING_UNAVAILABLE',
  INTERNAL: 'generate.failure.INTERNAL',
} as const;
const MAX_VIA = 10;
const POLL_MS = 1500;
const FROM = 'from';
const TO = 'to';

const roundVertex = (point: { lat: number; lon: number }): Vertex => [Number(point.lon.toFixed(7)), Number(point.lat.toFixed(7))];
const ringOf = (zone: Zone): Vertex[] => zone.geometry.coordinates[0]!.map(([lon, lat]) => [lon!, lat!] as Vertex);

/**
 * Generar rutas (RF-501, RF-507, doc 02 §3.6-A): dos puntos —o una misión, con su objetivo y uno de sus orígenes—, puntos intermedios, zonas
 * a evitar y cuántas alternativas. El cálculo se hace en segundo plano: la página lo sigue con `getJob` sin bloquearse y, al terminar, enseña
 * las alternativas con sus métricas y su composición (el servidor las mide; nada de geometría se calcula aquí). Cada una queda como un borrador.
 */
export function GenerateRoutesPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const elevationLookup = useElevationLookup();
  const [params] = useSearchParams();
  const missionId = params.get('mission');
  const locale = i18n.resolvedLanguage ?? 'es';

  const organization = useQuery({ queryKey: ['organization'], queryFn: ({ signal }) => api.getOrganization({ signal }) });
  const mission = useQuery({
    queryKey: ['mission', missionId],
    queryFn: ({ signal }) => api.getMission({ params: { missionId: missionId! } }, { signal }),
    enabled: missionId !== null,
  });
  const zones = useQuery({
    queryKey: ['avoid-zones', missionId ?? 'organization'],
    queryFn: ({ signal }) => api.listAvoidZones({ query: missionId ? { missionId } : {} }, { signal }),
  });

  // ---- El formulario ----
  const [from, setFrom] = useState<PickedPoint | null>(null);
  const [to, setTo] = useState<PickedPoint | null>(null);
  const [vias, setVias] = useState<{ key: string; point: PickedPoint | null }[]>([]);
  const [picking, setPicking] = useState<string | null>(missionId ? null : FROM);
  const [alternatives, setAlternatives] = useState(3);
  const [prefix, setPrefix] = useState('');
  const [originId, setOriginId] = useState('');
  const [chosenZones, setChosenZones] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [zoneNote, setZoneNote] = useState<string | null>(null);
  usePageTitle(t('generate.title'));

  // ---- La zona que se está dibujando ----
  const [drawing, setDrawing] = useState(false);
  const [zone, dispatchZone] = useReducer(editReducer, undefined, () => initialEdit());
  const [zoneReason, setZoneReason] = useState('');

  const origins = useMemo(() => (mission.data?.points ?? []).filter((point) => point.kind === 'origin'), [mission.data]);
  const selectedOriginId = originId || origins[0]?.id || '';
  const selectedOrigin = origins.find((point) => point.id === selectedOriginId);
  const closed = mission.data?.status === 'closed';
  const missionMode = missionId !== null;
  const noOrigin = missionMode && mission.isSuccess && origins.length === 0;

  const request = useMemo(() => {
    const target = missionMode ? mission.data?.target : to;
    const start = missionMode ? selectedOrigin : from;
    if (!target || !start) return null;
    return {
      from: { lat: start.lat, lon: start.lon },
      to: { lat: target.lat, lon: target.lon },
      via: vias.flatMap((via) => (via.point ? [{ lat: via.point.lat, lon: via.point.lon }] : [])),
      avoidZoneIds: [...chosenZones],
      alternatives,
      ...(prefix.trim() ? { namePrefix: prefix.trim() } : {}),
      ...(missionMode && selectedOriginId ? { addToMission: { missionId, originPointId: selectedOriginId } } : {}),
    };
  }, [alternatives, chosenZones, from, mission.data, missionId, missionMode, prefix, selectedOrigin, selectedOriginId, to, vias]);

  // ---- El cálculo ----
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => api.generateRoutes({ body: request! }),
    onSuccess: ({ jobId: id }) => setJobId(id),
  });
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: ({ signal }) => api.getJob({ params: { jobId: jobId! } }, { signal }),
    enabled: jobId !== null,
    refetchInterval: (query) => (query.state.data && (query.state.data.status === 'completed' || query.state.data.status === 'failed') ? false : POLL_MS),
  });
  const finished = job.data?.status === 'completed' || job.data?.status === 'failed';
  const routeIds = job.data?.status === 'completed' && job.data.kind === 'generate' ? (job.data.result?.routeIds ?? []) : [];

  const results = useQueries({
    queries: routeIds.map((routeId) => ({
      queryKey: ['generated', routeId],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const detail = await api.getRoute({ params: { routeId } }, { signal });
        const version = await api.getRouteVersion({ params: { routeId, versionId: detail.versions[0]!.id } }, { signal });
        return { detail, version };
      },
    })),
  });

  const saveZone = useMutation({
    mutationFn: () => {
      const ring = zone.vertices;
      return api.createAvoidZone({
        body: {
          ...(missionId ? { missionId } : {}),
          geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!].map(([lon, lat]) => [lon, lat] as [number, number])] },
          ...(zoneReason.trim() ? { reason: zoneReason.trim() } : {}),
        },
      });
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['avoid-zones'] });
      setChosenZones((previous) => new Set([...previous, created.id]));
      setDrawing(false);
      dispatchZone({ type: 'reset', vertices: [] });
      setZoneReason('');
      setZoneNote(t('generate.zoneSaved'));
    },
  });
  const removeZone = useMutation({
    mutationFn: (zoneId: string) => api.deleteAvoidZone({ params: { zoneId } }),
    onSuccess: async (_, zoneId) => {
      setChosenZones((previous) => new Set([...previous].filter((id) => id !== zoneId)));
      await queryClient.invalidateQueries({ queryKey: ['avoid-zones'] });
      setZoneNote(t('generate.zoneDeleted'));
    },
  });

  // ---- El mapa ----
  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    const target = missionMode ? mission.data?.target : to;
    const origin = missionMode ? selectedOrigin : from;
    if (origin) list.push({ id: 'from', kind: 'origin', lat: origin.lat, lon: origin.lon, label: t('generate.fromLabel') });
    vias.forEach((via, index) => via.point && list.push({ id: via.key, kind: 'waypoint', lat: via.point.lat, lon: via.point.lon, label: t('generate.viaLabel', { n: index + 1 }) }));
    if (target) list.push({ id: 'to', kind: 'target', lat: target.lat, lon: target.lon, label: t('generate.toLabel') });
    return list;
  }, [from, mission.data, missionMode, selectedOrigin, t, to, vias]);

  const mapRoutes = useMemo<MapRoute[]>(() => {
    const lines: MapRoute[] = (zones.data?.items ?? []).map((item) => ({ id: `zone-${item.id}`, name: item.reason ?? t('generate.zoneNoReason'), tone: 'avoid' as const, line: ringOf(item) }));
    if (zone.vertices.length >= 2)
      lines.push({ id: 'zone-draft', name: t('generate.drawing'), tone: 'avoid', line: zone.vertices.length >= 3 ? [...zone.vertices, zone.vertices[0]!] : zone.vertices });
    results.forEach((result, index) => {
      if (result.data) lines.push({ id: routeIds[index]!, name: result.data.detail.name, tone: 'draft', line: result.data.version.geometry.coordinates.map(([lon, lat]) => [lon!, lat!] as const) });
    });
    return lines;
  }, [results, routeIds, t, zone.vertices, zones.data]);
  const selectedOnMap = useMemo(() => new Set([...chosenZones].map((id) => `zone-${id}`)), [chosenZones]);

  const onPick = (point: { lat: number; lon: number }) => {
    if (drawing) return dispatchZone({ type: 'append', point: roundVertex(point) });
    const picked: PickedPoint = { lat: point.lat, lon: point.lon, source: 'map' };
    if (picking === FROM) setFrom(picked);
    else if (picking === TO) setTo(picked);
    else if (picking) setVias((previous) => previous.map((via) => (via.key === picking ? { ...via, point: picked } : via)));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (request && !closed && !noOrigin) start.mutate();
  };

  if (missionMode && mission.isPending) return <LoadingState />;
  if (missionMode && mission.isError) return <ErrorState error={mission.error} onRetry={() => void mission.refetch()} />;

  const failureCode: FailureCode | null = job.data?.status === 'failed' ? (job.data.errorCode ?? 'INTERNAL') : null;
  const running = start.isPending || (jobId !== null && !finished);
  const percent = job.data?.progress ?? 0;
  const formLocked = running || job.data?.status === 'completed';
  const missing = (value: unknown) => attempted && !value;

  return (
    <>
      <PageHeader
        icon="route"
        title={missionMode && mission.data ? t('generate.missionTitle', { name: mission.data.name }) : t('generate.title')}
        back={{ to: missionMode ? missionPath(missionId) : PATHS.routes, label: t('generate.back') }}
      />

      <div className="editor-layout page-wide">
        <div className="route-map">
          <MapView
            className="editor-map-view"
            label={drawing ? t('generate.zoneMapLabel') : t('generate.mapLabel')}
            markers={markers}
            routes={mapRoutes}
            selectedRouteIds={selectedOnMap}
            highlightedRouteId={highlighted}
            elevationLookup={elevationLookup}
            fitToMarkers
            picking={drawing || picking !== null}
            {...(drawing || picking !== null ? { onPick } : {})}
            {...(drawing
              ? {
                  editor: {
                    vertices: zone.vertices,
                    selected: zone.selected,
                    onMove: (index: number, point: { lat: number; lon: number }) => dispatchZone({ type: 'move', index, point: roundVertex(point) }),
                    onInsert: (index: number, point: { lat: number; lon: number }) => dispatchZone({ type: 'insert', index, point: roundVertex(point) }),
                    onSelect: (index: number | null) => dispatchZone({ type: 'select', index }),
                    onRemove: (index: number) => dispatchZone({ type: 'remove', index }),
                    labelFor: (index: number) => t('generate.zoneVertex', { n: index + 1, total: zone.vertices.length }),
                  },
                }
              : {})}
          />
        </div>

        <div className="editor-panel">
          {closed && (
            <p className="notice" role="status">
              {t('generate.missionClosed')}
            </p>
          )}
          {noOrigin && (
            <p className="notice" role="status">
              {t('generate.noOrigin')} <Link to={missionPath(missionId!)}>{t('generate.addOrigin')}</Link>
            </p>
          )}

          <form onSubmit={submit} noValidate aria-busy={running || undefined}>
            <fieldset disabled={formLocked} className="plain-fieldset">
              {missionMode ? (
                <SectionCard icon="pin" title={t('generate.fromLabel')}>
                  {origins.length > 0 && (
                    <div className="field">
                      <label htmlFor="generate-origin">{t('generate.originLabel')}</label>
                      <select id="generate-origin" value={selectedOriginId} onChange={(event) => setOriginId(event.target.value)}>
                        {origins.map((point) => (
                          <option key={point.id} value={point.id}>
                            {point.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <p className="form-note">{t('generate.missionTarget')}</p>
                </SectionCard>
              ) : (
                <>
                  <SectionCard icon="pin" title={t('generate.fromLabel')}>
                    <PointInput
                      id="generate-from"
                      value={from}
                      onChange={setFrom}
                      picking={picking === FROM}
                      onPicking={(on) => setPicking(on ? FROM : picking === FROM ? null : picking)}
                      organizationCountry={organization.data?.country}
                      elevationLookup={elevationLookup}
                      error={missing(from) ? t('generate.pointMissing') : null}
                    />
                  </SectionCard>
                  <SectionCard icon="target" title={t('generate.toLabel')}>
                    <PointInput
                      id="generate-to"
                      value={to}
                      onChange={setTo}
                      picking={picking === TO}
                      onPicking={(on) => setPicking(on ? TO : picking === TO ? null : picking)}
                      organizationCountry={organization.data?.country}
                      elevationLookup={elevationLookup}
                      error={missing(to) ? t('generate.pointMissing') : null}
                    />
                  </SectionCard>
                </>
              )}

              <SectionCard
                icon="more"
                title={t('generate.viaTitle')}
                actions={
                  vias.length < MAX_VIA && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        const key = `via-${Date.now()}-${vias.length}`;
                        setVias((previous) => [...previous, { key, point: null }]);
                        setPicking(key);
                      }}
                    >
                      <Icon name="plus" />
                      <span>{t('generate.addVia')}</span>
                    </button>
                  )
                }
              >
                {vias.length === 0 && <p className="form-note">{t('generate.viaEmpty')}</p>}
                {vias.map((via, index) => (
                  <div className="point-group" key={via.key}>
                    <p className="point-group-title">{t('generate.viaLabel', { n: index + 1 })}</p>
                    <PointInput
                      id={`generate-${via.key}`}
                      value={via.point}
                      onChange={(point) => setVias((previous) => previous.map((item) => (item.key === via.key ? { ...item, point } : item)))}
                      picking={picking === via.key}
                      onPicking={(on) => setPicking(on ? via.key : picking === via.key ? null : picking)}
                      organizationCountry={organization.data?.country}
                      elevationLookup={elevationLookup}
                    />
                    <button type="button" className="button button-plain origin-remove" onClick={() => setVias((previous) => previous.filter((item) => item.key !== via.key))}>
                      <Icon name="trash" />
                      <span>{t('generate.removeVia', { n: index + 1 })}</span>
                    </button>
                  </div>
                ))}
              </SectionCard>

              <SectionCard icon="filter" title={t('generate.optionsTitle')}>
                <div className="field-pair">
                  <div className="field">
                    <label htmlFor="generate-alternatives">{t('generate.alternativesLabel')}</label>
                    <select id="generate-alternatives" value={alternatives} onChange={(event) => setAlternatives(Number(event.target.value))}>
                      {[1, 2, 3, 4].map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="generate-name">{t('generate.nameLabel')}</label>
                    <input id="generate-name" type="text" maxLength={100} value={prefix} onChange={(event) => setPrefix(event.target.value)} />
                  </div>
                </div>
              </SectionCard>
            </fieldset>

            <SectionCard
              icon="shield"
              title={t('generate.zonesTitle')}
              actions={
                !drawing && (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={formLocked || closed}
                    onClick={() => {
                      setDrawing(true);
                      setZoneNote(null);
                    }}
                  >
                    <Icon name="pencil" />
                    <span>{t('generate.drawZone')}</span>
                  </button>
                )
              }
            >
              {zones.isPending && <LoadingState />}
              {zones.isError && <ErrorState error={zones.error} onRetry={() => void zones.refetch()} />}
              {zones.isSuccess && zones.data.items.length === 0 && <p className="form-note">{t('generate.zonesEmpty')}</p>}
              {zones.isSuccess && zones.data.items.length > 0 && (
                <ul className="zone-list">
                  {zones.data.items.map((item) => {
                    const name = item.reason ?? t('generate.zoneNoReason');
                    const scope = item.missionId ? t('generate.zoneScopeMission') : t('generate.zoneScopeOrganization');
                    return (
                      <li key={item.id}>
                        <label>
                          <input
                            type="checkbox"
                            disabled={formLocked}
                            checked={chosenZones.has(item.id)}
                            onChange={(event) => setChosenZones((previous) => new Set(event.target.checked ? [...previous, item.id] : [...previous].filter((id) => id !== item.id)))}
                          />{' '}
                          {name} ({scope})
                        </label>
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={formLocked || removeZone.isPending}
                          aria-label={t('generate.zoneDelete', { name })}
                          onClick={() => removeZone.mutate(item.id)}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div role="status" className="saved-message">
                {zoneNote}
              </div>
              {removeZone.error && (
                <p className="field-error" role="alert">
                  {errorMessage(t, removeZone.error)}
                </p>
              )}

              {drawing && (
                <div className="zone-editor">
                  <div className="field">
                    <label htmlFor="generate-zone-reason">{t('generate.zoneReasonLabel')}</label>
                    <input id="generate-zone-reason" type="text" maxLength={300} value={zoneReason} onChange={(event) => setZoneReason(event.target.value)} />
                  </div>
                  <VertexTable
                    vertices={zone.vertices}
                    selected={zone.selected}
                    onSelect={(index) => dispatchZone({ type: 'select', index })}
                    onMove={(index, point) => dispatchZone({ type: 'move', index, point })}
                    onRemove={(index) => dispatchZone({ type: 'remove', index })}
                    labels={{
                      lat: (n) => t('routeEditor.latLabel', { n }),
                      lon: (n) => t('routeEditor.lonLabel', { n }),
                      remove: (n) => t('routeEditor.removeVertex', { n }),
                      invalid: t('routeEditor.invalidCoordinates'),
                    }}
                  />
                  {zone.vertices.length < 3 && <p className="form-note">{t('generate.zoneNeedThree')}</p>}
                  {saveZone.error && (
                    <p className="field-error" role="alert">
                      {errorMessage(t, saveZone.error)}
                    </p>
                  )}
                  <div className="editor-toolbar">
                    <button type="button" className="button button-secondary" disabled={zone.history.length === 0} onClick={() => dispatchZone({ type: 'undo' })}>
                      {t('routeEditor.undo')}
                    </button>
                    <button type="button" className="button button-primary" disabled={zone.vertices.length < 3 || saveZone.isPending} onClick={() => saveZone.mutate()}>
                      {t('generate.saveZone')}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        setDrawing(false);
                        dispatchZone({ type: 'reset', vertices: [] });
                      }}
                    >
                      {t('generate.cancelZone')}
                    </button>
                  </div>
                </div>
              )}
            </SectionCard>

            {start.error && (
              <p className="field-error" role="alert">
                {errorMessage(t, start.error)}
              </p>
            )}
            <div className="form-submit">
              <button type="submit" className="button button-primary" disabled={running || formLocked || closed || noOrigin || drawing}>
                {start.isPending ? t('generate.submitting') : t('generate.submit')}
              </button>
            </div>
          </form>

          <Progress job={job.data} running={running} percent={percent} failureCode={failureCode} onRetry={() => setJobId(null)} />
        </div>
      </div>

      {job.data?.status === 'completed' && (
        <section aria-labelledby="generate-results-title" className="generate-results">
          <h2 id="generate-results-title" tabIndex={-1}>
            {t('generate.resultsTitle')}
          </h2>
          <p className="form-note">{t('generate.resultsHelp')}</p>
          {routeIds.length === 0 && <p>{t('generate.resultsEmpty')}</p>}
          {results.some((result) => result.isPending) && <LoadingState />}
          {results.some((result) => result.isError) && <ErrorState error={results.find((result) => result.isError)?.error} />}
          {results.length > 0 && results.every((result) => result.isSuccess) && (
            <div className="table-scroll" role="region" aria-label={t('generate.compareTitle')} tabIndex={0}>
              <table className="results-table">
                <caption>{t('generate.compareTitle')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('generate.resultName', { name: '' })}</th>
                    <th scope="col">{t('generate.distance')}</th>
                    <th scope="col">{t('generate.ascent')}</th>
                    <th scope="col">{t('generate.descent')}</th>
                    <th scope="col">{t('roadMix.title')}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result, index) => {
                    const detail = result.data!.detail;
                    const version = detail.versions[0]!;
                    return (
                      <tr key={detail.id} data-highlighted={highlighted === detail.id || undefined}>
                        <th scope="row">
                          <Link to={routePath(detail.id)} aria-label={t('generate.open', { name: detail.name })}>
                            {detail.name}
                          </Link>{' '}
                          <button
                            type="button"
                            className="button-link"
                            aria-pressed={highlighted === routeIds[index]}
                            aria-label={t('generate.showOnMap', { name: detail.name })}
                            onClick={() => setHighlighted(highlighted === detail.id ? null : detail.id)}
                          >
                            ◎
                          </button>
                        </th>
                        <td>{t('units.km', { value: formatKm(version.metrics.distanceM, locale) })}</td>
                        <td>{t('units.m', { value: Math.round(version.metrics.ascentM) })}</td>
                        <td>{t('units.m', { value: Math.round(version.metrics.descentM) })}</td>
                        <td>
                          <RoadMix mix={version.roadMix} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p>
            <Link to={PATHS.routes}>{t('generate.openLibrary')}</Link>
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setJobId(null);
              setHighlighted(null);
              start.reset();
            }}
          >
            {t('generate.again')}
          </button>
        </section>
      )}
    </>
  );
}

function Progress({ job, running, percent, failureCode, onRetry }: { job: Job | undefined; running: boolean; percent: number; failureCode: FailureCode | null; onRetry: () => void }) {
  const { t } = useTranslation();
  if (failureCode) {
    return (
      <section aria-labelledby="generate-failed-title" className="notice">
        <h2 id="generate-failed-title">{t('generate.failedTitle')}</h2>
        <p role="alert">{t(FAILURE_KEYS[failureCode])}</p>
        <button type="button" className="button button-secondary" onClick={onRetry}>
          {t('generate.tryAgain')}
        </button>
      </section>
    );
  }
  if (!running) return null;
  const waiting = !job || job.status === 'pending';
  return (
    <section aria-labelledby="generate-progress-title">
      <h2 id="generate-progress-title">{t('generate.progressTitle')}</h2>
      <progress max={100} value={percent} aria-label={t('generate.progress', { percent })} />
      <p role="status">
        {waiting ? t('generate.pending') : t('generate.running')} · {t('generate.progress', { percent })}
      </p>
    </section>
  );
}
