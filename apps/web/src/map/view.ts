// Encuadre inicial del mapa a partir de los marcadores. Geometría de mapa: vive aquí, no en las páginas (regla inviolable 9).
import type { MapPoint } from './types.js';

/** Los Pirineos: la caja de `geodata` (lon −2…4, lat 42…44). El mapa no se limita a ella: sigue a ambos lados de la frontera (RF-304). */
export const PYRENEES_BOUNDS: [number, number, number, number] = [-2, 42, 4, 44];

const SINGLE_POINT_ZOOM = 12;
const FIT_PADDING = 48;
const FIT_MAX_ZOOM = 14;

export type InitialView = { bounds: [number, number, number, number]; fitBoundsOptions: { padding: number; maxZoom?: number } } | { longitude: number; latitude: number; zoom: number };

/** Sin puntos, los Pirineos; con uno, centrado en él; con varios, la caja que los contiene. */
export function initialViewFor(points: readonly MapPoint[]): InitialView {
  const first = points[0];
  if (!first) return { bounds: PYRENEES_BOUNDS, fitBoundsOptions: { padding: 24 } };
  let west = first.lon;
  let east = first.lon;
  let south = first.lat;
  let north = first.lat;
  for (const point of points) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  if (west === east && south === north) return { longitude: first.lon, latitude: first.lat, zoom: SINGLE_POINT_ZOOM };
  return { bounds: [west, south, east, north], fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM } };
}
