// Satélite de IGN España e IGN Francia compuesto por tesela (RF-304: la frontera no corta). IGN Francia responde con teselas
// enteramente blancas al otro lado de su frontera, así que apilar las dos fuentes dejaba huecos blancos sobre España. Aquí cada tesela
// se pide a las fuentes que la tocan, se pinta la española y encima la francesa con su blanco puro hecho transparente.
import { ES_BOUNDS, ES_ORTHO, FR_ORTHO, FR_STRIPS, type Bounds } from './ign.js';

export const SATELLITE_PROTOCOL = 'ign-sat';
export const SATELLITE_TILES = `${SATELLITE_PROTOCOL}://tiles/{z}/{x}/{y}`;

const TILE_SIZE = 256;
/** Un píxel cuenta como «sin datos» de IGN Francia si sus tres canales son casi 255 (el JPEG deja el blanco puro en 254–255). */
const BLANK_FROM = 253;

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** Límites geográficos (oeste, sur, este, norte) de una tesela de la pirámide Web Mercator. */
export function tileBounds({ z, x, y }: TileId): Bounds {
  const n = 2 ** z;
  const lon = (column: number) => (column / n) * 360 - 180;
  const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

const intersects = (a: Bounds, b: Bounds) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** De qué fuentes hay que pedir una tesela: la española si toca España, la francesa si toca alguna franja de Francia. */
export function sourcesFor(tile: TileId): { spanish: boolean; french: boolean } {
  const bounds = tileBounds(tile);
  return { spanish: intersects(bounds, ES_BOUNDS), french: FR_STRIPS.some((strip) => intersects(bounds, strip)) };
}

export function parseTileUrl(url: string): TileId | null {
  const match = /^ign-sat:\/\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
  return match ? { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) } : null;
}

const fill = (template: string, { z, x, y }: TileId) => template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
export const spanishUrl = (tile: TileId) => fill(ES_ORTHO, tile);
export const frenchUrl = (tile: TileId) => fill(FR_ORTHO, tile);

/** Hace transparentes los píxeles sin datos (blanco puro). Devuelve cuántos quedaron transparentes. Cambia `rgba` en el sitio. */
export function keyOutBlank(rgba: Uint8ClampedArray): number {
  let cleared = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i]! >= BLANK_FROM && rgba[i + 1]! >= BLANK_FROM && rgba[i + 2]! >= BLANK_FROM) {
      rgba[i + 3] = 0;
      cleared += 1;
    }
  }
  return cleared;
}

async function load(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  const response = await fetch(url, { signal });
  // 404 = esa fuente no tiene la tesela (lo normal fuera de su país): se compone sin ella.
  if (!response.ok) return null;
  return createImageBitmap(await response.blob());
}

/** Protocolo de MapLibre: la tesela compuesta, en PNG con transparencia (o una tesela vacía si ninguna fuente la tiene). */
export async function satelliteTile(params: { url: string }, abortController: AbortController): Promise<{ data: ArrayBuffer }> {
  const tile = parseTileUrl(params.url);
  if (!tile) throw new Error(`Dirección de tesela no válida: ${params.url}`);
  const { signal } = abortController;
  const wanted = sourcesFor(tile);
  const [spanish, french] = await Promise.all([wanted.spanish ? load(spanishUrl(tile), signal) : null, wanted.french ? load(frenchUrl(tile), signal) : null]);

  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No hay lienzo disponible para componer la tesela');
  if (spanish) context.drawImage(spanish, 0, 0, TILE_SIZE, TILE_SIZE);
  if (french) {
    const layer = new OffscreenCanvas(TILE_SIZE, TILE_SIZE).getContext('2d', { willReadFrequently: true })!;
    layer.drawImage(french, 0, 0, TILE_SIZE, TILE_SIZE);
    const pixels = layer.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    keyOutBlank(pixels.data);
    layer.putImageData(pixels, 0, 0);
    context.drawImage(layer.canvas, 0, 0);
  }
  spanish?.close();
  french?.close();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { data: await blob.arrayBuffer() };
}
