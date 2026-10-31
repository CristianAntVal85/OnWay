import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as maplibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import MapGL, { Marker, NavigationControl, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import { Attribution } from './attribution.js';
import { SATELLITE_PROTOCOL, satelliteTile } from './ign-mix.js';
import { Readout, type Cursor } from './readout.js';
import { ROADS_SOURCE, buildStyle } from './style.js';
import { MAP_LAYERS, type MapLayerId, type MapViewProps } from './types.js';

// Registro único: el protocolo `pmtiles://` (extracto propio) y el trabajador de MapLibre, desde el propio origen (CSP `worker-src 'self'`).
maplibre.setWorkerUrl(workerUrl);
maplibre.addProtocol('pmtiles', new Protocol().tile);
maplibre.addProtocol(SATELLITE_PROTOCOL, satelliteTile);

/** Los Pirineos: la caja de `geodata` (lon −2…4, lat 42…44). El mapa no se limita a ella: sigue a ambos lados de la frontera (RF-304). */
const INITIAL_BOUNDS: [number, number, number, number] = [-2, 42, 4, 44];
const PICK_ZOOM = 12;

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Mapa con las tres capas, controles, indicador de coordenadas y altitud, y atribuciones. Único sitio que importa MapLibre. */
export default function MapView({ markers = [], onPick, picking = false, elevationLookup, focus, defaultLayer = 'topographic', label, className }: MapViewProps) {
  const { t, i18n } = useTranslation();
  const mapRef = useRef<MapRef>(null);
  const [layer, setLayer] = useState<MapLayerId>(defaultLayer);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [roadsFailed, setRoadsFailed] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const frame = useRef(0);

  const language = i18n.resolvedLanguage ?? 'es';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const style = useMemo(() => buildStyle(layer, language, origin), [layer, language, origin]);

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

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

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
      onPick?.({ lat, lon: lng });
    },
    [onPick],
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
          initialViewState={{ bounds: INITIAL_BOUNDS, fitBoundsOptions: { padding: 24 } }}
          minZoom={4}
          maxZoom={18}
          attributionControl={false}
          dragRotate
          locale={mapLocale}
          cursor={onPick ? 'crosshair' : undefined}
          onMouseMove={onMouseMove}
          onClick={onClick}
          onError={onError}
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="top-right" showCompass visualizePitch={false} />
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
