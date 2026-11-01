import { describe, expect, it } from 'vitest';
import { HGT_SIZE, HGT_VOID, buildHgtTile, hgtTileName } from '../../src/geo/hgt.js';
import type { ElevationProvider, GroundPoint } from '../../src/geo/elevation.js';

/** A plane: 1 000 m + 100 m per 0.1° of latitude + 10 m per 0.1° of longitude. Easy to compute by hand. */
const plane: ElevationProvider = {
  elevationAt: async ({ lat, lon }) => 1000 + (lat - 42) * 1000 + (lon + 1) * 100,
  elevationsAt: async (points: readonly GroundPoint[]) => points.map(({ lat, lon }) => 1000 + (lat - 42) * 1000 + (lon + 1) * 100),
};

const at = (tile: Buffer, row: number, column: number): number => tile.readInt16BE((row * HGT_SIZE + column) * 2);

describe('hgtTileName', () => {
  it('names tiles by their south-west corner as Skadi does', () => {
    expect(hgtTileName(42, -1)).toBe('N42W001.hgt.gz');
    expect(hgtTileName(43, 0)).toBe('N43E000.hgt.gz');
    expect(hgtTileName(42, 3)).toBe('N42E003.hgt.gz');
    expect(hgtTileName(-5, -70)).toBe('S05W070.hgt.gz');
  });
});

describe('buildHgtTile', () => {
  it('writes 3601 x 3601 big-endian metres, north row first and west column first', async () => {
    const tile = await buildHgtTile(plane, 42, -1, 500);
    expect(tile.length).toBe(HGT_SIZE * HGT_SIZE * 2);
    // North-west corner: lat 43, lon -1 -> 1000 + 1000 + 0 = 2000 m.
    expect(at(tile, 0, 0)).toBe(2000);
    // South-west corner: lat 42, lon -1 -> 1000.
    expect(at(tile, HGT_SIZE - 1, 0)).toBe(1000);
    // North-east corner: lat 43, lon 0 -> 2000 + 100.
    expect(at(tile, 0, HGT_SIZE - 1)).toBe(2100);
    // Centre: lat 42.5, lon -0.5 -> 1000 + 500 + 50.
    expect(at(tile, 1800, 1800)).toBe(1550);
    // One sample east is 1/3600 of a degree: 100/3600 m, so it rounds back to the same metre.
    expect(at(tile, 1800, 1801)).toBe(1550);
  });

  it('does not depend on how many rows go in a batch', async () => {
    const small = await buildHgtTile(plane, 42, -1, 97);
    const large = await buildHgtTile(plane, 42, -1, 1000);
    expect(small.equals(large)).toBe(true);
  });

  it('writes a void where the provider has no answer and clamps absurd values', async () => {
    const holes: ElevationProvider = {
      elevationAt: async () => null,
      elevationsAt: async (points) => points.map(({ lat }, i) => (lat > 42.9 ? null : i % 2 === 0 ? 99999 : -5000)),
    };
    const tile = await buildHgtTile(holes, 42, -1, 400);
    expect(at(tile, 0, 5)).toBe(HGT_VOID);
    const southRow = HGT_SIZE - 1;
    expect([at(tile, southRow, 0), at(tile, southRow, 1)].sort((a, b) => a - b)).toEqual([-1000, 12000]);
  });

  it('asks for the north and east edges inside the tile, so a neighbour that is missing does not blank them', async () => {
    const extent = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
    const spy: ElevationProvider = {
      elevationAt: async () => 0,
      elevationsAt: async (points) => {
        for (const { lat, lon } of points) {
          extent.minLat = Math.min(extent.minLat, lat);
          extent.maxLat = Math.max(extent.maxLat, lat);
          extent.minLon = Math.min(extent.minLon, lon);
          extent.maxLon = Math.max(extent.maxLon, lon);
        }
        return points.map(() => 0);
      },
    };
    await buildHgtTile(spy, 42, -1, 300);
    expect(extent.maxLat).toBeLessThan(43);
    expect(extent.maxLon).toBeLessThan(0);
    expect(extent.minLat).toBe(42);
    expect(extent.minLon).toBe(-1);
  });
});
