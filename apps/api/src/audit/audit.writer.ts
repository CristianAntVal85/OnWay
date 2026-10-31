import { Inject, Injectable } from '@nestjs/common';
import type { MissionHistoryAction } from '@onway/contracts';
import type { z } from 'zod';
import { DatabaseService } from '../db/database.service.js';
import { auditLog } from '../db/schema.js';

export interface MissionAuditEntry {
  orgId: string;
  missionId: string;
  action: z.infer<typeof MissionHistoryAction>;
  actorUserId: string;
  /** Never personal data: names of changed fields, the name of a point or route, counts. */
  detail?: Record<string, unknown>;
}

/** What happened to a route (doc 06 §10, D-H2-07). */
export type RouteAuditAction = 'route_created' | 'route_version_created' | 'route_derived' | 'route_version_validated' | 'route_archived';

export interface RouteAuditEntry {
  orgId: string;
  routeId: string;
  action: RouteAuditAction;
  actorUserId: string;
  /** Never personal data: the route's name, version numbers, the source of a copy. */
  detail?: Record<string, unknown>;
}

/**
 * Writes `audit_log` (INV-16, RN-05) inside the transaction of the request: if the operation fails the row is
 * rolled back with it, and a change cannot commit without its row. By convention every action of a mission is
 * recorded with `entity_type = 'mission'` and the mission as `entity_id`, and every action of a route with `entity_type = 'route'` (doc 06 §10).
 */
@Injectable()
export class AuditWriter {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async recordMission(entry: MissionAuditEntry): Promise<void> {
    await this.database
      .current()
      .insert(auditLog)
      .values({
        organizationId: entry.orgId,
        entityType: 'mission',
        entityId: entry.missionId,
        action: entry.action,
        actorUserId: entry.actorUserId,
        detail: entry.detail ?? {},
      });
  }

  async recordRoute(entry: RouteAuditEntry): Promise<void> {
    await this.database
      .current()
      .insert(auditLog)
      .values({
        organizationId: entry.orgId,
        entityType: 'route',
        entityId: entry.routeId,
        action: entry.action,
        actorUserId: entry.actorUserId,
        detail: entry.detail ?? {},
      });
  }
}
