import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as maplibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import MapGL, { Layer, Marker, NavigationControl, Source, type MapLayerMouseEvent, type MapRef, type ViewStateChangeEvent } from 'react-map-gl/maplibre';
import { useTheme } from '../theme/theme-context.js';
import { Attribution } from './attribution.js';
import { SATELLITE_PROTOCOL, TOPOGRAPHIC_PROTOCOL, satelliteTile, topographicTile } from './ign-mix.js';
import { Readout, type Cursor } from './readout.js';
import { nearestSegment, type Vertex } from './edit.js';
import { ROUTES_LINE_LAYER, ROUTES_SOURCE, casingLayer, lineLayer, routesBounds, routesGeoJson } from './route-layers.js';
import { ROADS_SOURCE, buildStyle } from './style.js';
import { MAP_LAYERS, type MapLayerId, type MapViewProps } from './types.js';
import { initialViewFor } from './view.js';

// Registro único: el protocolo `pmtiles://` (extracto propio) y el trabajador de MapLibre, desde el propio origen (CSP `worker-src 'self'`).
maplibre.setWorkerUrl(workerUrl);
maplibre.addProtocol('pmtiles', new Protocol().tile);
maplibre.addProtocol(SATELLITE_PROTOCOL, satelliteTile);
maplibre.addProtocol(TOPOGRAPHIC_PROTOCOL, topographicTile);

