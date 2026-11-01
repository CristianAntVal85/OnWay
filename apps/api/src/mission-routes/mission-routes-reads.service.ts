import { Inject, Injectable } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { computeMetrics, type Position3D } from '@onway/geo';
import { sql } from 'drizzle-orm';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { isoUtc, viewerOf } from '../missions/mission-support.js';
import { capPositions } from '../routes/route-library.service.js';
import { readSegments } from '../routes/route-reads.js';

type Table = OperationOutput<'listMissionRoutes'>;
type Row = Table['items'][number];

/** Most points of the line that paints a route in the table (doc 06, `LineStringPreview`); the full line comes with the geometry. */
const PREVIEW_POINTS = 400;

interface RawRow {
  id: string;
  route_id: string;
  name: string;
  status: Row['status'];
  note: string | null;
  added_at: string;
  version_id: string;
  version_number: number;
  version_status: 'draft' | 'validated';
  validated_at: string | null;
  stale: boolean;
  distance_m: number;
  ascent_m: number;
  descent_m: number;
  min_elevation_m: number;
  max_elevation_m: number;
  max_slope_pct: number;
  road_mix: Row['pinned']['roadMix'];
  newer_version_id: string | null;
  newer_version_number: number | null;
  origin_id: string | null;
  origin_name: string | null;
  team_id: string | null;
  team_name: string | null;
  team_locality: string | null;
  preview: string;
}

/**
 * The reads of the routes of a mission for the staff (RF-502, RF-518, RF-519, RF-513): the table, and the line of one route.
 * Everything is about the version the mission PINNED (RN-13, D-19), never the latest one of the route. `newerValidatedVersion` is only a
 * notice: nothing moves by itself (RF-518). "Stale" compares the validation of the pinned version with the limit of the organization
 * and the `Clock`, never the machine's time. Every query filters by the caller's organization, the second defence behind row level
 * security: another organization's mission or route is not there (INV-01). The administrator reads too (Q-14).
 */
@Injectable()
export class MissionRoutesReads {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  async list(principal: Principal, missionId: string): Promise<Table> {
    const { orgId } = viewerOf(principal);
    await this.assertMission(orgId, missionId);
    return { items: await readTable(this.tx, orgId, missionId, this.clock.now().toISOString()) };
  }

  /** The line (altitudes the server measured), the stretches and the elevation profile of the pinned version. */
  async geometry(principal: Principal, missionId: string, missionRouteId: string): Promise<OperationOutput<'getMissionRouteGeometry'>> {
    const { orgId } = viewerOf(principal);
    const { rows } = await this.tx.execute(sql`
      SELECT v.id AS version_id, v.version_number, ST_AsGeoJSON(v.geom, 7) AS geojson
        FROM mission_routes mr JOIN route_versions v ON v.id = mr.pinned_version_id
       WHERE mr.id = ${missionRouteId}::uuid AND mr.mission_id = ${missionId}::uuid AND mr.organization_id = ${orgId}::uuid`);
    const row = rows[0] as { version_id: string; version_number: number; geojson: string } | undefined;
    if (!row) throw new DomainError('NOT_FOUND');
    const coordinates = (JSON.parse(row.geojson) as { coordinates: Position3D[] }).coordinates;
    return {
      missionRouteId,
      versionNumber: row.version_number,
      geometry: { type: 'LineString', coordinates },
      segments: await readSegments(this.tx, row.version_id),
      elevationProfile: computeMetrics(coordinates).profile,
    };
  }

  private async assertMission(orgId: string, missionId: string): Promise<void> {
    const { rows } = await this.tx.execute(sql`SELECT 1 FROM missions WHERE id = ${missionId}::uuid AND organization_id = ${orgId}::uuid`);
    if (rows.length === 0) throw new DomainError('NOT_FOUND');
  }
}

