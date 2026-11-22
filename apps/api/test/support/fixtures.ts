// Fictitious data created as `onway_owner` (rule 10: nothing here is real). Each call makes new ids, so
// test files do not collide on the shared database.
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../../src/identity/password.js';
import type { DbConnection } from '../../src/db/config.js';

export type Role = 'admin' | 'coordinator' | 'rescuer';

export interface Member {
  userId: string;
  orgId: string;
  role: Role;
  email: string;
  /** Fictitious password, set only when the account was created able to log in. */
  password?: string;
}

/** One fictitious password for the tests that log in (rule 10: nothing real). */
export const TEST_PASSWORD = 'fictitious-test-password-1';
const hashes = new Map<string, Promise<string>>();
const hashOf = (password: string) => {
  if (!hashes.has(password)) hashes.set(password, hashPassword(password));
  return hashes.get(password)!;
};

export interface MemberOptions {
  /** Gives the account a real Argon2id hash of this password so it can log in. */
  password?: string;
  profile?: 'incomplete' | 'complete';
}

export class Fixtures {
  private readonly pool: pg.Pool;

  constructor(owner: DbConnection) {
    this.pool = new pg.Pool({ ...owner, max: 2 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(text, values)).rows;
  }

  async organization(name = 'Org'): Promise<string> {
    const [row] = await this.query<{ id: string }>(`INSERT INTO organizations (name, country, invite_code) VALUES ($1, 'ES', $2) RETURNING id`, [
      `${name} ${randomBytes(3).toString('hex')}`,
      `INV-${randomBytes(8).toString('hex')}`,
    ]);
    return row!.id;
  }

  async member(orgId: string, role: Role, accountStatus: 'pending' | 'active' | 'rejected' | 'disabled' = 'active', options: MemberOptions = {}): Promise<Member> {
    const email = `${role}-${randomUUID()}@example.org`;
    const hash = options.password ? await hashOf(options.password) : 'not-a-real-hash';
    const [user] = await this.query<{ id: string }>(`INSERT INTO users (email, password_hash, display_name, account_status) VALUES ($1, $2, $3, $4) RETURNING id`, [
      email,
      hash,
      `Fictitious ${role}`,
      accountStatus,
    ]);
    await this.query(`INSERT INTO memberships (organization_id, user_id, role, status) VALUES ($1, $2, $3, $4)`, [orgId, user!.id, role, accountStatus === 'active' ? 'active' : 'disabled']);
    if (role === 'rescuer') {
      const complete = options.profile === 'complete';
      await this.query(`INSERT INTO rescuer_profiles (organization_id, user_id, full_name, status, completed_at) VALUES ($1, $2, 'Fictitious Rescuer', $3, ${complete ? 'now()' : 'NULL'})`, [
        orgId,
        user!.id,
        complete ? 'complete' : 'incomplete',
      ]);
    }
    return { userId: user!.id, orgId, role, email, ...(options.password ? { password: options.password } : {}) };
  }

  /** An account that asked to join (or was turned down): it has a signup request and no membership (INV-25). */
  async applicant(orgId: string, status: 'pending' | 'rejected' = 'pending', options: MemberOptions = {}): Promise<Member> {
    const email = `applicant-${randomUUID()}@example.org`;
    const hash = options.password ? await hashOf(options.password) : 'not-a-real-hash';
    const [user] = await this.query<{ id: string }>(`INSERT INTO users (email, password_hash, display_name, account_status) VALUES ($1, $2, 'Fictitious applicant', $3) RETURNING id`, [
      email,
      hash,
      status,
    ]);
    await this.query(`INSERT INTO signup_requests (organization_id, user_id, status, decided_at) VALUES ($1, $2, $3, ${status === 'pending' ? 'NULL' : 'now()'})`, [orgId, user!.id, status]);
    return { userId: user!.id, orgId, role: 'rescuer', email, ...(options.password ? { password: options.password } : {}) };
  }

  async team(
    orgId: string,
    name = 'Team',
    code = `${randomBytes(2)
      .toString('base64url')
      .replace(/[^A-Za-z0-9]/g, 'x')
      .slice(0, 3)
      .toUpperCase()
      .padEnd(3, 'X')}`,
  ): Promise<string> {
    const [row] = await this.query<{ id: string }>(`INSERT INTO teams (organization_id, name, locality, code) VALUES ($1, $2, 'Locality', $3) RETURNING id`, [
      orgId,
      `${name} ${randomBytes(3).toString('hex')}`,
      code,
    ]);
    return row!.id;
  }

  async addToTeam(teamId: string, member: Member): Promise<void> {
    await this.query(`INSERT INTO team_members (team_id, user_id, organization_id) VALUES ($1, $2, $3)`, [teamId, member.userId, member.orgId]);
  }

  /** An organization with one admin, one coordinator, one rescuer and a team holding the rescuer. */
  async fullOrganization(name: string) {
    const orgId = await this.organization(name);
    const admin = await this.member(orgId, 'admin');
    const coordinator = await this.member(orgId, 'coordinator');
    const rescuer = await this.member(orgId, 'rescuer');
    const teamId = await this.team(orgId);
    await this.addToTeam(teamId, rescuer);
    return { orgId, admin, coordinator, rescuer, teamId };
  }
}
