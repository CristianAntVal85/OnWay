// Estilos de MapLibre de cada capa. El mapa base de carreteras es un PMTiles propio (servido por Caddy desde el volumen
// `geodata`) pintado con @protomaps/basemaps; satélite y topográfico son teselas WMTS de IGN España y Francia (ign.ts).
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import { SATELLITE_MAX_ZOOM, TOPOGRAPHIC_MAX_ZOOM } from './ign.js';
import { SATELLITE_TILES, TOPOGRAPHIC_TILES } from './ign-mix.js';
import type { ThemeName } from '../theme/theme.js';
import type { MapLayerId } from './types.js';

/** Dónde sirve Caddy el extracto PMTiles, las fuentes y los sprites (`infra/Caddyfile`, ruta `/tiles/`). */
export const TILES_PATH = '/tiles';
export const PMTILES_FILE = 'pyrenees.pmtiles';
export const ROADS_SOURCE = 'protomaps';

/**
 * El estilo de una capa. `origin` es el del propio sitio: las teselas propias son del mismo origen (CSP `'self'`).
 * `theme` solo cambia el mapa de carreteras (sabor y sprites de Protomaps, D-U2); satélite y topográfico (IGN) no se tematizan:
 * lo único que sigue al tema es el color de fondo que se ve mientras llegan las teselas, el mismo del sabor de Protomaps.
 */
export function buildStyle(layer: MapLayerId, language: string, origin: string, theme: ThemeName): StyleSpecification {
  const flavor = namedFlavor(theme);
  const background = { id: 'background', type: 'background', paint: { 'background-color': flavor.background } } as const;

  if (layer === 'roads') {
    return {
      version: 8,
      glyphs: `${origin}${TILES_PATH}/assets/fonts/{fontstack}/{range}.pbf`,
      sprite: `${origin}${TILES_PATH}/assets/sprites/v4/${theme}`,
      sources: { [ROADS_SOURCE]: { type: 'vector', url: `pmtiles://${origin}${TILES_PATH}/${PMTILES_FILE}`, maxzoom: 14 } },
      layers: protomapsLayers(ROADS_SOURCE, flavor, { lang: language }) as StyleSpecification['layers'],
    };
  }

  if (layer === 'satellite') {
    return {
      version: 8,
      sources: { satellite: { type: 'raster', tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: SATELLITE_MAX_ZOOM } },
      layers: [background, { id: 'satellite', type: 'raster', source: 'satellite' }],
    };
  }

  return {
    version: 8,
    sources: { topographic: { type: 'raster', tiles: [TOPOGRAPHIC_TILES], tileSize: 256, maxzoom: TOPOGRAPHIC_MAX_ZOOM } },
    layers: [background, { id: 'topographic', type: 'raster', source: 'topographic' }],
  };
}
