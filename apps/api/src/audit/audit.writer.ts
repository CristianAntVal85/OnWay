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
export type RouteAuditAction = 'route_created' | 'route_version_created' | 'route_derived' | 'route_version_validated' | 'route_archived' | 'route_deleted' | 'route_renamed';

export interface RouteAuditEntry {
  orgId: string;
  routeId: string;
  action: RouteAuditAction;
  actorUserId: string;
  /** Never personal data: the route's name, version numbers, the source of a copy. */
  detail?: Record<string, unknown>;
}

/** A calculation was asked for (H3). */
export interface JobAuditEntry {
  orgId: string;
  jobId: string;
  actorUserId: string;
  /** Counts and ids, never the points themselves: where a team goes is not for the log. */
  detail?: Record<string, unknown>;
}

/** What happened to a zone to avoid (H3, doc 06 §10). */
export type AvoidZoneAuditAction = 'avoid_zone_created' | 'avoid_zone_deleted';

export interface AvoidZoneAuditEntry {
  orgId: string;
  zoneId: string;
  action: AvoidZoneAuditAction;
  actorUserId: string;
  /** Never personal data, and not the free text of the reason: the mission it belonged to and the size of the polygon. */
  detail?: Record<string, unknown>;
}

/** The invitation code of the organization was replaced (RF-106, D-A5). */
export interface InviteCodeAuditEntry {
  orgId: string;
  actorUserId: string;
}

/** Which blocks of the profile changed (D-P4): the names only, never a value, because the log is append-only. */
export type ProfileBlock = 'fullName' | 'phone' | 'document' | 'address';

export interface ProfileAuditEntry {
  orgId: string;
  profileId: string;
  userId: string;
  action: 'profile_completed' | 'profile_updated';
  blocks: ProfileBlock[];
}

/** Somebody other than the owner asked for a certificate (INV-26, RN-24). Only ids: neither the name of the course nor the file's contents. */
export interface CertificateOpenedEntry {
  orgId: string;
  skillId: string;
  fileId: string;
  actorUserId: string;
  /** The owner of the certificate. */
  subjectUserId: string;
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

  async recordAvoidZone(entry: AvoidZoneAuditEntry): Promise<void> {
    await this.database
      .current()
      .insert(auditLog)
      .values({
        organizationId: entry.orgId,
        entityType: 'avoid_zone',
        entityId: entry.zoneId,
        action: entry.action,
        actorUserId: entry.actorUserId,
        detail: entry.detail ?? {},
      });
  }

  async recordJobRequested(entry: JobAuditEntry): Promise<void> {
    await this.database
      .current()
      .insert(auditLog)
      .values({
        organizationId: entry.orgId,
        entityType: 'calculation_job',
        entityId: entry.jobId,
        action: 'generate_requested',
        actorUserId: entry.actorUserId,
        detail: entry.detail ?? {},
      });
  }

  /** The person acts on their own profile: actor and subject are the same user. */
  async recordProfile(entry: ProfileAuditEntry): Promise<void> {
    await this.database
      .current()
      .insert(auditLog)
      .values({
        organizationId: entry.orgId,
        entityType: 'rescuer_profile',
        entityId: entry.profileId,
        action: entry.action,
        actorUserId: entry.userId,
        subjectUserId: entry.userId,
        detail: { blocks: entry.blocks },
      });
  }

  /** Neither password, old nor new, nor its hash: only that it changed and how many other sessions were closed. */
  async recordPasswordChanged(entry: { orgId: string; userId: string; closedSessions: number }): Promise<void> {
    await this.database
      .current()
      .insert(auditLog)
      .values({
        organizationId: entry.orgId,
        entityType: 'user',
        entityId: entry.userId,
        action: 'password_changed',
        actorUserId: entry.userId,
        subjectUserId: entry.userId,
        detail: { closedSessions: entry.closedSessions },
      });
  }

  /** The row never carries the code, old or new: it records that it was rotated, by whom and when. */
  async recordInviteCodeRotated(entry: InviteCodeAuditEntry): Promise<void> {
    await this.database
      .current()
      .insert(auditLog)
      .values({ organizationId: entry.orgId, entityType: 'organization', entityId: entry.orgId, action: 'invite_code_rotated', actorUserId: entry.actorUserId, detail: {} });
  }

  async recordCertificateOpened(entry: CertificateOpenedEntry): Promise<void> {
    await this.database
      .current()
      .insert(auditLog)
      .values({
        organizationId: entry.orgId,
        entityType: 'skill',
        entityId: entry.skillId,
        action: 'certificate_opened',
        actorUserId: entry.actorUserId,
        subjectUserId: entry.subjectUserId,
        detail: { fileId: entry.fileId },
      });
  }
}
