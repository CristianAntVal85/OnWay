// Satélite de IGN España e IGN Francia compuesto por tesela (RF-304: la frontera no corta). IGN Francia responde con teselas
// enteramente blancas al otro lado de su frontera, así que apilar las dos fuentes dejaba huecos blancos sobre España. Aquí cada tesela
// se pide a las fuentes que la tocan, se pinta la española y encima la francesa con su blanco puro hecho transparente.
import { ES_BOUNDS, ES_ORTHO, ES_TOPO, FR_ORTHO, FR_STRIPS, FR_TOPO, type Bounds } from './ign.js';

export const SATELLITE_PROTOCOL = 'ign-sat';
export const SATELLITE_TILES = `${SATELLITE_PROTOCOL}://tiles/{z}/{x}/{y}`;
export const TOPOGRAPHIC_PROTOCOL = 'ign-topo';
export const TOPOGRAPHIC_TILES = `${TOPOGRAPHIC_PROTOCOL}://tiles/{z}/{x}/{y}`;

const TILE_SIZE = 256;
/** Un píxel cuenta como «sin datos» de IGN Francia (satélite) si sus tres canales son casi 255 (el JPEG deja el blanco puro en 254–255). */
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
  const match = /^ign-(?:sat|topo):\/\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
  return match ? { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) } : null;
}

const fill = (template: string, { z, x, y }: TileId) => template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
export const spanishUrl = (tile: TileId) => fill(ES_ORTHO, tile);
export const frenchUrl = (tile: TileId) => fill(FR_ORTHO, tile);
export const spanishTopoUrl = (tile: TileId) => fill(ES_TOPO, tile);
export const frenchTopoUrl = (tile: TileId) => fill(FR_TOPO, tile);

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

/**
 * Cuánto detalle tiene una tesela: la diferencia media entre píxeles vecinos (0–765). Fuera de su cobertura el MTN de IGN España no
 * contesta en blanco sino con un relieve sombreado y borroso (medido el 2026-11-01: 0,04–2,3 en Lourdes, Pau, Foix, Perpiñán y
 * a 43,0° N; 15–82 en cualquier tesela de mapa real, también el mar y los lagos del lado español, 0,3–0,6, que no tienen Francia debajo).
 */
