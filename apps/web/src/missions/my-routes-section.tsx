import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OperationOutput } from '@onway/contracts/client';
import { ErrorState, LoadingState } from '../components/states';
import { errorMessage } from '../i18n/error-message';
import { ElevationProfile } from '../library/elevation-profile';
import { fileSlug, saveBlob } from '../library/download';
import { formatKm } from '../library/format';
import { RoadMix } from '../library/road-mix';
import { useApi } from '../session/api-context';
import { formatDate } from './format';
import type { MyMissionRouteRow } from './mission-route-style';

export type MyRoutesQuery = UseQueryResult<OperationOutput<'listMyMissionRoutes'>>;

/** Las rutas validadas y fijadas de la misión, tal como las deja ver el servidor al rescatista (INV-05). */
export function useMyMissionRoutes(missionId: string): MyRoutesQuery {
  const api = useApi();
  return useQuery({ queryKey: ['my-missions', 'routes', missionId], queryFn: ({ signal }) => api.listMyMissionRoutes({ params: { missionId } }, { signal }) });
}

type Format = 'gpx' | 'kml';
const FORMATS: readonly Format[] = ['gpx', 'kml'];

interface Props {
  missionId: string;
  /** Solo una misión activa se puede exportar; una cerrada se lee (`MISSION_NOT_ACTIVE`). */
  active: boolean;
  locale: string;
  routes: MyRoutesQuery;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Rutas de la misión para el rescatista (boceto 14, RF-601 a RF-603, RF-508): una tarjeta por ruta validada con sus datos, la no disponible señalada y
 * sin descarga, el mapa y el perfil al elegir una, y descargar GPX o KML de una o de todas. Solo lectura: no hay ni un campo de escritura.
 * Las descargas son botones de la propia página, no del mapa: se pueden hacer aunque el mapa no cargue.
 */
export function MyRoutesSection({ missionId, active, locale, routes, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const rows = routes.data?.items ?? [];
  const downloadable = active && rows.some((row) => row.status !== 'unavailable');

  const download = useMutation({
    mutationFn: async ({ format, row }: { format: Format; row?: MyMissionRouteRow }) => {
      const blob = await api.exportMyMissionRoutes({ params: { missionId }, query: { format, ...(row ? { ids: row.id } : {}) } });
      const base = row ? `${t('myMissions.routes.fileName')}-${fileSlug(row.name)}` : t('myMissions.routes.fileNameAll');
      saveBlob(blob, `${base}.${format}`);
    },
  });

  return (
    <section className="detail-routes" aria-labelledby="routes-title">
      <h2 id="routes-title">{t('myMissions.detail.routesTitle')}</h2>
      {routes.isPending && <LoadingState />}
      {routes.isError && <ErrorState error={routes.error} onRetry={() => void routes.refetch()} />}
      {routes.isSuccess && rows.length === 0 && <p className="form-note">{t('myMissions.detail.noRoutes')}</p>}
      {routes.isSuccess && rows.length > 0 && (
        <>
          <p className="form-note">{t('myMissions.routes.intro')}</p>
          {!active && (
            <p className="notice" role="status">
              {t('myMissions.routes.closedNotice')}
            </p>
          )}
          <ul className="my-route-list" aria-label={t('myMissions.routes.listLabel')}>
            {rows.map((row) => (
              <MyRouteCard
                key={row.id}
                missionId={missionId}
                row={row}
                locale={locale}
                canDownload={active && row.status !== 'unavailable'}
                selected={selectedId === row.id}
                onSelect={() => onSelect(selectedId === row.id ? null : row.id)}
                onDownload={(format) => download.mutate({ format, row })}
                busy={download.isPending}
              />
            ))}
          </ul>
          {downloadable && (
            <div className="my-route-all" role="group" aria-label={t('myMissions.routes.downloadAllTitle')}>
              {FORMATS.map((format) => (
                <button
                  key={format}
                  type="button"
                  className="button button-secondary"
                  aria-disabled={download.isPending || undefined}
                  onClick={() => !download.isPending && download.mutate({ format })}
                >
                  {t('myMissions.routes.downloadAll', { format: t(`myMissions.routes.formats.${format}`) })}
                </button>
              ))}
            </div>
          )}
          <div role="status">{download.isPending ? t('myMissions.routes.preparing') : download.isSuccess ? t('myMissions.routes.downloaded') : null}</div>
          {download.isError && (
            <p className="field-error" role="alert">
              {errorMessage(t, download.error)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

interface CardProps {
  missionId: string;
  row: MyMissionRouteRow;
  locale: string;
  canDownload: boolean;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onDownload: (format: Format) => void;
}

function MyRouteCard({ missionId, row, locale, canDownload, selected, busy, onSelect, onDownload }: CardProps) {
  const { t } = useTranslation();
  const unavailable = row.status === 'unavailable';
  const m = row.metrics;
  const meters = (value: number) => t('units.m', { value: Math.round(value) });
  return (
    <li className="my-route-card" data-unavailable={unavailable || undefined} data-selected={selected || undefined}>
      <h3>{row.name}</h3>
      <p className="route-badges">
        <span className="status-badge" data-version="validated">
          {t('myMissions.routes.version', { number: row.versionNumber, date: formatDate(row.validatedAt, locale) })}
        </span>
        {row.validationIsStale && (
          <span className="status-badge" data-route="stale">
            {t('myMissions.routes.stale')}
          </span>
        )}
        {unavailable && (
          <span className="status-badge" data-route="unavailable">
            {t('myMissions.routes.unavailable')}
          </span>
        )}
      </p>
      {unavailable && <p className="mission-route-notice">{t('myMissions.routes.unavailableNotice')}</p>}
      {row.validationIsStale && <p className="mission-route-notice">{t('myMissions.routes.staleNotice')}</p>}
      <dl className="facts-grid">
        <div>
          <dt>{t('routeDetail.metrics.distance')}</dt>
          <dd>{t('units.km', { value: formatKm(m.distanceM, locale) })}</dd>
        </div>
        <div>
          <dt>{t('routeDetail.metrics.ascent')}</dt>
          <dd>{meters(m.ascentM)}</dd>
        </div>
        <div>
          <dt>{t('routeDetail.metrics.descent')}</dt>
          <dd>{meters(m.descentM)}</dd>
        </div>
        <div>
          <dt>{t('routeDetail.metrics.minElevation')}</dt>
          <dd>{meters(m.minElevationM)}</dd>
        </div>
        <div>
          <dt>{t('routeDetail.metrics.maxElevation')}</dt>
          <dd>{meters(m.maxElevationM)}</dd>
        </div>
        <div>
          <dt>{t('routeDetail.metrics.maxSlope')}</dt>
          <dd>{t('routeDetail.metrics.slopeValue', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(m.maxSlopePct) })}</dd>
        </div>
      </dl>
      <RoadMix mix={row.roadMix} />
      {row.origin && <p>{t('myMissions.routes.origin', { name: row.origin.name })}</p>}
      {row.team && <p>{t('myMissions.routes.team', { name: row.team.name, locality: row.team.locality })}</p>}
      <div className="point-row-actions">
        <button type="button" className="button button-secondary" aria-pressed={selected} aria-label={t('myMissions.routes.showFor', { name: row.name })} onClick={onSelect}>
          {t('myMissions.routes.show')}
        </button>
        {canDownload && (
          <>
            <span className="my-route-download-label" aria-hidden="true">
              {t('myMissions.routes.download')}
            </span>
            {FORMATS.map((format) => (
              <button
                key={format}
                type="button"
                className="button button-secondary"
                aria-disabled={busy || undefined}
                aria-label={t('myMissions.routes.downloadFor', { name: row.name, format: t(`myMissions.routes.formats.${format}`) })}
                onClick={() => !busy && onDownload(format)}
              >
                {t(`myMissions.routes.formats.${format}`)}
              </button>
            ))}
          </>
        )}
      </div>
      {selected && <MyRouteProfile missionId={missionId} row={row} locale={locale} />}
    </li>
  );
}

/** El perfil de elevación de la versión fijada: se pide al elegir la ruta, no con la lista (D-H4-07). */
function MyRouteProfile({ missionId, row, locale }: { missionId: string; row: MyMissionRouteRow; locale: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const geometry = useQuery({
    queryKey: ['my-missions', 'routes', missionId, 'geometry', row.id, row.versionNumber],
    queryFn: ({ signal }) => api.getMyMissionRouteGeometry({ params: { missionId, missionRouteId: row.id } }, { signal }),
  });
  return (
    <div className="mission-route-profile" aria-label={t('myMissions.routes.profile', { name: row.name })} role="group">
      {geometry.isPending && <LoadingState />}
      {geometry.isError && <ErrorState error={geometry.error} onRetry={() => void geometry.refetch()} />}
      {geometry.isSuccess && <ElevationProfile profile={geometry.data.elevationProfile} versionNumber={geometry.data.versionNumber} locale={locale} />}
    </div>
  );
}
