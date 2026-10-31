import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { ApiError, type OperationOutput } from '@onway/contracts/client';
import { formatCoordinate } from '@onway/geo';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { countryName } from '../i18n/country-name';
import { EnvironmentSection } from '../environment/environment-section';
import { MapView, type MapMarker } from '../map';
import type { PointKind } from '../missions/point';
import { StatusBadge } from '../missions/status-badge';
import { PATHS } from '../nav/navigation';
import { useApi } from '../session/api-context';

type Mission = OperationOutput<'getMyMission'>;
type Point = Mission['points'][number];

const KINDS: readonly PointKind[] = ['origin', 'waypoint', 'rendezvous'];

/**
 * Detalle de una misión para el rescatista (RF-602, boceto 14): solo lectura. Puntos, mapa y tiempo del objetivo; sin rutas (llegan en H4)
 * y sin botón de oferta (H6) aunque el API devuelva `canOffer`. El mapa no lleva `elevationLookup`: el rescatista no tiene `getElevation`
 * y ve solo coordenadas. Una misión en planificación o de otra organización responde 404 (RN-16, INV-08).
 */
export function MyMissionDetailPage() {
  const { t } = useTranslation();
  const api = useApi();
  const { missionId = '' } = useParams();
  const mission = useQuery({
    queryKey: ['my-missions', 'detail', missionId],
    queryFn: ({ signal }) => api.getMyMission({ params: { missionId } }, { signal }),
  });
  usePageTitle(mission.data?.name ?? t('myMissions.title'));

  if (mission.isPending) return <LoadingState />;
  if (mission.isError) {
    return (
      <>
        <ErrorState error={mission.error} {...(mission.error instanceof ApiError && mission.error.code === 'NOT_FOUND' ? {} : { onRetry: () => void mission.refetch() })} />
        <Link className="button button-secondary" to={PATHS.missions}>
          {t('myMissions.detail.back')}
        </Link>
      </>
    );
  }
  return <MissionView mission={mission.data} />;
}

function MissionView({ mission }: { mission: Mission }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';

  const markers = useMemo<MapMarker[]>(
    () => [
      { id: 'target', kind: 'target', lat: mission.target.lat, lon: mission.target.lon, label: mission.target.label ?? t('map.markers.target') },
      ...mission.points.map((point) => ({ id: point.id, kind: point.kind, lat: point.lat, lon: point.lon, label: point.name })),
    ],
    [mission.points, mission.target, t],
  );

  const pointsOf = (kind: PointKind): Point[] => mission.points.filter((point) => point.kind === kind).sort((a, b) => a.position - b.position);
  const objective = mission.target.label ?? formatCoordinate(mission.target, 'decimal');

  return (
    <div className="page-wide">
      <div className="detail-layout detail-layout-readonly">
        <header className="detail-head">
          <Link className="back-link" to={PATHS.missions}>
            {t('myMissions.detail.back')}
          </Link>
          <h1 id="mission-title" tabIndex={-1}>
            {mission.name}
          </h1>
          <StatusBadge status={mission.status} />
          <dl className="facts-grid">
            <div>
              <dt>{t('missionDetail.fields.coordinator')}</dt>
              {/* `null` hasta que se decida cómo ve el rescatista el nombre del responsable (la política de `users` solo lo deja al personal). */}
              <dd>{mission.coordinatorName ?? t('myMissions.coordinatorNeutral')}</dd>
            </div>
            <div>
              <dt>{t('missionDetail.fields.objective')}</dt>
              <dd>
                {objective}
                {mission.target.label && <span className="fact-sub">{formatCoordinate(mission.target, 'decimal')}</span>}
              </dd>
            </div>
            {mission.target.country && (
              <div>
                <dt>{t('missionDetail.fields.country')}</dt>
                <dd>{countryName(mission.target.country, locale)}</dd>
              </div>
            )}
            <div>
              <dt>{t('myMissions.participation.label')}</dt>
              <dd>{mission.myParticipation ? t(`myMissions.participation.status.${mission.myParticipation.status}`) : t('myMissions.participation.none')}</dd>
            </div>
          </dl>
          <div className="detail-description">
            <h2>{t('missionDetail.fields.description')}</h2>
            <p>{mission.description ?? t('missionDetail.fields.noDescription')}</p>
          </div>
          <p className="notice" role="status">
            {t('myMissions.detail.readOnly')}
          </p>
        </header>

        <div className="detail-environment">
          <EnvironmentSection mission={{ id: mission.id, name: mission.name }} title={t('myMissions.detail.environmentTitle')} locale={locale} />
        </div>

        <section className="detail-points" aria-labelledby="points-title">
          <h2 id="points-title">{t('myMissions.detail.pointsTitle')}</h2>
          {KINDS.map((kind) => {
            const list = pointsOf(kind);
            return (
              <section key={kind} className="point-list" aria-labelledby={`points-${kind}`}>
                <h3 id={`points-${kind}`}>{t(`missionDetail.points.groups.${kind}`)}</h3>
                {list.length === 0 ? (
                  <p className="field-help">{t(`missionDetail.points.empty.${kind}`)}</p>
                ) : (
                  <ul>
                    {list.map((point) => (
                      <li key={point.id} className="point-row" data-kind={point.kind}>
                        <div className="point-row-main">
                          <p className="point-row-name">{point.name}</p>
                          {point.note && <p className="point-row-note">{point.note}</p>}
                          <p className="point-row-position">{formatCoordinate(point, 'decimal')}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </section>

        <section className="detail-routes" aria-labelledby="routes-title">
          <h2 id="routes-title">{t('myMissions.detail.routesTitle')}</h2>
          <p className="field-help">{t('myMissions.detail.noRoutes')}</p>
        </section>

        <div className="detail-map">
          <MapView label={t('missionDetail.mapRegion')} markers={markers} fitToMarkers />
        </div>
      </div>
    </div>
  );
}
