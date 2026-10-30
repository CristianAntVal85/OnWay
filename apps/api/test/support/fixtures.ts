// Fictitious data created as `onway_owner` (rule 10: nothing here is real). Each call makes new ids, so
// test files do not collide on the shared database.
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { DbConnection } from '../../src/db/config.js';

export type Role = 'admin' | 'coordinator' | 'rescuer';

export interface Member {
  userId: string;
  orgId: string;
  role: Role;
  email: string;
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

  async member(orgId: string, role: Role, accountStatus: 'pending' | 'active' | 'rejected' | 'disabled' = 'active'): Promise<Member> {
    const email = `${role}-${randomUUID()}@example.org`;
    const [user] = await this.query<{ id: string }>(`INSERT INTO users (email, password_hash, display_name, account_status) VALUES ($1, 'not-a-real-hash', $2, $3) RETURNING id`, [
      email,
      `Fictitious ${role}`,
      accountStatus,
    ]);
    await this.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, [orgId, user!.id, role]);
    if (role === 'rescuer') await this.query(`INSERT INTO rescuer_profiles (organization_id, user_id, full_name) VALUES ($1, $2, 'Fictitious Rescuer')`, [orgId, user!.id]);
    return { userId: user!.id, orgId, role, email };
  }

  async team(orgId: string, name = 'Team'): Promise<string> {
    const [row] = await this.query<{ id: string }>(`INSERT INTO teams (organization_id, name, locality) VALUES ($1, $2, 'Locality') RETURNING id`, [
      orgId,
      `${name} ${randomBytes(3).toString('hex')}`,
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
