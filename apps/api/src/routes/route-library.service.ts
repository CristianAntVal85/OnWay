import { Inject, Injectable } from '@nestjs/common';
import type { ListRoutesQuery, OperationOutput } from '@onway/contracts';
import { computeMetrics, type Position3D } from '@onway/geo';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { isoUtc, viewerOf } from '../missions/mission-support.js';
import { readRouteDetail, readSegments, versionView, versionColumns, VERSION_FROM, type VersionRow } from './route-reads.js';

type Query = z.infer<typeof ListRoutesQuery>;
type Page = OperationOutput<'listRoutes'>;
type Item = Page['items'][number];

/** Most points of the line that paints a route in a list (doc 06, `LineStringPreview`). */
export const PREVIEW_POINTS = 400;

/** `%` and `_` in what the user typed are text, not wildcards. */
const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** At most `limit` positions, evenly spread and keeping the first and the last. */
export function capPositions<T>(positions: readonly T[], limit: number): T[] {
  if (positions.length <= limit) return [...positions];
  const last = positions.length - 1;
  return Array.from({ length: limit }, (_, k) => positions[Math.round((k * last) / (limit - 1))]!);
}

interface ListRow {
  id: string;
  name: string;
  status: Item['status'];
  updated_at: string;
  derived_from_route_id: string | null;
  used_in: number;
  lv_id: string;
  lv_number: number;
  lv_status: 'draft' | 'validated';
  distance_m: number;
  ascent_m: number;
  descent_m: number;
  min_elevation_m: number;
  max_elevation_m: number;
  max_slope_pct: number;
  vv_id: string | null;
  vv_number: number | null;
  validated_at: string | null;
  stale: boolean | null;
  preview: string;
}

/**
 * Reads of the route library (RF-502, RF-504, RF-512, RF-519; D-H2-11). The list filters by the visible area with the GiST
 * index of `route_versions.geom`, by every other filter in SQL, and answers with the lines simplified in the database. A route is
 * shown by its latest version (`routes.latest_version_id`); "stale" compares the latest validation with the organization's limit
 * and the `Clock`, never the machine's time. Another organization's route is not there (INV-01); the administrator reads too.
 */
@Injectable()
export class RouteLibrary {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  async list(principal: Principal, query: Query): Promise<Page> {
    const { orgId } = viewerOf(principal);
    const now = this.clock.now().toISOString();

    const where: SQL[] = [sql`r.organization_id = ${orgId}::uuid`, sql`r.status = ${query.status}::route_status`];
    if (query.bbox) {
      const { minLon, minLat, maxLon, maxLat } = query.bbox;
      where.push(sql`lv.geom && ST_MakeEnvelope(${minLon}::float8, ${minLat}::float8, ${maxLon}::float8, ${maxLat}::float8, 4326)`);
    }
    if (query.q) where.push(sql`r.name ILIKE ${likePattern(query.q)} ESCAPE '\\'`);
    if (query.versionStatus) where.push(sql`lv.status = ${query.versionStatus}::version_status`);
    if (query.minDistanceM !== undefined) where.push(sql`lv.distance_m >= ${query.minDistanceM}`);
    if (query.maxDistanceM !== undefined) where.push(sql`lv.distance_m <= ${query.maxDistanceM}`);
    if (query.minAscentM !== undefined) where.push(sql`lv.ascent_m >= ${query.minAscentM}`);
    if (query.maxAscentM !== undefined) where.push(sql`lv.ascent_m <= ${query.maxAscentM}`);
    if (query.validatedWithinDays !== undefined) where.push(sql`vv.validated_at >= ${now}::timestamptz - make_interval(days => ${query.validatedWithinDays}::int)`);
    const conditions = sql.join(where, sql` AND `);

    const order = {
      updated_desc: sql`r.updated_at DESC, r.id`,
      name_asc: sql`lower(r.name), r.id`,
      distance_asc: sql`lv.distance_m, r.id`,
      distance_desc: sql`lv.distance_m DESC, r.id`,
      ascent_desc: sql`lv.ascent_m DESC, r.id`,
    }[query.sort];

    const from = sql`
      FROM routes r
      JOIN route_versions lv ON lv.id = r.latest_version_id
      JOIN organizations o ON o.id = r.organization_id
      LEFT JOIN route_versions vv ON vv.id = r.latest_validated_version_id`;

