import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { usePageTitle } from '../components/use-page-title';
import { useDeviceLocation } from '../environment/device-location';
import { LibraryFilterPanel } from '../library/filters';
import { PAGE_SIZE, activeFilterCount, listQuery, useLibraryState, VIEWS, type View } from '../library/library-state';
import { RouteCard, toneOf } from '../library/route-card';
import { SelectionBar } from '../library/selection-bar';
import { MapView, type MapBounds, type MapFocus, type MapRoute } from '../map';
import { Pager } from '../missions/list-controls';
import { PATHS } from '../nav/navigation';
import { useApi } from '../session/api-context';
import { useCurrentUser } from '../session/session';

const toBbox = (b: MapBounds) => [b.minLon, b.minLat, b.maxLon, b.maxLat].map((n) => n.toFixed(5)).join(',');

/**
 * Biblioteca de rutas (boceto 9, RF-504, RF-511, RF-512, RF-519): lista y mapa que se siguen el uno al otro. La lista puede seguir
 * a la zona visible del mapa (o, con «Buscar solo al pulsar», actualizarse al pedirlo). En pantallas estrechas hay dos pestañas,
 * Lista y Mapa, con la misma selección. Escribir (importar, dibujar, archivar) es del coordinador; el administrador solo lee.
 */
export function RoutesPage() {
  const { t } = useTranslation();
  const api = useApi();
  const user = useCurrentUser();
  const canWrite = user.role === 'coordinator';
  usePageTitle(t('routes.title'));
  const { filters, view, setView, draft, setDraft, update, clear } = useLibraryState();

  // Zona del mapa: `viewBounds` es lo que se ve; `zone` es la que se usa para pedir la lista.
  const [followMap, setFollowMap] = useState(true);
  const [viewBounds, setViewBounds] = useState<MapBounds | null>(null);
  const [zone, setZone] = useState<MapBounds | null>(null);
  const [selected, setSelected] = useState<ReadonlyMap<string, string>>(new Map());
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [positionNote, setPositionNote] = useState(false);
  const cards = useRef(new Map<string, HTMLLIElement>());
  const device = useDeviceLocation();

  const bbox = zone ? toBbox(zone) : null;
  const query = listQuery(filters, bbox);
  const routes = useQuery({
    queryKey: ['routes', 'list', query],
    queryFn: ({ signal }) => api.listRoutes({ query }, { signal }),
    placeholderData: keepPreviousData,
  });
  const data = routes.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const onViewChange = useCallback(
    (bounds: MapBounds) => {
      setViewBounds(bounds);
      if (followMap) {
        setZone(bounds);
        update({ page: null });
      }
    },
    // `update` cambia en cada render y solo escribe en la dirección.
    [followMap],
  );

  const mapRoutes: MapRoute[] = useMemo(
    () => (data?.items ?? []).map((item) => ({ id: item.id, name: item.name, tone: toneOf(item), line: item.previewGeometry.coordinates as [number, number][] })),
    [data],
  );
  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  // El mapa encuadra las rutas cuando cambian los filtros o la página; mover el mapa no lo vuelve a encuadrar.
  const filterKey = JSON.stringify({ ...query, bbox: undefined });
  const fitKey = data && !routes.isFetching && !zone ? filterKey : undefined;

  const toggle = (id: string, name: string) =>
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });

  const showOnList = (id: string) => {
    setHighlighted(id);
    setView('list');
    // La tarjeta sale en pantalla y recibe el foco para quien navega con teclado o lector.
    setTimeout(() => {
      const card = cards.current.get(id);
      card?.scrollIntoView?.({ block: 'nearest' });
      card?.querySelector<HTMLElement>('a')?.focus();
    }, 0);
  };

  const myPosition = () => {
    if (device.location.status === 'ready') {
      setPositionNote(false);
      setFocus({ lat: device.location.lat, lon: device.location.lon, zoom: 11, nonce: Date.now() });
      return;
    }
    setPositionNote(true);
    device.request();
  };

  const filtered = activeFilterCount(filters) > 0;
  const writeActions = canWrite ? (
    <div className="page-actions">
      <Link className="button button-primary" to={PATHS.generateRoutes}>
        {t('generate.cta')}
      </Link>
      <Link className="button button-secondary" to={PATHS.routeImport}>
        {t('routes.importCta')}
      </Link>
      <Link className="button button-secondary" to={PATHS.createRoute}>
        {t('routes.drawCta')}
      </Link>
    </div>
  ) : null;

  return (
    <>
      <div className="page-heading">
        <h1>{t('routes.title')}</h1>
        {writeActions}
      </div>

      <ViewTabs view={view} onSelect={setView} />

      <div className="library" data-view={view}>
        <section className="library-list" id="library-panel-list" aria-labelledby="library-tab-list">
          <LibraryFilterPanel
            filters={filters}
            draft={draft}
            onDraft={setDraft}
            onSubmit={(event) => {
              event.preventDefault();
              update({ q: draft.trim(), page: null });
            }}
            update={update}
            clear={clear}
          />
          {zone && (
            <p className="zone-note" role="status">
              {t('routes.zone.applied')}{' '}
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  setZone(null);
                  update({ page: null });
                }}
              >
                {t('routes.zone.clear')}
              </button>
            </p>
          )}
          <SelectionBar
            selected={selected}
            canArchive={canWrite && filters.status === 'active'}
            onClear={() => setSelected(new Map())}
            onArchived={(ids) =>
              setSelected((previous) => {
                const next = new Map(previous);
                for (const id of ids) next.delete(id);
                return next;
              })
            }
          />

          {routes.isPending && <LoadingState />}
          {routes.isError && <ErrorState error={routes.error} onRetry={() => void routes.refetch()} />}
          {data && data.items.length === 0 && (
            <EmptyState
              action={
                filtered || zone ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      clear();
                      setZone(null);
                    }}
                  >
                    {t('routes.clearFilters')}
                  </button>
                ) : (
                  writeActions
                )
              }
            >
              {zone ? t('routes.empty.zone') : filtered ? t('routes.empty.filtered') : t('routes.empty.library')}
            </EmptyState>
          )}
          {data && data.items.length > 0 && (
            <>
              <p className="result-count" role="status">
                {data.total > data.items.length ? t('routes.summaryOnPage', { total: data.total, shown: data.items.length }) : t('routes.summary', { total: data.total })}
              </p>
              <ul className="route-list" aria-busy={routes.isFetching}>
                {data.items.map((item) => (
                  <RouteCard
                    key={item.id}
                    item={item}
                    selected={selected.has(item.id)}
                    highlighted={highlighted === item.id}
                    onToggle={() => toggle(item.id, item.name)}
                    onHighlight={(on) => setHighlighted((current) => (on ? item.id : current === item.id ? null : current))}
                    cardRef={(element) => {
                      if (element) cards.current.set(item.id, element);
                      else cards.current.delete(item.id);
                    }}
                  />
                ))}
              </ul>
              <Pager page={filters.page} pages={pages} onPage={(next) => update({ page: String(next) })} />
            </>
          )}
        </section>

        <section className="library-map" id="library-panel-map" aria-labelledby="library-tab-map">
          <div className="zone-controls">
            <label className="check-row">
              <input
                type="checkbox"
                checked={!followMap}
                onChange={(event) => {
                  setFollowMap(!event.target.checked);
                }}
              />
              <span>{t('routes.zone.followLabel')}</span>
            </label>
            {!followMap && (
              <button
                type="button"
                className="button button-secondary"
                disabled={!viewBounds}
                onClick={() => {
                  if (!viewBounds) return;
                  setZone(viewBounds);
                  update({ page: null });
                }}
              >
                {t('routes.zone.search')}
              </button>
            )}
            <button type="button" className="button button-secondary" onClick={myPosition}>
              {t('routes.map.myPosition')}
            </button>
          </div>
          {positionNote && device.location.status !== 'ready' && device.location.status !== 'pending' && (
            <p role="status" className="zone-note">
              {t('routes.map.myPositionUnavailable')}
            </p>
          )}
          <MapView
            className="library-map-view"
            label={t('routes.map.label')}
            routes={mapRoutes}
            highlightedRouteId={highlighted}
            selectedRouteIds={selectedIds}
            onRouteClick={showOnList}
            onViewChange={onViewChange}
            fitRoutesKey={fitKey}
            focus={focus}
          />
          <Legend />
          {data && data.total > data.items.length && <p className="legend-note">{t('routes.map.onlyPage')}</p>}
        </section>
      </div>
    </>
  );
}

