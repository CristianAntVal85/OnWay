import { Inject, Injectable } from '@nestjs/common';
import { maskDocument, type OperationOutput } from '@onway/contracts';
import { and, eq } from 'drizzle-orm';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import type { Tx } from '../db/database.service.js';
import { rescuerContact, rescuerProfiles, rescuerSensitive, skills, teamMembers, teams, users } from '../db/schema.js';
import { SensitiveCipher } from '../sensitive/sensitive-cipher.js';

type MyProfile = OperationOutput<'getMyProfile'>;
type MySensitive = OperationOutput<'getMySensitive'>;
export type Address = NonNullable<MySensitive['address']>;
type MissingField = MyProfile['missingFields'][number];

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
  constructor(@Inject(SensitiveCipher) private readonly cipher: SensitiveCipher) {}

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
    const ownSkills = await tx.select().from(skills).where(eq(skills.profileId, profile.id)).orderBy(skills.createdAt);
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
      skills: ownSkills.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        issuer: s.issuer,
        issuedOn: s.issuedOn,
        expiresOn: s.expiresOn,
        hasCertificate: s.certificateFileId !== null,
      })),
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
