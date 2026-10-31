// Contrato del módulo del mapa: lo único que ven las páginas. Nada de MapLibre cruza esta frontera (D-H1-07).

/** Las tres capas conmutables (RF-301). */
export type MapLayerId = 'satellite' | 'topographic' | 'roads';

export const MAP_LAYERS: readonly MapLayerId[] = ['satellite', 'topographic', 'roads'];

export interface MapPoint {
  lat: number;
  lon: number;
}

export type MarkerKind = 'target' | 'origin' | 'waypoint' | 'rendezvous';

export interface MapMarker extends MapPoint {
  id: string;
  kind: MarkerKind;
  /** Nombre que se anuncia; si falta, el del tipo de punto. */
  label?: string;
}

/** Altitud de un punto, en metros, o `null` si no hay dato. Solo la tiene el personal (el rescatista no tiene `getElevation`). */
export type ElevationLookup = (point: MapPoint) => Promise<number | null>;

export interface MapFocus extends MapPoint {
  zoom?: number;
  /** Cambia en cada petición, para volver a centrar en el mismo punto. */
  nonce: number;
}

/** Cómo se pinta una ruta: borrador, validada, validación antigua o archivada. Además del color cambia el trazo (sólido, discontinuo, punteado). */
export type MapRouteTone = 'draft' | 'validated' | 'stale' | 'archived' | 'compare-a' | 'compare-b';

/** Una ruta de la biblioteca sobre el mapa: la línea ya viene simplificada del servidor (`previewGeometry`). */
export interface MapRoute {
  id: string;
  name: string;
  tone: MapRouteTone;
  /** `[lon, lat]`. */
  line: readonly (readonly [number, number])[];
}

/** Zona visible del mapa, en grados. */
export interface MapBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Edición de una línea sobre el mapa: vértices que se arrastran, se eligen, se borran y tramos donde se inserta un punto. */
export interface MapEditor {
  /** `[lon, lat]` de cada vértice, en orden. */
  vertices: readonly (readonly [number, number])[];
  selected: number | null;
  onMove: (index: number, point: MapPoint) => void;
  /** Se ha tocado el tramo que termina en `index - 1 → index`: hay que insertar ahí. */
  onInsert: (index: number, point: MapPoint) => void;
  onSelect: (index: number | null) => void;
  onRemove: (index: number) => void;
  /** Nombre accesible de cada vértice. */
  labelFor: (index: number) => string;
}

export interface MapViewProps {
  markers?: readonly MapMarker[];
  /** Clic o toque en el mapa. Si no se pasa, el mapa es solo de consulta. */
  onPick?: (point: MapPoint) => void;
  /** Con `onPick`, indica en el mapa y en voz alta que se está esperando un punto. */
  picking?: boolean;
  /** Sin esta función (rescatista) el indicador muestra solo coordenadas. */
  elevationLookup?: ElevationLookup;
  focus?: MapFocus | null;
  /** Al montarse, encuadra los marcadores que haya (uno: centrado; varios: todos a la vista). Sin marcadores, los Pirineos. */
  fitToMarkers?: boolean;
  defaultLayer?: MapLayerId;
  /** Rutas de la biblioteca como líneas. */
  routes?: readonly MapRoute[];
  /** Ruta resaltada (la tarjeta señalada o la línea tocada). */
  highlightedRouteId?: string | null;
  /** Rutas marcadas en la lista: se dibujan más gruesas. */
  selectedRouteIds?: ReadonlySet<string>;
  /** Clic o toque sobre una línea de ruta (en vez de `onPick`). */
  onRouteClick?: (routeId: string) => void;
  /** La persona ha movido o acercado el mapa (no una orden de la página): zona que se ve ahora. */
  onViewChange?: (bounds: MapBounds) => void;
  /** Cada vez que cambia (y no es `undefined`), el mapa encuadra todas las rutas. */
  fitRoutesKey?: string;
  /** Editor de línea (dibujar y editar rutas). Con él, tocar un tramo inserta un vértice y los vértices se arrastran. */
  editor?: MapEditor;
  /** Nombre accesible de la región del mapa. */
  label?: string;
  className?: string;
}
