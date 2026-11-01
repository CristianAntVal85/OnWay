import { Inject, Injectable } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { ImportedTracks } from '../files/imported-tracks.js';
import { RouteMeasurement } from './route-measurement.js';

type Preview = OperationOutput<'previewRouteImport'>;

/**
 * Preview of an uploaded GPX or KML (RF-510): measures the first track with the server's altitudes and says what was left
 * out. It writes nothing, not even the audit log: the route exists only when the coordinator saves it (`createRoute`).
 */
@Injectable()
export class RouteImports {
  constructor(
    @Inject(ImportedTracks) private readonly tracks: ImportedTracks,
    @Inject(RouteMeasurement) private readonly measurement: RouteMeasurement,
  ) {}

  async preview(principal: Principal, fileId: string): Promise<Preview> {
    if (!principal.orgId) throw new DomainError('ACCOUNT_PENDING');
    const { track } = await this.tracks.open(principal.orgId, fileId);
    const measured = await this.measurement.measure(track.line);
    const warnings: Preview['warnings'] = ['elevation_recomputed'];
    if (track.trackCount > 1) warnings.push('multiple_tracks_only_first_used');
    if (track.waypoints.length > 0) warnings.push('waypoints_ignored');
    return {
      trackName: track.name,
      candidate: { geometry: { type: 'LineString', coordinates: measured.coordinates }, metrics: measured.metrics, roadMix: measured.roadMix, offTrailShare: 0 },
      waypointCount: track.waypoints.length,
      warnings,
    };
  }
}
