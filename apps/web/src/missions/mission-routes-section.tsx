import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ApiError, type OperationOutput } from '@onway/contracts/client';
import { Icon } from '../components/icon';
import { Menu, type MenuItem } from '../components/menu';
import { ErrorState, LoadingState } from '../components/states';
import { ValidateDialog } from '../library/route-dialogs';
import { errorMessage } from '../i18n/error-message';
import { ElevationProfile } from '../library/elevation-profile';
import { saveBlob } from '../library/download';
import { formatKm } from '../library/format';
import { RoadMix } from '../library/road-mix';
import { PATHS } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { missionChangedMeanwhile, writeFailureMessage } from './errors';
import { formatDate } from './format';
import { AddRouteDialog } from './add-route-dialog';
import type { MissionRouteRow } from './mission-route-style';

export type MissionRoutesQuery = UseQueryResult<OperationOutput<'listMissionRoutes'>>;

/** La tabla de rutas de la misión; la comparten la sección y el mapa de la página. */
export function useMissionRoutes(missionId: string): MissionRoutesQuery {
  const api = useApi();
  return useQuery({ queryKey: ['missions', 'routes', missionId], queryFn: ({ signal }) => api.listMissionRoutes({ params: { missionId } }, { signal }) });
}

/** Lo que se está confirmando ahora: solo una cosa a la vez, como en los puntos. */
type Confirming = { id: string; kind: 'update' | 'remove' } | null;

