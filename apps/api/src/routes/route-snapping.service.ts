import { Inject, Injectable } from '@nestjs/common';
import type { OperationOutput, SnapRequest } from '@onway/contracts';
import type { z } from 'zod';
import type { Principal } from '../common/operation.js';
import { viewerOf } from '../missions/mission-support.js';
import { ROUTING_PROVIDER, type RoutingProvider } from '../routing/routing.js';
import { RouteMeasurement } from './route-measurement.js';

/**
 * `snapRoute` (RF-503, doc 02 §3.6-C): joins the points the coordinator placed, in order, following the paths, and measures the
 * result with the server's own elevation (rule 6). It is a preview: nothing is saved and nothing is audited; to keep the line the
 * client sends its `geometry` to `createRoute` like any other drawn route. The engine's altitude and metrics are never used.
 */
@Injectable()
export class RouteSnapping {
  constructor(
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
    @Inject(RouteMeasurement) private readonly measurement: RouteMeasurement,
  ) {}

  async snap(principal: Principal, body: z.infer<typeof SnapRequest>): Promise<OperationOutput<'snapRoute'>> {
    viewerOf(principal);
    const route = await this.routing.snap(body.points);
    const measured = await this.measurement.measure(route.coordinates, route.segments);
    const offTrailM = measured.roadMix.find((part) => part.roadType === 'offtrail')?.distanceM ?? 0;
    return {
      geometry: { type: 'LineString', coordinates: measured.coordinates },
      metrics: measured.metrics,
      roadMix: measured.roadMix,
      offTrailShare: measured.metrics.distanceM > 0 ? Math.min(1, offTrailM / measured.metrics.distanceM) : 0,
    };
  }
}
