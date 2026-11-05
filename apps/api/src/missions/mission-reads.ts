import type { OperationOutput } from '@onway/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { DomainError } from '../common/domain-error.js';
import type { Tx } from '../db/database.service.js';

// Read model of the staff views of a mission (lists and detail). Spatial values and timestamps are shaped in SQL
// (ST_X/ST_Y/ST_Z, ISO text, ints) so the driver's own parsing never matters; every query also filters by the
// caller's organization, the second defence behind row level security (rule 1).

export type MissionDetail = OperationOutput<'getMission'>;
export type MissionListItem = OperationOutput<'listMissions'>['items'][number];
type MissionStatus = MissionDetail['status'];

/** ISO 8601 with milliseconds and `Z`, built in the database so it is the same text everywhere. */
const iso = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const MISSION_COLUMNS = sql.raw(`
  m.id, m.name, m.status::text AS status, m.description, m.coordinator_id, cu.display_name AS coordinator_name,
  ST_Y(m.target) AS lat, ST_X(m.target) AS lon, ST_Z(m.target) AS elevation_m,
  m.target_label, m.target_country::text AS target_country, m.target_source::text AS target_source,
  ${iso('m.created_at')} AS created_at, ${iso('m.updated_at')} AS updated_at,
  ${iso('m.activated_at')} AS activated_at, ${iso('m.closed_at')} AS closed_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.position, p.created_at, p.id)
              FROM mission_points p WHERE p.mission_id = m.id AND p.kind = 'origin'), '[]'::jsonb) AS origins,
  (SELECT count(*)::int FROM mission_routes mr WHERE mr.mission_id = m.id) AS routes_total,
  (SELECT count(*)::int FROM mission_routes mr JOIN route_versions v ON v.id = mr.pinned_version_id
    WHERE mr.mission_id = m.id AND v.status = 'validated') AS routes_validated,
  (SELECT count(*)::int FROM mission_routes mr JOIN route_versions v ON v.id = mr.pinned_version_id
    WHERE mr.mission_id = m.id AND v.status = 'validated' AND mr.status = 'added') AS routes_usable,
  (SELECT count(*)::int FROM participations pa WHERE pa.mission_id = m.id AND pa.status = 'accepted') AS accepted,
  (SELECT count(*)::int FROM participations pa WHERE pa.mission_id = m.id AND pa.status = 'pending') AS pending`);

interface MissionRow {
  id: string;
  name: string;
  status: MissionStatus;
  description: string | null;
  coordinator_id: string;
  coordinator_name: string | null;
  lat: number;
  lon: number;
  elevation_m: number;
  target_label: string | null;
  target_country: string | null;
  target_source: 'coordinates' | 'map' | 'address';
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  closed_at: string | null;
  origins: { id: string; name: string }[];
  routes_total: number;
  routes_validated: number;
  routes_usable: number;
  accepted: number;
  pending: number;
}

