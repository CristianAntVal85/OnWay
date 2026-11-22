import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTrack } from '@onway/geo';
import pg from 'pg';
import { DomainError } from '../common/domain-error.js';
import type { DbConnection } from '../db/config.js';
import type { FileStorage } from '../files/file-storage.js';
import type { ElevationProvider } from '../geo/elevation.js';
import { hashPassword } from '../identity/password.js';
import { RouteMeasurement, type MeasuredPath } from '../routes/route-measurement.js';
import { aliasBase, normalizeDocument } from '@onway/contracts';
import type { SensitiveKeys } from '../sensitive/config.js';
import { DocumentFingerprint } from '../sensitive/document-fingerprint.js';
import { SensitiveCipher } from '../sensitive/sensitive-cipher.js';
import { demoCertificatePdf } from './demo-certificate.js';
import { gpxDirOf, type Demo } from './demo.js';

export interface SeedResult {
  /** `false` when the organization already existed: the people and teams are then left as they are (D-H0-17). */
  seeded: boolean;
  organizationId: string;
  /** Demo missions created in this run: 0 once they exist. A mission whose altitude cannot be calculated is left for a later run. */
  missions: number;
  /** Demo routes created in this run: 0 once they exist. */
  routes: number;
  /** Routes put in the demo missions in this run (H4-T7): 0 once they are there. */
  missionRoutes: number;
  /** Demo profiles completed in this run (H5-perfil): 0 once they are complete. */
  profiles: number;
  /** Demo courses and skills created in this run (H5-habilidades): 0 once they exist. */
  skills: number;
  /** Aliases fixed in this run (H5-equipos, Q-36): 0 once every member who can have one has it. */
  aliases: number;
}

export interface SeedOptions {
  /** Altitude source for the demo missions and routes, the same port the API uses (RN-07). */
  elevation: ElevationProvider;
  /** The API's keys of the sensitive data (D-P8): the seed encrypts the demo profiles exactly as `updateMyProfile` would. */
  sensitive: SensitiveKeys;
  /** Folder of the invented GPX files of the demo routes; `gpx/` next to the seed file by default. */
  gpxDir?: string;
  /** Where the bytes of the demo certificate go: the same `FileStorage` the API reads (`FILES_DIR`). Without it the entries are created but the certificate is skipped, with a warning. */
  storage?: FileStorage;
  warn?: (message: string) => void;
}

// Same keys for every run so that two seeds started together serialize instead of both inserting.
const SEED_LOCK = 7_301_001;
const MISSIONS_LOCK = 7_301_002;
const ROUTES_LOCK = 7_301_003;
const MISSION_ROUTES_LOCK = 7_301_004;
const PROFILES_LOCK = 7_301_005;
const SKILLS_LOCK = 7_301_006;

