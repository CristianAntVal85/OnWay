import { Inject, Injectable } from '@nestjs/common';
import type { ImportPointsRequest, OperationOutput, PointInput, UpdatePointRequest } from '@onway/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditWriter } from '../audit/audit.writer.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { missionPoints } from '../db/schema.js';
import { ImportedTracks } from '../files/imported-tracks.js';
import { ELEVATION_PROVIDER, type ElevationProvider } from '../geo/elevation.js';
import { translateMissionWriteError } from './errors.js';
import { groundAltitude, lockMission, pointZ, viewerOf } from './mission-support.js';

/** Most points one file may add: a mission with more than this is a track file by mistake, not a list of places. */
export const MAX_IMPORTED_POINTS = 100;

type PointBody = z.infer<typeof PointInput>;
type UpdateBody = z.infer<typeof UpdatePointRequest>;
type ImportBody = z.infer<typeof ImportPointsRequest>;
type Point = OperationOutput<'createMissionPoint'>;
type Kind = Point['kind'];

/**
 * Origins, intermediate and rendezvous points of a mission (RF-402, RF-403, RF-404, D-H1-06). `position` counts within
 * (mission, kind) from 0 and stays contiguous; the altitude is the server's and is recalculated when the point moves.
 * A closed mission refuses all of it (INV-11): the service answers `MISSION_CLOSED` and the trigger is the second defence.
 */
