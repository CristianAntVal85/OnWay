import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { RoadMix, RouteMetrics, RouteSegment } from '@onway/contracts';
import { computeMetrics, lengthM, prepareLine, type Position3D } from '@onway/geo';
import { DomainError } from '../common/domain-error.js';
import { ELEVATION_PROVIDER, type ElevationProvider } from '../geo/elevation.js';

/** Most vertices a measured route can have after `prepareLine` (about 1 800 km at 30 m): a guard for memory and time, not a rule of the domain. */
export const MAX_MEASURED_VERTICES = 60_000;

export interface MeasuredPath {
  /** The prepared line with the altitude of the server, `[lon, lat, elevation]`. What is stored, exported and drawn. */
  coordinates: Position3D[];
  metrics: z.infer<typeof RouteMetrics>;
  /** Pairs `[accumulated distance in m, elevation in m]`, at most 500. */
  profile: [number, number][];
  roadMix: z.infer<typeof RoadMix>;
  segments: z.infer<typeof RouteSegment>[];
}

/**
 * What the server does with any line before it keeps it (RN-10, rule 6, D-H2-01): round, thin and densify (`prepareLine`),
 * ask for the altitude of every vertex in one batch, measure, and describe it as a single stretch of unclassified road
 * (P1: the road type arrives with the routing engine in H3). The client's altitudes and metrics, and a file's, never get here.
 */
@Injectable()
export class RouteMeasurement {
  constructor(@Inject(ELEVATION_PROVIDER) private readonly elevation: ElevationProvider) {}

  async measure(vertices: readonly (readonly number[])[]): Promise<MeasuredPath> {
    const prepared = prepareLine(vertices);
    if (prepared.length < 2 || !(lengthM(prepared) > 0)) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: [{ path: 'geometry', code: 'too_short', message: 'a route needs at least two different points' }],
      });
    }
    if (prepared.length > MAX_MEASURED_VERTICES) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: [{ path: 'geometry', code: 'too_long', message: 'the route is too long to be measured' }],
      });
    }

    const heights = await this.elevation.elevationsAt(prepared.map(([lon, lat]) => ({ lat, lon })));
    const coordinates: Position3D[] = [];
    for (const [index, [lon, lat]] of prepared.entries()) {
      const height = heights[index];
      if (height === null || height === undefined) throw new DomainError('OUTSIDE_COVERAGE');
      coordinates.push([lon, lat, height]);
    }

    const { metrics, profile } = computeMetrics(coordinates);
    return {
      coordinates,
      metrics,
      profile,
      roadMix: [{ roadType: 'unknown', distanceM: metrics.distanceM }],
      segments: [{ position: 0, roadType: 'unknown', distanceM: metrics.distanceM, ascentM: metrics.ascentM, descentM: metrics.descentM }],
    };
  }
}
