import { Inject, Injectable } from '@nestjs/common';
import type { CreateRouteRequest, CreateVersionRequest, DeriveRouteRequest, OperationOutput, ValidateVersionRequest } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditWriter } from '../audit/audit.writer.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { ImportedTracks } from '../files/imported-tracks.js';
import { viewerOf } from '../missions/mission-support.js';
import { translateRouteWriteError } from './errors.js';
import { readRouteDetail, readVersion } from './route-reads.js';
import { RouteMeasurement, type MeasuredPath } from './route-measurement.js';

type CreateBody = z.infer<typeof CreateRouteRequest>;
type VersionBody = z.infer<typeof CreateVersionRequest>;
type DeriveBody = z.infer<typeof DeriveRouteRequest>;
type ValidateBody = z.infer<typeof ValidateVersionRequest>;
type Created = OperationOutput<'createRoute'>;

interface LockedRoute {
  id: string;
  name: string;
  status: 'active' | 'archived';
  latest_validated_version_id: string | null;
}

/** An input the contract carries for a later milestone: refused with the field named, as the points of H1 do with `teamIds` (D-H2-09). */
function notYet(path: string, milestone: string): DomainError {
  return new DomainError('VALIDATION_FAILED', 'Request validation failed', {
    issues: [{ path, code: 'not_available', message: `${path} arrives with ${milestone}` }],
  });
}