    const [{ n }] = (await this.tx.execute(sql`SELECT count(*)::int AS n ${from} WHERE ${conditions}`)).rows as [{ n: number }];
    const { rows } = await this.tx.execute(sql`
      SELECT r.id, r.name, r.status::text AS status, ${sql.raw(isoUtc('r.updated_at'))} AS updated_at, r.derived_from_route_id,
             (SELECT count(*)::int FROM mission_routes mr WHERE mr.route_id = r.id) AS used_in,
             lv.id AS lv_id, lv.version_number AS lv_number, lv.status::text AS lv_status,
             lv.distance_m::float8 AS distance_m, lv.ascent_m::float8 AS ascent_m, lv.descent_m::float8 AS descent_m,
             lv.min_elevation_m::float8 AS min_elevation_m, lv.max_elevation_m::float8 AS max_elevation_m, lv.max_slope_pct::float8 AS max_slope_pct,
             vv.id AS vv_id, vv.version_number AS vv_number, ${sql.raw(isoUtc('vv.validated_at'))} AS validated_at,
             (vv.validated_at < ${now}::timestamptz - make_interval(days => o.validation_max_age_days)) AS stale,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Force2D(lv.geom), GREATEST(ST_XMax(lv.geom) - ST_XMin(lv.geom), ST_YMax(lv.geom) - ST_YMin(lv.geom)) / 600.0), 7) AS preview
        ${from}
       WHERE ${conditions}
       ORDER BY ${order}
       LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);

    return { items: (rows as unknown as ListRow[]).map(listItem), page: query.page, pageSize: query.pageSize, total: n };
  }

  get(principal: Principal, routeId: string): Promise<OperationOutput<'getRoute'>> {
    return readRouteDetail(this.tx, viewerOf(principal).orgId, routeId);
  }

  /** A version with its line (altitudes included), its stretches and the elevation profile, measured again from the stored line. */
  async getVersion(principal: Principal, routeId: string, versionId: string): Promise<OperationOutput<'getRouteVersion'>> {
    const { orgId } = viewerOf(principal);
    const { rows } = await this.tx.execute(sql`
      SELECT ${versionColumns()}, ST_AsGeoJSON(v.geom, 7) AS geojson FROM ${sql.raw(VERSION_FROM)}
       WHERE v.id = ${versionId} AND v.route_id = ${routeId} AND v.organization_id = ${orgId}`);
    const row = rows[0] as (VersionRow & { geojson: string }) | undefined;
    if (!row) throw new DomainError('NOT_FOUND');
    const coordinates = (JSON.parse(row.geojson) as { coordinates: Position3D[] }).coordinates;
    return {
      ...versionView(row),
      geometry: { type: 'LineString', coordinates },
      segments: await readSegments(this.tx, versionId),
      elevationProfile: computeMetrics(coordinates).profile,
    };
  }

  /** A version (the latest one when `versionId` is missing, or the latest validated one) of each route of the organization, with its line, in the order asked for. */
  async exportable(orgId: string, routeIds: readonly string[], which: { versionId?: string; validatedOnly?: boolean }): Promise<ExportRow[]> {
    const { rows } = await this.tx.execute(sql`
      SELECT r.id AS route_id, r.name, v.id AS version_id, v.version_number, v.status::text AS status, ${sql.raw(isoUtc('v.validated_at'))} AS validated_at, ST_AsGeoJSON(v.geom, 7) AS geojson
        FROM routes r
        JOIN route_versions v ON v.route_id = r.id AND v.organization_id = r.organization_id
       WHERE r.organization_id = ${orgId}::uuid AND r.id IN (${sql.join(
         routeIds.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
         AND ${which.versionId ? sql`v.id = ${which.versionId}::uuid` : which.validatedOnly ? sql`v.id = r.latest_validated_version_id` : sql`v.id = r.latest_version_id`}`);
    const byId = new Map((rows as unknown as (ExportRaw & { route_id: string })[]).map((row) => [row.route_id, row]));
    return routeIds.flatMap((id) => {
      const row = byId.get(id);
      return row
        ? [
            {
              routeId: id,
              name: row.name,
              versionNumber: row.version_number,
              status: row.status,
              validatedAt: row.validated_at,
              coordinates: (JSON.parse(row.geojson) as { coordinates: Position3D[] }).coordinates,
            },
          ]
        : [];
    });
  }
}

interface ExportRaw {
  name: string;
  version_number: number;
  status: 'draft' | 'validated';
  validated_at: string | null;
  geojson: string;
}

export interface ExportRow {
  routeId: string;
  name: string;
  versionNumber: number;
  status: 'draft' | 'validated';
  validatedAt: string | null;
  coordinates: Position3D[];
}

function listItem(row: ListRow): Item {
  const line = (JSON.parse(row.preview) as { coordinates: [number, number][] }).coordinates;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    latestVersion: {
      id: row.lv_id,
      number: row.lv_number,
      status: row.lv_status,
      metrics: {
        distanceM: row.distance_m,
        ascentM: row.ascent_m,
        descentM: row.descent_m,
        minElevationM: row.min_elevation_m,
        maxElevationM: row.max_elevation_m,
        maxSlopePct: row.max_slope_pct,
      },
    },
    latestValidated: row.vv_id === null ? null : { versionId: row.vv_id, number: row.vv_number!, validatedAt: row.validated_at!, isStale: row.stale === true },
    usedInMissions: row.used_in,
    derivedFromRouteId: row.derived_from_route_id,
    previewGeometry: { type: 'LineString', coordinates: capPositions(line, PREVIEW_POINTS) },
    updatedAt: row.updated_at,
  };
}
