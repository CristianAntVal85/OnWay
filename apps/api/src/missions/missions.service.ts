import { Inject, Injectable } from '@nestjs/common';
import type { CreateMissionRequest, OperationOutput, UpdateMissionRequest } from '@onway/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditWriter } from '../audit/audit.writer.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { missionPoints, missions } from '../db/schema.js';
import { ELEVATION_PROVIDER, type ElevationProvider, type GroundPoint } from '../geo/elevation.js';
import { translateMissionWriteError } from './errors.js';
import { listMissions, missionDetail, missionHistory } from './mission-reads.js';
import { assertCoordinator, groundAltitude, pointZ, viewerOf } from './mission-support.js';

type CreateBody = z.infer<typeof CreateMissionRequest>;
type UpdateBody = z.infer<typeof UpdateMissionRequest>;

@Injectable()
export class MissionsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(ELEVATION_PROVIDER) private readonly elevation: ElevationProvider,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  list(principal: Principal, query: Parameters<typeof listMissions>[2]): Promise<OperationOutput<'listMissions'>> {
    return listMissions(this.tx, viewerOf(principal).orgId, query);
  }

  get(principal: Principal, missionId: string): Promise<OperationOutput<'getMission'>> {
    return missionDetail(this.tx, viewerOf(principal), missionId);
  }

  /** RF-201, RN-07: a mission needs a name, a responsible coordinator and a target; everything else can wait. */
  async create(principal: Principal, body: CreateBody): Promise<OperationOutput<'createMission'>> {
    const viewer = viewerOf(principal);
    this.rejectLaterMilestoneFields(body);
    const coordinatorId = body.coordinatorId ?? viewer.userId;
    await this.assertCoordinator(viewer.orgId, coordinatorId);
    const targetElevation = await this.altitudeOf(body.target);
    const originElevations = await Promise.all(body.origins.map((origin) => this.altitudeOf(origin)));

    let missionId: string;
    try {
      const [created] = await this.tx
        .insert(missions)
        .values({
          organizationId: viewer.orgId,
          name: body.name,
          description: body.description || null,
          coordinatorId,
          target: pointZ(body.target.lat, body.target.lon, targetElevation),
          targetLabel: body.target.label ?? null,
          targetCountry: body.target.country ?? null,
          targetSource: body.target.source,
          createdBy: viewer.userId,
        })
        .returning({ id: missions.id });
      missionId = created!.id;
      if (body.origins.length > 0) {
        await this.tx.insert(missionPoints).values(
          body.origins.map((origin, index) => ({
            organizationId: viewer.orgId,
            missionId,
            kind: 'origin' as const,
            name: origin.name,
            note: origin.note || null,
            geom: pointZ(origin.lat, origin.lon, originElevations[index]!),
            position: index,
          })),
        );
      }
    } catch (error) {
      translateMissionWriteError(error);
    }

    await this.audit.recordMission({ orgId: viewer.orgId, missionId, action: 'mission_created', actorUserId: viewer.userId, detail: { name: body.name, origins: body.origins.length } });
    return missionDetail(this.tx, viewer, missionId);
  }

  /** RF-205 (data). Q-10: with `expectedUpdatedAt`, an edit over a newer version answers `STALE_RESOURCE`. */
  async update(principal: Principal, missionId: string, body: UpdateBody): Promise<OperationOutput<'updateMission'>> {
    const viewer = viewerOf(principal);
    const [current] = await this.tx
      .select({ status: missions.status, updatedAt: sql<string>`to_char(${missions.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` })
      .from(missions)
      .where(and(eq(missions.id, missionId), eq(missions.organizationId, viewer.orgId)))
      .for('update');
    if (!current) throw new DomainError('NOT_FOUND');
    if (current.status === 'closed') throw new DomainError('MISSION_CLOSED');
    if (body.expectedUpdatedAt !== undefined && new Date(body.expectedUpdatedAt).getTime() !== new Date(current.updatedAt).getTime()) {
      throw new DomainError('STALE_RESOURCE', 'The mission changed since it was read', { currentUpdatedAt: current.updatedAt });
    }
    if (body.coordinatorId !== undefined) await this.assertCoordinator(viewer.orgId, body.coordinatorId);

    const changes: Partial<typeof missions.$inferInsert> = {};
    const fields: string[] = [];
    if (body.name !== undefined) {
      changes.name = body.name;
      fields.push('name');
    }
    if (body.description !== undefined) {
      changes.description = body.description || null;
      fields.push('description');
    }
    if (body.coordinatorId !== undefined) {
      changes.coordinatorId = body.coordinatorId;
      fields.push('coordinatorId');
    }
    if (body.target !== undefined) {
      const elevationM = await this.altitudeOf(body.target);
      Object.assign(changes, {
        target: pointZ(body.target.lat, body.target.lon, elevationM),
        targetLabel: body.target.label ?? null,
        targetCountry: body.target.country ?? null,
        targetSource: body.target.source,
      });
      fields.push('target');
    }

    try {
      await this.tx
        .update(missions)
        .set(changes)
        .where(and(eq(missions.id, missionId), eq(missions.organizationId, viewer.orgId)));
    } catch (error) {
      translateMissionWriteError(error);
    }

    await this.audit.recordMission({ orgId: viewer.orgId, missionId, action: 'mission_updated', actorUserId: viewer.userId, detail: { fields } });
    return missionDetail(this.tx, viewer, missionId);
  }

  /** RN-05: the history of a mission of the caller's organization. A mission of another organization is a 404 (INV-01). */
  async history(principal: Principal, missionId: string, query: { page: number; pageSize: number }): Promise<OperationOutput<'listMissionHistory'>> {
    const viewer = viewerOf(principal);
    const [found] = await this.tx
      .select({ id: missions.id })
      .from(missions)
      .where(and(eq(missions.id, missionId), eq(missions.organizationId, viewer.orgId)))
      .limit(1);
    if (!found) throw new DomainError('NOT_FOUND');
    return missionHistory(this.tx, viewer.orgId, missionId, query);
  }

  /**
   * Equipos, rescatistas individuales y rutas del cuerpo de `createMission` llegan en H4 y H6 (RF-513, RF-802, RF-804).
   * Until then the contract admits the fields but the server refuses any value (P4 a); it never ignores them silently.
   */
  private rejectLaterMilestoneFields(body: CreateBody): void {
    const issues = (['teamIds', 'rescuerIds', 'routes'] as const)
      .filter((field) => body[field].length > 0)
      .map((field) => ({ path: field, code: 'not_supported', message: `${field} is not available yet: add them from the mission once the milestone that builds them is done` }));
    if (issues.length > 0) throw new DomainError('VALIDATION_FAILED', 'Request validation failed', { issues });
  }

  private assertCoordinator(orgId: string, userId: string): Promise<void> {
    return assertCoordinator(this.tx, orgId, userId);
  }

  private altitudeOf(point: GroundPoint): Promise<number> {
    return groundAltitude(this.elevation, point);
  }
}
