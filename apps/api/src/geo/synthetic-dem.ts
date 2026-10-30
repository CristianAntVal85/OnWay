import { writeArrayBuffer } from 'geotiff';
import { demTileName } from './dem-elevation.js';
import { syntheticSurface } from './synthetic-elevation.js';

/** Degrees between two samples of the synthetic tiles: 0.01° (36 arc seconds), so a tile is 100 x 100 samples (40 kB). */
export const SYNTHETIC_STEP = 0.01;
/** The 1° x 1° tiles the synthetic DEM covers, named by south-west corner: the central Pyrenees on both sides of the border. */
export const SYNTHETIC_TILES = [
  { south: 42, west: -1 },
  { south: 42, west: 0 },
  { south: 43, west: -1 },
  { south: 43, west: 0 },
] as const;

/** One tile as a GeoTIFF in the layout of Copernicus GLO-30 (WGS84, `PixelIsPoint`, float32), sampled from `syntheticSurface`. Deterministic: same bytes every time. */
export function syntheticTile(south: number, west: number): { name: string; bytes: Uint8Array } {
  const size = Math.round(1 / SYNTHETIC_STEP);
  const values = new Float32Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      values[row * size + column] = syntheticSurface(south + 1 - row * SYNTHETIC_STEP, west + column * SYNTHETIC_STEP);
    }
  }
  const buffer = writeArrayBuffer(values, {
    width: size,
    height: size,
    BitsPerSample: [32],
    SampleFormat: [3],
    ModelPixelScale: [SYNTHETIC_STEP, SYNTHETIC_STEP, 0],
    ModelTiepoint: [0, 0, 0, west, south + 1, 0],
    GTModelTypeGeoKey: 2,
    GTRasterTypeGeoKey: 2,
    GeographicTypeGeoKey: 4326,
    GeogCitationGeoKey: 'WGS 84',
  });
  return { name: demTileName(south + 0.5, west + 0.5), bytes: new Uint8Array(buffer) };
}
