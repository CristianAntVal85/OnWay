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

  /** Each source is asked only for the points the previous ones left without an answer. */
  async elevationsAt(points: readonly GroundPoint[]): Promise<(number | null)[]> {
    const result: (number | null)[] = points.map(() => null);
    let pending = points.map((_, index) => index);
    for (const source of this.sources) {
      if (pending.length === 0) break;
      const answers = await source.elevationsAt(pending.map((index) => points[index]!));
      pending = pending.filter((index, i) => {
        const metres = answers[i] ?? null;
        result[index] = metres;
        return metres === null;
      });
    }
    return result;
  }
}