async function findOrganization(client: pg.Pool | pg.PoolClient, demo: Demo): Promise<string | undefined> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM organizations WHERE name = $1 AND country = $2`, [demo.organization.name, demo.organization.country]);
  return rows[0]?.id;
}

/**
 * Loads the demonstration data as `onway_owner` (doc 05 §10), the way the platform would, never through the API.
 * Idempotent: if the organization exists its people and teams are left alone, and each demo mission is created only if its name is
 * not there yet (see `seedMissions`). Rescuers get an `incomplete` profile; those with a `profile` in the file then have it completed
 * (`seedProfiles`, H5-perfil), the others stay incomplete. The invite code is random each time and not printed.
 */
export async function seedDemo(owner: DbConnection, demo: Demo, options: SeedOptions): Promise<SeedResult> {
  const pool = new pg.Pool({ ...owner, max: 1 });
  try {
    const organization = await seedOrganization(pool, demo);
    const missions = await seedMissions(pool, organization.organizationId, demo, options);
    const routes = await seedRoutes(pool, organization.organizationId, demo, options);
    const missionRoutes = await seedMissionRoutes(pool, organization.organizationId, demo, options);
    const profiles = await seedProfiles(pool, organization.organizationId, demo, options);
    const skills = await seedSkills(pool, organization.organizationId, demo, options);
    const aliases = await seedAliases(pool, organization.organizationId, demo);
    return { ...organization, missions, routes, missionRoutes, profiles, skills, aliases };
  } finally {
    await pool.end();
  }
}

/**
 * Completes the demo profiles that are still `incomplete` and have no sensitive data (H5-perfil, D-P8), so a stack seeded before H5 gets
 * them on its next `up` and a profile somebody already filled in is left alone. Same rows and audit line as `updateMyProfile`: contact,
 * encrypted document and address with the document's fingerprint, then `complete`.
 */
async function seedProfiles(pool: pg.Pool, orgId: string, demo: Demo, options: SeedOptions): Promise<number> {
  const cipher = new SensitiveCipher(options.sensitive);
  const fingerprint = new DocumentFingerprint(options.sensitive);
  let completed = 0;
  for (const member of demo.members) {
    if (!member.profile) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [PROFILES_LOCK]);
      const { rows } = await client.query<{ id: string; user_id: string }>(
        `SELECT p.id, p.user_id FROM rescuer_profiles p JOIN users u ON u.id = p.user_id
          WHERE p.organization_id = $1 AND u.email = $2 AND p.status = 'incomplete'
            AND NOT EXISTS (SELECT 1 FROM rescuer_sensitive s WHERE s.profile_id = p.id)`,
        [orgId, member.email],
      );
      const profile = rows[0];
      if (!profile) {
        await client.query('ROLLBACK');
        continue;
      }
      const { phone, document, address } = member.profile;
      // A phone the person already saved stays: the seed only fills what is missing (reviewer-db, H5-perfil).
      await client.query(`INSERT INTO rescuer_contact (profile_id, organization_id, phone) VALUES ($1, $2, $3) ON CONFLICT (profile_id) DO NOTHING`, [profile.id, orgId, phone]);
      await client.query(`INSERT INTO rescuer_sensitive (profile_id, organization_id, document_type, document_enc, document_hash, address_enc, key_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        profile.id,
        orgId,
        document.type,
        cipher.encrypt(profile.id, 'document', normalizeDocument(document.number)),
        fingerprint.of(document.type, document.number),
        cipher.encrypt(profile.id, 'address', JSON.stringify(address)),
        cipher.keyId,
      ]);
      await client.query(`UPDATE rescuer_profiles SET status = 'complete', completed_at = now() WHERE id = $1`, [profile.id]);
      await client.query(
        `INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, subject_user_id, detail) VALUES ($1, 'rescuer_profile', $2, 'profile_completed', $3, $3, $4)`,
        [orgId, profile.id, profile.user_id, JSON.stringify({ blocks: ['phone', 'document', 'address'] })],
      );
      await client.query('COMMIT');
      completed += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return completed;
}

/**
 * The demo courses and skills (H5-habilidades, RF-808): each entry is created only if the profile has none with that name, so a stack seeded
 * before H5 gains them on its next `up` and one somebody edited is left alone. The entry that asks for a certificate gets the invented PDF,
 * attached at creation only: if the rescuer later removes it, the seed does not bring it back. The bytes go first and are removed if the rows fail.
 */
