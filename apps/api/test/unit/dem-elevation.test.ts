import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DemElevationProvider, demTileName } from '../../src/geo/dem-elevation.js';
import { syntheticSurface } from '../../src/geo/synthetic-elevation.js';
import { SYNTHETIC_STEP, SYNTHETIC_TILES, syntheticTile } from '../../src/geo/synthetic-dem.js';

const COMMITTED = resolve(import.meta.dirname, '../../../../data/seed/dem');
let dir: string;
let provider: DemElevationProvider;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'onway-dem-'));
  for (const { south, west } of SYNTHETIC_TILES) {
    const tile = syntheticTile(south, west);
    writeFileSync(join(dir, tile.name), tile.bytes);
  }
  provider = new DemElevationProvider(dir);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('demTileName (Copernicus GLO-30 naming)', () => {
  it('names the tile by its south-west corner', () => {
    expect(demTileName(42.6, 0.65)).toBe('Copernicus_DSM_COG_10_N42_00_E000_00_DEM.tif');
    expect(demTileName(42.99, -0.0001)).toBe('Copernicus_DSM_COG_10_N42_00_W001_00_DEM.tif');
    expect(demTileName(43, -2)).toBe('Copernicus_DSM_COG_10_N43_00_W002_00_DEM.tif');
    expect(demTileName(-0.5, 12.3)).toBe('Copernicus_DSM_COG_10_S01_00_E012_00_DEM.tif');
  });
});

describe('DemElevationProvider over GeoTIFF tiles (RF-302, R-15)', () => {
  it('gives the stored value at a sample point', async () => {
    // Pixel centres of the synthetic tile are 0.01° apart (PixelIsPoint), starting at the north-west corner.
    const lat = 42.63;
    const lon = -0.1;
    const metres = await provider.elevationAt({ lat, lon });
    expect(metres).not.toBeNull();
    expect(Math.abs(metres! - syntheticSurface(lat, lon))).toBeLessThan(0.1);
  });

  it('interpolates between samples: between two neighbours, never outside their range', async () => {
    const a = (await provider.elevationAt({ lat: 42.5, lon: 0.2 }))!;
    const b = (await provider.elevationAt({ lat: 42.5, lon: 0.2 + SYNTHETIC_STEP }))!;
    const mid = (await provider.elevationAt({ lat: 42.5, lon: 0.2 + SYNTHETIC_STEP / 2 }))!;
    expect(mid).toBeGreaterThanOrEqual(Math.min(a, b) - 0.1);
    expect(mid).toBeLessThanOrEqual(Math.max(a, b) + 0.1);
    expect(Math.abs(mid - (a + b) / 2)).toBeLessThan(0.15);
  });

  it('covers the four tiles it has, and no other: a point in a tile that is not in the folder is null', async () => {
    for (const { south, west } of SYNTHETIC_TILES) expect(await provider.elevationAt({ lat: south + 0.5, lon: west + 0.5 })).not.toBeNull();
    expect(await provider.elevationAt({ lat: 45.5, lon: 0.5 })).toBeNull();
    expect(await provider.elevationAt({ lat: 42.5, lon: 2.5 })).toBeNull();
    expect(await provider.elevationAt({ lat: Number.NaN, lon: 0 })).toBeNull();
  });

  it('reads the very edge of a tile without failing (the last sample is replicated)', async () => {
    expect(await provider.elevationAt({ lat: 42.0001, lon: 0.9999 })).not.toBeNull();
    expect(await provider.elevationAt({ lat: 42.9999, lon: -0.9999 })).not.toBeNull();
  });

  it('answers many concurrent readings of one tile with the same values as one by one', async () => {
    const points = Array.from({ length: 40 }, (_, i) => ({ lat: 42.2 + i * 0.013, lon: -0.8 + i * 0.011 }));
    const together = await Promise.all(points.map((p) => provider.elevationAt(p)));
    const apart = [];
    for (const p of points) apart.push(await provider.elevationAt(p));
    expect(together).toEqual(apart);
  });

  it('a file that is not a GeoTIFF fails the reading instead of inventing a height', async () => {
    const broken = mkdtempSync(join(tmpdir(), 'onway-dem-bad-'));
    try {
      writeFileSync(join(broken, demTileName(42.5, 0.5)), 'not a tiff');
      await expect(new DemElevationProvider(broken).elevationAt({ lat: 42.5, lon: 0.5 })).rejects.toThrow();
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});

describe('the committed synthetic DEM (data/seed/dem, used by the end-to-end stack)', () => {
  it('is exactly what the generator writes: made-up terrain, regenerated with `pnpm --filter @onway/api synthetic-dem`', () => {
    expect(readdirSync(COMMITTED).sort()).toEqual(SYNTHETIC_TILES.map(({ south, west }) => syntheticTile(south, west).name).sort());
    for (const { south, west } of SYNTHETIC_TILES) {
      const tile = syntheticTile(south, west);
      expect(Buffer.compare(readFileSync(join(COMMITTED, tile.name)), Buffer.from(tile.bytes))).toBe(0);
    }
  });

  it('covers the targets and points of the demo missions', async () => {
    const demo = JSON.parse(readFileSync(resolve(COMMITTED, '..', 'demo.json'), 'utf8')) as { missions: { target: { lat: number; lon: number }; points: { lat: number; lon: number }[] }[] };
    const committed = new DemElevationProvider(COMMITTED);
    for (const mission of demo.missions) {
      for (const place of [mission.target, ...mission.points]) expect(await committed.elevationAt(place)).not.toBeNull();
    }
  });
});