@Injectable()
export class MissionPointsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(ELEVATION_PROVIDER) private readonly elevation: ElevationProvider,
    @Inject(ImportedTracks) private readonly tracks: ImportedTracks,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  async create(principal: Principal, missionId: string, body: PointBody): Promise<Point> {
    const viewer = viewerOf(principal);
    await this.lockOpen(viewer.orgId, missionId);
    const elevationM = await groundAltitude(this.elevation, body);
    const [last] = (await this.tx.execute(sql`SELECT max("position") AS last FROM mission_points WHERE mission_id = ${missionId} AND kind = ${body.kind}::point_kind`)).rows as {
      last: number | null;
    }[];

    let pointId: string;
    try {
      const [created] = await this.tx
        .insert(missionPoints)
        .values({
          organizationId: viewer.orgId,
          missionId,
          kind: body.kind,
          name: body.name,
          note: body.note || null,
          geom: pointZ(body.lat, body.lon, elevationM),
          position: last?.last === null || last === undefined ? 0 : last.last + 1,
        })
        .returning({ id: missionPoints.id });
      pointId = created!.id;
    } catch (error) {
      translateMissionWriteError(error);
    }
    await this.audit.recordMission({ orgId: viewer.orgId, missionId, action: 'point_added', actorUserId: viewer.userId, detail: { name: body.name, kind: body.kind } });
    return this.read(missionId, pointId);
  }

  /**
   * Adds the named points (`wpt` of a GPX, `Point` of a KML) of an uploaded file as points of `kind` (RF-405). Their altitude is
   * the server's, never the file's (RN-07); each point leaves its own `point_added` row (INV-16); all of them or none.
   */
  async importFromFile(principal: Principal, missionId: string, body: ImportBody): Promise<{ items: Point[] }> {
    const viewer = viewerOf(principal);
    await this.lockOpen(viewer.orgId, missionId);
    const { track } = await this.tracks.open(viewer.orgId, body.fileId);
    const { waypoints } = track;
    if (waypoints.length === 0) throw new DomainError('INVALID_FILE_CONTENT', 'The file has no named points to import', { reason: 'no_waypoints' });
    if (waypoints.length > MAX_IMPORTED_POINTS) throw new DomainError('INVALID_FILE_CONTENT', 'The file has too many points to import', { reason: 'too_many_waypoints' });

    const heights = await this.elevation.elevationsAt(waypoints.map(({ lat, lon }) => ({ lat, lon })));
    if (heights.some((height) => height === null)) throw new DomainError('OUTSIDE_COVERAGE');
    const [last] = (await this.tx.execute(sql`SELECT max("position") AS last FROM mission_points WHERE mission_id = ${missionId} AND kind = ${body.kind}::point_kind`)).rows as {
      last: number | null;
    }[];
    const first = last?.last === null || last === undefined ? 0 : last.last + 1;

    const items: Point[] = [];
    for (const [index, waypoint] of waypoints.entries()) {
      const elevationM = heights[index]!;
      const name = Array.from(waypoint.name?.trim() || `P${index + 1}`)
        .slice(0, 120)
        .join('');
      let created: { id: string };
      try {
        [created] = (await this.tx
          .insert(missionPoints)
          .values({ organizationId: viewer.orgId, missionId, kind: body.kind, name, note: null, geom: pointZ(waypoint.lat, waypoint.lon, elevationM), position: first + index })
          .returning({ id: missionPoints.id })) as [{ id: string }];
      } catch (error) {
        translateMissionWriteError(error);
      }
      await this.audit.recordMission({ orgId: viewer.orgId, missionId, action: 'point_added', actorUserId: viewer.userId, detail: { name, kind: body.kind, source: 'import' } });
      items.push({ id: created.id, kind: body.kind, name, note: null, lat: waypoint.lat, lon: waypoint.lon, elevationM, position: first + index });
    }
    return { items };
  }

  async update(principal: Principal, missionId: string, pointId: string, body: UpdateBody): Promise<Point> {
    const viewer = viewerOf(principal);
    await this.lockOpen(viewer.orgId, missionId);
    const current = await this.read(missionId, pointId);

    const changes: Partial<typeof missionPoints.$inferInsert> = {};
    const fields: string[] = [];
    if (body.name !== undefined) {
      changes.name = body.name;
      fields.push('name');
    }
    if (body.note !== undefined) {
      changes.note = body.note || null;
      fields.push('note');
    }
    if (body.lat !== undefined || body.lon !== undefined) {
      const lat = body.lat ?? current.lat;
      const lon = body.lon ?? current.lon;
      Object.assign(changes, { geom: pointZ(lat, lon, await groundAltitude(this.elevation, { lat, lon })) });
      fields.push('location');
    }
    const kind: Kind = body.kind ?? current.kind;
    if (body.kind !== undefined && body.kind !== current.kind) {
      changes.kind = body.kind;
      fields.push('kind');
    }
    if (body.position !== undefined) fields.push('position');

    try {
      if (Object.keys(changes).length > 0) {
        await this.tx
          .update(missionPoints)
          .set(changes)
          .where(and(eq(missionPoints.id, pointId), eq(missionPoints.missionId, missionId), eq(missionPoints.organizationId, viewer.orgId)));
      }
      if (kind !== current.kind || body.position !== undefined) {
        // Take the point out of its list and put it back where it was asked to go (or at the end of the new kind).
        if (kind !== current.kind) await this.renumber(missionId, current.kind, [], null);
        await this.renumber(missionId, kind, [pointId], body.position ?? null);
      }
    } catch (error) {
      translateMissionWriteError(error);
    }
    await this.audit.recordMission({ orgId: viewer.orgId, missionId, action: 'point_updated', actorUserId: viewer.userId, detail: { name: body.name ?? current.name, fields } });
    return this.read(missionId, pointId);
  }

  async remove(principal: Principal, missionId: string, pointId: string): Promise<void> {
    const viewer = viewerOf(principal);
    await this.lockOpen(viewer.orgId, missionId);
    const current = await this.read(missionId, pointId);
    try {
      await this.tx.delete(missionPoints).where(and(eq(missionPoints.id, pointId), eq(missionPoints.missionId, missionId), eq(missionPoints.organizationId, viewer.orgId)));
      await this.renumber(missionId, current.kind, [], null);
    } catch (error) {
      translateMissionWriteError(error);
    }
    await this.audit.recordMission({ orgId: viewer.orgId, missionId, action: 'point_removed', actorUserId: viewer.userId, detail: { name: current.name, kind: current.kind } });
  }

  /** Locks the mission (the writers of its points go one at a time, so positions never clash) and refuses a closed one. */
  private async lockOpen(orgId: string, missionId: string): Promise<void> {
    const mission = await lockMission(this.tx, orgId, missionId);
    if (mission.status === 'closed') throw new DomainError('MISSION_CLOSED');
  }

  /** One point of the mission or `NOT_FOUND` (a point of another mission or organization is not there). */
  private async read(missionId: string, pointId: string): Promise<Point> {
    const { rows } = await this.tx.execute(sql`
      SELECT p.id, p.kind::text AS kind, p.name, p.note, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon, ST_Z(p.geom) AS elevation_m, p."position" AS position
        FROM mission_points p WHERE p.id = ${pointId} AND p.mission_id = ${missionId}`);
    const row = rows[0] as { id: string; kind: Kind; name: string; note: string | null; lat: number; lon: number; elevation_m: number; position: number } | undefined;
    if (!row) throw new DomainError('NOT_FOUND');
    return { id: row.id, kind: row.kind, name: row.name, note: row.note, lat: row.lat, lon: row.lon, elevationM: row.elevation_m, position: row.position };
  }

  /**
   * Rewrites the positions of one kind as 0..n-1. The ids in `place` are taken out of the order and put back at
   * `at` (clamped to the end; null = at the end), so a move, a change of kind and a deletion share one routine.
   */
  private async renumber(missionId: string, kind: Kind, place: string[], at: number | null): Promise<void> {
    const { rows } = await this.tx.execute(sql`SELECT id FROM mission_points WHERE mission_id = ${missionId} AND kind = ${kind}::point_kind ORDER BY "position", created_at, id`);
    const order = (rows as { id: string }[]).map((row) => row.id).filter((id) => !place.includes(id));
    order.splice(at === null ? order.length : Math.min(at, order.length), 0, ...place);
    for (const [index, id] of order.entries()) {
      await this.tx.execute(sql`UPDATE mission_points SET "position" = ${index} WHERE id = ${id} AND "position" <> ${index}`);
    }
  }
}
