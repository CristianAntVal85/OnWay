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

/**
 * Writes `audit_log` (INV-16, RN-05) inside the transaction of the request: if the operation fails the row is
 * rolled back with it, and a change cannot commit without its row. By convention every action of a mission is
 * recorded with `entity_type = 'mission'` and the mission as `entity_id` (doc 06 §10).
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
}
