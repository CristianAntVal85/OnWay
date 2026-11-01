// Las rutas de la biblioteca como capas de MapLibre: datos GeoJSON, pintura y encuadre. Geometría de mapa: vive aquí (regla inviolable 9).
import type { LayerProps } from 'react-map-gl/maplibre';
import type { MapBounds, MapRoute, MapRouteTone } from './types.js';

export const ROUTES_SOURCE = 'library-routes';
export const ROUTES_LINE_LAYER = 'library-routes-line';
export const ROUTES_CASING_LAYER = 'library-routes-casing';

/** Colores por tipo de ruta; el trazo también cambia (sólido, discontinuo, punteado) para no depender solo del color. */
export const TONE_COLORS: Record<MapRouteTone, string> = {
  validated: '#1f6b3a',
  draft: '#8a5a00',
  stale: '#b3261e',
  archived: '#5f6b73',
  'compare-a': '#0b5cad',
  'compare-b': '#7b2d8e',
  avoid: '#c2185b',
};

/** El GeoJSON mínimo que MapLibre lee: una línea por ruta con lo que la pintura necesita. */
export interface RoutesGeoJson {
  type: 'FeatureCollection';
  features: { type: 'Feature'; properties: { id: string; name: string; tone: MapRouteTone; highlighted: 0 | 1; selected: 0 | 1 }; geometry: { type: 'LineString'; coordinates: number[][] } }[];
}

export function routesGeoJson(routes: readonly MapRoute[], highlightedId: string | null | undefined, selectedIds: ReadonlySet<string> | undefined): RoutesGeoJson {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((route) => route.line.length >= 2)
      .map((route) => ({
        type: 'Feature' as const,
        properties: { id: route.id, name: route.name, tone: route.tone, highlighted: route.id === highlightedId ? 1 : 0, selected: selectedIds?.has(route.id) ? 1 : 0 },
        geometry: { type: 'LineString' as const, coordinates: route.line.map(([lon, lat]) => [lon, lat]) },
      })),
  };
}

const width = ['case', ['==', ['get', 'highlighted'], 1], 7, ['==', ['get', 'selected'], 1], 5, 3.5] as const;

/** Una línea blanca más ancha debajo de cada ruta, para que se lea sobre el satélite y sobre el topográfico. */
export const casingLayer = {
  id: ROUTES_CASING_LAYER,
  type: 'line',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': '#ffffff', 'line-opacity': 0.9, 'line-width': ['+', width, 3] },
} as unknown as LayerProps;

export const lineLayer = {
  id: ROUTES_LINE_LAYER,
  type: 'line',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': [
      'match',
      ['get', 'tone'],
      'validated',
      TONE_COLORS.validated,
      'draft',
      TONE_COLORS.draft,
      'stale',
      TONE_COLORS.stale,
      'compare-a',
      TONE_COLORS['compare-a'],
      'compare-b',
      TONE_COLORS['compare-b'],
      'avoid',
      TONE_COLORS.avoid,
      TONE_COLORS.archived,
    ],
    'line-width': width,
    'line-dasharray': [
      'match',
      ['get', 'tone'],
      'draft',
      ['literal', [2, 1.5]],
      'compare-b',
      ['literal', [2, 1.5]],
      'archived',
      ['literal', [0.5, 2]],
      'avoid',
      ['literal', [1, 1]],
      ['literal', [1, 0]],
    ],
  },
} as unknown as LayerProps;

/** Caja que contiene todas las rutas, o `null` si no hay ninguna con línea. */
export function routesBounds(routes: readonly MapRoute[]): MapBounds | null {
  let box: MapBounds | null = null;
  for (const route of routes) {
    for (const [lon, lat] of route.line) {
      box = box
        ? { minLon: Math.min(box.minLon, lon), minLat: Math.min(box.minLat, lat), maxLon: Math.max(box.maxLon, lon), maxLat: Math.max(box.maxLat, lat) }
        : { minLon: lon, minLat: lat, maxLon: lon, maxLat: lat };
    }
  }
  return box;
}