const PICK_ZOOM = 12;
/** Más vértices que esto no se dibujan como controles (la lista de coordenadas sigue teniéndolos todos). */
const MAX_HANDLES = 400;

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Mapa con las tres capas, controles, indicador de coordenadas y altitud, y atribuciones. Único sitio que importa MapLibre. */
export default function MapView({
  markers = [],
  onPick,
  picking = false,
  elevationLookup,
  focus,
  fitToMarkers = false,
  defaultLayer = 'topographic',
  label,
  className,
  routes,
  highlightedRouteId,
  selectedRouteIds,
  onRouteClick,
  onViewChange,
  fitRoutesKey,
  editor,
}: MapViewProps) {
  const { t, i18n } = useTranslation();
  const mapRef = useRef<MapRef>(null);
  const [layer, setLayer] = useState<MapLayerId>(defaultLayer);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [roadsFailed, setRoadsFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const frame = useRef(0);
  // Solo al montar: después el mapa no se mueve solo (lo mueve la persona o una petición de `focus`).
  const [initialViewState] = useState(() => initialViewFor(fitToMarkers ? markers : []));

  const language = i18n.resolvedLanguage ?? 'es';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // El tema entra como el idioma o la capa: un estilo nuevo para el mismo mapa, que react-map-gl aplica con `setStyle` por diferencias
  // (sprites, colores) sin volver a montarlo; las rutas, marcadores y la vista se conservan (D-U7).
  const { resolved: theme } = useTheme();
  const style = useMemo(() => buildStyle(layer, language, origin, theme), [layer, language, origin, theme]);

  useEffect(() => {
    setRoadsFailed(false);
    setTilesFailed(false);
  }, [layer]);

  useEffect(() => {
    if (!focus) return;
    mapRef.current?.easeTo({
      center: [focus.lon, focus.lat],
      zoom: Math.max(mapRef.current.getZoom(), focus.zoom ?? PICK_ZOOM),
      duration: prefersReducedMotion() ? 0 : 600,
    });
    // `nonce` identifica la petición; las coordenadas solas no cambiarían si se pide el mismo punto dos veces.
  }, [focus]);

  // Encuadra todas las rutas cuando la página lo pide con una clave nueva (otros filtros, otra página), nunca por mover el mapa.
  // Si el mapa aún se está cargando cuando llega la clave, lo hace al terminar de cargar (`onLoad`).
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const fitKeyRef = useRef(fitRoutesKey);
  fitKeyRef.current = fitRoutesKey;
  const fitRoutes = useCallback(() => {
    const box = routesBounds(routesRef.current ?? []);
    if (!box) return;
    mapRef.current?.fitBounds(
      [
        [box.minLon, box.minLat],
        [box.maxLon, box.maxLat],
      ],
      { padding: 48, maxZoom: 14, duration: prefersReducedMotion() ? 0 : 600 },
    );
  }, []);
  useEffect(() => {
    if (fitRoutesKey !== undefined) fitRoutes();
  }, [fitRoutesKey, fitRoutes]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Arrastre de un vértice: sigue al puntero y, al soltar (si se movió de verdad), el editor recibe el punto nuevo.
  const [drag, setDrag] = useState<{ index: number; lon: number; lat: number } | null>(null);
  const startDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    const map = mapRef.current?.getMap();
    if (!map || event.button !== 0) return;
    const rect = map.getCanvas().getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    const at = (e: PointerEvent) => map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    let moved = false;
    const onMove = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 4) return;
      moved = true;
      const p = at(e);
      setDrag({ index, lon: p.lng, lat: p.lat });
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointercancel', onUp);
      setDrag(null);
      if (moved) {
        const p = at(e);
        editorRef.current?.onMove(index, { lat: p.lat, lon: p.lng });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  }, []);

  const editorRef = useRef(editor);
  editorRef.current = editor;

  const routeData = useMemo(() => routesGeoJson(routes ?? [], highlightedRouteId, selectedRouteIds), [routes, highlightedRouteId, selectedRouteIds]);

  // Solo los movimientos de la persona (con evento original) cuentan: un encuadre pedido por la página no debe cambiar la lista.
  const onMoveEnd = useCallback(
    (event: ViewStateChangeEvent) => {
      if (!onViewChange || !(event as { originalEvent?: unknown }).originalEvent) return;
      const bounds = event.target.getBounds();
      onViewChange({ minLon: bounds.getWest(), minLat: bounds.getSouth(), maxLon: bounds.getEast(), maxLat: bounds.getNorth() });
    },
    [onViewChange],
  );

  const onMouseMove = useCallback((event: MapLayerMouseEvent) => {
    const { lat, lng } = event.lngLat;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setCursor({ lat, lon: lng, immediate: false }));
  }, []);

  const onClick = useCallback(
    (event: MapLayerMouseEvent) => {
      const { lat, lng } = event.lngLat;
      cancelAnimationFrame(frame.current);
      setCursor({ lat, lon: lng, immediate: true });
      const routeId = event.features?.find((feature) => feature.layer.id === ROUTES_LINE_LAYER)?.properties?.id;
      // Con el editor, tocar la línea inserta un vértice en el tramo tocado; fuera de la línea, `onPick` añade uno al final.
      if (typeof routeId === 'string' && editorRef.current) {
        const at = nearestSegment(editorRef.current.vertices as Vertex[], [lng, lat]);
        if (at !== null) editorRef.current.onInsert(at + 1, { lat, lon: lng });
        return;
      }
      if (typeof routeId === 'string' && onRouteClick) {
        onRouteClick(routeId);
        return;
      }
      onPick?.({ lat, lon: lng });
    },
    [onPick, onRouteClick],
  );

  const onError = useCallback((event: { sourceId?: string; error?: unknown }) => {
    if (event.sourceId === ROADS_SOURCE) {
      setRoadsFailed(true);
      return;
    }
    // IGN Francia contesta 404 donde no tiene datos (lado español): no es un fallo, ahí se ve la capa de IGN España de debajo.
    const status = (event.error as { status?: number } | undefined)?.status;
    if (status !== 404) setTilesFailed(true);
  }, []);

  const mapLocale = useMemo(
    () => ({
      'Map.Title': t('map.label'),
      'NavigationControl.ZoomIn': t('map.zoomIn'),
      'NavigationControl.ZoomOut': t('map.zoomOut'),
      'NavigationControl.ResetBearing': t('map.resetNorth'),
    }),
    [t],
  );

  return (
    <section className={['map-view', className].filter(Boolean).join(' ')} aria-label={label ?? t('map.label')} data-picking={picking || undefined}>
      <div className="map-toolbar">
        <div className="map-layers" role="group" aria-label={t('map.layers.label')}>
          {MAP_LAYERS.map((id) => (
            <button key={id} type="button" className="map-layer-button" aria-pressed={layer === id} onClick={() => setLayer(id)}>
              {t(`map.layers.${id}`)}
            </button>
          ))}
        </div>
        {picking && <p className="map-picking">{t('point.mapPicking')}</p>}
      </div>
      <div className="map-canvas">
        <MapGL
          ref={mapRef}
          mapLib={maplibre}
          mapStyle={style}
          initialViewState={initialViewState}
          minZoom={4}
          maxZoom={18}
          attributionControl={false}
          dragRotate
          locale={mapLocale}
          cursor={onPick ? 'crosshair' : undefined}
          interactiveLayerIds={routes ? [ROUTES_LINE_LAYER] : undefined}
          onMouseMove={onMouseMove}
          onMoveEnd={onMoveEnd}
          onClick={onClick}
          onLoad={() => fitKeyRef.current !== undefined && fitRoutes()}
          onError={onError}
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="top-right" showCompass visualizePitch={false} />
          {routes && (
            <Source id={ROUTES_SOURCE} type="geojson" data={routeData as never}>
              <Layer {...casingLayer} />
              <Layer {...lineLayer} />
            </Source>
          )}
          {editor?.vertices.slice(0, MAX_HANDLES).map((vertex, index) => (
            <Marker key={`vertex-${index}`} longitude={drag?.index === index ? drag.lon : vertex[0]} latitude={drag?.index === index ? drag.lat : vertex[1]} anchor="center">
              <button
                type="button"
                className="vertex-handle"
                data-end={index === 0 ? 'start' : index === editor.vertices.length - 1 ? 'end' : undefined}
                aria-label={editor.labelFor(index)}
                aria-pressed={editor.selected === index}
                // El arrastre es propio (eventos de puntero): el mapa no debe empezar a desplazarse con el mismo gesto.
                onMouseDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onPointerDown={(event) => startDrag(event, index)}
                onClick={(event) => {
                  event.stopPropagation();
                  editor.onSelect(editor.selected === index ? null : index);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Delete' || event.key === 'Backspace') {
                    event.preventDefault();
                    editor.onRemove(index);
                  }
                }}
              />
            </Marker>
          ))}
          {markers.map((marker) => (
            <Marker key={marker.id} longitude={marker.lon} latitude={marker.lat} anchor="bottom">
              <div className="map-marker" data-kind={marker.kind} role="img" aria-label={marker.label ?? t(`map.markers.${marker.kind}`)} />
            </Marker>
          ))}
        </MapGL>
      </div>
      {layer === 'roads' && roadsFailed && (
        <p className="map-notice" role="status">
          {t('map.roadsUnavailable')}
        </p>
      )}
      {tilesFailed && layer !== 'roads' && (
        <p className="map-notice" role="status">
          {t('map.tilesError')}
        </p>
      )}
      <Readout cursor={cursor} lookup={elevationLookup} />
      <Attribution layer={layer} withElevation={elevationLookup !== undefined} />
    </section>
  );
}