function listItem(row: MissionRow): MissionListItem {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    coordinator: row.coordinator_name === null ? null : { id: row.coordinator_id, displayName: row.coordinator_name },
    target: { lat: row.lat, lon: row.lon, elevationM: row.elevation_m, label: row.target_label, country: row.target_country, source: row.target_source },
    origins: row.origins,
    routes: { validated: row.routes_validated, total: row.routes_total },
    participants: { accepted: row.accepted, pending: row.pending },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface Viewer {
  orgId: string;
  role: 'admin' | 'coordinator' | 'rescuer';
}

/** What this user can do with the mission now (RF-103): the web only paints buttons; the server decides (rule 2). */
function actionsFor(role: Viewer['role'], status: MissionStatus): MissionDetail['actions'] {
  const writer = role === 'coordinator'; // MISSION_WRITERS: the administrator reads, never writes (Q-14 = no)
  const open = status !== 'closed';
  return {
    edit: writer && open,
    activate: writer && status === 'planning',
    close: writer && status === 'active',
    reopen: writer && status === 'closed',
    duplicate: writer,
    manageParticipants: writer && open,
    manageRoutes: writer && open,
  };
}

/** `ILIKE` pattern for "contains q", with the wildcards of `q` taken literally. */
const containing = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listMissions(tx: Tx, orgId: string, query: { page: number; pageSize: number; status?: MissionStatus | undefined; q?: string | undefined; coordinatorId?: string | undefined }) {
  const filters: SQL[] = [sql`m.organization_id = ${orgId}`];
  if (query.status) filters.push(sql`m.status = ${query.status}::mission_status`);
  if (query.q) filters.push(sql`m.name ILIKE ${containing(query.q)}`);
  if (query.coordinatorId) filters.push(sql`m.coordinator_id = ${query.coordinatorId}`);
  const where = sql.join(filters, sql` AND `);

  const [count] = (await tx.execute(sql`SELECT count(*)::int AS total FROM missions m WHERE ${where}`)).rows as { total: number }[];
  const { rows } = await tx.execute(sql`
    SELECT ${MISSION_COLUMNS} FROM missions m LEFT JOIN users cu ON cu.id = m.coordinator_id
    WHERE ${where} ORDER BY m.created_at DESC, m.id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
  return { items: (rows as unknown as MissionRow[]).map(listItem), page: query.page, pageSize: query.pageSize, total: count?.total ?? 0 };
}

/** The detail of a mission of the caller's organization, or `NOT_FOUND`: another organization's mission is not there (INV-01). */
export async function missionDetail(tx: Tx, viewer: Viewer, missionId: string): Promise<MissionDetail> {
  const { rows } = await tx.execute(sql`
    SELECT ${MISSION_COLUMNS} FROM missions m LEFT JOIN users cu ON cu.id = m.coordinator_id
    WHERE m.id = ${missionId} AND m.organization_id = ${viewer.orgId}`);
  const row = (rows as unknown as MissionRow[])[0];
  if (!row) throw new DomainError('NOT_FOUND');

  const points = (
    await tx.execute(sql`
      SELECT p.id, p.kind::text AS kind, p.name, p.note, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon, ST_Z(p.geom) AS elevation_m, p."position" AS position
        FROM mission_points p WHERE p.mission_id = ${missionId} AND p.organization_id = ${viewer.orgId}
       ORDER BY p.kind, p."position", p.created_at, p.id`)
  ).rows as { id: string; kind: MissionDetail['points'][number]['kind']; name: string; note: string | null; lat: number; lon: number; elevation_m: number; position: number }[];

  const teams = (
    await tx.execute(sql`
      SELECT t.id, t.name, t.locality FROM mission_team_assignments a JOIN teams t ON t.id = a.team_id
       WHERE a.mission_id = ${missionId} AND a.organization_id = ${viewer.orgId} ORDER BY t.name, t.id`)
  ).rows as { id: string; name: string; locality: string }[];

  const [newer] = (
    await tx.execute(sql`
      SELECT count(*)::int AS n FROM mission_routes mr
        JOIN route_versions pv ON pv.id = mr.pinned_version_id
        JOIN routes r ON r.id = mr.route_id
        JOIN route_versions lv ON lv.id = r.latest_validated_version_id
       WHERE mr.mission_id = ${missionId} AND lv.version_number > pv.version_number`)
  ).rows as { n: number }[];

  return {
    ...listItem(row),
    description: row.description,
    activatedAt: row.activated_at,
    closedAt: row.closed_at,
    points: points.map((p) => ({ id: p.id, kind: p.kind, name: p.name, note: p.note, lat: p.lat, lon: p.lon, elevationM: p.elevation_m, position: p.position })),
    teams,
    readiness: { targetDefined: true, hasOrigins: row.origins.length > 0, hasParticipants: row.accepted > 0, hasValidatedRoute: row.routes_usable > 0 },
    routesWithNewerValidatedVersion: newer?.n ?? 0,
    actions: actionsFor(viewer.role, row.status),
  };
}

/** One page of the history of a mission, newest first (RN-05). Only `entity_type = 'mission'` rows are read (policy `audit_mission_staff`). */
export async function missionHistory(tx: Tx, orgId: string, missionId: string, query: { page: number; pageSize: number }): Promise<OperationOutput<'listMissionHistory'>> {
  const [count] = (await tx.execute(sql`SELECT count(*)::int AS total FROM audit_log a WHERE a.organization_id = ${orgId} AND a.entity_type = 'mission' AND a.entity_id = ${missionId}`)).rows as {
    total: number;
  }[];
  const { rows } = await tx.execute(sql`
    SELECT a.id::text AS id, ${sql.raw(iso('a.occurred_at'))} AS occurred_at, a.action, a.actor_user_id, u.display_name AS actor_name, a.detail
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.organization_id = ${orgId} AND a.entity_type = 'mission' AND a.entity_id = ${missionId}
     ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
  const items = (rows as { id: string; occurred_at: string; action: string; actor_user_id: string | null; actor_name: string | null; detail: Record<string, unknown> }[]).map((row) => ({
    id: Number(row.id),
    occurredAt: row.occurred_at,
    action: row.action as OperationOutput<'listMissionHistory'>['items'][number]['action'],
    actor: row.actor_user_id !== null && row.actor_name !== null ? { id: row.actor_user_id, displayName: row.actor_name } : null,
    summary: summaryOf(row.detail),
  }));
  return { items, page: query.page, pageSize: query.pageSize, total: count?.total ?? 0 };
}

/** The short text of a history line: the name of the point or route involved, or the fields that changed. */
function summaryOf(detail: Record<string, unknown>): string | null {
  if (typeof detail.name === 'string') return detail.name;
  if (Array.isArray(detail.fields) && detail.fields.every((f) => typeof f === 'string')) return detail.fields.join(', ');
  return null;
}
