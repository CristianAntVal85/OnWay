import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CreateRouteRequest, CreateVersionRequest, DeriveRouteRequest, OperationOutput, ValidateVersionRequest } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { projectOnLine } from '@onway/geo';
import { AuditWriter } from '../audit/audit.writer.js';
import { assertCanLink, pinRoute } from '../mission-routes/mission-route-links.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage.js';
import { ImportedTracks } from '../files/imported-tracks.js';
import { viewerOf } from '../missions/mission-support.js';
import { translateRouteWriteError } from './errors.js';
import { readRouteDetail, readVersion } from './route-reads.js';
import { ROUTING_PROVIDER, type EngineSegment, type RoutingProvider } from '../routing/routing.js';
import { RouteMeasurement, type MeasuredPath, type RoadStretch } from './route-measurement.js';

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

/** Most control points the engine joins at once (the same limit as `snapRoute`). */
const MAX_SNAP_POINTS = 50;

const tooManyPoints = (): DomainError =>
  new DomainError('VALIDATION_FAILED', 'Request validation failed', {
    issues: [{ path: 'geometry', code: 'too_many_points', message: `following the paths takes at most ${MAX_SNAP_POINTS} points` }],
  });

/** An input the contract carries for a later milestone: refused with the field named, as the points of H1 do with `teamIds` (D-H2-09). */
function notYet(path: string, milestone: string): DomainError {
  return new DomainError('VALIDATION_FAILED', 'Request validation failed', {
    issues: [{ path, code: 'not_available', message: `${path} arrives with ${milestone}` }],
  });
}

/** How far from the route a cut may fall (D-P7): beyond this, the coordinator did not mean the route. */
const MAX_CUT_OFFSET_M = 200;