/** The table of a mission, in the order the routes were added. Shared with the writes of H4-T2, which answer with the rows they touched. */
export async function readTable(tx: Tx, orgId: string, missionId: string, now: string, onlyIds?: readonly string[]): Promise<Row[]> {
  const only =
    onlyIds && onlyIds.length > 0
      ? sql` AND mr.id IN (${sql.join(
          onlyIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
  const { rows } = await tx.execute(sql`
    SELECT mr.id, mr.route_id, r.name, mr.status::text AS status, mr.note, ${sql.raw(isoUtc('mr.added_at'))} AS added_at,
           pv.id AS version_id, pv.version_number, pv.status::text AS version_status, ${sql.raw(isoUtc('pv.validated_at'))} AS validated_at,
           (pv.status = 'validated' AND pv.validated_at < ${now}::timestamptz - make_interval(days => o.validation_max_age_days)) AS stale,
           pv.distance_m::float8 AS distance_m, pv.ascent_m::float8 AS ascent_m, pv.descent_m::float8 AS descent_m,
           pv.min_elevation_m::float8 AS min_elevation_m, pv.max_elevation_m::float8 AS max_elevation_m, pv.max_slope_pct::float8 AS max_slope_pct,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('roadType', mix.road_type, 'distanceM', mix.distance_m) ORDER BY mix.road_type)
                       FROM (SELECT s.road_type::text AS road_type, sum(s.distance_m)::float8 AS distance_m FROM route_segments s WHERE s.version_id = pv.id GROUP BY s.road_type) mix), '[]'::jsonb) AS road_mix,
           nv.id AS newer_version_id, nv.version_number AS newer_version_number,
           mp.id AS origin_id, mp.name AS origin_name, t.id AS team_id, t.name AS team_name, t.locality AS team_locality,
           ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Force2D(pv.geom), GREATEST(ST_XMax(pv.geom) - ST_XMin(pv.geom), ST_YMax(pv.geom) - ST_YMin(pv.geom)) / 600.0), 7) AS preview
      FROM mission_routes mr
      JOIN routes r ON r.id = mr.route_id AND r.organization_id = mr.organization_id
      JOIN route_versions pv ON pv.id = mr.pinned_version_id
      JOIN organizations o ON o.id = mr.organization_id
      LEFT JOIN LATERAL (
        SELECT v2.id, v2.version_number FROM route_versions v2
         WHERE v2.route_id = mr.route_id AND v2.status = 'validated' AND v2.version_number > pv.version_number
         ORDER BY v2.version_number DESC LIMIT 1) nv ON true
      LEFT JOIN mission_points mp ON mp.id = mr.origin_point_id
      LEFT JOIN teams t ON t.id = mr.team_id
     WHERE mr.mission_id = ${missionId}::uuid AND mr.organization_id = ${orgId}::uuid${only}
     ORDER BY mr.added_at, mr.id`);
  return (rows as unknown as RawRow[]).map(rowOf);
}

function rowOf(row: RawRow): Row {
  const line = (JSON.parse(row.preview) as { coordinates: [number, number][] }).coordinates;
  return {
    id: row.id,
    routeId: row.route_id,
    name: row.name,
    status: row.status,
    pinned: {
      versionId: row.version_id,
      number: row.version_number,
      status: row.version_status,
      validatedAt: row.validated_at,
      metrics: {
        distanceM: row.distance_m,
        ascentM: row.ascent_m,
        descentM: row.descent_m,
        minElevationM: row.min_elevation_m,
        maxElevationM: row.max_elevation_m,
        maxSlopePct: row.max_slope_pct,
      },
      roadMix: row.road_mix,
    },
    newerValidatedVersion: row.newer_version_id === null ? null : { versionId: row.newer_version_id, number: row.newer_version_number! },
    validationIsStale: row.stale === true,
    origin: row.origin_id === null ? null : { id: row.origin_id, name: row.origin_name! },
    team: row.team_id === null ? null : { id: row.team_id, name: row.team_name!, locality: row.team_locality! },
    note: row.note,
    previewGeometry: { type: 'LineString', coordinates: capPositions(line, PREVIEW_POINTS) },
    addedAt: row.added_at,
  };
}
