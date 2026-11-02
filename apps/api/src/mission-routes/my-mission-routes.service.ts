import { Inject, Injectable } from '@nestjs/common';
import type { ExportMissionRoutesQuery, OperationOutput } from '@onway/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { ExportedFile } from '../common/download.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { isoUtc, viewerOf } from '../missions/mission-support.js';
import { capPositions } from '../routes/route-library.service.js';
import { exportFile, safeFileName } from '../routes/route-exports.service.js';
import { parseIds, readExportRows, readGeometry } from './mission-routes-reads.service.js';

type Rows = OperationOutput<'listMyMissionRoutes'>;
type Row = Rows['items'][number];

/** Most points of the line that paints a route in the list; the full line comes with the geometry (D-H4-07). */
const PREVIEW_POINTS = 400;

/**
 * INV-05, RN-03 and D-H4-04: what a rescuer may read of the routes of a mission is the PINNED version of each row, only if it is validated, in a
 * mission that is active or closed (RN-16: never in planning) of their organization. Two defences, as everywhere: the policies `mroutes_rescuer`,
 * `versions_rescuer`, `segments_rescuer` and `routes_rescuer` of the database, and this explicit condition in every query. Nothing here takes a
 * version from the client, and nothing returns a note, a Draft or who validated (the schema `MissionRouteRescuer` has no place for them).
 */
const VISIBLE = sql`m.organization_id = mr.organization_id AND m.status IN ('active', 'closed') AND pv.status = 'validated'`;

interface RawRow {
  id: string;
  route_id: string;
  name: string;
  status: Row['status'];
  version_number: number;
  validated_at: string;
  stale: boolean;
  distance_m: number;
  ascent_m: number;
  descent_m: number;
  min_elevation_m: number;
  max_elevation_m: number;
  max_slope_pct: number;
  road_mix: Row['roadMix'];
  origin_id: string | null;
  origin_name: string | null;
  team_id: string | null;
  team_name: string | null;
  team_locality: string | null;
  preview: string;
}

@Injectable()
export class MyMissionRoutes {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  /** RF-601, RF-602: the validated, pinned routes of the mission, in the order they were added. A route marked unavailable is listed and marked (RF-508). */
  async list(principal: Principal, missionId: string): Promise<Rows> {
    const { orgId } = viewerOf(principal);
    await this.visibleMission(orgId, missionId);
    const { rows } = await this.tx.execute(sql`
      SELECT mr.id, mr.route_id, r.name, mr.status::text AS status,
             pv.version_number, ${sql.raw(isoUtc('pv.validated_at'))} AS validated_at,
             (pv.validated_at < ${this.clock.now().toISOString()}::timestamptz - make_interval(days => o.validation_max_age_days)) AS stale,
             pv.distance_m::float8 AS distance_m, pv.ascent_m::float8 AS ascent_m, pv.descent_m::float8 AS descent_m,
             pv.min_elevation_m::float8 AS min_elevation_m, pv.max_elevation_m::float8 AS max_elevation_m, pv.max_slope_pct::float8 AS max_slope_pct,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('roadType', mix.road_type, 'distanceM', mix.distance_m) ORDER BY mix.road_type)
                         FROM (SELECT s.road_type::text AS road_type, sum(s.distance_m)::float8 AS distance_m FROM route_segments s WHERE s.version_id = pv.id GROUP BY s.road_type) mix), '[]'::jsonb) AS road_mix,
             mp.id AS origin_id, mp.name AS origin_name, t.id AS team_id, t.name AS team_name, t.locality AS team_locality,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Force2D(pv.geom), GREATEST(ST_XMax(pv.geom) - ST_XMin(pv.geom), ST_YMax(pv.geom) - ST_YMin(pv.geom)) / 600.0), 7) AS preview
        FROM mission_routes mr
        JOIN missions m ON m.id = mr.mission_id
        JOIN routes r ON r.id = mr.route_id AND r.organization_id = mr.organization_id
        JOIN route_versions pv ON pv.id = mr.pinned_version_id
        JOIN organizations o ON o.id = mr.organization_id
        LEFT JOIN mission_points mp ON mp.id = mr.origin_point_id
        LEFT JOIN teams t ON t.id = mr.team_id
       WHERE mr.mission_id = ${missionId}::uuid AND mr.organization_id = ${orgId}::uuid AND ${VISIBLE}
       ORDER BY mr.added_at, mr.id`);
    return { items: (rows as unknown as RawRow[]).map(rowOf) };
  }

  /** The line, stretches and profile of the pinned version. If that version is not validated (or the mission is in planning) the row is not there: 404. */
  async geometry(principal: Principal, missionId: string, missionRouteId: string): Promise<OperationOutput<'getMyMissionRouteGeometry'>> {
    const { orgId } = viewerOf(principal);
    return readGeometry(this.tx, orgId, missionId, missionRouteId, sql` AND m.status IN ('active', 'closed') AND v.status = 'validated'`);
  }

  /**
   * RF-603, P2: only the validated and pinned versions of routes that are NOT marked unavailable (a route that is warned not to be used is not
   * downloaded), and only while the mission is active. A closed mission is read but not exported; a mission in planning is not there.
   */
  async export(principal: Principal, missionId: string, query: z.infer<typeof ExportMissionRoutesQuery>): Promise<ExportedFile> {
    const { orgId } = viewerOf(principal);
    const mission = await this.visibleMission(orgId, missionId);
    if (mission.status !== 'active') throw new DomainError('MISSION_NOT_ACTIVE');
    const ids = parseIds(query.ids);
    const narrowed: SQL = ids ? sql` AND mr.id IN (${ids})` : sql``;
    const rows = await readExportRows(this.tx, orgId, missionId, sql` AND ${VISIBLE} AND mr.status <> 'unavailable'${narrowed}`);
    if (rows.length === 0) throw new DomainError('NOT_FOUND');
    return exportFile(rows, query.format, `${safeFileName(mission.name, 'mission')}-routes`);
  }

  /** RN-16, INV-01: an active or closed mission of the caller's organization, or it is not there. The policy `missions_select` says the same. */
  private async visibleMission(orgId: string, missionId: string): Promise<{ name: string; status: 'active' | 'closed' }> {
    const { rows } = await this.tx.execute(
      sql`SELECT name, status::text AS status FROM missions WHERE id = ${missionId}::uuid AND organization_id = ${orgId}::uuid AND status IN ('active', 'closed')`,
    );
    const mission = rows[0] as { name: string; status: 'active' | 'closed' } | undefined;
    if (!mission) throw new DomainError('NOT_FOUND');
    return mission;
  }
}

function rowOf(row: RawRow): Row {
  const line = (JSON.parse(row.preview) as { coordinates: [number, number][] }).coordinates;
  return {
    id: row.id,
    routeId: row.route_id,
    name: row.name,
    status: row.status,
    versionNumber: row.version_number,
    validatedAt: row.validated_at,
    validationIsStale: row.stale === true,
    metrics: {
      distanceM: row.distance_m,
      ascentM: row.ascent_m,
      descentM: row.descent_m,
      minElevationM: row.min_elevation_m,
      maxElevationM: row.max_elevation_m,
      maxSlopePct: row.max_slope_pct,
    },
    roadMix: row.road_mix,
    origin: row.origin_id === null ? null : { id: row.origin_id, name: row.origin_name! },
    team: row.team_id === null ? null : { id: row.team_id, name: row.team_name!, locality: row.team_locality! },
    previewGeometry: { type: 'LineString', coordinates: capPositions(line, PREVIEW_POINTS) },
  };
}
