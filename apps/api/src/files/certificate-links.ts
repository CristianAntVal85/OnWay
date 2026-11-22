import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { AuditWriter } from '../audit/audit.writer.js';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService } from '../db/database.service.js';
import { files, rescuerProfiles, skills } from '../db/schema.js';
import { FILE_STORAGE, FileNotFoundError, type FileStorage } from './file-storage.js';

/** The link lives five minutes (INV-26): long enough to open it, short enough to be worthless once leaked. */
export const CERTIFICATE_LINK_TTL_MS = 5 * 60_000;
export const CERTIFICATE_LINK_PREFIX = '/api/v1/certificates/';

export interface CertificateGrant {
  fileId: string;
  userId: string;
  expiresAt: Date;
}

/**
 * Signs and checks the token of a certificate link (D-S2): `base64url(fileId|userId|expiresAtMs).base64url(HMAC-SHA256)`. There is no table:
 * the key is random per process, so a restart invalidates the live links, which last five minutes and are asked for again at every click.
 * Every failure is the same `null`: the caller answers one `404`, whatever was wrong.
 */
export class CertificateSigner {
  constructor(private readonly key: Buffer = randomBytes(32)) {}

  sign(grant: CertificateGrant): string {
    const payload = Buffer.from(`${grant.fileId}|${grant.userId}|${grant.expiresAt.getTime()}`, 'utf8').toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  verify(token: string, userId: string, now: Date): CertificateGrant | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts as [string, string];
    const expected = Buffer.from(this.mac(payload), 'utf8');
    const given = Buffer.from(signature, 'utf8');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const fields = Buffer.from(payload, 'base64url').toString('utf8').split('|');
    if (fields.length !== 3) return null;
    const [fileId, owner, exp] = fields as [string, string, string];
    const expiresAt = new Date(Number(exp));
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) return null;
    if (owner !== userId) return null; // the link is for whoever asked for it (D-S2)
    return { fileId, userId: owner, expiresAt };
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}

export interface CertificateFile {
  content: Buffer;
  contentType: string;
}

/**
 * Who opens which certificate (RN-24, INV-28) and the link that proves it (INV-26). The owner opens their own without a trace; the administrator, any of
 * the organization, and a coordinator, the one of whoever has a `pending` or `accepted` participation in the organization's missions, with a row
 * `certificate_opened` written in the same transaction. Anyone else gets `404`, as if the entry did not exist (D-S7).
 */
@Injectable()
export class CertificateLinks {
  private readonly signer = new CertificateSigner();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async link(principal: Principal, skillId: string): Promise<OperationOutput<'getCertificateLink'>> {
    const tx = this.database.current();
    if (!principal.orgId) throw new DomainError('NOT_FOUND');
    const [entry] = await tx
      .select({ id: skills.id, organizationId: skills.organizationId, fileId: skills.certificateFileId, ownerId: rescuerProfiles.userId })
      .from(skills)
      .innerJoin(rescuerProfiles, eq(rescuerProfiles.id, skills.profileId))
      .where(and(eq(skills.id, skillId), eq(skills.organizationId, principal.orgId)))
      .limit(1);
    if (!entry?.fileId) throw new DomainError('NOT_FOUND');
    const [file] = await tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, entry.fileId), eq(files.purpose, 'certificate'), isNull(files.deletedAt)))
      .limit(1);
    if (!file) throw new DomainError('NOT_FOUND');

    const own = entry.ownerId === principal.userId;
    if (!own) {
      if (principal.role === 'coordinator') {
        const related = await tx.execute(
          sql`SELECT 1 FROM participations WHERE organization_id = ${principal.orgId} AND user_id = ${entry.ownerId} AND status IN ('pending', 'accepted') LIMIT 1`,
        );
        if (related.rows.length === 0) throw new DomainError('NOT_FOUND');
      } else if (principal.role !== 'admin') {
        throw new DomainError('NOT_FOUND'); // another rescuer
      }
      // INV-26: the row is written with the signature, in the transaction of the request; the name of the course never goes in it.
      await this.audit.recordCertificateOpened({ orgId: principal.orgId, skillId: entry.id, fileId: entry.fileId, actorUserId: principal.userId, subjectUserId: entry.ownerId });
    }
    const expiresAt = new Date(this.clock.now().getTime() + CERTIFICATE_LINK_TTL_MS);
    const token = this.signer.sign({ fileId: entry.fileId, userId: principal.userId, expiresAt });
    return { url: `${CERTIFICATE_LINK_PREFIX}${token}`, expiresAt: expiresAt.toISOString() };
  }

  /** The bytes behind a valid link: one `404` for a bad signature, an expired or foreign link and a file that is gone. */
  async open(principal: Principal, token: string): Promise<CertificateFile> {
    const grant = this.signer.verify(token, principal.userId, this.clock.now());
    if (!grant) throw new DomainError('NOT_FOUND');
    const [file] = await this.database
      .current()
      .select({ contentType: files.contentType, storageKey: files.storageKey })
      .from(files)
      .where(and(eq(files.id, grant.fileId), eq(files.purpose, 'certificate'), isNull(files.deletedAt)))
      .limit(1);
    if (!file) throw new DomainError('NOT_FOUND');
    try {
      return { content: await this.storage.get(file.storageKey), contentType: file.contentType };
    } catch (error) {
      if (error instanceof FileNotFoundError) throw new DomainError('NOT_FOUND');
      throw error;
    }
  }
}