function Legend() {
  const { t } = useTranslation();
  const tones = [
    ['validated', 'legendValidated'],
    ['draft', 'legendDraft'],
    ['stale', 'legendStale'],
    ['archived', 'legendArchived'],
  ] as const;
  return (
    <ul className="map-legend" aria-label={t('routes.map.legend')}>
      {tones.map(([tone, key]) => (
        <li key={tone}>
          <span className="legend-swatch" data-tone={tone} aria-hidden="true" />
          {t(`routes.map.${key}`)}
        </li>
      ))}
    </ul>
  );
}

/** Lista y Mapa como pestañas en pantallas estrechas (en las anchas se ven las dos a la vez y estas pestañas no se muestran). */
function ViewTabs({ view, onSelect }: { view: View; onSelect: (view: View) => void }) {
  const { t } = useTranslation();
  return (
    <div className="tabs library-tabs" role="tablist" aria-label={t('routes.views.label')}>
      {VIEWS.map((id) => (
        <button
          key={id}
          id={`library-tab-${id}`}
          type="button"
          role="tab"
          className="tab"
          aria-selected={view === id}
          aria-controls={`library-panel-${id}`}
          tabIndex={view === id ? 0 : -1}
          onClick={() => onSelect(id)}
          onKeyDown={(event) => {
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            if (step === 0) return;
            event.preventDefault();
            const next = VIEWS[(VIEWS.indexOf(id) + step + VIEWS.length) % VIEWS.length]!;
            onSelect(next);
            document.getElementById(`library-tab-${next}`)?.focus();
          }}
        >
          {t(`routes.views.${id}`)}
        </button>
      ))}
    </div>
  );
}

export { PAGE_SIZE };
