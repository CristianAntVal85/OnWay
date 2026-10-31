import type { ElevationProvider, GroundPoint } from './elevation.js';

/** Asks each source in order and answers the first altitude found: the local DEM first, then the remote one. All `null` means no coverage. */
export class CompositeElevationProvider implements ElevationProvider {
  constructor(private readonly sources: readonly ElevationProvider[]) {}

  async elevationAt(point: GroundPoint): Promise<number | null> {
    for (const source of this.sources) {
      const metres = await source.elevationAt(point);
      if (metres !== null) return metres;
    }
    return null;
  }
}
