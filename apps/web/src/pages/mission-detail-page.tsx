import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { ApiError, type OperationOutput } from '@onway/contracts/client';
import { formatCoordinate } from '@onway/geo';
import { Icon } from '../components/icon';
import { Menu } from '../components/menu';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { useElevationLookup } from '../hooks/use-elevation-lookup';
import { countryName } from '../i18n/country-name';
import { MapView, type MapFocus, type MapMarker } from '../map';
import { formatDate, formatDateTime, formatMeters } from '../missions/format';
import { LifecycleActions } from '../missions/lifecycle-actions';
import { MissionEditForm } from '../missions/mission-edit-form';
import { MissionHistory } from '../missions/mission-history';
import { mapRoutesOf } from '../missions/mission-route-style';
import { MissionRoutesSection, useMissionRoutes } from '../missions/mission-routes-section';
import type { PickedPoint, PointKind } from '../missions/point';
import { ImportPointsDialog } from '../missions/import-points-dialog';
import { PointForm } from '../missions/point-form';
import { PointRow } from '../missions/point-row';
import { StatusBadge } from '../missions/status-badge';
import { PATHS } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { useCurrentUser } from '../session/session';
import { MyMissionDetailPage } from './my-mission-detail-page';

type Mission = OperationOutput<'getMission'>;
type Point = Mission['points'][number];

const KINDS: readonly PointKind[] = ['origin', 'waypoint', 'rendezvous'];

/** Lo que se está escribiendo ahora. Solo hay una cosa abierta a la vez: abrir otra descarta lo que no se guardó. */
type Editor = { type: 'mission' } | { type: 'add'; kind: PointKind } | { type: 'edit'; pointId: string } | null;

/**
 * Detalle de misión (boceto 6, RF-205): cabecera, lista de preparación, mapa y puntos. El rescatista tiene su propia vista
 * (detalle en solo lectura, RF-602): aquí no tiene `getMission`.
 */
export function MissionDetailPage() {
  const user = useCurrentUser();
  if (user.role === 'rescuer') return <MyMissionDetailPage />;
  return <StaffMissionDetail />;
}

const asPicked = (point: { lat: number; lon: number }): PickedPoint => ({ lat: point.lat, lon: point.lon, source: 'coordinates' });

function StaffMissionDetail() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const locale = i18n.resolvedLanguage ?? 'es';
  const { missionId = '' } = useParams();
  const elevationLookup = useElevationLookup();

  const mission = useQuery({
    queryKey: ['missions', 'detail', missionId],
    queryFn: ({ signal }) => api.getMission({ params: { missionId } }, { signal }),
  });
  const organization = useQuery({ queryKey: ['organization'], queryFn: ({ signal }) => api.getOrganization({ signal }) });
  usePageTitle(mission.data?.name ?? t('missions.title'));

  if (mission.isPending) return <LoadingState />;
  if (mission.isError) {
    return (
      <>
        <ErrorState error={mission.error} {...(mission.error instanceof ApiError && mission.error.code === 'NOT_FOUND' ? {} : { onRetry: () => void mission.refetch() })} />
        <Link className="button button-secondary" to={PATHS.missions}>
          {t('missionDetail.back')}
        </Link>
      </>
    );
  }
  return <MissionView mission={mission.data} locale={locale} organizationCountry={organization.data?.country} elevationLookup={elevationLookup} reload={async () => (await mission.refetch()).data} />;
}

interface ViewProps {
  mission: Mission;
  locale: string;
  organizationCountry: string | undefined;
  elevationLookup: ReturnType<typeof useElevationLookup>;
  reload: () => Promise<Mission | undefined>;
}

