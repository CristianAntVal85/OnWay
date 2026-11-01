import { Inject, Injectable } from '@nestjs/common';
import type { CreateAvoidZoneRequest, ListAvoidZonesQuery, OperationOutput } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditWriter } from '../audit/audit.writer.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { isoUtc, lockMission, viewerOf } from '../missions/mission-support.js';

type Zone = OperationOutput<'createAvoidZone'>;

/** Most vertices of a zone: a hand-drawn polygon has a few dozen; thousands only slow the engine down. */
export const MAX_ZONE_VERTICES = 200;

interface ZoneRow {
  id: string;
  mission_id: string | null;
  geometry: Zone['geometry'];
  reason: string | null;
  created_at: string;
}

const toZone = (row: ZoneRow): Zone => ({ id: row.id, missionId: row.mission_id, geometry: row.geometry, reason: row.reason, createdAt: row.created_at });
const columns = sql.raw(`id, mission_id, ST_AsGeoJSON(geom)::json AS geometry, reason, ${isoUtc('created_at')} AS created_at`);

/**
 * Zones to avoid (RF-507, Q-05 resolved with the default of doc 02: they belong to the organization, with an optional mission).
 * Only staff sees them and only coordinators write them (migrations 0008 and 0011); a rescuer never does. Another organization's
 * zone or mission is not there (INV-01). A zone of a closed mission is read-only (rule 5).
 */
@Injectable()
export class AvoidZones {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  async list(principal: Principal, query: z.infer<typeof ListAvoidZonesQuery>): Promise<OperationOutput<'listAvoidZones'>> {
    const { orgId } = viewerOf(principal);
    if (query.missionId) await lockMissionForRead(this.tx, orgId, query.missionId);
    const where = query.missionId ? sql`(mission_id IS NULL OR mission_id = ${query.missionId}::uuid)` : sql`mission_id IS NULL`;
    const { rows } = await this.tx.execute(sql`SELECT ${columns} FROM avoid_zones WHERE organization_id = ${orgId}::uuid AND ${where} ORDER BY created_at DESC, id`);
    return { items: (rows as unknown as ZoneRow[]).map(toZone) };
  }

  async create(principal: Principal, body: z.infer<typeof CreateAvoidZoneRequest>): Promise<Zone> {
    const { orgId, userId } = viewerOf(principal);
    const vertices = body.geometry.coordinates[0]!.length;
    if (vertices > MAX_ZONE_VERTICES) throw invalidZone('too_many_vertices', `a zone has at most ${MAX_ZONE_VERTICES} vertices`);
    if (body.missionId) {
      const mission = await lockMission(this.tx, orgId, body.missionId);
      if (mission.status === 'closed') throw new DomainError('MISSION_CLOSED');
    }
    const geojson = JSON.stringify(body.geometry);
    // ST_IsValid rejects a polygon that crosses itself: a zone that cannot be drawn on a map is not a zone.
    const { rows } = await this.tx.execute(sql`
      INSERT INTO avoid_zones (organization_id, mission_id, geom, reason, created_by)
      SELECT ${orgId}::uuid, ${body.missionId ?? null}::uuid, g, ${body.reason ?? null}, ${userId}::uuid
      FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS g) AS drawn
      WHERE ST_IsValid(g)
      RETURNING ${columns}`);
    const row = (rows as unknown as ZoneRow[])[0];
    if (!row) throw invalidZone('invalid_polygon', 'the polygon crosses itself or is not valid');
    await this.audit.recordAvoidZone({ orgId, zoneId: row.id, action: 'avoid_zone_created', actorUserId: userId, detail: { missionId: body.missionId ?? null, vertices } });
    return toZone(row);
  }

  async remove(principal: Principal, zoneId: string): Promise<void> {
    const { orgId, userId } = viewerOf(principal);
    const { rows } = await this.tx.execute(sql`SELECT mission_id FROM avoid_zones WHERE id = ${zoneId}::uuid AND organization_id = ${orgId}::uuid FOR UPDATE`);
    const zone = (rows as unknown as { mission_id: string | null }[])[0];
    if (!zone) throw new DomainError('NOT_FOUND');
    if (zone.mission_id) {
      const mission = await lockMission(this.tx, orgId, zone.mission_id);
      if (mission.status === 'closed') throw new DomainError('MISSION_CLOSED');
    }
    await this.tx.execute(sql`DELETE FROM avoid_zones WHERE id = ${zoneId}::uuid AND organization_id = ${orgId}::uuid`);
    await this.audit.recordAvoidZone({ orgId, zoneId, action: 'avoid_zone_deleted', actorUserId: userId, detail: { missionId: zone.mission_id } });
  }
}

/** A read only needs the mission to exist for this organization: no row lock, and a closed mission is fine. */
async function lockMissionForRead(tx: Tx, orgId: string, missionId: string): Promise<void> {
  const { rows } = await tx.execute(sql`SELECT 1 FROM missions WHERE id = ${missionId}::uuid AND organization_id = ${orgId}::uuid`);
  if (rows.length === 0) throw new DomainError('NOT_FOUND');
}

const invalidZone = (code: string, message: string): DomainError => new DomainError('VALIDATION_FAILED', 'Request validation failed', { issues: [{ path: 'geometry', code, message }] });
