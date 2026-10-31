// Estilos de MapLibre de cada capa. El mapa base de carreteras es un PMTiles propio (servido por Caddy desde el volumen
// `geodata`) pintado con @protomaps/basemaps; satélite y topográfico son teselas WMTS de IGN España y Francia (ign.ts).
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import { SATELLITE_MAX_ZOOM, topographicSources } from './ign.js';
import { SATELLITE_TILES } from './ign-mix.js';
import type { MapLayerId } from './types.js';

/** Dónde sirve Caddy el extracto PMTiles, las fuentes y los sprites (`infra/Caddyfile`, ruta `/tiles/`). */
export const TILES_PATH = '/tiles';
export const PMTILES_FILE = 'pyrenees.pmtiles';
export const ROADS_SOURCE = 'protomaps';

/** El estilo de una capa. `origin` es el del propio sitio: las teselas propias son del mismo origen (CSP `'self'`). */
export function buildStyle(layer: MapLayerId, language: string, origin: string): StyleSpecification {
  const background = { id: 'background', type: 'background', paint: { 'background-color': '#e8ecea' } } as const;

  if (layer === 'roads') {
    return {
      version: 8,
      glyphs: `${origin}${TILES_PATH}/assets/fonts/{fontstack}/{range}.pbf`,
      sprite: `${origin}${TILES_PATH}/assets/sprites/v4/light`,
      sources: { [ROADS_SOURCE]: { type: 'vector', url: `pmtiles://${origin}${TILES_PATH}/${PMTILES_FILE}`, maxzoom: 14 } },
      layers: protomapsLayers(ROADS_SOURCE, namedFlavor('light'), { lang: language }) as StyleSpecification['layers'],
    };
  }

  if (layer === 'satellite') {
    return {
      version: 8,
      sources: { satellite: { type: 'raster', tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: SATELLITE_MAX_ZOOM } },
      layers: [background, { id: 'satellite', type: 'raster', source: 'satellite' }],
    };
  }

  const raster = topographicSources();
  return {
    version: 8,
    sources: Object.fromEntries(raster.map((source) => [source.id, { type: 'raster', tiles: [source.tiles], tileSize: 256, maxzoom: source.maxzoom, bounds: [...source.bounds] }])),
    layers: [background, ...raster.map((source) => ({ id: source.id, type: 'raster' as const, source: source.id }))],
  };
}
