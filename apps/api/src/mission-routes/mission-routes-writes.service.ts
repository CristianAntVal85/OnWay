import { Inject, Injectable } from '@nestjs/common';
import type { AddMissionRoutesRequest, OperationOutput, UpdateMissionRouteRequest } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditWriter } from '../audit/audit.writer.js';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { lockMission, viewerOf } from '../missions/mission-support.js';
import { assertOriginAndTeam, pinRoute } from './mission-route-links.js';
import { readTable } from './mission-routes-reads.service.js';

type AddBody = z.infer<typeof AddMissionRoutesRequest>;
type UpdateBody = z.infer<typeof UpdateMissionRouteRequest>;

/** PostgreSQL's `unique_violation`: the other writer of the same mission got there first (INV-13). */
const isUniqueViolation = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

/**
 * The writes of the routes of a mission (RF-513, RF-508, RF-518, RF-805; D-H4-01 to D-H4-06). Every write takes the lock of the mission,
 * so the writers of one mission go one at a time, refuses a closed mission (INV-11) and writes its line of the history in the same
 * transaction (INV-16). The version pinned never changes by itself (RN-13): only `pinnedVersionId` moves it. What is not the caller's
 * organization's — mission, route, version, origin point or team — is a 404 (INV-01); the database repeats all of it (INV-06, INV-13).
 */
