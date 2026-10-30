import type { ElevationProvider, GroundPoint } from './elevation.js';

/** Area where the synthetic surface answers: a generous box around the Pyrenees (stand-in for the future DEM coverage). */
export const SYNTHETIC_COVERAGE = { south: 41, north: 44.5, west: -3.5, east: 4 } as const;

/**
 * Deterministic made-up terrain: always the same altitude for the same point, between about 300 and 2 700 m, and
 * `null` outside `SYNTHETIC_COVERAGE`. It stands in for the real source (GLO-30 plus Open-Meteo) until the milestone's
 * geodata task replaces it; nothing in it is real data.
 */
export class SyntheticElevationProvider implements ElevationProvider {
  async elevationAt({ lat, lon }: GroundPoint): Promise<number | null> {
    const { south, north, west, east } = SYNTHETIC_COVERAGE;
    if (!(lat >= south && lat <= north && lon >= west && lon <= east)) return null;
    const metres = 1500 + 800 * Math.sin(lat * 37) * Math.cos(lon * 41) + 400 * Math.sin(lat * 113 + lon * 97);
    return Math.round(metres * 10) / 10;
  }
}