export function detailOf(rgba: Uint8ClampedArray, width = TILE_SIZE): number {
  let sum = 0;
  let count = 0;
  for (let row = 0; row < rgba.length / 4 / width; row += 2) {
    for (let column = 0; column < width - 1; column += 1) {
      const i = (row * width + column) * 4;
      sum += Math.abs(rgba[i]! - rgba[i + 4]!) + Math.abs(rgba[i + 1]! - rgba[i + 5]!) + Math.abs(rgba[i + 2]! - rgba[i + 6]!);
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}
/** Por debajo de esto una tesela del MTN es el relieve de relleno de fuera de su cobertura. */
export const NO_DATA_DETAIL = 6;
const BLOCK = 32;
/** Un bloque de la tesela con menos detalle que esto es relleno (el relleno mide < 1,5; el mapa real, mucho más). */
const NO_DATA_BLOCK_DETAIL = 3;

/**
 * En una tesela del borde de la cobertura (mitad mapa, mitad relleno) hace transparentes los bloques de 32 × 32 px que son relleno,
 * para que se vea el Plan IGN que hay debajo. Devuelve cuántos bloques quedaron transparentes. Cambia `rgba` en el sitio.
 */
export function keyOutFlatBlocks(rgba: Uint8ClampedArray, width = TILE_SIZE): number {
  const height = rgba.length / 4 / width;
  let cleared = 0;
  for (let top = 0; top < height; top += BLOCK) {
    for (let left = 0; left < width; left += BLOCK) {
      let sum = 0;
      let count = 0;
      for (let row = top; row < Math.min(top + BLOCK, height); row += 1) {
        for (let column = left; column < Math.min(left + BLOCK, width) - 1; column += 1) {
          const i = (row * width + column) * 4;
          sum += Math.abs(rgba[i]! - rgba[i + 4]!) + Math.abs(rgba[i + 1]! - rgba[i + 5]!) + Math.abs(rgba[i + 2]! - rgba[i + 6]!);
          count += 1;
        }
      }
      if (count > 0 && sum / count < NO_DATA_BLOCK_DETAIL) {
        for (let row = top; row < Math.min(top + BLOCK, height); row += 1) for (let column = left; column < Math.min(left + BLOCK, width); column += 1) rgba[(row * width + column) * 4 + 3] = 0;
        cleared += 1;
      }
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

interface Mix {
  /** La fuente que se pinta primero (la de debajo); la otra va encima. */
  bottom: 'spanish' | 'french';
  spanishUrl: (tile: TileId) => string;
  frenchUrl: (tile: TileId) => string;
  /** Prepara la capa de encima (puede cambiar `rgba`) y dice si se pinta; `hasBottom`: hay algo debajo que dejar ver. */
  prepareTop: (rgba: Uint8ClampedArray, hasBottom: boolean) => boolean;
}

/** Protocolo de MapLibre: la tesela compuesta, en PNG con transparencia (o una tesela vacía si ninguna fuente la tiene). */
async function mixedTile(params: { url: string }, abortController: AbortController, mix: Mix): Promise<{ data: ArrayBuffer }> {
  const tile = parseTileUrl(params.url);
  if (!tile) throw new Error(`Dirección de tesela no válida: ${params.url}`);
  const { signal } = abortController;
  const wanted = sourcesFor(tile);
  const [spanish, french] = await Promise.all([wanted.spanish ? load(mix.spanishUrl(tile), signal) : null, wanted.french ? load(mix.frenchUrl(tile), signal) : null]);
  const bottom = mix.bottom === 'spanish' ? spanish : french;
  const top = mix.bottom === 'spanish' ? french : spanish;

  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No hay lienzo disponible para componer la tesela');
  if (bottom) context.drawImage(bottom, 0, 0, TILE_SIZE, TILE_SIZE);
  if (top) {
    const layer = new OffscreenCanvas(TILE_SIZE, TILE_SIZE).getContext('2d', { willReadFrequently: true })!;
    layer.drawImage(top, 0, 0, TILE_SIZE, TILE_SIZE);
    const pixels = layer.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    if (mix.prepareTop(pixels.data, bottom !== null)) {
      layer.putImageData(pixels, 0, 0);
      context.drawImage(layer.canvas, 0, 0);
    }
  }
  spanish?.close();
  french?.close();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { data: await blob.arrayBuffer() };
}

/** Satélite: IGN España debajo y encima IGN Francia (con su blanco transparente). */
export const satelliteTile = (params: { url: string }, abortController: AbortController) =>
  mixedTile(params, abortController, {
    bottom: 'spanish',
    spanishUrl,
    frenchUrl,
    prepareTop: (rgba) => {
      keyOutBlank(rgba);
      return true;
    },
  });

/**
 * Topográfico: el Plan IGN debajo y encima el MTN de IGN España, que se descarta solo cuando es el relieve de relleno de fuera de su
 * cobertura (`detailOf`) y hay Plan IGN debajo; en las teselas del borde, solo los bloques de relleno. Donde el MTN tiene datos —toda España y una franja de Francia— se ve el MTN.
 */
export const topographicTile = (params: { url: string }, abortController: AbortController) =>
  mixedTile(params, abortController, {
    bottom: 'french',
    spanishUrl: spanishTopoUrl,
    frenchUrl: frenchTopoUrl,
    prepareTop: (rgba, hasBottom) => {
      if (!hasBottom) return true;
      if (detailOf(rgba) < NO_DATA_DETAIL) return false;
      keyOutFlatBlocks(rgba); // tesela del borde de la cobertura: solo se quita el relleno
      return true;
    },
  });
