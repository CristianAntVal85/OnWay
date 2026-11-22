import { Inject, Injectable } from '@nestjs/common';
import { maskDocument, normalizeDocument, type OperationOutput } from '@onway/contracts';
import { and, eq } from 'drizzle-orm';
import { AuditWriter, type ProfileBlock } from '../audit/audit.writer.js';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import type { Tx } from '../db/database.service.js';
import { pgErrorOf } from '../db/errors.js';
import { rescuerContact, rescuerProfiles, rescuerSensitive, teamMembers, teams, users } from '../db/schema.js';
import { listSkillsOf } from './skill-rows.js';
import { DocumentFingerprint } from '../sensitive/document-fingerprint.js';
import { SensitiveCipher } from '../sensitive/sensitive-cipher.js';

type MyProfile = OperationOutput<'getMyProfile'>;
type MySensitive = OperationOutput<'getMySensitive'>;
export type Address = NonNullable<MySensitive['address']>;
type MissingField = MyProfile['missingFields'][number];
type DocumentInput = Decrypted['document'];

export interface ProfileChanges {
  fullName?: string;
  phone?: string;
  document?: DocumentInput;
  address?: Address;
}

/** Name PostgreSQL gave to `UNIQUE (organization_id, document_hash)` of migration 0003 (INV-24). */
export const DOCUMENT_UNIQUE = 'rescuer_sensitive_organization_id_document_hash_key';

export interface ProfileRow {
  id: string;
  organizationId: string;
  fullName: string;
  status: 'incomplete' | 'complete' | 'deleted';
  completedAt: Date | null;
}

/** What `rescuer_sensitive` holds once decrypted: only ever for the person themselves here (INV-18). */
interface Decrypted {
  document: { type: 'dni' | 'nie' | 'passport' | 'other'; number: string };
  address: Address;
}

/** `•••••, 22600 Sabiñánigo (ES)`: enough to recognise it, nothing of the street (doc 06, note of `getMyProfile`). */
export const addressSummary = (address: Address) => `•••••, ${address.postalCode} ${address.locality} (${address.country})`;

