import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { DbConnection } from '../db/config.js';
import type { ElevationProvider } from '../geo/elevation.js';
import { hashPassword } from '../identity/password.js';
import type { Demo } from './demo.js';

export interface SeedResult {
  /** `false` when the organization already existed: the people and teams are then left as they are (D-H0-17). */
  seeded: boolean;
  organizationId: string;
  /** Demo missions created in this run: 0 once they exist. A mission whose altitude cannot be calculated is left for a later run. */
  missions: number;
}

export interface SeedOptions {
  /** Altitude source for the demo missions, the same port the API uses (RN-07). */
  elevation: ElevationProvider;
  warn?: (message: string) => void;
}

// Same keys for every run so that two seeds started together serialize instead of both inserting.
const SEED_LOCK = 7_301_001;
const MISSIONS_LOCK = 7_301_002;

async function findOrganization(client: pg.Pool | pg.PoolClient, demo: Demo): Promise<string | undefined> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM organizations WHERE name = $1 AND country = $2`, [demo.organization.name, demo.organization.country]);
  return rows[0]?.id;
}

/**
 * Loads the demonstration data as `onway_owner` (doc 05 §10), the way the platform would, never through the API.
 * Idempotent: if the organization exists its people and teams are left alone, and each demo mission is created only if its name is
 * not there yet (see `seedMissions`). Rescuers get an `incomplete` profile with no contact and no
 * sensitive data (D-H0-19: filling those in needs encryption, H5). The invite code is random each time and not printed.
 */
export async function seedDemo(owner: DbConnection, demo: Demo, options: SeedOptions): Promise<SeedResult> {
  const pool = new pg.Pool({ ...owner, max: 1 });
  try {
    const organization = await seedOrganization(pool, demo);
    const missions = await seedMissions(pool, organization.organizationId, demo, options);
    return { ...organization, missions };
  } finally {
    await pool.end();
  }
}

async function seedOrganization(pool: pg.Pool, demo: Demo): Promise<{ seeded: boolean; organizationId: string }> {
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
}

/** SQL for a 3D point from three placeholders. `ST_MakePoint` takes x = lon, y = lat; the altitude is the Z. */
const pointZ = (lon: string, lat: string, z: string) => `ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8, ${z}::float8), 4326)`;

/**
 * The demo missions (P4 b): one per state, created the way the API creates, activates and closes them (same rows in
 * `audit_log`, INV-16) but as `onway_owner`. Idempotent per mission name, so a stack that was seeded before H1 gains them on its
 * next `up`. Altitudes come from the `ElevationProvider`; with no source for a point (the geodata download failed) that mission is skipped with a warning.
 */
async function seedMissions(pool: pg.Pool, orgId: string, demo: Demo, options: SeedOptions): Promise<number> {
  const warn = options.warn ?? (() => undefined);
  let created = 0;
  for (const mission of demo.missions) {
    const exists = await pool.query(`SELECT 1 FROM missions WHERE organization_id = $1 AND lower(name) = lower($2)`, [orgId, mission.name]);
    if (exists.rowCount) continue;

    const target = await options.elevation.elevationAt(mission.target);
    const heights = await Promise.all(mission.points.map((p) => options.elevation.elevationAt(p)));
    if (target === null || heights.some((h) => h === null)) {
      warn(`demo mission "${mission.name}" skipped: no elevation source covers all its points (is the geodata volume loaded?)`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [MISSIONS_LOCK]);
      const raced = await client.query(`SELECT 1 FROM missions WHERE organization_id = $1 AND lower(name) = lower($2)`, [orgId, mission.name]);
      if (raced.rowCount) {
        await client.query('ROLLBACK');
        continue;
      }
      const coordinator = demo.members.find((m) => m.key === mission.coordinator)!;
      const coordinatorId = (await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [coordinator.email])).rows[0]!.id;

      const row = await client.query<{ id: string }>(
        `INSERT INTO missions (organization_id, name, description, coordinator_id, target, target_label, target_country, target_source, created_by)
         VALUES ($1, $2, $3, $4, ${pointZ('$5', '$6', '$7')}, $8, $9, 'map', $4) RETURNING id`,
        [orgId, mission.name, mission.description ?? null, coordinatorId, mission.target.lon, mission.target.lat, target, mission.target.label ?? null, demo.organization.country],
      );
      const missionId = row.rows[0]!.id;

      const positions = new Map<string, number>();
      for (const [index, point] of mission.points.entries()) {
        const position = positions.get(point.kind) ?? 0;
        positions.set(point.kind, position + 1);
        await client.query(
          `INSERT INTO mission_points (organization_id, mission_id, kind, name, note, geom, position)
           VALUES ($1, $2, $3, $4, $5, ${pointZ('$6', '$7', '$8')}, $9)`,
          [orgId, missionId, point.kind, point.name, point.note ?? null, point.lon, point.lat, heights[index], position],
        );
      }

      const audit = async (action: string, detail: Record<string, unknown>) => {
        await client.query(`INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, detail) VALUES ($1, 'mission', $2, $3, $4, $5)`, [
          orgId,
          missionId,
          action,
          coordinatorId,
          JSON.stringify(detail),
        ]);
      };
      await audit('mission_created', { name: mission.name, origins: mission.points.filter((p) => p.kind === 'origin').length });
      for (const point of mission.points.filter((p) => p.kind !== 'origin')) await audit('point_added', { name: point.name, kind: point.kind });
      if (mission.status !== 'planning') {
        await client.query(`UPDATE missions SET status = 'active', activated_at = now() WHERE id = $1`, [missionId]);
        await audit('mission_activated', { withoutValidatedRoute: true });
      }
      if (mission.status === 'closed') {
        await client.query(`UPDATE missions SET status = 'closed', closed_at = now() WHERE id = $1`, [missionId]);
        await audit('mission_closed', { attended: 0, accepted: 0 });
      }
      await client.query('COMMIT');
      created += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  return created;
}
