import type { OperationOutput } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import { DomainError } from '../common/domain-error.js';
import type { Tx } from '../db/database.service.js';
import { isoUtc } from '../missions/mission-support.js';

// Read model of the route library (versions, detail). Numbers and timestamps are shaped in SQL (`float8`, ISO text) so the
// driver's own parsing never matters; every query filters by the caller's organization, the second defence behind row level security.

export type RouteDetail = OperationOutput<'getRoute'>;
export type RouteVersionView = RouteDetail['versions'][number];

const VERSION_COLUMNS = `
  v.id, v.version_number, v.status::text AS status, v.provenance::text AS provenance, v.manually_modified,
  v.distance_m::float8 AS distance_m, v.ascent_m::float8 AS ascent_m, v.descent_m::float8 AS descent_m,
  v.min_elevation_m::float8 AS min_elevation_m, v.max_elevation_m::float8 AS max_elevation_m, v.max_slope_pct::float8 AS max_slope_pct,
  v.note, v.created_by, COALESCE(cu.display_name, '') AS created_by_name, ${isoUtc('v.created_at')} AS created_at,
  v.validated_by, vu.display_name AS validated_by_name, ${isoUtc('v.validated_at')} AS validated_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('roadType', mix.road_type, 'distanceM', mix.distance_m) ORDER BY mix.road_type)
              FROM (SELECT s.road_type::text AS road_type, sum(s.distance_m)::float8 AS distance_m FROM route_segments s WHERE s.version_id = v.id GROUP BY s.road_type) mix), '[]'::jsonb) AS road_mix`;

export const VERSION_FROM = `route_versions v LEFT JOIN users cu ON cu.id = v.created_by LEFT JOIN users vu ON vu.id = v.validated_by`;

export interface VersionRow {
  id: string;
  version_number: number;
  status: 'draft' | 'validated';
  provenance: RouteVersionView['provenance'];
  manually_modified: boolean;
  distance_m: number;
  ascent_m: number;
  descent_m: number;
  min_elevation_m: number;
  max_elevation_m: number;
  max_slope_pct: number;
  note: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  validated_by: string | null;
  validated_by_name: string | null;
  validated_at: string | null;
  road_mix: RouteVersionView['roadMix'];
}

export const versionColumns = () => sql.raw(VERSION_COLUMNS);

export function versionView(row: VersionRow): RouteVersionView {
  return {
    id: row.id,
    number: row.version_number,
    status: row.status,
    provenance: row.provenance,
    manuallyModified: row.manually_modified,
    metrics: {
      distanceM: row.distance_m,
      ascentM: row.ascent_m,
      descentM: row.descent_m,
      minElevationM: row.min_elevation_m,
      maxElevationM: row.max_elevation_m,
      maxSlopePct: row.max_slope_pct,
    },
    roadMix: row.road_mix,
    note: row.note,
    createdBy: { id: row.created_by, displayName: row.created_by_name },
    createdAt: row.created_at,
    validatedBy: row.validated_by === null ? null : { id: row.validated_by, displayName: row.validated_by_name ?? '' },
    validatedAt: row.validated_at,
  };
}

/** One version of a route of the organization, or `NOT_FOUND`. */
export async function readVersion(tx: Tx, orgId: string, routeId: string, versionId: string): Promise<RouteVersionView> {
  const { rows } = await tx.execute(sql`SELECT ${versionColumns()} FROM ${sql.raw(VERSION_FROM)} WHERE v.id = ${versionId} AND v.route_id = ${routeId} AND v.organization_id = ${orgId}`);
  const row = rows[0] as VersionRow | undefined;
  if (!row) throw new DomainError('NOT_FOUND');
  return versionView(row);
}

interface RouteRow {
  id: string;
  name: string;
  status: RouteDetail['status'];
  created_at: string;
  updated_at: string;
  derived_from: { routeId: string; routeName: string; versionNumber: number } | null;
}

/** The detail of a route of the organization: versions (newest first), where it comes from, what comes from it and where it is used. `NOT_FOUND` if it is not there. */
export async function readRouteDetail(tx: Tx, orgId: string, routeId: string): Promise<RouteDetail> {
  const { rows } = await tx.execute(sql`
    SELECT r.id, r.name, r.status::text AS status, ${sql.raw(isoUtc('r.created_at'))} AS created_at, ${sql.raw(isoUtc('r.updated_at'))} AS updated_at,
           (SELECT jsonb_build_object('routeId', o.id, 'routeName', o.name, 'versionNumber', ov.version_number)
              FROM routes o JOIN route_versions ov ON ov.id = r.derived_from_version_id WHERE o.id = r.derived_from_route_id) AS derived_from
      FROM routes r WHERE r.id = ${routeId} AND r.organization_id = ${orgId}`);
  const route = rows[0] as RouteRow | undefined;
  if (!route) throw new DomainError('NOT_FOUND');

  const versions = (await tx.execute(sql`SELECT ${versionColumns()} FROM ${sql.raw(VERSION_FROM)} WHERE v.route_id = ${routeId} AND v.organization_id = ${orgId} ORDER BY v.version_number DESC`))
    .rows as unknown as VersionRow[];
  const derivatives = (await tx.execute(sql`SELECT id, name FROM routes WHERE derived_from_route_id = ${routeId} AND organization_id = ${orgId} ORDER BY created_at, id`)).rows as {
    id: string;
    name: string;
  }[];
  const usedIn = (
    await tx.execute(sql`
      SELECT m.id AS mission_id, mr.id AS mission_route_id, m.name AS mission_name, m.status::text AS mission_status, v.version_number AS pinned_version_number
        FROM mission_routes mr JOIN missions m ON m.id = mr.mission_id JOIN route_versions v ON v.id = mr.pinned_version_id
       WHERE mr.route_id = ${routeId} AND mr.organization_id = ${orgId} ORDER BY mr.added_at, mr.id`)
  ).rows as { mission_id: string; mission_route_id: string; mission_name: string; mission_status: 'planning' | 'active' | 'closed'; pinned_version_number: number }[];

  return {
    id: route.id,
    name: route.name,
    status: route.status,
    versions: versions.map(versionView),
    derivedFrom: route.derived_from,
    derivatives,
    usedIn: usedIn.map((row) => ({
      missionId: row.mission_id,
      missionRouteId: row.mission_route_id,
      missionName: row.mission_name,
      missionStatus: row.mission_status,
      pinnedVersionNumber: row.pinned_version_number,
    })),
    createdAt: route.created_at,
    updatedAt: route.updated_at,
  };
}

type Segment = OperationOutput<'getRouteVersion'>['segments'][number];

/** The stretches of a version, in order: the road type, the length and the climb of each (RF-503). */
export async function readSegments(tx: Tx, versionId: string): Promise<Segment[]> {
  const { rows } = await tx.execute(sql`
    SELECT position, road_type::text AS road_type, distance_m::float8 AS distance_m, ascent_m::float8 AS ascent_m, descent_m::float8 AS descent_m
      FROM route_segments WHERE version_id = ${versionId} ORDER BY position`);
  return (rows as { position: number; road_type: Segment['roadType']; distance_m: number; ascent_m: number; descent_m: number }[]).map((s) => ({
    position: s.position,
    roadType: s.road_type,
    distanceM: s.distance_m,
    ascentM: s.ascent_m,
    descentM: s.descent_m,
  }));
}
