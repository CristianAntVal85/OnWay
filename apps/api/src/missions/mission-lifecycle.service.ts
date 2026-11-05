import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ActivateMissionRequest, CloseMissionRequest, DuplicateMissionRequest, OperationOutput } from '@onway/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditWriter } from '../audit/audit.writer.js';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { missions } from '../db/schema.js';
import { translateMissionWriteError } from './errors.js';
import { missionDetail } from './mission-reads.js';
import { isActiveCoordinator, lockMission, viewerOf } from './mission-support.js';

type ActivateBody = z.infer<typeof ActivateMissionRequest>;
type CloseBody = z.infer<typeof CloseMissionRequest>;
type DuplicateBody = z.infer<typeof DuplicateMissionRequest>;

/**
 * Life cycle of a mission (RF-202, RF-203, RF-207, RF-208): activate, close, reopen and duplicate. Each one takes the
 * lock of the mission row, checks the state in the service (clear answers) and leaves the database triggers
 * (`missions_guard`) as the second defence; each writes its audit row in the same transaction (INV-16).
 */
@Injectable()
export class MissionLifecycleService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  /** RF-207, D-H1-04: planning → active. Without a validated route the server warns first and the caller repeats with the confirmation. */
  async activate(principal: Principal, missionId: string, body: ActivateBody): Promise<OperationOutput<'activateMission'>> {
    const viewer = viewerOf(principal);
    const mission = await lockMission(this.tx, viewer.orgId, missionId);
    if (mission.status !== 'planning') throw new DomainError('INVALID_STATE_TRANSITION', `A mission that is ${mission.status} cannot be activated`);

    const validatedRoutes = await this.validatedRoutes(missionId);
    if (validatedRoutes === 0 && !body.confirmWithoutValidatedRoute) {
      throw new DomainError('CONFIRMATION_REQUIRED', 'The mission has no validated route: confirm to activate it anyway', { warning: 'no_validated_route' });
    }

    try {
      await this.tx
        .update(missions)
        .set({ status: 'active', activatedAt: this.clock.now() })
        .where(and(eq(missions.id, missionId), eq(missions.organizationId, viewer.orgId)));
    } catch (error) {
      translateMissionWriteError(error);
    }
    await this.audit.recordMission({ orgId: viewer.orgId, missionId, action: 'mission_activated', actorUserId: viewer.userId, detail: { withoutValidatedRoute: validatedRoutes === 0 } });
    return missionDetail(this.tx, viewer, missionId);
  }

  /**
   * RF-208, D-27, doc 05 §8.2: one transaction (the request's): the attendance of every accepted participant is confirmed
   * first (a closed mission accepts no writes, INV-11) and then the mission closes. The list must name every accepted
   * participation: a missing one is `ATTENDANCE_INCOMPLETE`; one that is not an accepted participation of this mission is invalid input.
   */
  async close(principal: Principal, missionId: string, body: CloseBody): Promise<OperationOutput<'closeMission'>> {
    const viewer = viewerOf(principal);
    const mission = await lockMission(this.tx, viewer.orgId, missionId);
    if (mission.status !== 'active') throw new DomainError('INVALID_STATE_TRANSITION', `A mission that is ${mission.status} cannot be closed`);

    const accepted = (await this.tx.execute(sql`SELECT id FROM participations WHERE mission_id = ${missionId} AND organization_id = ${viewer.orgId} AND status = 'accepted' ORDER BY id`)).rows.map(
      (row) => (row as { id: string }).id,
    );
    const known = new Set(accepted);
    const unknown = body.attendance.flatMap((entry, index) => (known.has(entry.participationId) ? [] : [index]));
    if (unknown.length > 0) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: unknown.map((index) => ({ path: `attendance.${index}.participationId`, code: 'invalid_value', message: 'It is not an accepted participation of this mission' })),
      });
    }
    const sent = new Set(body.attendance.map((entry) => entry.participationId));
    const missing = accepted.filter((id) => !sent.has(id));
    if (missing.length > 0) throw new DomainError('ATTENDANCE_INCOMPLETE', 'The attendance list must include every accepted participant', { missingParticipationIds: missing });

    const now = this.clock.now();
    const attended = body.attendance.filter((entry) => entry.participated).map((entry) => entry.participationId);
    await this.confirmAttendance(viewer.orgId, missionId, viewer.userId, now, attended, true);
    await this.confirmAttendance(
      viewer.orgId,
      missionId,
      viewer.userId,
      now,
      body.attendance.filter((entry) => !entry.participated).map((entry) => entry.participationId),
      false,
    );

    try {
      await this.tx
        .update(missions)
        .set({ status: 'closed', closedAt: now })
        .where(and(eq(missions.id, missionId), eq(missions.organizationId, viewer.orgId)));
    } catch (error) {
      translateMissionWriteError(error);
    }
    await this.audit.recordMission({ orgId: viewer.orgId, missionId, action: 'mission_closed', actorUserId: viewer.userId, detail: { attended: attended.length, accepted: accepted.length } });
    return missionDetail(this.tx, viewer, missionId);
  }

  /** RF-202: closed → active. It can clash with an open mission of the same name (`DUPLICATE_NAME`): the name was free while it was closed. */
  async reopen(principal: Principal, missionId: string): Promise<OperationOutput<'reopenMission'>> {
    const viewer = viewerOf(principal);
    const mission = await lockMission(this.tx, viewer.orgId, missionId);
    if (mission.status !== 'closed') throw new DomainError('INVALID_STATE_TRANSITION', `A mission that is ${mission.status} cannot be reopened`);

    try {
      await this.tx
        .update(missions)
        .set({ status: 'active', closedAt: null })
        .where(and(eq(missions.id, missionId), eq(missions.organizationId, viewer.orgId)));
    } catch (error) {
      translateMissionWriteError(error);
    }
    await this.audit.recordMission({ orgId: viewer.orgId, missionId, action: 'mission_reopened', actorUserId: viewer.userId });
    return missionDetail(this.tx, viewer, missionId);
  }

  /**
   * RF-203, D-H1-05: a new mission in planning with the description, target (already with its altitude), responsible and
   * points of the original, under the new name. Routes come along with their pinned version when asked; participants
   * and teams never do. The history of the copy starts with `mission_created` and says where it came from.
   */
  async duplicate(principal: Principal, missionId: string, body: DuplicateBody): Promise<OperationOutput<'duplicateMission'>> {
    const viewer = viewerOf(principal);
    const source = await lockMission(this.tx, viewer.orgId, missionId);
    // The original's responsible may have left the role since; a mission always has a responsible (RN-11), so the one who copies takes it.
    const coordinatorId = (await isActiveCoordinator(this.tx, viewer.orgId, source.coordinatorId)) ? source.coordinatorId : viewer.userId;

    let copyId: string;
    try {
      const { rows } = await this.tx.execute(sql`
        INSERT INTO missions (organization_id, name, description, coordinator_id, target, target_label, target_country, target_source, created_by)
        SELECT organization_id, ${body.name}, description, ${coordinatorId}::uuid, target, target_label, target_country, target_source, ${viewer.userId}::uuid
          FROM missions WHERE id = ${missionId} AND organization_id = ${viewer.orgId}
        RETURNING id`);
      copyId = (rows[0] as { id: string }).id;
      const pointIds = await this.copyPoints(viewer.orgId, missionId, copyId);
      if (body.includeRoutes) await this.copyRoutes(viewer.orgId, viewer.userId, missionId, copyId, pointIds);
    } catch (error) {
      translateMissionWriteError(error);
    }

    await this.audit.recordMission({
      orgId: viewer.orgId,
      missionId: copyId,
      action: 'mission_created',
      actorUserId: viewer.userId,
      detail: { name: body.name, duplicatedFrom: missionId, includeRoutes: body.includeRoutes },
    });
    return missionDetail(this.tx, viewer, copyId);
  }

  private async validatedRoutes(missionId: string): Promise<number> {
    const { rows } = await this.tx.execute(sql`
      SELECT count(*)::int AS n FROM mission_routes mr JOIN route_versions v ON v.id = mr.pinned_version_id
       WHERE mr.mission_id = ${missionId} AND v.status = 'validated' AND mr.status = 'added'`); // P5: a route marked unavailable is not a usable one
    return (rows[0] as { n: number }).n;
  }

  private async confirmAttendance(orgId: string, missionId: string, actorId: string, at: Date, participationIds: string[], participated: boolean): Promise<void> {
    if (participationIds.length === 0) return;
    const ids = sql.join(
      participationIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    await this.tx.execute(sql`
      UPDATE participations SET participated = ${participated}, attendance_confirmed_by = ${actorId}::uuid, attendance_confirmed_at = ${at.toISOString()}::timestamptz
       WHERE mission_id = ${missionId} AND organization_id = ${orgId} AND status = 'accepted' AND id IN (${ids})`);
  }

  /** Copies every point under a new id; returns the old id → new id map (routes point at their origin). */
  private async copyPoints(orgId: string, fromMissionId: string, toMissionId: string): Promise<Map<string, string>> {
    const { rows } = await this.tx.execute(sql`SELECT id FROM mission_points WHERE mission_id = ${fromMissionId} AND organization_id = ${orgId} ORDER BY kind, position, created_at, id`);
    const ids = new Map<string, string>();
    for (const row of rows as { id: string }[]) {
      const copyId = randomUUID();
      ids.set(row.id, copyId);
      await this.tx.execute(sql`
        INSERT INTO mission_points (id, organization_id, mission_id, kind, name, note, geom, position)
        SELECT ${copyId}::uuid, organization_id, ${toMissionId}::uuid, kind, name, note, geom, position FROM mission_points WHERE id = ${row.id}`);
    }
    return ids;
  }

  /** The same route in the same pinned version (RN-13); the copy starts as `added`, without the team (teams are not copied). */
  private async copyRoutes(orgId: string, actorId: string, fromMissionId: string, toMissionId: string, pointIds: Map<string, string>): Promise<void> {
    const { rows } = await this.tx.execute(sql`SELECT id, origin_point_id FROM mission_routes WHERE mission_id = ${fromMissionId} AND organization_id = ${orgId} ORDER BY added_at, id`);
    for (const row of rows as { id: string; origin_point_id: string | null }[]) {
      const origin = row.origin_point_id === null ? null : (pointIds.get(row.origin_point_id) ?? null);
      await this.tx.execute(sql`
        INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, origin_point_id, note, added_by)
        SELECT organization_id, ${toMissionId}::uuid, route_id, pinned_version_id, ${origin}::uuid, note, ${actorId}::uuid FROM mission_routes WHERE id = ${row.id}`);
    }
  }
}
