import { and, eq, sql } from 'drizzle-orm';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import type { Tx } from '../db/database.service.js';
import { memberships, missions } from '../db/schema.js';
import type { ElevationProvider, GroundPoint } from '../geo/elevation.js';
import { invalidCoordinator } from './errors.js';
import type { Viewer } from './mission-reads.js';

// Pieces shared by the staff services of missions (create/edit, lifecycle, points).

/** The principal of a request that reached a staff operation: the guard already refused pending accounts. */
export function viewerOf(principal: Principal): Viewer & { userId: string } {
  if (!principal.orgId || principal.role === 'pending') throw new DomainError('ACCOUNT_PENDING');
  return { orgId: principal.orgId, userId: principal.userId, role: principal.role };
}

/** `ST_MakePoint` with the altitude the server calculated (RN-07, INV-02: always `PointZ`). */
export const pointZ = (lat: number, lon: number, elevationM: number) => sql`ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8, ${elevationM}::float8), 4326)`;

/** ISO 8601 with milliseconds and `Z`, as the read model writes it. */
export const isoUtc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export interface LockedMission {
  status: 'planning' | 'active' | 'closed';
  coordinatorId: string;
  updatedAt: string;
}

/**
 * Takes the row lock of a mission of the caller's organization (writers of one mission go one at a time) or answers
 * `NOT_FOUND`: another organization's mission is not there for this caller (D-H1-01, INV-01).
 */
export async function lockMission(tx: Tx, orgId: string, missionId: string): Promise<LockedMission> {
  const [row] = await tx
    .select({ status: missions.status, coordinatorId: missions.coordinatorId, updatedAt: sql<string>`${sql.raw(isoUtc('missions.updated_at'))}` })
    .from(missions)
    .where(and(eq(missions.id, missionId), eq(missions.organizationId, orgId)))
    .for('update');
  if (!row) throw new DomainError('NOT_FOUND');
  return row;
}

/** INV-03: is this user an active coordinator of the organization? Row level security hides the others, so they look the same. */
export async function isActiveCoordinator(tx: Tx, orgId: string, userId: string): Promise<boolean> {
  const [member] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.userId, userId), eq(memberships.role, 'coordinator'), eq(memberships.status, 'active')))
    .limit(1);
  return member !== undefined;
}

export async function assertCoordinator(tx: Tx, orgId: string, userId: string): Promise<void> {
  if (!(await isActiveCoordinator(tx, orgId, userId))) throw invalidCoordinator();
}

/** RN-07, AC-10: the altitude comes from the server's source, never from the client. No source → 422 `OUTSIDE_COVERAGE`. */
export async function groundAltitude(elevation: ElevationProvider, point: GroundPoint): Promise<number> {
  const elevationM = await elevation.elevationAt({ lat: point.lat, lon: point.lon });
  if (elevationM === null) throw new DomainError('OUTSIDE_COVERAGE');
  return elevationM;
}
