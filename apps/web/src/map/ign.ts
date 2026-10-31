// Servicios de IGN España e IGN Francia: el ÚNICO módulo que declara anfitriones de terceros (D-H1-08).
// La prueba «sin recursos externos» exige que estos dos anfitriones, y solo estos, estén aquí y en la CSP de `infra/Caddyfile`.
//
// Verificado en sus GetCapabilities oficiales el 2026-10-31 (doc 04 §8.2):
//  - IGN España, `https://www.ign.es/wmts/pnoa-ma` capa `OI.OrthoimageCoverage` («Imágenes de satélite Sentinel y ortofotos PNOA») y
//    `https://www.ign.es/wmts/mapa-raster` capa `MTN` («Cartografía del IGN», MTN 1:50 000 y 1:25 000): TileMatrixSet `GoogleMapsCompatible`,
//    niveles 0–20, JPEG; Fees «No se aplican condiciones»; AccessConstraints «CC BY 4.0». Solo KVP.
//  - IGN Francia, `https://data.geopf.fr/wmts` capas `ORTHOIMAGERY.ORTHOPHOTOS` («Photographies aériennes», niveles 0–19, JPEG) y
//    `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` («Plan IGN», con curvas de nivel y sombreado, niveles 0–19, PNG): TileMatrixSet `PM`;
//    Fees «none»; condiciones: cartes.gouv.fr/cgu (WMTS «non soumis à limite d'usage»; datos con Licence Ouverte 2.0).
//    No hay SCAN 25 público en ese servicio: la capa topográfica francesa es el Plan IGN.
// Ambos responden con `Access-Control-Allow-Origin: *`, así que el navegador puede pedirlas directamente.

export const IGN_HOSTS = ['www.ign.es', 'data.geopf.fr'] as const;

export type Bounds = readonly [west: number, south: number, east: number, north: number];

export interface RasterSource {
  id: string;
  /** Plantilla de teselas con {z}/{x}/{y}. */
  tiles: string;
  bounds: Bounds;
  maxzoom: number;
}

const es = (service: string, layer: string, style: string, format: string, tms: string) =>
  `https://www.ign.es/wmts/${service}?service=WMTS&request=GetTile&version=1.0.0&layer=${layer}&style=${style}&format=${format}&tilematrixset=${tms}&tilematrix={z}&tilerow={y}&tilecol={x}`;
const fr = (layer: string, format: string) =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&FORMAT=${format}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

export const ES_ORTHO = es('pnoa-ma', 'OI.OrthoimageCoverage', 'default', 'image/jpeg', 'GoogleMapsCompatible');
const ES_TOPO = es('mapa-raster', 'MTN', 'default', 'image/jpeg', 'GoogleMapsCompatible');
export const FR_ORTHO = fr('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg');
const FR_TOPO = fr('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png');

/** España peninsular y Baleares. Debajo de la francesa: lo que IGN Francia no tiene (404) deja ver esta. */
export const ES_BOUNDS: Bounds = [-9.5, 35.8, 4.5, 43.9];

/**
 * Francia, en franjas de longitud con el borde sur un poco al sur de la frontera de los Pirineos (la frontera va en diagonal y un
 * solo rectángulo no la sigue). Un rectángulo por franja evita pedir miles de teselas españolas a IGN Francia, que contesta 404
 * donde no tiene datos; el margen deja que ninguna tesela francesa quede sin cubrir. Es una aproximación nuestra, no un dato de IGN.
 */
export const FR_STRIPS: readonly Bounds[] = [
  [-5.3, 43.3, -1.75, 51.2],
  [-1.75, 42.75, -0.65, 51.2],
  [-0.65, 42.55, 0.65, 51.2],
  [0.65, 42.35, 2.0, 51.2],
  [2.0, 42.25, 3.5, 51.2],
  [3.5, 41.3, 9.7, 51.2],
];

const MAX_ZOOM = 18;

function sources(prefix: string, spanish: string, french: string): RasterSource[] {
  return [
    { id: `${prefix}-es`, tiles: spanish, bounds: ES_BOUNDS, maxzoom: MAX_ZOOM },
    ...FR_STRIPS.map((bounds, index) => ({ id: `${prefix}-fr-${index + 1}`, tiles: french, bounds, maxzoom: MAX_ZOOM })),
  ];
}

/** Topográfico, de abajo arriba: IGN España y encima las franjas de IGN Francia (el Plan IGN responde 404 donde no tiene datos). */
export function topographicSources(): RasterSource[] {
  return sources('topo', ES_TOPO, FR_TOPO);
}

/**
 * El satélite NO se apila: IGN Francia contesta con teselas completamente blancas (200, no 404) del otro lado de la frontera y taparían
 * a IGN España. Se pide a través del protocolo `ign-sat://` (ign-mix.ts), que compone por tesela las dos fuentes y quita ese blanco.
 */
export const SATELLITE_MAX_ZOOM = MAX_ZOOM;
