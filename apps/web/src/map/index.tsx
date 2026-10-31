// Frontera del mapa (D-H1-07, regla inviolable 9): las páginas solo importan de aquí. MapLibre, react-map-gl y pmtiles
// se cargan en un trozo aparte, solo cuando se muestra un mapa; el resto de la web no los descarga.
import { lazy, Suspense } from 'react';
import { LoadingStatus } from './loading.js';
import type { MapViewProps } from './types.js';

const Loaded = lazy(() => import('./map-view.js'));

export function MapView(props: MapViewProps) {
  return (
    <Suspense fallback={<LoadingStatus className={props.className} />}>
      <Loaded {...props} />
    </Suspense>
  );
}

export {
  MAP_LAYERS,
  type ElevationLookup,
  type MapBounds,
  type MapFocus,
  type MapLayerId,
  type MapMarker,
  type MapPoint,
  type MapRoute,
  type MapRouteTone,
  type MapViewProps,
  type MarkerKind,
} from './types.js';
