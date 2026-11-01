import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { RoadMix, RouteMetrics, RouteSegment } from '@onway/contracts';
import { computeMetrics, groupIntervals, labelIntervals, lengthM, prepareLine, type Position3D } from '@onway/geo';
import { DomainError } from '../common/domain-error.js';
import { ELEVATION_PROVIDER, type ElevationProvider } from '../geo/elevation.js';
import type { EngineSegment } from '../routing/routing.js';

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
  /** The line of each stretch of `segments`, in the same order: the vertices it covers, with their altitude. */
  segmentLines: Position3D[][];
}

/**
 * What the server does with any line before it keeps it (RN-10, rule 6, D-H2-01): round, thin and densify (`prepareLine`),
 * ask for the altitude of every vertex in one batch, measure, and describe it as a single stretch of unclassified road
 * (P1: the road type arrives with the routing engine in H3). The client's altitudes and metrics, and a file's, never get here.
 */
@Injectable()
export class RouteMeasurement {
  constructor(@Inject(ELEVATION_PROVIDER) private readonly elevation: ElevationProvider) {}

  /**
   * `stretches` are the road types the routing engine gave to its own vertices (D-H3-04); they are carried to the prepared line by
   * share of the length. Without them (an imported, drawn or edited line) the route is one `unknown` stretch (P1 of H2).
   */
  async measure(vertices: readonly (readonly number[])[], stretches?: readonly EngineSegment[]): Promise<MeasuredPath> {
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
    const labels = labelIntervals(
      vertices,
      prepared,
      (stretches ?? []).map(({ fromIndex, toIndex, roadType }) => ({ fromIndex, toIndex, value: roadType })),
      'unknown' as RoadTypeValue,
    );
    const runs = stretches ? groupIntervals(labels) : [{ fromIndex: 0, toIndex: coordinates.length - 1, value: 'unknown' as RoadTypeValue }];
    const segmentLines = runs.map((run) => coordinates.slice(run.fromIndex, run.toIndex + 1));
    const segments = runs.map((run, position) => {
      const line = segmentLines[position]!;
      // A single stretch is the whole route and keeps the route's own figures; a part is measured on its own line.
      const part = runs.length === 1 ? metrics : computeMetrics(line).metrics;
      return { position, roadType: run.value, distanceM: runs.length === 1 ? metrics.distanceM : part.distanceM, ascentM: part.ascentM, descentM: part.descentM };
    });
    const mix = new Map<RoadTypeValue, number>();
    for (const segment of segments) mix.set(segment.roadType, (mix.get(segment.roadType) ?? 0) + segment.distanceM);
    const roadMix = [...mix].map(([roadType, distanceM]) => ({ roadType, distanceM }));
    return { coordinates, metrics, profile, roadMix, segments, segmentLines };
  }
}

type RoadTypeValue = z.infer<typeof RouteSegment>['roadType'];