/**
 * The rescuer's own profile (RF-806, RF-807, RF-810). Name, contact and sensitive data are three entities (INV-32): each one is read
 * from its own table inside the request's transaction, so row level security decides every read, and nothing comes "on the way".
 */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(SensitiveCipher) private readonly cipher: SensitiveCipher,
    @Inject(DocumentFingerprint) private readonly fingerprint: DocumentFingerprint,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * RF-807 and RF-812 (correct): a partial update in the request's transaction. Each block goes to its own table (INV-32); document
   * and address are encrypted before they reach the database and the document's fingerprint is what INV-24 compares. The profile
   * becomes `complete` as soon as nothing is missing (the database refuses it otherwise, `rescuer_profiles_guard`).
   */
  async update(tx: Tx, principal: Principal, changes: ProfileChanges): Promise<MyProfile> {
    const profile = await this.ownProfile(tx, principal);
    const blocks: ProfileBlock[] = [];

    if (changes.fullName !== undefined) {
      await tx.update(rescuerProfiles).set({ fullName: changes.fullName }).where(eq(rescuerProfiles.id, profile.id));
      blocks.push('fullName');
    }
    if (changes.phone !== undefined) {
      await tx
        .insert(rescuerContact)
        .values({ profileId: profile.id, organizationId: profile.organizationId, phone: changes.phone })
        .onConflictDoUpdate({ target: rescuerContact.profileId, set: { phone: changes.phone, updatedAt: this.clock.now() } });
      blocks.push('phone');
    }
    if (changes.document || changes.address) {
      await this.writeSensitive(tx, profile, changes.document, changes.address);
      if (changes.document) blocks.push('document');
      if (changes.address) blocks.push('address');
    }

    const completes = profile.status === 'incomplete' && (await this.nothingMissing(tx, profile.id));
    if (completes) {
      await tx.update(rescuerProfiles).set({ status: 'complete', completedAt: this.clock.now() }).where(eq(rescuerProfiles.id, profile.id));
    }
    await this.audit.recordProfile({ orgId: profile.organizationId, profileId: profile.id, userId: principal.userId, action: completes ? 'profile_completed' : 'profile_updated', blocks });
    return this.describe(tx, principal);
  }

  /** The row holds both pieces (`NOT NULL`): the first time, document and address come together; afterwards either one alone. */
  private async writeSensitive(tx: Tx, profile: ProfileRow, document: DocumentInput | undefined, address: Address | undefined): Promise<void> {
    const [existing] = await tx.select({ keyId: rescuerSensitive.keyId }).from(rescuerSensitive).where(eq(rescuerSensitive.profileId, profile.id)).limit(1);
    if (!existing && (!document || !address)) {
      const missing = document ? 'address' : 'document';
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: [{ path: missing, code: 'required', message: 'document and address are stored together: the first time both are needed' }],
      });
    }
    const documentColumns = document
      ? { documentType: document.type, documentEnc: this.cipher.encrypt(profile.id, 'document', normalizeDocument(document.number)), documentHash: this.fingerprint.of(document.type, document.number) }
      : {};
    const addressColumns = address ? { addressEnc: this.cipher.encrypt(profile.id, 'address', JSON.stringify(address)) } : {};
    try {
      if (existing) {
        await tx
          .update(rescuerSensitive)
          .set({ ...documentColumns, ...addressColumns, updatedAt: this.clock.now() })
          .where(eq(rescuerSensitive.profileId, profile.id));
      } else {
        // Two first saves of the same profile at once: the second one finds the row of the first and updates it instead of failing on
        // the primary key (which would otherwise read as a duplicate document).
        const columns = { ...(documentColumns as Required<typeof documentColumns>), ...(addressColumns as Required<typeof addressColumns>), keyId: this.cipher.keyId };
        await tx
          .insert(rescuerSensitive)
          .values({ profileId: profile.id, organizationId: profile.organizationId, ...columns })
          .onConflictDoUpdate({ target: rescuerSensitive.profileId, set: { ...columns, updatedAt: this.clock.now() } });
      }
    } catch (error) {
      // INV-24: `UNIQUE (organization_id, document_hash)`. The person cannot read other rows (`sensitive_own`), so the database is the one
      // that knows; the answer says nothing of whose it is (D-P2). Only that constraint means a duplicate document.
      const failure = pgErrorOf(error);
      if (failure?.code === '23505' && failure.constraint === DOCUMENT_UNIQUE) throw new DomainError('DOCUMENT_ALREADY_REGISTERED', 'This document is already registered');
      throw error;
    }
  }

  private async nothingMissing(tx: Tx, profileId: string): Promise<boolean> {
    const [contact] = await tx.select({ id: rescuerContact.profileId }).from(rescuerContact).where(eq(rescuerContact.profileId, profileId)).limit(1);
    const [sensitive] = await tx.select({ id: rescuerSensitive.profileId }).from(rescuerSensitive).where(eq(rescuerSensitive.profileId, profileId)).limit(1);
    return Boolean(contact && sensitive);
  }

  async ownProfile(tx: Tx, principal: Principal): Promise<ProfileRow> {
    const [row] = await tx
      .select({ id: rescuerProfiles.id, organizationId: rescuerProfiles.organizationId, fullName: rescuerProfiles.fullName, status: rescuerProfiles.status, completedAt: rescuerProfiles.completedAt })
      .from(rescuerProfiles)
      .where(eq(rescuerProfiles.userId, principal.userId))
      .limit(1);
    // Every rescuer gets a profile when approved (admin_decide_signup); a deleted one cannot log in. Missing means not theirs to see.
    if (!row || row.status === 'deleted') throw new DomainError('NOT_FOUND');
    return row;
  }

  async describe(tx: Tx, principal: Principal): Promise<MyProfile> {
    const profile = await this.ownProfile(tx, principal);
    const [account] = await tx.select({ email: users.email }).from(users).where(eq(users.id, principal.userId)).limit(1);
    const [contact] = await tx.select({ phone: rescuerContact.phone }).from(rescuerContact).where(eq(rescuerContact.profileId, profile.id)).limit(1);
    const sensitive = await this.decrypted(tx, profile.id);
    const ownSkills = await listSkillsOf(tx, profile.id);
    const ownTeams = await tx
      .select({ id: teams.id, name: teams.name, locality: teams.locality })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teamMembers.userId, principal.userId), eq(teams.status, 'active')))
      .orderBy(teams.name);

    const missingFields: MissingField[] = [];
    if (!contact) missingFields.push('phone');
    if (!sensitive) missingFields.push('document', 'address');

    return {
      status: profile.status,
      fullName: profile.fullName,
      email: account!.email, // INV-31: the contact email is the login one, there is no other
      phone: contact?.phone ?? null,
      document: sensitive ? { type: sensitive.document.type, masked: maskDocument(sensitive.document.number) } : null,
      addressSummary: sensitive ? addressSummary(sensitive.address) : null,
      skills: ownSkills,
      teams: ownTeams,
      missingFields,
      completedAt: profile.completedAt ? profile.completedAt.toISOString() : null,
    };
  }

  async sensitive(tx: Tx, principal: Principal): Promise<MySensitive> {
    const profile = await this.ownProfile(tx, principal);
    const data = await this.decrypted(tx, profile.id);
    return { document: data?.document ?? null, address: data?.address ?? null };
  }

  /** `sensitive_own` only lets the person read their row (INV-18); the administrator never comes through here. */
  protected async decrypted(tx: Tx, profileId: string): Promise<Decrypted | null> {
    const [row] = await tx.select().from(rescuerSensitive).where(eq(rescuerSensitive.profileId, profileId)).limit(1);
    if (!row) return null;
    return {
      document: { type: row.documentType, number: this.cipher.decrypt(profileId, 'document', row.documentEnc, row.keyId) },
      address: JSON.parse(this.cipher.decrypt(profileId, 'address', row.addressEnc, row.keyId)) as Address,
    };
  }
}
