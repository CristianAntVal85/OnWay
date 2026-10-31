import { Injectable } from '@nestjs/common';
import { MAX_FILE_BYTES, type OperationOutput } from '@onway/contracts';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import type { Tx } from '../db/database.service.js';
import { memberships, organizations, users } from '../db/schema.js';

@Injectable()
export class OrganizationService {
  /**
   * The organization of the session (RF-102). It selects exactly the columns of `OrgInfo`: the invitation code
   * and the rest of the row never leave the database. Row level security would already hide any other
   * organization; the filter by the principal's organization is the second defence (rule 1).
   */
  async describe(tx: Tx, principal: Principal): Promise<OperationOutput<'getOrganization'>> {
    // A pending account has no organization; the guard stops it before it gets here.
    if (!principal.orgId) throw new DomainError('ACCOUNT_PENDING');
    const [row] = await tx
      .select({ id: organizations.id, name: organizations.name, country: organizations.country, validationMaxAgeDays: organizations.validationMaxAgeDays })
      .from(organizations)
      .where(eq(organizations.id, principal.orgId))
      .limit(1);
    if (!row) throw new DomainError('NOT_FOUND');
    // maxUploadBytes is the constant of the files contract, which mirrors the CHECK on files.size_bytes.
    return { id: row.id, name: row.name, country: row.country, config: { validationMaxAgeDays: row.validationMaxAgeDays, maxUploadBytes: MAX_FILE_BYTES } };
  }

  /**
   * The selector «Coordinador responsable» (RF-201): active members with the coordinator role, by name. Rescuers and
   * administrators are not in it (Q-14 = no, D-H1-03). Only id and name leave the database (RN-21).
   */
  async listCoordinators(tx: Tx, principal: Principal): Promise<OperationOutput<'listCoordinators'>> {
    if (!principal.orgId) throw new DomainError('ACCOUNT_PENDING');
    const rows = await tx
      .select({ id: users.id, displayName: users.displayName })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.organizationId, principal.orgId), eq(memberships.role, 'coordinator'), eq(memberships.status, 'active'), isNull(users.anonymizedAt)))
      .orderBy(asc(users.displayName), asc(users.id));
    return { items: rows };
  }
}