@Injectable()
export class MissionRoutesWrites {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  /** All or nothing (D-H4-05): the first route that cannot be added stops the batch, and the request's transaction takes back what was written. */
  async add(principal: Principal, missionId: string, body: AddBody): Promise<OperationOutput<'addMissionRoutes'>> {
    const { orgId, userId } = viewerOf(principal);
    await this.openMission(orgId, missionId);
    const routeIds = body.items.map((item) => item.routeId);
    if (new Set(routeIds).size !== routeIds.length) throw new DomainError('ROUTE_ALREADY_IN_MISSION', 'The same route appears twice in the request');

    const rowIds: string[] = [];
    for (const item of body.items) {
      const route = await this.routeOf(orgId, item.routeId);
      if (route.status === 'archived') throw new DomainError('INVALID_STATE_TRANSITION', 'An archived route is read-only: derive it to use it');
      const { rows: present } = await this.tx.execute(sql`SELECT 1 FROM mission_routes WHERE mission_id = ${missionId}::uuid AND route_id = ${item.routeId}::uuid`);
      if (present.length > 0) throw new DomainError('ROUTE_ALREADY_IN_MISSION', 'The route is already in the mission', { routeId: item.routeId });

      const version = item.versionId ? await this.versionOf(orgId, item.routeId, item.versionId) : await this.defaultVersion(route);
      await assertOriginAndTeam(this.tx, orgId, missionId, item.originPointId, item.teamId);
      try {
        rowIds.push(
          await pinRoute(this.tx, this.audit, {
            orgId,
            userId,
            missionId,
            routeId: item.routeId,
            routeName: route.name,
            versionId: version.id,
            versionNumber: version.number,
            originPointId: item.originPointId,
            teamId: item.teamId,
            note: item.note,
            source: 'library',
          }),
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new DomainError('ROUTE_ALREADY_IN_MISSION', 'The route is already in the mission', { routeId: item.routeId });
        throw error;
      }
    }
    return { items: await readTable(this.tx, orgId, missionId, this.clock.now().toISOString(), rowIds) };
  }

  async update(principal: Principal, missionId: string, missionRouteId: string, body: UpdateBody): Promise<OperationOutput<'updateMissionRoute'>> {
    const { orgId, userId } = viewerOf(principal);
    await this.openMission(orgId, missionId);
    const [row] = (
      await this.tx.execute(sql`
        SELECT mr.route_id, mr.pinned_version_id, mr.status::text AS status, r.name, r.status::text AS route_status, pv.version_number
          FROM mission_routes mr JOIN routes r ON r.id = mr.route_id JOIN route_versions pv ON pv.id = mr.pinned_version_id
         WHERE mr.id = ${missionRouteId}::uuid AND mr.mission_id = ${missionId}::uuid AND mr.organization_id = ${orgId}::uuid
           FOR UPDATE OF mr`)
    ).rows as { route_id: string; pinned_version_id: string; status: 'added' | 'unavailable'; name: string; route_status: 'active' | 'archived'; version_number: number }[];
    if (!row) throw new DomainError('NOT_FOUND');
    if (row.route_status === 'archived') throw new DomainError('INVALID_STATE_TRANSITION', 'An archived route is read-only');

    const changed: string[] = [];
    const set: ReturnType<typeof sql>[] = [];
    let moved: { from: number; to: number } | null = null;
    if (body.pinnedVersionId !== undefined && body.pinnedVersionId !== row.pinned_version_id) {
      const version = await this.versionOf(orgId, row.route_id, body.pinnedVersionId);
      set.push(sql`pinned_version_id = ${version.id}::uuid`);
      moved = { from: row.version_number, to: version.number };
    }
    if (body.originPointId !== undefined) {
      await assertOriginAndTeam(this.tx, orgId, missionId, body.originPointId, undefined);
      set.push(sql`origin_point_id = ${body.originPointId}::uuid`);
      changed.push('origin');
    }
    if (body.teamId !== undefined) {
      await assertOriginAndTeam(this.tx, orgId, missionId, undefined, body.teamId);
      set.push(sql`team_id = ${body.teamId}::uuid`);
      changed.push('team');
    }
    if (body.note !== undefined) {
      set.push(sql`note = ${body.note}`);
      changed.push('note');
    }
    const statusChanged = body.status !== undefined && body.status !== row.status;
    if (statusChanged) set.push(sql`status = ${body.status}::mission_route_status`);

    if (set.length > 0) await this.tx.execute(sql`UPDATE mission_routes SET ${sql.join(set, sql`, `)} WHERE id = ${missionRouteId}::uuid`);
    const line = (action: 'route_version_changed' | 'route_updated' | 'route_marked_unavailable' | 'route_reactivated', detail: Record<string, unknown>) =>
      this.audit.recordMission({ orgId, missionId, action, actorUserId: userId, detail: { name: row.name, routeId: row.route_id, ...detail } });
    if (moved) await line('route_version_changed', { fromVersionNumber: moved.from, toVersionNumber: moved.to });
    if (statusChanged) await line(body.status === 'unavailable' ? 'route_marked_unavailable' : 'route_reactivated', {});
    // The note itself is free text: the line says that it changed, never what it says.
    if (changed.length > 0) await line('route_updated', { fields: changed });

    const [updated] = await readTable(this.tx, orgId, missionId, this.clock.now().toISOString(), [missionRouteId]);
    return updated!;
  }

  /** The route stays in the library (RN-14); if it is in no open mission any more it can be archived (INV-07). */
  async remove(principal: Principal, missionId: string, missionRouteId: string): Promise<void> {
    const { orgId, userId } = viewerOf(principal);
    await this.openMission(orgId, missionId);
    const { rows } = await this.tx.execute(sql`
      DELETE FROM mission_routes mr USING routes r
       WHERE mr.id = ${missionRouteId}::uuid AND mr.mission_id = ${missionId}::uuid AND mr.organization_id = ${orgId}::uuid AND r.id = mr.route_id
       RETURNING mr.route_id, r.name, (SELECT version_number FROM route_versions WHERE id = mr.pinned_version_id) AS version_number`);
    const removed = rows[0] as { route_id: string; name: string; version_number: number } | undefined;
    if (!removed) throw new DomainError('NOT_FOUND');
    await this.audit.recordMission({
      orgId,
      missionId,
      action: 'route_removed',
      actorUserId: userId,
      detail: { name: removed.name, routeId: removed.route_id, versionNumber: removed.version_number },
    });
  }

  /** The mission is the caller's (404 otherwise) and open (`MISSION_CLOSED`); its row stays locked until the end of the request. */
  private async openMission(orgId: string, missionId: string): Promise<void> {
    const mission = await lockMission(this.tx, orgId, missionId);
    if (mission.status === 'closed') throw new DomainError('MISSION_CLOSED');
  }

  private async routeOf(orgId: string, routeId: string): Promise<{ name: string; status: 'active' | 'archived'; latest: string; latestValidated: string | null }> {
    const { rows } = await this.tx.execute(sql`
      SELECT name, status::text AS status, latest_version_id, latest_validated_version_id FROM routes WHERE id = ${routeId}::uuid AND organization_id = ${orgId}::uuid`);
    const row = rows[0] as { name: string; status: 'active' | 'archived'; latest_version_id: string; latest_validated_version_id: string | null } | undefined;
    if (!row) throw new DomainError('NOT_FOUND');
    return { name: row.name, status: row.status, latest: row.latest_version_id, latestValidated: row.latest_validated_version_id };
  }

  /** A version of THAT route and organization, or it is not there (INV-06, INV-01). */
  private async versionOf(orgId: string, routeId: string, versionId: string): Promise<{ id: string; number: number }> {
    const { rows } = await this.tx.execute(sql`
      SELECT id, version_number FROM route_versions WHERE id = ${versionId}::uuid AND route_id = ${routeId}::uuid AND organization_id = ${orgId}::uuid`);
    const row = rows[0] as { id: string; version_number: number } | undefined;
    if (!row) throw new DomainError('NOT_FOUND');
    return { id: row.id, number: row.version_number };
  }

  /** D-H4-01: the last validated version; a route with none validated is added with its last version, as RF-513 allows. */
  private async defaultVersion(route: { latest: string; latestValidated: string | null }): Promise<{ id: string; number: number }> {
    const id = route.latestValidated ?? route.latest;
    const { rows } = await this.tx.execute(sql`SELECT version_number FROM route_versions WHERE id = ${id}::uuid`);
    return { id, number: (rows[0] as { version_number: number }).version_number };
  }
}