interface Props {
  missionId: string;
  locale: string;
  /** `actions.manageRoutes`: sin él la tabla es de lectura y no hay ningún control que escriba (misión cerrada o administrador). */
  canManage: boolean;
  /** Los orígenes de la misión: el diálogo de añadir los ofrece a cada ruta y decide si se puede generar. */
  origins: readonly { id: string; name: string }[];
  routes: MissionRoutesQuery;
  /** «Generar rutas» desde la misión (va en el menú de la sección): a dónde lleva y si se puede (hace falta un origen, RN-08). */
  generate?: { to: string; enabled: boolean };
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

/**
 * «Rutas de la misión» (boceto 6, RF-502, RF-504): la versión fijada de cada ruta con sus datos para compararlas, las que se quieren ver en el
 * mapa y su perfil, los avisos de versión nueva (RF-518, nunca cambia sola) y de validación antigua (RF-519), y marcar no disponible (RF-508),
 * quitar y exportar. Nada de geometría aquí: el mapa y el perfil reciben lo que calcula el servidor.
 */
export function MissionRoutesSection({ missionId, locale, canManage, origins, routes, generate, selected, onToggle }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  // Un archivo con las rutas de la misión (RF-603): lo escribe el servidor con la versión fijada de cada una.
  const exportFile = useMutation({
    mutationFn: async (format: 'gpx' | 'kml') => {
      const blob = await api.exportMissionRoutes({ params: { missionId }, query: { format } });
      saveBlob(blob, `${t('missionRoutes.export.fileName')}.${format}`);
    },
  });
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [message, setMessage] = useState('');
  const [adding, setAdding] = useState(false);
  const rows = routes.data?.items ?? [];
  const inMission = new Set(rows.map((row) => row.routeId));

  // Si la fila que se confirmaba desaparece (otra persona la quitó), la confirmación se cierra sola.
  const open = confirming && rows.some((row) => row.id === confirming.id) ? confirming : null;

  const done = (text: string, focusId: string) => {
    setConfirming(null);
    setMessage(text);
    document.getElementById(focusId)?.focus();
  };

  const sectionItems: MenuItem[] = [
    ...(generate ? [{ id: 'generate', label: t('generate.cta'), icon: 'route' as const, ...(generate.enabled ? { to: generate.to } : { disabled: true }) }] : []),
    ...(rows.length > 0
      ? (['gpx', 'kml'] as const).map((format) => ({
          id: format,
          label: t(`missionRoutes.export.${format}`),
          icon: 'download' as const,
          disabled: exportFile.isPending,
          onSelect: () => exportFile.mutate(format),
        }))
      : []),
  ];

  return (
    <section className="mission-routes section-card" aria-labelledby="mission-routes-title">
      <header className="section-card-header">
        <Icon name="route" className="section-card-icon" />
        <h2 id="mission-routes-title" className="section-card-title" tabIndex={-1}>
          {t('missionRoutes.title')}
        </h2>
        <div className="section-card-actions">
          {canManage && (
            <button id="add-route-open" type="button" className="button button-secondary" onClick={() => setAdding(true)}>
              <Icon name="plus" />
              <span>{t('missionRoutes.add.open')}</span>
            </button>
          )}
          {sectionItems.length > 0 && <Menu label={t('missionRoutes.more')} icon="more" iconOnly align="end" items={sectionItems} />}
        </div>
      </header>
      <div role="status" className="saved-message">
        {message}
        {exportFile.isPending ? t('missionRoutes.export.busy') : null}
      </div>
      {exportFile.isError && (
        <p className="field-error" role="alert">
          {exportFile.error instanceof ApiError && exportFile.error.code === 'NOT_FOUND' ? t('missionRoutes.export.nothing') : errorMessage(t, exportFile.error)}
        </p>
      )}

      {routes.isPending && <LoadingState />}
      {routes.isError && <ErrorState error={routes.error} onRetry={() => void routes.refetch()} />}
      {routes.isSuccess && rows.length === 0 && (
        <div className="mission-routes-empty">
          <p className="form-note">{t('missionRoutes.empty')}</p>
          <Link to={PATHS.routes}>{t('missionRoutes.openLibrary')}</Link>
        </div>
      )}
      {routes.isSuccess && rows.length > 0 && (
        <>
          <div className="table-scroll" role="region" aria-label={t('missionRoutes.tableCaption')} tabIndex={0}>
            <table className="results-table mission-routes-table">
              <caption className="visually-hidden">{t('missionRoutes.tableCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('missionRoutes.columns.route')}</th>
                  <th scope="col">{t('missionRoutes.columns.version')}</th>
                  <th scope="col">{t('missionRoutes.columns.distance')}</th>
                  <th scope="col">{t('missionRoutes.columns.ascent')}</th>
                  <th scope="col">{t('missionRoutes.columns.descent')}</th>
                  <th scope="col">{t('missionRoutes.columns.minElevation')}</th>
                  <th scope="col">{t('missionRoutes.columns.maxElevation')}</th>
                  <th scope="col">{t('missionRoutes.columns.maxSlope')}</th>
                  <th scope="col">{t('missionRoutes.columns.roadMix')}</th>
                  <th scope="col">{t('missionRoutes.columns.validatedOn')}</th>
                  <th scope="col">{t('missionRoutes.columns.origin')}</th>
                  <th scope="col">{t('missionRoutes.columns.team')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RouteRow
                    key={row.id}
                    missionId={missionId}
                    row={row}
                    locale={locale}
                    canManage={canManage}
                    checked={selected.has(row.id)}
                    onToggle={() => onToggle(row.id)}
                    confirming={open?.id === row.id ? open.kind : null}
                    onConfirm={(kind) => {
                      setConfirming({ id: row.id, kind });
                      setMessage('');
                    }}
                    onCancel={() => {
                      setConfirming(null);
                      document.getElementById(`route-pick-${row.id}`)?.focus();
                    }}
                    onDone={(text, removed) => done(text, removed ? 'mission-routes-title' : `route-pick-${row.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {rows.some((row) => selected.has(row.id)) && (
            <div className="mission-routes-profiles">
              <h3>{t('missionRoutes.profiles.title')}</h3>
              {rows
                .filter((row) => selected.has(row.id))
                .map((row) => (
                  <RouteProfile key={row.id} missionId={missionId} row={row} locale={locale} />
                ))}
            </div>
          )}
        </>
      )}
      {adding && canManage && (
        <AddRouteDialog
          missionId={missionId}
          origins={origins}
          inMission={inMission}
          onClose={() => setAdding(false)}
          onAdded={(count) => {
            setConfirming(null);
            setMessage(t('missionRoutes.add.added', { count }));
          }}
        />
      )}
    </section>
  );
}

interface RowProps {
  missionId: string;
  row: MissionRouteRow;
  locale: string;
  canManage: boolean;
  checked: boolean;
  onToggle: () => void;
  confirming: 'update' | 'remove' | null;
  onConfirm: (kind: 'update' | 'remove') => void;
  onCancel: () => void;
  onDone: (message: string, removed?: boolean) => void;
}

function RouteRow({ missionId, row, locale, canManage, checked, onToggle, confirming, onConfirm, onCancel, onDone }: RowProps) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const safe = useRef<HTMLButtonElement>(null);
  const [validating, setValidating] = useState(false);
  const unavailable = row.status === 'unavailable';
  const newer = row.newerValidatedVersion;
  const km = (meters: number) => t('units.km', { value: formatKm(meters, locale) });
  const meters = (value: number) => t('units.m', { value: Math.round(value) });

  // Al pedir confirmación, el foco va a la opción segura.
  useEffect(() => {
    if (confirming) safe.current?.focus();
  }, [confirming]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['missions'] });
  };
  const failed = (error: unknown) => {
    if (missionChangedMeanwhile(error)) void queryClient.invalidateQueries({ queryKey: ['missions'] });
  };

  const update = useMutation({
    mutationFn: () => api.updateMissionRoute({ params: { missionId, missionRouteId: row.id }, body: { pinnedVersionId: newer!.versionId } }),
    onSuccess: async () => {
      await refresh();
      onDone(t('missionRoutes.update.done', { name: row.name, number: newer!.number }));
    },
    onError: failed,
  });
  const availability = useMutation({
    mutationFn: (status: 'added' | 'unavailable') => api.updateMissionRoute({ params: { missionId, missionRouteId: row.id }, body: { status } }),
    onSuccess: async (_data, status) => {
      await refresh();
      onDone(t(status === 'unavailable' ? 'missionRoutes.unavailable.marked' : 'missionRoutes.unavailable.reactivated', { name: row.name }));
    },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: () => api.removeMissionRoute({ params: { missionId, missionRouteId: row.id } }),
    onSuccess: async () => {
      await refresh();
      onDone(t('missionRoutes.remove.done', { name: row.name }), true);
    },
    onError: failed,
  });

  const pending = update.isPending || availability.isPending || remove.isPending;
  const failure = update.error ?? availability.error ?? remove.error;

  return (
    <tr data-unavailable={unavailable || undefined}>
      <th scope="row" className="mission-route-main">
        <span className="mission-route-name">
          <input id={`route-pick-${row.id}`} type="checkbox" checked={checked} onChange={onToggle} aria-label={t('missionRoutes.select', { name: row.name })} />
          <label htmlFor={`route-pick-${row.id}`}>{row.name}</label>
        </span>
        <span className="mission-route-badges">
          {unavailable && (
            <span className="status-badge" data-route="unavailable">
              {t('missionRoutes.badges.unavailable')}
            </span>
          )}
          {row.validationIsStale && (
            <span className="status-badge" data-route="stale">
              {t('missionRoutes.badges.stale')}
            </span>
          )}
          {row.pinned.status === 'draft' && (
            <span className="status-badge" data-version="draft">
              {t('missionRoutes.notices.draft')}
            </span>
          )}
          {newer && <span className="status-badge">{t('missionRoutes.notices.newer', { number: newer.number })}</span>}
        </span>

        {canManage && confirming === null && (
          <Menu
            className="mission-route-menu"
            label={t('missionRoutes.actionsFor', { name: row.name })}
            icon="more"
            iconOnly
            variant="plain"
            disabled={pending}
            items={[
              ...(row.pinned.status === 'draft' ? [{ id: 'validate', label: t('missionRoutes.validate.action'), icon: 'check' as const, onSelect: () => setValidating(true) }] : []),
              ...(newer ? [{ id: 'update', label: t('missionRoutes.update.action', { number: newer.number }), icon: 'upload' as const, onSelect: () => onConfirm('update') }] : []),
              {
                id: 'availability',
                label: t(unavailable ? 'missionRoutes.unavailable.reactivate' : 'missionRoutes.unavailable.mark'),
                icon: unavailable ? ('play' as const) : ('close' as const),
                onSelect: () => availability.mutate(unavailable ? 'added' : 'unavailable'),
              },
              { id: 'remove', label: t('missionRoutes.remove.action'), icon: 'trash' as const, danger: true, onSelect: () => onConfirm('remove') },
            ]}
          />
        )}
        {canManage && confirming !== null && (
          <span
            className="point-row-confirm"
            role="group"
            aria-label={confirming === 'update' ? t('missionRoutes.update.confirm', { name: row.name, number: newer?.number ?? 0 }) : t('missionRoutes.remove.confirm', { name: row.name })}
          >
            <span>{confirming === 'update' ? t('missionRoutes.update.confirm', { name: row.name, number: newer?.number ?? 0 }) : t('missionRoutes.remove.confirm', { name: row.name })}</span>
            <span className="point-row-actions">
              <button type="button" className="button button-primary" aria-disabled={pending} onClick={() => !pending && (confirming === 'update' ? update.mutate() : remove.mutate())}>
                {confirming === 'update'
                  ? update.isPending
                    ? t('missionRoutes.update.busy')
                    : t('missionRoutes.update.yes')
                  : remove.isPending
                    ? t('missionRoutes.remove.busy')
                    : t('missionRoutes.remove.yes')}
              </button>
              <button ref={safe} type="button" className="button button-secondary" onClick={onCancel}>
                {confirming === 'update' ? t('missionRoutes.update.no') : t('missionRoutes.remove.no')}
              </button>
            </span>
          </span>
        )}
        {validating && (
          <ValidateDialog
            routeId={row.routeId}
            versionId={row.pinned.versionId}
            versionNumber={row.pinned.number}
            onClose={() => setValidating(false)}
            onValidated={() => {
              void refresh().then(() => onDone(t('missionRoutes.validate.done', { name: row.name })));
            }}
          />
        )}
        {canManage && failure != null && (
          <span className="field-error" role="alert">
            {writeFailureMessage(t, failure)}
          </span>
        )}
      </th>
      <td>{t('missionRoutes.versionValue', { number: row.pinned.number, status: t(`routeDetail.versions.${row.pinned.status}`) })}</td>
      <td>{km(row.pinned.metrics.distanceM)}</td>
      <td>{meters(row.pinned.metrics.ascentM)}</td>
      <td>{meters(row.pinned.metrics.descentM)}</td>
      <td>{meters(row.pinned.metrics.minElevationM)}</td>
      <td>{meters(row.pinned.metrics.maxElevationM)}</td>
      <td>{t('routeDetail.metrics.slopeValue', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(row.pinned.metrics.maxSlopePct) })}</td>
      <td>
        <RoadMix mix={row.pinned.roadMix} />
      </td>
      <td>{row.pinned.validatedAt ? formatDate(row.pinned.validatedAt, locale) : t('missionRoutes.notValidated')}</td>
      <td>{row.origin ? row.origin.name : t('missionRoutes.noOrigin')}</td>
      <td>{row.team ? t('missionRoutes.teamValue', { name: row.team.name, locality: row.team.locality }) : t('missionRoutes.noTeam')}</td>
    </tr>
  );
}

/** El perfil de elevación de la versión fijada de una ruta marcada: se pide al marcarla, no con la tabla (D-H4-07). */
function RouteProfile({ missionId, row, locale }: { missionId: string; row: MissionRouteRow; locale: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const geometry = useQuery({
    queryKey: ['missions', 'routes', missionId, 'geometry', row.id, row.pinned.versionId],
    queryFn: ({ signal }) => api.getMissionRouteGeometry({ params: { missionId, missionRouteId: row.id } }, { signal }),
  });
  return (
    <section className="mission-route-profile" aria-label={t('missionRoutes.profiles.forRoute', { name: row.name, number: row.pinned.number })}>
      <h4>{t('missionRoutes.profiles.forRoute', { name: row.name, number: row.pinned.number })}</h4>
      {geometry.isPending && <LoadingState />}
      {geometry.isError && <ErrorState error={geometry.error} onRetry={() => void geometry.refetch()} />}
      {geometry.isSuccess && <ElevationProfile profile={geometry.data.elevationProfile} versionNumber={geometry.data.versionNumber} locale={locale} />}
    </section>
  );
}
