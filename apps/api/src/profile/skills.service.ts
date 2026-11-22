import { Inject, Injectable } from '@nestjs/common';
import { SkillFields, SkillInput, type OperationOutput } from '@onway/contracts';
import { and, count, eq, isNull, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { files, skills } from '../db/schema.js';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage.js';
import { listSkillsOf, toSkillView, type SkillRow } from './skill-rows.js';
import { ProfileService } from './profile.service.js';

type Skill = OperationOutput<'createMySkill'>;
type Fields = z.infer<typeof SkillFields>;
export type SkillCreate = z.infer<typeof SkillInput>;
export type SkillChanges = Partial<Omit<Fields, 'certificateFileId'>> & { certificateFileId?: string | null };

/** D-S4: a profile cannot fill the disk with certificates. */
export const MAX_SKILLS = 50;

const invalid = (path: string, code: string, message: string) => new DomainError('VALIDATION_FAILED', 'Request validation failed', { issues: [{ path, code, message }] });

/**
 * The rescuer's courses and skills (RF-808, RF-806). The profile is found as in `ProfileService.ownProfile`, and a row of someone else is
 * `404` (it is invisible to row level security anyway, `skills_write`). The certificate is optional and belongs to a course (D-29); a
 * retired one is marked `deleted_at` and its bytes go after the commit (D-S5), never before it.
 */
@Injectable()
export class SkillsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(principal: Principal): Promise<{ items: Skill[] }> {
    const tx = this.database.current();
    const profile = await this.profiles.ownProfile(tx, principal);
    return { items: await listSkillsOf(tx, profile.id) };
  }

  async create(principal: Principal, input: SkillCreate): Promise<Skill> {
    const tx = this.database.current();
    const profile = await this.profiles.ownProfile(tx, principal);
    const [{ n }] = (await tx.select({ n: count() }).from(skills).where(eq(skills.profileId, profile.id))) as [{ n: number }];
    if (n >= MAX_SKILLS) throw invalid('name', 'too_many', `a profile holds at most ${MAX_SKILLS} courses and skills`);
    if (input.certificateFileId) await this.assertAttachable(tx, principal, input.certificateFileId, null);
    const [row] = await tx
      .insert(skills)
      .values({
        organizationId: profile.organizationId,
        profileId: profile.id,
        name: input.name,
        kind: input.kind,
        issuer: input.issuer ?? null,
        issuedOn: input.issuedOn ?? null,
        expiresOn: input.expiresOn ?? null,
        certificateFileId: input.certificateFileId ?? null,
      })
      .returning();
    return toSkillView(row!);
  }

  async update(principal: Principal, skillId: string, changes: SkillChanges): Promise<Skill> {
    const tx = this.database.current();
    const current = await this.ownSkill(tx, principal, skillId);
    const merged = {
      name: changes.name ?? current.name,
      kind: changes.kind ?? current.kind,
      issuer: changes.issuer !== undefined ? changes.issuer : (current.issuer ?? undefined),
      issuedOn: changes.issuedOn !== undefined ? changes.issuedOn : (current.issuedOn ?? undefined),
      expiresOn: changes.expiresOn !== undefined ? changes.expiresOn : (current.expiresOn ?? undefined),
      certificateFileId: changes.certificateFileId !== undefined ? (changes.certificateFileId ?? undefined) : (current.certificateFileId ?? undefined),
    };
    // The rules of SkillInput are about the row that results, not about what came in: a skill cannot keep a certificate, an expiry cannot precede its date.
    const result = SkillInput.safeParse(merged);
    if (!result.success) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', { issues: result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })) });
    }
    const next = result.data;
    const newFileId = next.certificateFileId ?? null;
    if (newFileId && newFileId !== current.certificateFileId) await this.assertAttachable(tx, principal, newFileId, skillId);

    const [row] = await tx
      .update(skills)
      .set({ name: next.name, kind: next.kind, issuer: next.issuer ?? null, issuedOn: next.issuedOn ?? null, expiresOn: next.expiresOn ?? null, certificateFileId: newFileId })
      .where(eq(skills.id, skillId))
      .returning();
    if (current.certificateFileId && current.certificateFileId !== newFileId) await this.retire(tx, current.certificateFileId);
    return toSkillView(row!);
  }

  async remove(principal: Principal, skillId: string): Promise<void> {
    const tx = this.database.current();
    const current = await this.ownSkill(tx, principal, skillId);
    await tx.delete(skills).where(eq(skills.id, skillId));
    if (current.certificateFileId) await this.retire(tx, current.certificateFileId);
  }

  private async ownSkill(tx: Tx, principal: Principal, skillId: string): Promise<SkillRow> {
    const profile = await this.profiles.ownProfile(tx, principal);
    const [row] = await tx
      .select()
      .from(skills)
      .where(and(eq(skills.id, skillId), eq(skills.profileId, profile.id)))
      .limit(1);
    if (!row) throw new DomainError('NOT_FOUND');
    return row;
  }

  /**
   * The file must be the person's own certificate, still alive and not on another entry. The database guards owner and purpose
   * (`skills_guard`) but not `deleted_at` (plan §6), so it is checked here too, with an answer that points at the field.
   */
  private async assertAttachable(tx: Tx, principal: Principal, fileId: string, skillId: string | null): Promise<void> {
    const [file] = await tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.purpose, 'certificate'), eq(files.ownerUserId, principal.userId), isNull(files.deletedAt)))
      .limit(1);
    if (!file) throw invalid('certificateFileId', 'invalid_file', 'the certificate must be a file you uploaded and that is still available');
    const taken = await tx
      .select({ id: skills.id })
      .from(skills)
      .where(skillId ? and(eq(skills.certificateFileId, fileId), ne(skills.id, skillId)) : eq(skills.certificateFileId, fileId))
      .limit(1);
    if (taken.length > 0) throw invalid('certificateFileId', 'already_attached', 'the certificate is already attached to another entry');
  }

  /** The row stays with `deleted_at`; the bytes go once the transaction has committed (D-S5). */
  private async retire(tx: Tx, fileId: string): Promise<void> {
    const [file] = await tx
      .update(files)
      .set({ deletedAt: this.clock.now() })
      .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
      .returning({ storageKey: files.storageKey });
    if (file) this.database.afterCommit(() => this.storage.delete(file.storageKey));
  }
}
