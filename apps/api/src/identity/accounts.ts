import { sql } from 'drizzle-orm';
import { DomainError } from '../common/domain-error.js';
import type { ContextRole, Tx } from '../db/database.service.js';

/** What `auth_find_user` returns (doc 05 §6.4): the account, its active membership if any, and the lock state. */
export interface Account {
  id: string;
  passwordHash: string;
  accountStatus: 'pending' | 'active' | 'rejected' | 'disabled';
  lockedUntil: Date | null;
  failedLogins: number;
  organizationId: string | null;
  role: ContextRole | null;
  locale: 'es' | 'fr';
}

type AccountRecord = {
  id: string;
  password_hash: string;
  account_status: Account['accountStatus'];
  locked_until: string | Date | null; // drizzle hands timestamps over as text
  failed_logins: number;
  organization_id: string | null;
  role: ContextRole | null;
  locale: 'es' | 'fr';
};

/** The only lookup of an account by email: a SECURITY DEFINER function, because the organization is not known yet. */
export async function findAccount(tx: Tx, email: string): Promise<Account | undefined> {
  const { rows } = await tx.execute<AccountRecord>(sql`SELECT * FROM auth_find_user(${email}::citext)`);
  const row = rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    passwordHash: row.password_hash,
    accountStatus: row.account_status,
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
    failedLogins: Number(row.failed_logins),
    organizationId: row.organization_id,
    role: row.role,
    locale: row.locale,
  };
}

export interface Standing {
  orgId: string | null;
  role: ContextRole | 'pending';
}

/**
 * Whether the account may hold a session and with which role (INV-25, RF-102). The role always comes from the
 * active membership, never from anything the client sends. A pending account has no organization and no role.
 */
export function standingOf(account: Account): Standing {
  switch (account.accountStatus) {
    case 'pending':
      return { orgId: null, role: 'pending' };
    case 'rejected':
      throw new DomainError('ACCOUNT_REJECTED');
    case 'disabled':
      throw new DomainError('ACCOUNT_DISABLED');
    case 'active':
      // An active account without an active membership has lost its access (doc 05, admin_set_account_status).
      if (!account.organizationId || !account.role) throw new DomainError('ACCOUNT_DISABLED');
      return { orgId: account.organizationId, role: account.role };
  }
}
