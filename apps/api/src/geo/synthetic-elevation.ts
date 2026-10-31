import type { ElevationProvider, GroundPoint } from './elevation.js';

/** Area where the synthetic surface answers: a generous box around the Pyrenees. */
export const SYNTHETIC_COVERAGE = { south: 41, north: 44.5, west: -3.5, east: 4 } as const;

/** The made-up terrain in metres, for any point. Smooth and deterministic, between about 300 and 2 700 m. Nothing in it is real data. */
export function syntheticSurface(lat: number, lon: number): number {
  return 1500 + 800 * Math.sin(lat * 37) * Math.cos(lon * 41) + 400 * Math.sin(lat * 113 + lon * 97);
}

/**
 * Deterministic made-up terrain: always the same altitude for the same point, and `null` outside `SYNTHETIC_COVERAGE`.
 * It is the test implementation of the `ElevationProvider` port (`test:api`); the stack never uses it: the real source is
 * the DEM tiles plus Open-Meteo (`createElevationProvider`), and the end-to-end tests read a synthetic DEM through the same
 * adapter as the real one (`data/seed/dem`, generated from `syntheticSurface`).
 */
export class SyntheticElevationProvider implements ElevationProvider {
  async elevationAt({ lat, lon }: GroundPoint): Promise<number | null> {
    const { south, north, west, east } = SYNTHETIC_COVERAGE;
    if (!(lat >= south && lat <= north && lon >= west && lon <= east)) return null;
    return Math.round(syntheticSurface(lat, lon) * 10) / 10;
  }
}
