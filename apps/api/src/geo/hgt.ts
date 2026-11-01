import type { ElevationProvider, GroundPoint } from './elevation.js';

/** Samples per side of a 1° x 1° tile at 1 arc-second, edges included (SRTM1 / Skadi). */
export const HGT_SIZE = 3601;

/** The value SRTM files use for "no data". GraphHopper's elevation reader treats anything below -1000 m as missing. */
export const HGT_VOID = -32768;

/**
 * Name of the tile file GraphHopper's Skadi reader looks for in its cache before it downloads anything:
 * `N42W001.hgt.gz` (south-west corner, latitude on two digits, longitude on three).
 */
export function hgtTileName(south: number, west: number): string {
  const ns = `${south >= 0 ? 'N' : 'S'}${String(Math.abs(south)).padStart(2, '0')}`;
  const ew = `${west >= 0 ? 'E' : 'W'}${String(Math.abs(west)).padStart(3, '0')}`;
  return `${ns}${ew}.hgt.gz`;
}

/** Just inside the tile, so that the north and east edge samples are answered by this tile and not by its neighbour. */
const EDGE_EPSILON = 1e-9;

/**
 * One tile in the layout GraphHopper reads: big-endian signed 16-bit metres, row by row from the north edge to the south
 * edge, each row from the west edge to the east edge, 3601 x 3601 samples.
 *
 * The altitudes come from OnWay's own `ElevationProvider` (D-H3-02): the engine sees exactly what the server measures
 * with, not another model of the same ground. Whole metres, like every SRTM file. A point the provider cannot answer
 * is written as void.
 */
export async function buildHgtTile(provider: ElevationProvider, south: number, west: number, rowsPerBatch = 128): Promise<Buffer> {
  const out = Buffer.alloc(HGT_SIZE * HGT_SIZE * 2);
  for (let firstRow = 0; firstRow < HGT_SIZE; firstRow += rowsPerBatch) {
    const lastRow = Math.min(firstRow + rowsPerBatch, HGT_SIZE);
    const points: GroundPoint[] = [];
    for (let row = firstRow; row < lastRow; row++) {
      const lat = Math.min(south + 1 - row / (HGT_SIZE - 1), south + 1 - EDGE_EPSILON);
      for (let column = 0; column < HGT_SIZE; column++) {
        points.push({ lat, lon: Math.min(west + column / (HGT_SIZE - 1), west + 1 - EDGE_EPSILON) });
      }
    }
    const heights = await provider.elevationsAt(points);
    heights.forEach((height, index) => {
      const value = height === null || !Number.isFinite(height) ? HGT_VOID : Math.max(-1000, Math.min(12000, Math.round(height)));
      out.writeInt16BE(value, (firstRow * HGT_SIZE + index) * 2);
    });
  }
  return out;
}