async function seedSkills(pool: pg.Pool, orgId: string, demo: Demo, options: SeedOptions): Promise<number> {
  const warn = options.warn ?? (() => undefined);
  let created = 0;
  for (const member of demo.members) {
    if (member.skills.length === 0) continue;
    const client = await pool.connect();
    let key: string | null = null;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [SKILLS_LOCK]);
      const { rows } = await client.query<{ id: string; user_id: string }>(
        `SELECT p.id, p.user_id FROM rescuer_profiles p JOIN users u ON u.id = p.user_id WHERE p.organization_id = $1 AND u.email = $2 AND p.status <> 'deleted'`,
        [orgId, member.email],
      );
      const profile = rows[0];
      if (!profile) {
        await client.query('ROLLBACK');
        continue;
      }
      for (const skill of member.skills) {
        const exists = await client.query(`SELECT 1 FROM skills WHERE profile_id = $1 AND lower(name) = lower($2)`, [profile.id, skill.name]);
        if (exists.rowCount) continue;
        let fileId: string | null = null;
        if (skill.certificate) {
          if (!options.storage) warn(`demo certificate of "${member.key}" skipped: the seed has no file storage (is FILES_DIR set?)`);
          else {
            const pdf = demoCertificatePdf();
            key = await options.storage.put(pdf);
            const file = await client.query<{ id: string }>(
              `INSERT INTO files (organization_id, owner_user_id, purpose, content_type, size_bytes, storage_key, sha256, created_by) VALUES ($1, $2, 'certificate', 'application/pdf', $3, $4, $5, $2) RETURNING id`,
              [orgId, profile.user_id, pdf.length, key, createHash('sha256').update(pdf).digest()],
            );
            fileId = file.rows[0]!.id;
          }
        }
        await client.query(`INSERT INTO skills (organization_id, profile_id, name, kind, issuer, issued_on, expires_on, certificate_file_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
          orgId,
          profile.id,
          skill.name,
          skill.kind,
          skill.issuer ?? null,
          skill.issuedOn ?? null,
          skill.expiresOn ?? null,
          fileId,
        ]);
        created += 1;
      }
      await client.query('COMMIT');
      key = null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (key && options.storage) await options.storage.delete(key);
      throw error;
    } finally {
      client.release();
    }
  }
  return created;
}

/**
 * Fixes the alias (Q-36) of the demo members who have none yet and can have one: the staff (from the visible name) and the rescuers with the profile
 * complete (from the full name of the profile), with the code of the first team of the demo that holds them. The same rule as `set_member_alias`
 * (a numeric suffix on a clash) done as the owner, because the seed has no request context. An alias that exists is left as it is (fixed).
 * Idempotent, so a stack seeded before H5-equipos receives them on its next `up`.
 */
async function seedAliases(pool: pg.Pool, orgId: string, demo: Demo): Promise<number> {
  const { rows } = await pool.query<{ email: string; role: string; display_name: string; full_name: string | null; profile_status: string | null; alias: string | null; user_id: string }>(
    `SELECT u.id user_id, u.email, m.role::text role, u.display_name, p.full_name, p.status::text profile_status, m.alias
       FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN rescuer_profiles p ON p.user_id = u.id AND p.organization_id = m.organization_id
      WHERE m.organization_id = $1`,
    [orgId],
  );
  const byEmail = new Map(rows.map((r) => [r.email, r]));
  let fixed = 0;
  for (const member of demo.members) {
    const row = byEmail.get(member.email);
    if (!row || row.alias !== null) continue;
    const name = member.role === 'rescuer' ? (row.profile_status === 'complete' ? row.full_name : null) : row.display_name;
    if (!name) continue;
    const base = aliasBase(name);
    const code = demo.teams.find((t) => t.members.includes(member.key))?.code ?? null;
    const taken = new Set((await pool.query<{ alias: string }>(`SELECT lower(alias) alias FROM memberships WHERE organization_id = $1 AND alias IS NOT NULL`, [orgId])).rows.map((r) => r.alias));
    let n = 1;
    let alias: string;
    do {
      alias = `${base}${n > 1 ? n : ''}${code ? ` ${code}` : ''}`;
      n += 1;
    } while (taken.has(alias.toLowerCase()));
    await pool.query(`UPDATE memberships SET alias = $3 WHERE organization_id = $1 AND user_id = $2 AND alias IS NULL`, [orgId, row.user_id, alias]);
    fixed += 1;
  }
  return fixed;
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
      const { rows } = await client.query<{ id: string }>(`INSERT INTO teams (organization_id, name, locality, code) VALUES ($1, $2, $3, $4) RETURNING id`, [
        orgId,
        team.name,
        team.locality,
        team.code,
      ]);
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

/**
 * The demo routes (P6): the library as the API would have left it after a few weeks of work (versions, validations, a copy, an
 * archived route and a validation older than the limit), written as `onway_owner` with their audit rows (INV-16). Geometry,
 * altitudes, metrics and segments come from the same `RouteMeasurement` the API uses, never from the GPX file (RN-10).
 * Idempotent per route name; a route whose points no elevation source covers is skipped with a warning.
 */
async function seedRoutes(pool: pg.Pool, orgId: string, demo: Demo, options: SeedOptions): Promise<number> {
  const warn = options.warn ?? (() => undefined);
  const measurement = new RouteMeasurement(options.elevation);
  const gpxDir = options.gpxDir ?? gpxDirOf();
  let created = 0;

  for (const route of demo.routes) {
    const exists = await pool.query(`SELECT 1 FROM routes WHERE organization_id = $1 AND lower(name) = lower($2)`, [orgId, route.name]);
    if (exists.rowCount) continue;

    const measured: MeasuredPath[] = [];
    try {
      for (const version of route.versions) measured.push(await measurement.measure(parseTrack(readFileSync(join(gpxDir, version.gpx), 'utf8')).line));
    } catch (error) {
      if (!(error instanceof DomainError && error.code === 'OUTSIDE_COVERAGE')) throw error;
      warn(`demo route "${route.name}" skipped: no elevation source covers all its points (is the geodata volume loaded?)`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [ROUTES_LOCK]);
      const raced = await client.query(`SELECT 1 FROM routes WHERE organization_id = $1 AND lower(name) = lower($2)`, [orgId, route.name]);
      if (raced.rowCount) {
        await client.query('ROLLBACK');
        continue;
      }
      const coordinator = demo.members.find((m) => m.key === route.coordinator)!;
      const userId = (await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [coordinator.email])).rows[0]!.id;

      let derived: { routeId: string; versionId: string; versionNumber: number } | null = null;
      if (route.derivedFrom) {
        const source = await client.query<{ route_id: string; version_id: string }>(
          `SELECT r.id AS route_id, v.id AS version_id FROM routes r JOIN route_versions v ON v.route_id = r.id AND v.version_number = $3
            WHERE r.organization_id = $1 AND lower(r.name) = lower($2)`,
          [orgId, route.derivedFrom.route, route.derivedFrom.version],
        );
        if (!source.rowCount) {
          warn(`demo route "${route.name}" skipped: the route it derives from is not there`);
          await client.query('ROLLBACK');
          continue;
        }
        derived = { routeId: source.rows[0]!.route_id, versionId: source.rows[0]!.version_id, versionNumber: route.derivedFrom.version };
      }

      const routeId = randomUUID();
      const versionIds = route.versions.map(() => randomUUID());
      const lastValidated = route.versions
        .map((v, i) => (v.validatedDaysAgo !== undefined ? i : -1))
        .filter((i) => i >= 0)
        .at(-1);
      const ago = (days: number) => `now() - make_interval(days => ${Math.trunc(days)})`;
      const newest = route.versions.at(-1)!;

      // `latest_*` point at versions inserted right after in the same transaction: the foreign keys are deferred (0005).
      await client.query(
        `INSERT INTO routes (id, organization_id, name, status, derived_from_route_id, derived_from_version_id, latest_version_id, latest_validated_version_id, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${ago(route.versions[0]!.daysAgo)}, ${ago(Math.min(newest.daysAgo, newest.validatedDaysAgo ?? newest.daysAgo))})`,
        [
          routeId,
          orgId,
          route.name,
          route.archived ? 'archived' : 'active',
          derived?.routeId ?? null,
          derived?.versionId ?? null,
          versionIds.at(-1),
          lastValidated === undefined ? null : versionIds[lastValidated],
          userId,
        ],
      );

      const audit = async (action: string, daysAgo: number, detail: Record<string, unknown>) => {
        await client.query(`INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, occurred_at, detail) VALUES ($1, 'route', $2, $3, $4, ${ago(daysAgo)}, $5)`, [
          orgId,
          routeId,
          action,
          userId,
          JSON.stringify(detail),
        ]);
      };

      for (const [index, version] of route.versions.entries()) {
        const path = measured[index]!;
        const { metrics } = path;
        const geometry = JSON.stringify({ type: 'LineString', coordinates: path.coordinates });
        const validated = version.validatedDaysAgo !== undefined;
        const first = index === 0;
        await client.query(
          `INSERT INTO route_versions (id, organization_id, route_id, version_number, status, geom, distance_m, ascent_m, descent_m, min_elevation_m, max_elevation_m, max_slope_pct,
                                      provenance, manually_modified, note, created_by, created_at, validated_by, validated_at)
           VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_GeomFromGeoJSON($6::text), 4326), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, ${ago(version.daysAgo)}, $17, ${
             validated ? ago(version.validatedDaysAgo!) : 'NULL'
           })`,
          [
            versionIds[index],
            orgId,
            routeId,
            index + 1,
            validated ? 'validated' : 'draft',
            geometry,
            metrics.distanceM,
            metrics.ascentM,
            metrics.descentM,
            metrics.minElevationM,
            metrics.maxElevationM,
            metrics.maxSlopePct,
            first && !derived ? 'imported' : 'edited',
            !(first && !derived),
            version.note ?? null,
            userId,
            validated ? userId : null,
          ],
        );
        for (const segment of path.segments) {
          await client.query(
            `INSERT INTO route_segments (organization_id, version_id, position, geom, road_type, distance_m, ascent_m, descent_m)
             VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4::text), 4326), $5, $6, $7, $8)`,
            [orgId, versionIds[index], segment.position, geometry, segment.roadType, segment.distanceM, segment.ascentM, segment.descentM],
          );
        }
        if (first && derived) {
          await audit('route_derived', version.daysAgo, { name: route.name, versionNumber: 1, fromRouteId: derived.routeId, fromVersionNumber: derived.versionNumber, geometryChanged: true });
        } else if (first) {
          await audit('route_created', version.daysAgo, { name: route.name, versionNumber: 1, source: 'import' });
        } else {
          await audit('route_version_created', version.daysAgo, { name: route.name, versionNumber: index + 1, baseVersionNumber: index });
        }
        if (validated) await audit('route_version_validated', version.validatedDaysAgo!, { name: route.name, versionNumber: index + 1 });
      }
      if (route.archived) await audit('route_archived', 0, { name: route.name });
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

/**
 * The routes of the demo missions (H4-T7, P1): what `addMissionRoutes` and `updateMissionRoute` would have left, as `onway_owner`, with the same
 * lines of the history (`route_added`, and `route_marked_unavailable` for an unavailable one, INV-16). The pinned version is the last validated one
 * unless the file says otherwise (D-H4-01). Idempotent per mission and route (INV-13). A mission or a route that is not there yet (no elevation source
 * covered it, and the seed already warned) is left for a later run, without a second warning.
 */
async function seedMissionRoutes(pool: pg.Pool, orgId: string, demo: Demo, _options: SeedOptions): Promise<number> {
  let created = 0;
  for (const mission of demo.missions) {
    for (const placed of mission.routes) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [MISSION_ROUTES_LOCK]);
        const found = await client.query<{ mission_id: string; route_id: string; name: string }>(
          `SELECT m.id AS mission_id, r.id AS route_id, r.name
             FROM missions m, routes r
            WHERE m.organization_id = $1 AND lower(m.name) = lower($2) AND r.organization_id = $1 AND lower(r.name) = lower($3)`,
          [orgId, mission.name, placed.route],
        );
        const target = found.rows[0];
        if (!target) {
          await client.query('ROLLBACK');
          continue;
        }
        const present = await client.query(`SELECT 1 FROM mission_routes WHERE mission_id = $1 AND route_id = $2`, [target.mission_id, target.route_id]);
        if (present.rowCount) {
          await client.query('ROLLBACK');
          continue;
        }
        const version = await client.query<{ id: string; version_number: number }>(
          placed.version === undefined
            ? `SELECT id, version_number FROM route_versions WHERE route_id = $1
                ORDER BY (status = 'validated') DESC, version_number DESC LIMIT 1`
            : `SELECT id, version_number FROM route_versions WHERE route_id = $1 AND version_number = $2`,
          placed.version === undefined ? [target.route_id] : [target.route_id, placed.version],
        );
        const pinned = version.rows[0];
        if (!pinned) {
          await client.query('ROLLBACK');
          continue;
        }
        const coordinator = demo.members.find((m) => m.key === mission.coordinator)!;
        const userId = (await client.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [coordinator.email])).rows[0]!.id;

        await client.query(
          `INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, status, added_by, added_at)
           VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
          [orgId, target.mission_id, target.route_id, pinned.id, placed.unavailable ? 'unavailable' : 'added', userId],
        );
        const audit = (action: string, detail: Record<string, unknown>) =>
          client.query(`INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, detail) VALUES ($1, 'mission', $2, $3, $4, $5)`, [
            orgId,
            target.mission_id,
            action,
            userId,
            JSON.stringify(detail),
          ]);
        await audit('route_added', { name: target.name, routeId: target.route_id, versionNumber: pinned.version_number, source: 'library' });
        if (placed.unavailable) await audit('route_marked_unavailable', { name: target.name, routeId: target.route_id });
        await client.query('COMMIT');
        created += 1;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  }
  return created;
}
