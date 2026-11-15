import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Icon } from '../components/icon';
import { Menu, type MenuItem } from '../components/menu';
import { PageHeader } from '../components/page-header';
import { SectionCard } from '../components/section-card';
import { ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { ComparePanel } from '../library/compare-panel';
import { saveBlob } from '../library/download';
import { ElevationProfile } from '../library/elevation-profile';
import { RoadMix } from '../library/road-mix';
import { formatKm } from '../library/format';
import { ArchiveDialog, DeriveDialog, ValidateDialog } from '../library/route-dialogs';
import { MapView, type MapRoute } from '../map';
import { errorMessage } from '../i18n/error-message';
import { formatDate, formatMeters } from '../missions/format';
import { PATHS, missionPath, routePath } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { useCurrentUser } from '../session/session';

type Dialogs = 'validate' | 'derive' | 'archive' | null;

/**
 * Detalle de una ruta (boceto 10, RF-502, RF-504, RF-506, RF-511, RF-516, RF-517, RF-519): mapa de la versión elegida, datos, perfil
 * de elevación, historial de versiones con comparación, de dónde viene, qué deriva de ella y dónde se usa. Escribir (validar, derivar,
 * archivar, crear una versión nueva) es del coordinador; una ruta archivada es de solo lectura (solo se puede derivar). La versión
 * que se enseña y la comparación viven en la dirección.
 */
export function RouteDetailPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const user = useCurrentUser();
  const locale = i18n.resolvedLanguage ?? 'es';
  const { routeId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const canWrite = user.role === 'coordinator';

  const route = useQuery({ queryKey: ['route', routeId], queryFn: ({ signal }) => api.getRoute({ params: { routeId } }, { signal }) });
  const organization = useQuery({ queryKey: ['organization'], queryFn: ({ signal }) => api.getOrganization({ signal }) });
  const versions = route.data?.versions ?? [];
  const shown = versions.find((v) => v.id === params.get('v')) ?? versions[0];
  const compareA = versions.find((v) => v.id === params.get('a'));
  const compareB = versions.find((v) => v.id === params.get('b'));
  const comparing = Boolean(compareA && compareB);

  const version = useQuery({
    queryKey: ['route', routeId, 'version', shown?.id],
    queryFn: ({ signal }) => api.getRouteVersion({ params: { routeId, versionId: shown!.id } }, { signal }),
    enabled: Boolean(shown),
  });
  const detailA = useQuery({
    queryKey: ['route', routeId, 'version', compareA?.id],
    queryFn: ({ signal }) => api.getRouteVersion({ params: { routeId, versionId: compareA!.id } }, { signal }),
    enabled: comparing,
  });
  const detailB = useQuery({
    queryKey: ['route', routeId, 'version', compareB?.id],
    queryFn: ({ signal }) => api.getRouteVersion({ params: { routeId, versionId: compareB!.id } }, { signal }),
    enabled: comparing,
  });

  usePageTitle(route.data?.name ?? t('routes.title'));
  const update = (changes: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const exportFile = useMutation({
    mutationFn: async (format: 'gpx' | 'kml') => {
      const blob = await api.exportRoute({ params: { routeId }, query: { versionId: shown!.id, format } });
      saveBlob(blob, `onway-route-v${shown!.number}.${format}`);
    },
  });

  const mapRoutes: MapRoute[] = useMemo(() => {
    const line = (detail: { geometry: { coordinates: number[][] } } | undefined) => (detail?.geometry.coordinates.map(([lon, lat]) => [lon!, lat!]) ?? []) as [number, number][];
    if (comparing && detailA.data && detailB.data) {
      return [
        { id: 'a', name: `${route.data?.name ?? ''} · A`, tone: 'compare-a', line: line(detailA.data) },
        { id: 'b', name: `${route.data?.name ?? ''} · B`, tone: 'compare-b', line: line(detailB.data) },
      ];
    }
    if (!comparing && version.data && shown && route.data) {
      const tone = route.data.status === 'archived' ? 'archived' : shown.status === 'validated' ? 'validated' : 'draft';
      return [{ id: shown.id, name: route.data.name, tone, line: line(version.data) }];
    }
    return [];
  }, [comparing, detailA.data, detailB.data, version.data, shown, route.data]);
  const fitKey = mapRoutes.length > 0 ? `${routeId}|${comparing ? `${compareA?.id}|${compareB?.id}` : shown?.id}` : undefined;

  if (route.isPending) return <LoadingState />;
  if (route.isError) {
    return (
      <>
        <p>
          <Link to={PATHS.routes}>{t('routeDetail.back')}</Link>
        </p>
        <ErrorState error={route.error} onRetry={() => void route.refetch()} />
      </>
    );
  }
  const data = route.data;
  const archived = data.status === 'archived';
  const latestValidated = versions.find((v) => v.status === 'validated');
  const maxAge = organization.data?.config.validationMaxAgeDays;
  const staleDays = latestValidated?.validatedAt && maxAge !== undefined ? Math.floor((Date.now() - new Date(latestValidated.validatedAt).getTime()) / 86_400_000) : null;
  const stale = !archived && staleDays !== null && maxAge !== undefined && staleDays > maxAge;
  const metrics = version.data?.metrics;

  const moreItems: MenuItem[] = [
    { id: 'duplicate', label: t('routeDetail.actions.duplicate'), icon: 'copy', onSelect: () => setDialog('derive') },
    ...(archived ? [] : [{ id: 'archive', label: t('routeDetail.actions.archive'), icon: 'archive' as const, danger: true, onSelect: () => setDialog('archive') }]),
  ];

  return (
    <>
      <PageHeader
        icon="route"
        title={data.name}
        back={{ to: PATHS.routes, label: t('routeDetail.back') }}
        badges={
          shown && (
            <>
              <span className="status-badge">{t('routeDetail.versions.number', { number: shown.number })}</span>
              <span className="status-badge" data-version={shown.status}>
                {t(`routeDetail.versions.${shown.status}`)}
              </span>
            </>
          )
        }
        actions={
          <>
            {canWrite && shown && !archived && shown.status === 'draft' && (
              <button type="button" className="button button-primary" onClick={() => setDialog('validate')}>
                <Icon name="check" />
                <span>{t('routeDetail.actions.validate')}</span>
              </button>
            )}
            {canWrite && shown && !archived && (
              <Link className="button button-secondary" to={`${routePath(routeId)}/edit?base=${shown.id}`}>
                <Icon name="edit" />
                <span>{t('routeDetail.actions.edit')}</span>
              </Link>
            )}
            <Menu
              label={t('common.export')}
              icon="download"
              align="end"
              disabled={!shown || exportFile.isPending}
              items={(['gpx', 'kml'] as const).map((format) => ({ id: format, label: t(format === 'gpx' ? 'routeDetail.actions.exportGpx' : 'routeDetail.actions.exportKml'), onSelect: () => exportFile.mutate(format) }))}
            />
            {canWrite && shown && <Menu label={t('common.more')} icon="more" iconOnly align="end" items={moreItems} />}
          </>
        }
      />
      {exportFile.isPending && <p role="status">{t('routeDetail.actions.exporting')}</p>}
      {exportFile.isError && (
        <p className="notice" role="alert">
          {errorMessage(t, exportFile.error) || t('routeDetail.actions.exportError')}
        </p>
      )}
      {archived && (
        <p className="notice" role="status">
          {t('routeDetail.archivedNotice')}
        </p>
      )}
      {stale && staleDays !== null && maxAge !== undefined && (
        <p className="notice notice-warning" role="status">
          {t('routeDetail.staleNotice', { days: staleDays, max: maxAge })}
        </p>
      )}
      {data.derivedFrom && (
        <p className="route-origin">
          <Link to={routePath(data.derivedFrom.routeId)}>{t('routeDetail.relations.derivedFrom', { name: data.derivedFrom.routeName, number: data.derivedFrom.versionNumber })}</Link>
        </p>
      )}

      <div className="route-layout page-wide">
        <div className="route-map">
          <MapView className="route-map-view" label={t('routeDetail.mapLabel')} routes={mapRoutes} fitRoutesKey={fitKey} />
          {comparing && (
            <ul className="map-legend" aria-label={t('routes.map.legend')}>
              <li>
                <span className="legend-swatch" data-tone="compare-a" aria-hidden="true" />
                {t('routeDetail.compare.legendA')}
              </li>
              <li>
                <span className="legend-swatch" data-tone="compare-b" aria-hidden="true" />
                {t('routeDetail.compare.legendB')}
              </li>
            </ul>
          )}
        </div>

        <div className="route-info">
          {comparing && compareA && compareB ? (
            <ComparePanel
              versions={versions}
              a={compareA.id}
              b={compareB.id}
              onChange={(changes) => update({ ...(changes.a ? { a: changes.a } : {}), ...(changes.b ? { b: changes.b } : {}) })}
              onStop={() => update({ a: null, b: null })}
              detailA={detailA.data}
              detailB={detailB.data}
            />
          ) : (
            <>
              <SectionCard icon="info" title={t('routeDetail.metrics.title')}>
                {version.isPending && <LoadingState />}
                {version.isError && <ErrorState error={version.error} onRetry={() => void version.refetch()} />}
                {metrics && version.data && (
                  <>
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
                        <dt>{t('routeDetail.metrics.minElevation')}</dt>
                        <dd>{t('units.m', { value: formatMeters(metrics.minElevationM, locale) })}</dd>
                      </div>
                      <div>
                        <dt>{t('routeDetail.metrics.maxElevation')}</dt>
                        <dd>{t('units.m', { value: formatMeters(metrics.maxElevationM, locale) })}</dd>
                      </div>
                      <div>
                        <dt>{t('routeDetail.metrics.maxSlope')}</dt>
                        <dd>{t('routeDetail.metrics.slopeValue', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metrics.maxSlopePct) })}</dd>
                      </div>
                      <div className="facts-wide">
                        <dt>{t('routeDetail.metrics.roadMix')}</dt>
                        <dd>
                          <RoadMix mix={version.data.roadMix} />
                          <br />
                          {version.data.roadMix.map((part) => `${t(`routeDetail.metrics.roadTypes.${part.roadType}`)} · ${t('units.km', { value: formatKm(part.distanceM, locale) })}`).join(', ')}
                        </dd>
                      </div>
                    </dl>
                    <ElevationProfile profile={version.data.elevationProfile} versionNumber={version.data.number} locale={locale} />
                  </>
                )}
              </SectionCard>
            </>
          )}

          <SectionCard
            icon="clock"
            title={t('routeDetail.versions.title')}
            actions={
              versions.length > 1 &&
              !comparing && (
                <button type="button" className="button button-secondary" onClick={() => update({ a: versions[1]!.id, b: versions[0]!.id })}>
                  {t('routeDetail.compare.start')}
                </button>
              )
            }
          >
            <ol className="version-list">
              {versions.map((v) => (
                <li key={v.id} className="version-row" data-shown={!comparing && v.id === shown?.id ? 'true' : undefined}>
                  <p className="route-badges">
                    <strong>{t('routeDetail.versions.number', { number: v.number })}</strong>
                    <span className="status-badge" data-version={v.status}>
                      {t(`routeDetail.versions.${v.status}`)}
                    </span>
                    <span className="status-badge">{t(`routeDetail.versions.provenance.${v.provenance}`)}</span>
                    {v.manuallyModified && <span className="status-badge">{t('routeDetail.versions.manuallyModified')}</span>}
                    {!comparing && v.id === shown?.id && <span className="status-badge">{t('routeDetail.versions.shown')}</span>}
                  </p>
                  <p className="version-meta">{t('routeDetail.versions.createdBy', { name: v.createdBy.displayName, date: formatDate(v.createdAt, locale) })}</p>
                  {v.validatedBy && v.validatedAt && (
                    <p className="version-meta">{t('routeDetail.versions.validatedBy', { name: v.validatedBy.displayName, date: formatDate(v.validatedAt, locale) })}</p>
                  )}
                  <p className="version-meta">{v.note ?? t('routeDetail.versions.noNote')}</p>
                  {!comparing && v.id !== shown?.id && (
                    <button type="button" className="button button-secondary version-show" aria-label={t('routeDetail.versions.show', { number: v.number })} onClick={() => update({ v: v.id })}>
                      {t('routeDetail.versions.showShort')}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </SectionCard>

          <SectionCard icon="flag" title={t('routeDetail.relations.usedIn')}>
            {data.usedIn.length === 0 ? (
              <p className="form-note">{t('routeDetail.relations.notUsed')}</p>
            ) : (
              <ul className="plain-list">
                {data.usedIn.map((use) => (
                  <li key={use.missionId}>
                    <Link to={missionPath(use.missionId)}>{use.missionName}</Link>{' '}
                    {t('routeDetail.relations.usedInRow', { status: t(`missions.status.${use.missionStatus}`), number: use.pinnedVersionNumber })}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard icon="copy" title={t('routeDetail.relations.derivatives')}>
            {data.derivatives.length === 0 ? (
              <p className="form-note">{t('routeDetail.relations.noDerivatives')}</p>
            ) : (
              <ul className="plain-list">
                {data.derivatives.map((copy) => (
                  <li key={copy.id}>
                    <Link to={routePath(copy.id)}>{copy.name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {dialog === 'validate' && shown && <ValidateDialog routeId={routeId} versionId={shown.id} versionNumber={shown.number} onClose={() => setDialog(null)} />}
      {dialog === 'derive' && shown && <DeriveDialog routeId={routeId} versionId={shown.id} versionNumber={shown.number} defaultName={`${data.name} (2)`} onClose={() => setDialog(null)} />}
      {dialog === 'archive' && <ArchiveDialog routeId={routeId} onClose={() => setDialog(null)} />}
    </>
  );
}