function MissionView({ mission, locale, organizationCountry, elevationLookup, reload }: ViewProps) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<Editor>(null);
  const [draft, setDraft] = useState<PickedPoint | null>(null);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Aviso de lo último guardado, junto a lo que se ha tocado (cabecera o puntos); las regiones `status` existen siempre para que se anuncie.
  // Si se llega desde «Duplicar», la copia lo anuncia (la navegación lleva el nombre del original).
  const arrival = useLocation().state as { duplicatedFrom?: string; routeAdded?: string } | null;
  const [saved, setSaved] = useState<{ area: 'head' | 'points'; text: string } | null>(
    arrival?.duplicatedFrom
      ? { area: 'head', text: t('missionDetail.lifecycle.duplicated', { name: arrival.duplicatedFrom }) }
      : arrival?.routeAdded
        ? { area: 'head', text: t('routeImport.mission.added', { name: arrival.routeAdded }) }
        : null,
  );
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const nonce = useRef(1);
  // Las rutas de la misión: la tabla y el mapa comparten la consulta y la selección (qué rutas se ven resaltadas y con su perfil).
  const routes = useMissionRoutes(mission.id);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const routeRows = routes.data?.items;
  const selectedRoutes = useMemo(() => new Set((routeRows ?? []).filter((row) => picked.has(row.id)).map((row) => row.id)), [routeRows, picked]);
  const mapRoutes = useMemo(() => mapRoutesOf(routeRows ?? []), [routeRows]);
  const togglePicked = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const canEdit = mission.actions.edit;
  // Si la misión pasa a solo lectura mientras se escribe (la cerró otra persona), el editor desaparece con sus controles.
  const active: Editor = canEdit ? editor : null;

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const open = (next: Editor, initialDraft: PickedPoint | null, startPicking: boolean) => {
    setEditor(next);
    setDraft(initialDraft);
    setPicking(startPicking);
    setRemoving(null);
    setSaved(null);
  };
  const close = (returnFocusTo: string | null = null) => {
    setEditor(null);
    setDraft(null);
    setPicking(false);
    if (returnFocusTo) setFocusId(returnFocusTo);
  };

  const changeDraft = (point: PickedPoint | null) => {
    setDraft(point);
    if (point && point.source !== 'map') setFocus({ lat: point.lat, lon: point.lon, nonce: nonce.current++ });
  };

  const pointsByKind = useMemo(() => {
    const ofKind = (kind: PointKind): Point[] => mission.points.filter((point) => point.kind === kind).sort((a, b) => a.position - b.position);
    return { origin: ofKind('origin'), waypoint: ofKind('waypoint'), rendezvous: ofKind('rendezvous') } satisfies Record<PointKind, Point[]>;
  }, [mission.points]);

  const markers = useMemo<MapMarker[]>(() => {
    const editedId = active?.type === 'edit' ? active.pointId : null;
    const editedKind: PointKind | null | undefined = active?.type === 'edit' ? mission.points.find((point) => point.id === active.pointId)?.kind : active?.type === 'add' ? active.kind : null;
    const target = active?.type === 'mission' && draft ? draft : mission.target;
    return [
      { id: 'target', kind: 'target' as const, lat: target.lat, lon: target.lon, label: mission.target.label ?? t('map.markers.target') },
      ...mission.points.filter((point) => point.id !== editedId).map((point) => ({ id: point.id, kind: point.kind, lat: point.lat, lon: point.lon, label: point.name })),
      ...(draft && editedKind ? [{ id: 'draft', kind: editedKind, lat: draft.lat, lon: draft.lon, label: t(`missionDetail.points.kinds.${editedKind}`) }] : []),
    ];
  }, [active, draft, mission.points, mission.target, t]);

  const onPick = (point: { lat: number; lon: number }) => setDraft({ lat: point.lat, lon: point.lon, source: 'map' });

  const readOnlyNotice = canEdit ? null : mission.status === 'closed' ? t('missionDetail.readOnlyClosed') : t('missionDetail.readOnlyRole');
  const objective = mission.target.label ?? formatCoordinate(mission.target, 'decimal');

  return (
    <div className="page-wide">
      <div className="detail-layout">
        <header className="detail-head">
          <Link className="back-link" to={PATHS.missions}>
            {t('missionDetail.back')}
          </Link>
          <h1 id="mission-title" tabIndex={-1}>
            {mission.name}
          </h1>
          <StatusBadge status={mission.status} />
          <div role="status" className="saved-message">
            {saved?.area === 'head' ? saved.text : null}
          </div>

          {active?.type === 'mission' ? (
            <MissionEditForm
              key={mission.updatedAt}
              mission={mission}
              draft={draft}
              onDraft={changeDraft}
              picking={picking}
              onPicking={setPicking}
              organizationCountry={organizationCountry}
              elevationLookup={elevationLookup}
              onDone={() => {
                close('mission-edit-button');
                setSaved({ area: 'head', text: t('missionDetail.edit.saved') });
              }}
              onCancel={() => close('mission-edit-button')}
              onReload={() => {
                void reload().then((fresh) => {
                  if (fresh) setDraft(asPicked(fresh.target));
                });
              }}
            />
          ) : (
            <>
              <dl className="facts-grid">
                <div>
                  <dt>{t('missionDetail.fields.coordinator')}</dt>
                  <dd>{mission.coordinator?.displayName ?? t('missionDetail.fields.noCoordinator')}</dd>
                </div>
                <div>
                  <dt>{t('missionDetail.fields.objective')}</dt>
                  <dd>
                    {objective}
                    {mission.target.label && <span className="fact-sub">{formatCoordinate(mission.target, 'decimal')}</span>}
                  </dd>
                </div>
                <div>
                  <dt>{t('missionDetail.fields.altitude')}</dt>
                  <dd>
                    {mission.target.elevationM === null ? t('missionDetail.points.noAltitude') : t('missionDetail.fields.altitudeValue', { meters: formatMeters(mission.target.elevationM, locale) })}
                  </dd>
                </div>
                {mission.target.country && (
                  <div>
                    <dt>{t('missionDetail.fields.country')}</dt>
                    <dd>{countryName(mission.target.country, locale)}</dd>
                  </div>
                )}
                <div>
                  <dt>{t('missionDetail.fields.created')}</dt>
                  <dd>{formatDate(mission.createdAt, locale)}</dd>
                </div>
                {mission.activatedAt && (
                  <div>
                    <dt>{t('missionDetail.fields.activated')}</dt>
                    <dd>{formatDateTime(mission.activatedAt, locale)}</dd>
                  </div>
                )}
                {mission.closedAt && (
                  <div>
                    <dt>{t('missionDetail.fields.closed')}</dt>
                    <dd>{formatDateTime(mission.closedAt, locale)}</dd>
                  </div>
                )}
              </dl>
              <div className="detail-description">
                <h2>{t('missionDetail.fields.description')}</h2>
                <p>{mission.description ?? t('missionDetail.fields.noDescription')}</p>
              </div>
              <LifecycleActions
                mission={mission}
                {...(canEdit ? { onEdit: () => open({ type: 'mission' }, asPicked(mission.target), false) } : {})}
                onSettled={({ message }) => {
                  setEditor(null);
                  setDraft(null);
                  setPicking(false);
                  setRemoving(null);
                  setSaved(message ? { area: 'head', text: message } : null);
                  setFocusId('mission-title');
                }}
              />
            </>
          )}
          {readOnlyNotice && (
            <p className="notice" role="status">
              {readOnlyNotice}
            </p>
          )}
        </header>

        <section className="detail-readiness" aria-labelledby="readiness-title">
          <h2 id="readiness-title">{t('missionDetail.readiness.title')}</h2>
          <ul className="readiness-list">
            <ReadinessItem done={mission.readiness.targetDefined} label={t('missionDetail.readiness.targetDefined')} />
            <ReadinessItem
              done={mission.readiness.hasOrigins}
              label={t('missionDetail.readiness.hasOrigins')}
              action={
                canEdit && (
                  <button type="button" className="button-link" onClick={() => open({ type: 'add', kind: 'origin' }, null, true)}>
                    {t('missionDetail.readiness.addOrigin')}
                  </button>
                )
              }
            />
            <ReadinessItem done={mission.readiness.hasParticipants} label={t('missionDetail.readiness.hasParticipants')} hint={t('missionDetail.readiness.later')} />
            <ReadinessItem done={mission.readiness.hasValidatedRoute} label={t('missionDetail.readiness.hasValidatedRoute')} hint={t('missionDetail.readiness.later')} />
          </ul>
        </section>

        <div className="detail-routes">
          <MissionRoutesSection
            missionId={mission.id}
            locale={locale}
            canManage={mission.actions.manageRoutes}
            origins={pointsByKind.origin.map((point) => ({ id: point.id, name: point.name }))}
            routes={routes}
            {...(canEdit ? { generate: { to: `${PATHS.generateRoutes}?mission=${mission.id}`, enabled: pointsByKind.origin.length > 0 } } : {})}
            selected={selectedRoutes}
            onToggle={togglePicked}
          />
        </div>

        <section className="detail-points section-card" aria-labelledby="points-title">
          <header className="section-card-header">
            <Icon name="pin" className="section-card-icon" />
            <h2 id="points-title" className="section-card-title" tabIndex={-1}>
              {t('missionDetail.points.title')}
            </h2>
            {canEdit && (
              <div className="section-card-actions">
                <Menu
                  buttonId="points-add"
                  label={t('missionDetail.points.addMenu')}
                  icon="plus"
                  align="end"
                  disabled={active?.type === 'add'}
                  items={[
                    ...KINDS.map((kind) => ({ id: kind, label: t(`missionDetail.points.add.${kind}`), onSelect: () => open({ type: 'add', kind }, null, true) })),
                    { id: 'import', label: t('missionDetail.importPoints.cta'), icon: 'upload' as const, onSelect: () => setImporting(true) },
                  ]}
                />
              </div>
            )}
          </header>
          <div role="status" className="saved-message">
            {saved?.area === 'points' ? saved.text : null}
          </div>
          {KINDS.map((kind) => {
            const list = pointsByKind[kind];
            const adding = active?.type === 'add' && active.kind === kind;
            return (
              <section key={kind} className="point-list" aria-labelledby={`points-${kind}`}>
                <h3 id={`points-${kind}`} tabIndex={-1}>
                  {t(`missionDetail.points.groups.${kind}`)}
                </h3>
                {list.length === 0 && !adding && <p className="form-note">{t(`missionDetail.points.empty.${kind}`)}</p>}
                {list.length > 0 && (
                  <ul>
                    {list.map((point) =>
                      active?.type === 'edit' && active.pointId === point.id ? (
                        <li key={point.id} className="point-row point-row-editing">
                          <PointForm
                            missionId={mission.id}
                            kind={kind}
                            point={point}
                            draft={draft}
                            onDraft={changeDraft}
                            picking={picking}
                            onPicking={setPicking}
                            organizationCountry={organizationCountry}
                            elevationLookup={elevationLookup}
                            onDone={({ name }) => {
                              close(`points-${kind}`);
                              setSaved({ area: 'points', text: t('missionDetail.points.updated', { name }) });
                            }}
                            onCancel={() => close(`point-edit-${point.id}`)}
                          />
                        </li>
                      ) : (
                        <PointRow
                          key={point.id}
                          missionId={mission.id}
                          point={point}
                          locale={locale}
                          canEdit={canEdit}
                          confirming={removing === point.id}
                          onEdit={() => open({ type: 'edit', pointId: point.id }, asPicked(point), false)}
                          onAskRemove={() => {
                            close();
                            setRemoving(point.id);
                            setSaved(null);
                          }}
                          onCancelRemove={() => setRemoving(null)}
                          onRemoved={(name) => {
                            setRemoving(null);
                            setSaved({ area: 'points', text: t('missionDetail.points.removed', { name }) });
                            setFocusId(`points-${kind}`);
                          }}
                        />
                      ),
                    )}
                  </ul>
                )}
                {adding && (
                  <PointForm
                    missionId={mission.id}
                    kind={kind}
                    draft={draft}
                    onDraft={changeDraft}
                    picking={picking}
                    onPicking={setPicking}
                    organizationCountry={organizationCountry}
                    elevationLookup={elevationLookup}
                    onDone={({ name }) => {
                      close(`points-${kind}`);
                      setSaved({ area: 'points', text: t('missionDetail.points.added', { name }) });
                    }}
                    onCancel={() => close('points-add')}
                  />
                )}
              </section>
            );
          })}
        </section>

        <MissionHistory missionId={mission.id} locale={locale} />

        <div className="detail-map">
          <MapView
            label={t('missionDetail.mapRegion')}
            markers={markers}
            focus={focus}
            fitToMarkers
            elevationLookup={elevationLookup}
            picking={active !== null && picking}
            {...(active !== null && picking ? { onPick } : {})}
            routes={mapRoutes}
            selectedRouteIds={selectedRoutes}
            onRouteClick={(id) => setPicked((current) => new Set(current).add(id))}
          />
        </div>
      </div>
      {importing && canEdit && (
        <ImportPointsDialog missionId={mission.id} onClose={() => setImporting(false)} onImported={(count) => setSaved({ area: 'points', text: t('missionDetail.importPoints.done', { count }) })} />
      )}
    </div>
  );
}

function ReadinessItem({ done, label, hint, action }: { done: boolean; label: string; hint?: string; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="readiness-item" data-done={done}>
      <span className="readiness-state">{done ? t('missionDetail.readiness.done') : t('missionDetail.readiness.pending')}</span>
      <span className="readiness-label">{label}</span>
      {!done && hint && <span className="form-note">{hint}</span>}
      {!done && action}
    </li>
  );
}