const lineString = (coordinates: readonly (readonly number[])[]) => sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({ type: 'LineString', coordinates })}::text), 4326)`;

/**
 * Writes of the route library (RF-505, RF-506, RF-510, RF-516, RF-517, RN-10, RN-12, RN-14). The server measures every
 * geometry itself (`RouteMeasurement`); a version is never changed once saved (INV-04): editing adds the next one, and the
 * row of the route is locked while it does, so two edits at once become versions 2 and 3. Each write leaves its audit row in
 * the same transaction (INV-16, D-H2-07). Routes are archived, never deleted (RN-14); an archived one is read-only (D-H2-08).
 */
@Injectable()
export class RouteWrites {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(ImportedTracks) private readonly tracks: ImportedTracks,
    @Inject(RouteMeasurement) private readonly measurement: RouteMeasurement,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  async create(principal: Principal, body: CreateBody): Promise<Created> {
    const viewer = viewerOf(principal);
    if (body.addToMission) throw notYet('addToMission', 'the missions milestone (H4)');

    let vertices: readonly (readonly number[])[];
    let sourceFileId: string | null = null;
    if (body.source === 'import') {
      const { fileId, track } = await this.tracks.open(viewer.orgId, body.fileId);
      vertices = track.line;
      sourceFileId = fileId;
    } else {
      vertices = body.geometry.coordinates;
    }
    const measured = await this.measurement.measure(vertices);

    const routeId = await this.insertRoute(viewer.orgId, viewer.userId, body.name);
    const versionId = await this.insertVersion({
      orgId: viewer.orgId,
      userId: viewer.userId,
      routeId,
      number: 1,
      measured,
      provenance: body.source === 'import' ? 'imported' : 'drawn',
      manuallyModified: false,
      sourceFileId,
      note: body.note,
    });
    await this.setLatest(routeId, versionId);
    await this.audit.recordRoute({
      orgId: viewer.orgId,
      routeId,
      action: 'route_created',
      actorUserId: viewer.userId,
      detail: { name: body.name, versionNumber: 1, source: body.source },
    });
    return { routeId, versionId, versionNumber: 1, missionRouteId: null };
  }

  async createVersion(principal: Principal, routeId: string, body: VersionBody): Promise<Created> {
    const viewer = viewerOf(principal);
    if (body.calculationJobId) throw notYet('calculationJobId', 'the adaptation milestone (H9)');
    const route = await this.lockRoute(viewer.orgId, routeId);
    if (route.status === 'archived') throw new DomainError('INVALID_STATE_TRANSITION', 'An archived route is read-only');
    const base = await this.versionNumber(viewer.orgId, routeId, body.baseVersionId);
    const measured = await this.measurement.measure(body.geometry.coordinates);

    const number = await this.nextNumber(routeId);
    const versionId = await this.insertVersion({
      orgId: viewer.orgId,
      userId: viewer.userId,
      routeId,
      number,
      measured,
      provenance: 'edited',
      manuallyModified: true,
      sourceFileId: null,
      note: body.note,
    });
    await this.setLatest(routeId, versionId);
    await this.audit.recordRoute({
      orgId: viewer.orgId,
      routeId,
      action: 'route_version_created',
      actorUserId: viewer.userId,
      detail: { name: route.name, versionNumber: number, baseVersionNumber: base },
    });
    return { routeId, versionId, versionNumber: number, missionRouteId: null };
  }

  async derive(principal: Principal, routeId: string, body: DeriveBody): Promise<Created> {
    const viewer = viewerOf(principal);
    if (body.addToMission) throw notYet('addToMission', 'the missions milestone (H4)');
    if (body.calculationJobId) throw notYet('calculationJobId', 'the adaptation milestone (H9)');
    // An archived route can be derived: it is how one gets it back as a copy (D-H2-08).
    const source = await this.lockRoute(viewer.orgId, routeId);
    const fromNumber = await this.versionNumber(viewer.orgId, routeId, body.fromVersionId);
    const measured = body.geometry ? await this.measurement.measure(body.geometry.coordinates) : null;

    const newRouteId = await this.insertRoute(viewer.orgId, viewer.userId, body.name, { routeId, versionId: body.fromVersionId });
    let versionId: string;
    if (measured) {
      versionId = await this.insertVersion({
        orgId: viewer.orgId,
        userId: viewer.userId,
        routeId: newRouteId,
        number: 1,
        measured,
        provenance: 'edited',
        manuallyModified: true,
        sourceFileId: null,
        note: body.note,
      });
    } else {
      versionId = await this.copyVersion(viewer.orgId, viewer.userId, newRouteId, body.fromVersionId, body.note);
    }
    await this.setLatest(newRouteId, versionId);
    await this.audit.recordRoute({
      orgId: viewer.orgId,
      routeId: newRouteId,
      action: 'route_derived',
      actorUserId: viewer.userId,
      detail: { name: body.name, versionNumber: 1, fromRouteId: routeId, fromRouteName: source.name, fromVersionNumber: fromNumber, geometryChanged: measured !== null },
    });
    return { routeId: newRouteId, versionId, versionNumber: 1, missionRouteId: null };
  }

  async validate(principal: Principal, routeId: string, versionId: string, _body: ValidateBody): Promise<OperationOutput<'validateRouteVersion'>> {
    const viewer = viewerOf(principal);
    const route = await this.lockRoute(viewer.orgId, routeId);
    if (route.status === 'archived') throw new DomainError('INVALID_STATE_TRANSITION', 'An archived route is read-only');
    const [row] = (
      await this.tx.execute(sql`SELECT version_number, status::text AS status FROM route_versions WHERE id = ${versionId} AND route_id = ${routeId} AND organization_id = ${viewer.orgId}`)
    ).rows as {
      version_number: number;
      status: 'draft' | 'validated';
    }[];
    if (!row) throw new DomainError('NOT_FOUND');
    if (row.status === 'validated') throw new DomainError('VERSION_IMMUTABLE');

    try {
      await this.tx.execute(sql`UPDATE route_versions SET status = 'validated', validated_by = ${viewer.userId}::uuid, validated_at = now() WHERE id = ${versionId}`);
      // The latest validated version is the one with the highest number among the validated: validating an older draft does not move it back.
      await this.tx.execute(sql`
        UPDATE routes SET latest_validated_version_id = (
          SELECT id FROM route_versions WHERE route_id = ${routeId} AND status = 'validated' ORDER BY version_number DESC LIMIT 1)
         WHERE id = ${routeId}`);
    } catch (error) {
      translateRouteWriteError(error);
    }
    await this.audit.recordRoute({
      orgId: viewer.orgId,
      routeId,
      action: 'route_version_validated',
      actorUserId: viewer.userId,
      detail: { name: route.name, versionNumber: row.version_number },
    });
    return readVersion(this.tx, viewer.orgId, routeId, versionId);
  }

  async archive(principal: Principal, routeId: string): Promise<OperationOutput<'archiveRoute'>> {
    const viewer = viewerOf(principal);
    const route = await this.lockRoute(viewer.orgId, routeId);
    if (route.status === 'archived') throw new DomainError('INVALID_STATE_TRANSITION', 'The route is already archived');
    // INV-07: looked at first, because a statement the trigger refuses would abort the transaction.
    const inUse = (
      await this.tx.execute(sql`
      SELECT DISTINCT m.id, m.name FROM mission_routes mr JOIN missions m ON m.id = mr.mission_id
       WHERE mr.route_id = ${routeId} AND mr.organization_id = ${viewer.orgId} AND m.status <> 'closed' ORDER BY m.name, m.id`)
    ).rows as { id: string; name: string }[];
    if (inUse.length > 0) throw new DomainError('ROUTE_IN_USE', 'The route is in missions that are not closed', { missions: inUse });
    try {
      await this.tx.execute(sql`UPDATE routes SET status = 'archived' WHERE id = ${routeId}`);
    } catch (error) {
      translateRouteWriteError(error);
    }
    await this.audit.recordRoute({ orgId: viewer.orgId, routeId, action: 'route_archived', actorUserId: viewer.userId, detail: { name: route.name } });
    return readRouteDetail(this.tx, viewer.orgId, routeId);
  }

  // ---------- Pieces ----------

  /** Takes the row lock of a route of the caller's organization (its writers go one at a time) or answers `NOT_FOUND`: another organization's route is not there (INV-01). */
  private async lockRoute(orgId: string, routeId: string): Promise<LockedRoute> {
    const [row] = (await this.tx.execute(sql`SELECT id, name, status::text AS status, latest_validated_version_id FROM routes WHERE id = ${routeId} AND organization_id = ${orgId} FOR UPDATE`))
      .rows as unknown as LockedRoute[];
    if (!row) throw new DomainError('NOT_FOUND');
    return row;
  }

  /** The number of a version of this route, or `NOT_FOUND` (a version of another route or organization is not there). */
  private async versionNumber(orgId: string, routeId: string, versionId: string): Promise<number> {
    const [row] = (await this.tx.execute(sql`SELECT version_number FROM route_versions WHERE id = ${versionId} AND route_id = ${routeId} AND organization_id = ${orgId}`)).rows as {
      version_number: number;
    }[];
    if (!row) throw new DomainError('NOT_FOUND');
    return row.version_number;
  }

  private async nextNumber(routeId: string): Promise<number> {
    const [row] = (await this.tx.execute(sql`SELECT COALESCE(max(version_number), 0) + 1 AS next FROM route_versions WHERE route_id = ${routeId}`)).rows as { next: number }[];
    return row!.next;
  }

  private async insertRoute(orgId: string, userId: string, name: string, from?: { routeId: string; versionId: string }): Promise<string> {
    const [row] = (
      await this.tx.execute(sql`
      INSERT INTO routes (organization_id, name, created_by, derived_from_route_id, derived_from_version_id)
      VALUES (${orgId}::uuid, ${name}, ${userId}::uuid, ${from?.routeId ?? null}::uuid, ${from?.versionId ?? null}::uuid) RETURNING id`)
    ).rows as { id: string }[];
    return row!.id;
  }

  private async insertVersion(input: {
    orgId: string;
    userId: string;
    routeId: string;
    number: number;
    measured: MeasuredPath;
    provenance: 'imported' | 'drawn' | 'edited';
    manuallyModified: boolean;
    sourceFileId: string | null;
    note: string | undefined;
  }): Promise<string> {
    const { measured } = input;
    const { metrics } = measured;
    const geom = lineString(measured.coordinates);
    const [row] = (
      await this.tx.execute(sql`
      INSERT INTO route_versions (organization_id, route_id, version_number, geom, distance_m, ascent_m, descent_m, min_elevation_m, max_elevation_m, max_slope_pct,
                                  provenance, manually_modified, source_file_id, note, created_by)
      VALUES (${input.orgId}::uuid, ${input.routeId}::uuid, ${input.number}, ${geom}, ${metrics.distanceM}, ${metrics.ascentM}, ${metrics.descentM}, ${metrics.minElevationM},
              ${metrics.maxElevationM}, ${metrics.maxSlopePct}, ${input.provenance}::provenance, ${input.manuallyModified}, ${input.sourceFileId}::uuid, ${input.note || null}, ${input.userId}::uuid)
      RETURNING id`)
    ).rows as { id: string }[];
    const versionId = row!.id;
    for (const segment of measured.segments) {
      // Each stretch keeps its own line (a route from the engine has several; one that has not passed through it has the whole line).
      const segmentGeom = lineString(measured.segmentLines[segment.position]!);
      await this.tx.execute(sql`
        INSERT INTO route_segments (organization_id, version_id, position, geom, road_type, distance_m, ascent_m, descent_m)
        VALUES (${input.orgId}::uuid, ${versionId}::uuid, ${segment.position}, ${segmentGeom}, ${segment.roadType}::road_type, ${segment.distanceM}, ${segment.ascentM}, ${segment.descentM})`);
    }
    return versionId;
  }

  /** Version 1 of a derived route as an exact copy (geometry, metrics, segments) of `fromVersionId`; the copy is a Draft. */
  private async copyVersion(orgId: string, userId: string, routeId: string, fromVersionId: string, note: string | undefined): Promise<string> {
    const [row] = (
      await this.tx.execute(sql`
      INSERT INTO route_versions (organization_id, route_id, version_number, geom, distance_m, ascent_m, descent_m, min_elevation_m, max_elevation_m, max_slope_pct,
                                  provenance, manually_modified, source_file_id, note, created_by)
      SELECT organization_id, ${routeId}::uuid, 1, geom, distance_m, ascent_m, descent_m, min_elevation_m, max_elevation_m, max_slope_pct,
             provenance, manually_modified, source_file_id, ${note || null}, ${userId}::uuid
        FROM route_versions WHERE id = ${fromVersionId} AND organization_id = ${orgId}
      RETURNING id`)
    ).rows as { id: string }[];
    const versionId = row!.id;
    await this.tx.execute(sql`
      INSERT INTO route_segments (organization_id, version_id, position, geom, road_type, distance_m, ascent_m, descent_m)
      SELECT organization_id, ${versionId}::uuid, position, geom, road_type, distance_m, ascent_m, descent_m FROM route_segments WHERE version_id = ${fromVersionId}`);
    return versionId;
  }

  private async setLatest(routeId: string, versionId: string): Promise<void> {
    await this.tx.execute(sql`UPDATE routes SET latest_version_id = ${versionId}::uuid WHERE id = ${routeId}`);
  }
}
