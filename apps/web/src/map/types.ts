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

export interface MapViewProps {
  markers?: readonly MapMarker[];
  /** Clic o toque en el mapa. Si no se pasa, el mapa es solo de consulta. */
  onPick?: (point: MapPoint) => void;
  /** Con `onPick`, indica en el mapa y en voz alta que se está esperando un punto. */
  picking?: boolean;
  /** Sin esta función (rescatista) el indicador muestra solo coordenadas. */
  elevationLookup?: ElevationLookup;
  focus?: MapFocus | null;
  defaultLayer?: MapLayerId;
  /** Nombre accesible de la región del mapa. */
  label?: string;
  className?: string;
}
