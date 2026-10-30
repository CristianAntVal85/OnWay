import { Inject, Injectable } from '@nestjs/common';
import type { ListMyMissionsQuery, OperationOutput } from '@onway/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { isoUtc, viewerOf } from './mission-support.js';

type MyMission = OperationOutput<'getMyMission'>;
type MyListItem = OperationOutput<'listMyMissions'>['items'][number];
type Participation = NonNullable<MyMission['myParticipation']>;
type Query = z.infer<typeof ListMyMissionsQuery>;

interface Row {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'closed';
  lat: number;
  lon: number;
  elevation_m: number;
  target_label: string | null;
  target_country: string | null;
  target_source: MyMission['target']['source'];
  coordinator_name: string | null;
  validated_routes: number;
  participation_status: Participation['status'] | null;
  offered_at: string | null;
  decided_at: string | null;
}

// RN-16, INV-08: a rescuer sees active and closed missions of the organization, never a mission in planning. Row level
// security already hides those (`missions_select`); the filter on status and organization is the second defence (rule 1).
// The only personal thing here is the rescuer's own offer (RF-601); other people's participations are not readable for
// a rescuer. `coordinatorName` comes from `users`, which the policy `users_select` shows to the staff only: until a
// decision lets a rescuer read the name of the responsible, it is `null` for them (contract: string | null).
const SELECT = sql.raw(`
  m.id, m.name, m.description, m.status::text AS status,
  ST_Y(m.target) AS lat, ST_X(m.target) AS lon, ST_Z(m.target) AS elevation_m,
  m.target_label, m.target_country::text AS target_country, m.target_source::text AS target_source,
  cu.display_name AS coordinator_name,
  (SELECT count(*)::int FROM mission_routes mr JOIN route_versions v ON v.id = mr.pinned_version_id
    WHERE mr.mission_id = m.id AND v.status = 'validated') AS validated_routes,
  pa.status::text AS participation_status, ${isoUtc('pa.offered_at')} AS offered_at, ${isoUtc('pa.decided_at')} AS decided_at`);

const target = (row: Row): MyMission['target'] => ({ lat: row.lat, lon: row.lon, elevationM: row.elevation_m, label: row.target_label, country: row.target_country, source: row.target_source });
const participation = (row: Row): MyMission['myParticipation'] =>
  row.participation_status === null ? null : { status: row.participation_status, offeredAt: row.offered_at, decidedAt: row.decided_at };

@Injectable()
export class MyMissionsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get tx(): Tx {
    return this.database.current();
  }

  /** RF-601: active missions first, then closed, newest activation first. */
  async list(principal: Principal, query: Query): Promise<OperationOutput<'listMyMissions'>> {
    const viewer = viewerOf(principal);
    const filters: SQL[] = [sql`m.organization_id = ${viewer.orgId}`, query.status ? sql`m.status = ${query.status}::mission_status` : sql`m.status IN ('active', 'closed')`];
    if (query.q) filters.push(sql`m.name ILIKE ${`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
    const where = sql.join(filters, sql` AND `);

    const [count] = (await this.tx.execute(sql`SELECT count(*)::int AS total FROM missions m WHERE ${where}`)).rows as { total: number }[];
    const { rows } = await this.tx.execute(sql`
      SELECT ${SELECT} FROM missions m
        LEFT JOIN users cu ON cu.id = m.coordinator_id
        LEFT JOIN participations pa ON pa.mission_id = m.id AND pa.user_id = ${viewer.userId}
       WHERE ${where}
       ORDER BY (m.status = 'closed'), m.activated_at DESC, m.id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
    const items = (rows as unknown as Row[]).map((row): MyListItem => ({
      id: row.id,
      name: row.name,
      status: row.status,
      target: target(row),
      coordinatorName: row.coordinator_name,
      validatedRoutes: row.validated_routes,
      myParticipation: participation(row),
    }));
    return { items, page: query.page, pageSize: query.pageSize, total: count?.total ?? 0 };
  }

  /** RF-602 without routes: a mission in planning, or of another organization, is `NOT_FOUND` (doc 06 §4.3). */
  async get(principal: Principal, missionId: string): Promise<OperationOutput<'getMyMission'>> {
    const viewer = viewerOf(principal);
    const { rows } = await this.tx.execute(sql`
      SELECT ${SELECT} FROM missions m
        LEFT JOIN users cu ON cu.id = m.coordinator_id
        LEFT JOIN participations pa ON pa.mission_id = m.id AND pa.user_id = ${viewer.userId}
       WHERE m.id = ${missionId} AND m.organization_id = ${viewer.orgId} AND m.status IN ('active', 'closed')`);
    const row = (rows as unknown as Row[])[0];
    if (!row) throw new DomainError('NOT_FOUND');

    const points = (
      await this.tx.execute(sql`
        SELECT p.id, p.kind::text AS kind, p.name, p.note, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon, ST_Z(p.geom) AS elevation_m, p."position" AS position
          FROM mission_points p WHERE p.mission_id = ${missionId} AND p.organization_id = ${viewer.orgId}
         ORDER BY p.kind, p."position", p.created_at, p.id`)
    ).rows as { id: string; kind: MyMission['points'][number]['kind']; name: string; note: string | null; lat: number; lon: number; elevation_m: number; position: number }[];

    const [profile] = (await this.tx.execute(sql`SELECT (status = 'complete') AS complete FROM rescuer_profiles WHERE user_id = ${viewer.userId} AND organization_id = ${viewer.orgId} LIMIT 1`))
      .rows as { complete: boolean }[];
    const profileComplete = profile?.complete === true;

    const mine = participation(row);
    const status = mine?.status ?? null;
    // Doc 03 §5: a rescuer withdraws only while Pending; after a rejection only the coordinator reconsiders, after withdrawing they may offer again.
    const offerBlockedReason: MyMission['offerBlockedReason'] =
      row.status !== 'active' ? 'mission_not_active' : status !== null && status !== 'withdrawn' ? 'already_offered' : !profileComplete ? 'profile_incomplete' : null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      target: target(row),
      coordinatorName: row.coordinator_name,
      points: points.map((p) => ({ id: p.id, kind: p.kind, name: p.name, note: p.note, lat: p.lat, lon: p.lon, elevationM: p.elevation_m, position: p.position })),
      myParticipation: mine,
      canOffer: offerBlockedReason === null,
      canWithdraw: row.status === 'active' && status === 'pending',
      offerBlockedReason,
    };
  }
}
