import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { DbConnection } from '../db/config.js';
import { hashPassword } from '../identity/password.js';
import type { Demo } from './demo.js';

export interface SeedResult {
  /** `false` when the organization already existed: the seed then changes nothing (D-H0-17). */
  seeded: boolean;
  organizationId: string;
}

// Same key for every run so that two seeds started together serialize instead of both inserting.
const SEED_LOCK = 7_301_001;

async function findOrganization(client: pg.Pool | pg.PoolClient, demo: Demo): Promise<string | undefined> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM organizations WHERE name = $1 AND country = $2`, [demo.organization.name, demo.organization.country]);
  return rows[0]?.id;
}

/**
 * Loads the demonstration data as `onway_owner` (doc 05 §10), the way the platform would, never through the API.
 * Idempotent: if the organization exists it does nothing. Rescuers get an `incomplete` profile with no contact and no
 * sensitive data (D-H0-19: filling those in needs encryption, H5). The invite code is random each time and not printed.
 */
export async function seedDemo(owner: DbConnection, demo: Demo): Promise<SeedResult> {
  const pool = new pg.Pool({ ...owner, max: 1 });
  try {
    const existing = await findOrganization(pool, demo);
    if (existing) return { seeded: false, organizationId: existing };

    // Argon2id with the API's own parameters, computed now so the repository holds no hash. One salt per account.
    const hashes = new Map<string, string>();
    for (const person of [...demo.members, ...demo.applicants]) hashes.set(person.key, await hashPassword(demo.demoPassword));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
      const raced = await findOrganization(client, demo);
      if (raced) {
        await client.query('ROLLBACK');
        return { seeded: false, organizationId: raced };
      }

      const org = await client.query<{ id: string }>(`INSERT INTO organizations (name, country, invite_code, validation_max_age_days) VALUES ($1, $2, $3, $4) RETURNING id`, [
        demo.organization.name,
        demo.organization.country,
        `DEMO-${randomBytes(12).toString('hex')}`,
        demo.organization.validationMaxAgeDays,
      ]);
      const orgId = org.rows[0]!.id;

      const userIds = new Map<string, string>();
      const insertUser = async (key: string, email: string, displayName: string, locale: string, status: 'active' | 'pending') => {
        const { rows } = await client.query<{ id: string }>(`INSERT INTO users (email, password_hash, display_name, locale, account_status) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
          email,
          hashes.get(key),
          displayName,
          locale,
          status,
        ]);
        userIds.set(key, rows[0]!.id);
        return rows[0]!.id;
      };

      for (const member of demo.members) {
        const userId = await insertUser(member.key, member.email, member.displayName, member.locale, 'active');
        await client.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, [orgId, userId, member.role]);
        if (member.role === 'rescuer') {
          await client.query(`INSERT INTO rescuer_profiles (organization_id, user_id, full_name, status) VALUES ($1, $2, $3, 'incomplete')`, [orgId, userId, member.displayName]);
        }
      }

      // Pending accounts: a signup request and no membership (INV-25).
      for (const applicant of demo.applicants) {
        const userId = await insertUser(applicant.key, applicant.email, applicant.displayName, applicant.locale, 'pending');
        await client.query(`INSERT INTO signup_requests (organization_id, user_id) VALUES ($1, $2)`, [orgId, userId]);
      }

      for (const team of demo.teams) {
        const { rows } = await client.query<{ id: string }>(`INSERT INTO teams (organization_id, name, locality) VALUES ($1, $2, $3) RETURNING id`, [orgId, team.name, team.locality]);
        for (const key of team.members) {
          await client.query(`INSERT INTO team_members (team_id, user_id, organization_id) VALUES ($1, $2, $3)`, [rows[0]!.id, userIds.get(key), orgId]);
        }
      }

      await client.query('COMMIT');
      return { seeded: true, organizationId: orgId };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
