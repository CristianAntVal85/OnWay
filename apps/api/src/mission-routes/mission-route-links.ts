import { sql } from 'drizzle-orm';
import { DomainError } from '../common/domain-error.js';
import type { AuditWriter } from '../audit/audit.writer.js';
import type { Tx } from '../db/database.service.js';
import { lockMission } from '../missions/mission-support.js';

// Pieces shared by the writes that put a route in a mission: `addMissionRoutes`, and `addToMission` of createRoute and deriveRoute (RF-513).

export interface LinkTarget {
  missionId: string;
  originPointId?: string | undefined;
  teamId?: string | undefined;
}

/** The origin must be an origin point of THAT mission, and the team one of this organization: otherwise it is not there (INV-01). */
export async function assertOriginAndTeam(tx: Tx, orgId: string, missionId: string, originPointId?: string | null, teamId?: string | null): Promise<void> {
  if (originPointId) {
    const { rows } = await tx.execute(sql`SELECT 1 FROM mission_points WHERE id = ${originPointId}::uuid AND mission_id = ${missionId}::uuid AND organization_id = ${orgId}::uuid AND kind = 'origin'`);
    if (rows.length === 0) throw new DomainError('NOT_FOUND');
  }
  if (teamId) {
    const { rows } = await tx.execute(sql`SELECT 1 FROM teams WHERE id = ${teamId}::uuid AND organization_id = ${orgId}::uuid`);
    if (rows.length === 0) throw new DomainError('NOT_FOUND');
  }
}

/**
 * Before a route is made for a mission: the mission is the caller's and is open (INV-11, `MISSION_CLOSED`), and the origin and the team are
 * valid. Asked first so that a refusal leaves no route behind. Takes the lock of the mission row, as every writer of a mission does.
 */
export async function assertCanLink(tx: Tx, orgId: string, target: LinkTarget): Promise<void> {
  const mission = await lockMission(tx, orgId, target.missionId);
  if (mission.status === 'closed') throw new DomainError('MISSION_CLOSED');
  await assertOriginAndTeam(tx, orgId, target.missionId, target.originPointId, target.teamId);
}

export interface PinInput extends LinkTarget {
  orgId: string;
  userId: string;
  routeId: string;
  routeName: string;
  versionId: string;
  versionNumber: number;
  note?: string | null | undefined;
  /** How the route came to be, for the line of the history. */
  source: string;
}

/**
 * Puts a route in a mission with the version pinned (D-19) and writes its line of the history in the same transaction (INV-16). Answers the new
 * row's id. `added_at` is the instant of the insert, not of the transaction, so the routes of one batch keep the order they were asked in.
 */
export async function pinRoute(tx: Tx, audit: AuditWriter, input: PinInput): Promise<string> {
  const { rows } = await tx.execute(sql`
    INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, origin_point_id, team_id, note, added_by, added_at)
    VALUES (${input.orgId}::uuid, ${input.missionId}::uuid, ${input.routeId}::uuid, ${input.versionId}::uuid, ${input.originPointId ?? null}::uuid, ${input.teamId ?? null}::uuid, ${input.note ?? null}, ${input.userId}::uuid, clock_timestamp())
    RETURNING id`);
  await audit.recordMission({
    orgId: input.orgId,
    missionId: input.missionId,
    action: 'route_added',
    actorUserId: input.userId,
    detail: { name: input.routeName, routeId: input.routeId, versionNumber: input.versionNumber, source: input.source },
  });
  return (rows[0] as { id: string }).id;
}