const lineString = (coordinates: readonly (readonly number[])[]) => sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({ type: 'LineString', coordinates })}::text), 4326)`;

/**
 * Writes of the route library (RF-505, RF-506, RF-510, RF-516, RF-517, RN-10, RN-12, RN-14). The server measures every
 * geometry itself (`RouteMeasurement`); a version is never changed once saved (INV-04): editing adds the next one, and the
 * row of the route is locked while it does, so two edits at once become versions 2 and 3. Each write leaves its audit row in
 * the same transaction (INV-16, D-H2-07). Routes are archived (RN-14); an archived one is read-only (D-H2-08) and, when no mission has
 * it, can be deleted for good (`remove`, issue #17).
 */
@Injectable()
export class RouteWrites {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(ImportedTracks) private readonly tracks: ImportedTracks,
    @Inject(RouteMeasurement) private readonly measurement: RouteMeasurement,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  private readonly logger = new Logger(RouteWrites.name);

  private get tx(): Tx {
    return this.database.current();
  }

  async create(principal: Principal, body: CreateBody): Promise<Created> {
    const viewer = viewerOf(principal);
    // Asked before anything is made: a closed mission, or an origin or team that is not there, must leave no route behind (RF-513).
    if (body.addToMission) await assertCanLink(this.tx, viewer.orgId, body.addToMission);

    let vertices: readonly (readonly number[])[];
    let stretches: readonly EngineSegment[] | undefined;
    let sourceFileId: string | null = null;
    if (body.source === 'import') {
      const { fileId, track } = await this.tracks.open(viewer.orgId, body.fileId);
      vertices = track.line;
      sourceFileId = fileId;
    } else if (body.snapToPaths) {
      // The points are control points: the engine joins them following the paths, and the server measures the result (rule 6).
      if (body.geometry.coordinates.length > MAX_SNAP_POINTS) throw tooManyPoints();
      const snapped = await this.routing.snap(body.geometry.coordinates.map(([lon, lat]) => ({ lat: lat!, lon: lon! })));
      vertices = snapped.coordinates;
      stretches = snapped.segments;
    } else {
      vertices = body.geometry.coordinates;
    }
    const measured = await this.measurement.measure(vertices, stretches);

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
      detail: { name: body.name, versionNumber: 1, source: body.source, ...(body.source === 'drawn' && body.snapToPaths ? { snapToPaths: true } : {}) },
    });
    const missionRouteId = body.addToMission
      ? await pinRoute(this.tx, this.audit, {
          ...body.addToMission,
          orgId: viewer.orgId,
          userId: viewer.userId,
          routeId,
          routeName: body.name,
          versionId,
          versionNumber: 1,
          source: body.source === 'import' ? 'imported' : 'drawn',
        })
      : null;
    return { routeId, versionId, versionNumber: 1, missionRouteId };
  }

  async createVersion(principal: Principal, routeId: string, body: VersionBody): Promise<Created> {
    const viewer = viewerOf(principal);
    if (body.calculationJobId) throw notYet('calculationJobId', 'the adaptation milestone (H9)');
    const route = await this.lockRoute(viewer.orgId, routeId);
    if (route.status === 'archived') throw new DomainError('INVALID_STATE_TRANSITION', 'An archived route is read-only');
    const base = await this.versionNumber(viewer.orgId, routeId, body.baseVersionId);
    // Continued by hand (issue-pintar-ruta): the kept part comes from the stored version, never from the client (rule 6).
    const continued = body.continueFrom ? await this.continuedLine(viewer.orgId, body.baseVersionId, body.continueFrom) : null;
    const measured = continued ? await this.measurement.measure(continued.vertices, continued.stretches) : await this.measurement.measure(body.geometry!.coordinates);

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
      detail: { name: route.name, versionNumber: number, baseVersionNumber: base, ...(continued ? { continued: true, keptDistanceM: Math.round(continued.keptDistanceM) } : {}) },
    });
    return { routeId, versionId, versionNumber: number, missionRouteId: null };
  }

  async derive(principal: Principal, routeId: string, body: DeriveBody): Promise<Created> {
    const viewer = viewerOf(principal);
    if (body.addToMission) await assertCanLink(this.tx, viewer.orgId, body.addToMission);
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
    const missionRouteId = body.addToMission
      ? await pinRoute(this.tx, this.audit, {
          ...body.addToMission,
          orgId: viewer.orgId,
          userId: viewer.userId,
          routeId: newRouteId,
          routeName: body.name,
          versionId,
          versionNumber: 1,
          source: 'derived',
        })
      : null;
    return { routeId: newRouteId, versionId, versionNumber: 1, missionRouteId };
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
    // The missions that have this very version pinned (and are still open) now have a validated route: they say so in their history.
    const pinned = (
      await this.tx.execute(sql`
        SELECT DISTINCT mr.mission_id FROM mission_routes mr JOIN missions m ON m.id = mr.mission_id
         WHERE mr.pinned_version_id = ${versionId}::uuid AND mr.organization_id = ${viewer.orgId}::uuid AND m.status <> 'closed'`)
    ).rows as { mission_id: string }[];
    for (const { mission_id } of pinned) {
      await this.audit.recordMission({
        orgId: viewer.orgId,
        missionId: mission_id,
        action: 'route_version_validated',
        actorUserId: viewer.userId,
        detail: { name: route.name, routeId, versionNumber: row.version_number },
      });
    }
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

  /**
   * Changes the name of an active route (RF-512, D-N4). The name belongs to the route, not to its versions: no version is created or
   * touched (RN-12, INV-04), and the missions that use it show the new name. The same name again is answered without an audit line (D-N5).
   */
  async rename(principal: Principal, routeId: string, name: string): Promise<OperationOutput<'updateRoute'>> {
    const viewer = viewerOf(principal);
    const route = await this.lockRoute(viewer.orgId, routeId);
    if (route.status === 'archived') throw new DomainError('INVALID_STATE_TRANSITION', 'An archived route keeps its name');
    if (route.name !== name) {
      await this.tx.execute(sql`UPDATE routes SET name = ${name} WHERE id = ${routeId}`);
      await this.audit.recordRoute({ orgId: viewer.orgId, routeId, action: 'route_renamed', actorUserId: viewer.userId, detail: { from: route.name, to: name } });
    }
    return readRouteDetail(this.tx, viewer.orgId, routeId);
  }

  /**
   * Deletes for good an ARCHIVED route that no mission has, closed ones included (issue #17, RN-14, D-I1 and D-I6). Looked at first, because
   * a statement the database refuses aborts the transaction (INV-04 and INV-07 are the second defence). In this order: the routes that
   * derive from it lose the link (D-I4), its versions go (segments with them), then the route; the original files nobody else uses are
   * retired (D-I5); one audit line stays (INV-16). The bytes are removed last and a failure there is only logged: the route is gone either way.
   */
  async remove(principal: Principal, routeId: string): Promise<void> {
    const viewer = viewerOf(principal);
    const route = await this.lockRoute(viewer.orgId, routeId);
    if (route.status !== 'archived') throw new DomainError('INVALID_STATE_TRANSITION', 'Only an archived route can be deleted');
    const inUse = (
      await this.tx.execute(sql`
      SELECT DISTINCT m.id, m.name FROM mission_routes mr JOIN missions m ON m.id = mr.mission_id
       WHERE mr.route_id = ${routeId} AND mr.organization_id = ${viewer.orgId} ORDER BY m.name, m.id`)
    ).rows as { id: string; name: string }[];
    if (inUse.length > 0) throw new DomainError('ROUTE_IN_USE', 'The route is in missions', { missions: inUse });

    const derivatives = (
      await this.tx.execute(sql`
      UPDATE routes SET derived_from_route_id = NULL, derived_from_version_id = NULL
       WHERE derived_from_route_id = ${routeId} AND organization_id = ${viewer.orgId} RETURNING id`)
    ).rows as { id: string }[];
    const sources = (
      await this.tx.execute(sql`SELECT DISTINCT source_file_id AS id FROM route_versions WHERE route_id = ${routeId} AND organization_id = ${viewer.orgId} AND source_file_id IS NOT NULL`)
    ).rows as { id: string }[];
    let versions: number;
    try {
      versions = (await this.tx.execute(sql`DELETE FROM route_versions WHERE route_id = ${routeId} AND organization_id = ${viewer.orgId}`)).rowCount ?? 0;
      await this.tx.execute(sql`DELETE FROM routes WHERE id = ${routeId} AND organization_id = ${viewer.orgId}`);
    } catch (error) {
      translateRouteWriteError(error);
    }
    const retired =
      sources.length === 0
        ? []
        : await this.retireFiles(
            viewer.orgId,
            sources.map((file) => file.id),
          );
    await this.audit.recordRoute({
      orgId: viewer.orgId,
      routeId,
      action: 'route_deleted',
      actorUserId: viewer.userId,
      detail: { name: route.name, versions, derivativesUnlinked: derivatives.map((row) => row.id) },
    });
    for (const key of retired) {
      try {
        await this.storage.delete(key);
      } catch (error) {
        this.logger.warn(`the bytes of a retired route file could not be removed: ${(error as Error).message}`);
      }
    }
  }

  /** Marks as deleted the route files that no version uses any more and returns their storage keys. */
  private async retireFiles(orgId: string, fileIds: string[]): Promise<string[]> {
    const ids = sql.join(
      fileIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    // The rows are locked first: a version that is being saved with the same file holds a share lock on its row through the foreign key,
    // so the check below never races with it.
    await this.tx.execute(sql`SELECT id FROM files WHERE organization_id = ${orgId} AND id IN (${ids}) ORDER BY id FOR UPDATE`);
    const rows = (
      await this.tx.execute(sql`
      UPDATE files SET deleted_at = now()
       WHERE organization_id = ${orgId} AND purpose = 'route_import' AND deleted_at IS NULL AND id IN (${ids})
         AND NOT EXISTS (SELECT 1 FROM route_versions v WHERE v.source_file_id = files.id)
       RETURNING storage_key`)
    ).rows as { storage_key: string }[];
    return rows.map((row) => row.storage_key);
  }

  /**
   * The routes a calculation job proposes (H3, RF-501): each one a new route in Draft, version 1, `provenance = generated`, measured by
   * the server and linked to the job. Idempotent per job (D-H3-06): if the job already created its routes — a retry after a crash —
   * those are returned and nothing is written. Runs in the transaction of the caller, so all the routes of a job exist or none does.
   */
  async createGenerated(input: { orgId: string; userId: string; jobId: string; names: string[]; measured: MeasuredPath[] }): Promise<{ routeId: string; versionId: string; name: string }[]> {
    const existing = await this.generatedBy(input.jobId);
    if (existing.length > 0) return existing;
    const created: { routeId: string; versionId: string; name: string }[] = [];
    for (const [index, measured] of input.measured.entries()) {
      const name = input.names[index]!;
      const routeId = await this.insertRoute(input.orgId, input.userId, name);
      const versionId = await this.insertVersion({
        orgId: input.orgId,
        userId: input.userId,
        routeId,
        number: 1,
        measured,
        provenance: 'generated',
        manuallyModified: false,
        sourceFileId: null,
        note: undefined,
        calculationJobId: input.jobId,
      });
      await this.setLatest(routeId, versionId);
      await this.audit.recordRoute({ orgId: input.orgId, routeId, action: 'route_created', actorUserId: input.userId, detail: { name, versionNumber: 1, source: 'generated', jobId: input.jobId } });
      created.push({ routeId, versionId, name });
    }
    return created;
  }

  /** The routes (and their first versions) a job already created, in the order it created them. */
  async generatedBy(jobId: string): Promise<{ routeId: string; versionId: string; name: string }[]> {
    const { rows } = await this.tx.execute(sql`
      SELECT v.route_id, v.id AS version_id, r.name FROM route_versions v JOIN routes r ON r.id = v.route_id
       WHERE v.calculation_job_id = ${jobId}::uuid ORDER BY v.created_at, v.id`);
    return (rows as unknown as { route_id: string; version_id: string; name: string }[]).map((row) => ({ routeId: row.route_id, versionId: row.version_id, name: row.name }));
  }

  // ---------- Pieces ----------

  /**
   * The line of a version continued by hand (D-P4, D-P5, D-P7): the stored version from its start to the vertex nearest to the cut,
   * with the road types of its stored stretches, then the hand-drawn points in straight lines, `offtrail`. A cut more than
   * `MAX_CUT_OFFSET_M` away from the route, or on its first vertex, keeps nothing worth continuing: `VALIDATION_FAILED`.
   */
  private async continuedLine(
    orgId: string,
    versionId: string,
    continueFrom: NonNullable<VersionBody['continueFrom']>,
  ): Promise<{ vertices: [number, number][]; stretches: RoadStretch[]; keptDistanceM: number }> {
    const [version] = (await this.tx.execute(sql`SELECT ST_AsGeoJSON(geom)::json AS geometry FROM route_versions WHERE id = ${versionId} AND organization_id = ${orgId}`)).rows as {
      geometry: { coordinates: number[][] };
    }[];
    if (!version) throw new DomainError('NOT_FOUND');
    const base = version.geometry.coordinates.map(([lon, lat]) => [lon!, lat!] as [number, number]);
    const cut = projectOnLine(base, [continueFrom.cutPoint.lon, continueFrom.cutPoint.lat]);
    if (cut.offsetM > MAX_CUT_OFFSET_M || cut.index === 0) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: [
          {
            path: 'continueFrom.cutPoint',
            code: cut.index === 0 ? 'at_start' : 'too_far',
            message: cut.index === 0 ? 'the cut keeps nothing of the route' : `the cut is more than ${MAX_CUT_OFFSET_M} m away from the route`,
          },
        ],
      });
    }

    // The stored stretches are consecutive pieces of the version's line that share their joining vertex.
    const pieces = (await this.tx.execute(sql`SELECT road_type::text AS road_type, ST_NPoints(geom) AS points FROM route_segments WHERE version_id = ${versionId} ORDER BY position`)).rows as {
      road_type: RoadStretch['roadType'];
      points: number;
    }[];
    const kept: RoadStretch[] = [];
    let start = 0;
    for (const piece of pieces) {
      const end = start + piece.points - 1;
      if (start < cut.index) kept.push({ fromIndex: start, toIndex: Math.min(end, cut.index), roadType: piece.road_type });
      start = end;
    }
    // If the pieces do not add up to the line (they always should), the kept part is not classified rather than wrongly classified.
    const stretches: RoadStretch[] = start === base.length - 1 ? kept : [{ fromIndex: 0, toIndex: cut.index, roadType: 'unknown' }];

    const vertices = [...base.slice(0, cut.index + 1), ...continueFrom.points.map(({ lat, lon }) => [lon, lat] as [number, number])];
    stretches.push({ fromIndex: cut.index, toIndex: vertices.length - 1, roadType: 'offtrail' });
    return { vertices, stretches, keptDistanceM: cut.distanceM };
  }

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
    provenance: 'imported' | 'drawn' | 'edited' | 'generated';
    manuallyModified: boolean;
    sourceFileId: string | null;
    note: string | undefined;
    /** The calculation that proposed this version (H3): how a retried job knows what it already did. */
    calculationJobId?: string;
  }): Promise<string> {
    const { measured } = input;
    const { metrics } = measured;
    const geom = lineString(measured.coordinates);
    const [row] = (
      await this.tx.execute(sql`
      INSERT INTO route_versions (organization_id, route_id, version_number, geom, distance_m, ascent_m, descent_m, min_elevation_m, max_elevation_m, max_slope_pct,
                                  provenance, manually_modified, source_file_id, note, created_by, calculation_job_id)
      VALUES (${input.orgId}::uuid, ${input.routeId}::uuid, ${input.number}, ${geom}, ${metrics.distanceM}, ${metrics.ascentM}, ${metrics.descentM}, ${metrics.minElevationM},
              ${metrics.maxElevationM}, ${metrics.maxSlopePct}, ${input.provenance}::provenance, ${input.manuallyModified}, ${input.sourceFileId}::uuid, ${input.note || null}, ${input.userId}::uuid,
              ${input.calculationJobId ?? null}::uuid)
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
