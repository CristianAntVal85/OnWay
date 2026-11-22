import { createHash } from 'node:crypto';
import { MeResponse, MissionDetail, MissionHistoryPage, MissionRouteGeometry, MissionRoutesRescuer, MissionRoutesStaff, MissionsPage, MyMissionsPage } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadDemo } from '../../src/seed/demo.js';
import type { ElevationProvider } from '../../src/geo/elevation.js';
import { SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';
import { seedDemo } from '../../src/seed/seed.js';
import { randomBytes } from 'node:crypto';
import { sensitiveKeysFromSecrets } from '../../src/sensitive/config.js';
import { SensitiveCipher } from '../../src/sensitive/sensitive-cipher.js';
import { verifyPassword } from '../../src/identity/password.js';
import { login, mustLogin, startApp, withSession, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD } from '../support/fixtures.js';

// The seed runs as onway_owner on the migrated container, like the `seed` service of compose (D-H0-16, D-H0-17).
const demo = loadDemo();
let fixtures: Fixtures;
let app: TestApp;
let orgId: string;
const elevation = new SyntheticElevationProvider();
const warnings: string[] = [];
// The seed and the API share the keys of the sensitive data (D-P8): the app below gets the same ones.
const sensitive = sensitiveKeysFromSecrets(randomBytes(48), randomBytes(48));
const options = { elevation, sensitive, warn: (message: string) => warnings.push(message) };

const count = async (sql: string, values: unknown[] = []) => Number((await fixtures.query<{ n: string }>(sql, values))[0]!.n);

/** A fingerprint of every row the seed writes, to prove a second run changes nothing (ids and timestamps included). */
async function fingerprint(): Promise<string> {
  const parts = await Promise.all(
    [
      `SELECT * FROM organizations ORDER BY id`,
      `SELECT * FROM users WHERE email LIKE '%@example.org' AND email IN (${[...demo.members, ...demo.applicants].map((p) => `'${p.email}'`).join(',')}) ORDER BY id`,
      `SELECT * FROM memberships ORDER BY id`,
      `SELECT * FROM rescuer_profiles ORDER BY id`,
      `SELECT * FROM signup_requests ORDER BY id`,
      `SELECT * FROM teams ORDER BY id`,
      `SELECT * FROM team_members ORDER BY team_id, user_id`,
      `SELECT id, name, status, ST_AsEWKT(target) target, created_at, updated_at, activated_at, closed_at FROM missions ORDER BY id`,
      `SELECT id, kind, name, ST_AsEWKT(geom) geom, position FROM mission_points ORDER BY id`,
      `SELECT id, name, status, derived_from_route_id, derived_from_version_id, latest_version_id, latest_validated_version_id, created_at, updated_at FROM routes ORDER BY id`,
      `SELECT id, route_id, version_number, status, ST_AsEWKT(geom) geom, distance_m, ascent_m, descent_m, provenance, note, created_at, validated_at FROM route_versions ORDER BY id`,
      `SELECT id, version_id, position, road_type, distance_m FROM route_segments ORDER BY id`,
      `SELECT id, mission_id, route_id, pinned_version_id, origin_point_id, team_id, status, note, added_by, added_at FROM mission_routes ORDER BY id`,
      `SELECT * FROM audit_log ORDER BY id`,
    ].map(async (query) => JSON.stringify(await fixtures.query(query))),
  );
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection, sensitive });
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

describe('seed (T7: R-10, D-H0-17, D-H0-18)', () => {
  it('loads the agreed demo and a second run changes nothing', async () => {
    const { owner } = inject('database');
    const first = await seedDemo(owner, demo, options);
    expect(first).toMatchObject({ seeded: true, missions: 3, routes: 6, missionRoutes: 4, profiles: 5 });
    orgId = first.organizationId;
    const before = await fingerprint();

    const second = await seedDemo(owner, demo, options);
    expect(second).toEqual({ seeded: false, organizationId: orgId, missions: 0, routes: 0, missionRoutes: 0, profiles: 0 });
    expect(await fingerprint()).toBe(before);

    // Two runs at once also end with a single organization.
    await Promise.all([seedDemo(owner, demo, options), seedDemo(owner, demo, options)]);
    expect(await count(`SELECT count(*) n FROM organizations WHERE name = $1`, [demo.organization.name])).toBe(1);
    expect(await fingerprint()).toBe(before);
    expect(await count(`SELECT count(*) n FROM missions WHERE organization_id = $1`, [orgId])).toBe(3);
    expect(await count(`SELECT count(*) n FROM routes WHERE organization_id = $1`, [orgId])).toBe(6);
    expect(await count(`SELECT count(*) n FROM route_versions WHERE organization_id = $1`, [orgId])).toBe(9);
    expect(warnings).toEqual([]);
  });

  it('has the agreed counts, one organization only (D-H0-18)', async () => {
    expect(await count(`SELECT count(*) n FROM organizations WHERE name = $1`, [demo.organization.name])).toBe(1);
    const byRole = await fixtures.query<{ role: string; n: string }>(`SELECT role, count(*) n FROM memberships WHERE organization_id = $1 AND status = 'active' GROUP BY role`, [orgId]);
    expect(Object.fromEntries(byRole.map((r) => [r.role, Number(r.n)]))).toEqual({ admin: 1, coordinator: 2, rescuer: 6 });
    expect(await count(`SELECT count(*) n FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.organization_id = $1 AND u.locale = 'fr' AND m.role = 'coordinator'`, [orgId])).toBe(1);

    const teams = await fixtures.query<{ locality: string }>(`SELECT locality FROM teams WHERE organization_id = $1`, [orgId]);
    expect(teams).toHaveLength(4);
    expect(new Set(teams.map((t) => t.locality)).size).toBe(4);

    const perRescuer = await fixtures.query<{ teams: string }>(
      `SELECT count(tm.team_id) teams FROM memberships m LEFT JOIN team_members tm ON tm.user_id = m.user_id WHERE m.organization_id = $1 AND m.role = 'rescuer' GROUP BY m.user_id`,
      [orgId],
    );
    expect(new Set(perRescuer.map((r) => Number(r.teams)))).toEqual(new Set([0, 1, 2]));

    expect(
      await count(`SELECT count(*) n FROM signup_requests s JOIN users u ON u.id = s.user_id WHERE s.organization_id = $1 AND s.status = 'pending' AND u.account_status = 'pending'`, [orgId]),
    ).toBe(1);
    // The applicant of the demo has its own pending signup request, so the admin inbox (H5) shows it (and a second `up` adds no duplicate).
    const pendingRequests = await fixtures.query<{ email: string }>(`SELECT u.email FROM signup_requests s JOIN users u ON u.id = s.user_id WHERE s.organization_id = $1 AND s.status = 'pending'`, [
      orgId,
    ]);
    expect(pendingRequests.map((r) => r.email)).toEqual(demo.applicants.map((a) => a.email));
    expect(demo.applicants.map((a) => a.email)).toEqual(['pendiente@example.org']);
    // INV-25: the pending account holds no membership.
    expect(await count(`SELECT count(*) n FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.account_status = 'pending' AND m.organization_id = $1`, [orgId])).toBe(0);
    // No rejected, disabled or locked account in the demo (D-H0-18): those are test data only.
    expect(
      await count(`SELECT count(*) n FROM users WHERE email = ANY($1) AND (account_status IN ('rejected','disabled') OR locked_until IS NOT NULL)`, [
        [...demo.members, ...demo.applicants].map((p) => p.email),
      ]),
    ).toBe(0);
  });

  it('keeps every demo email on example.org; five rescuers complete with encrypted data and one incomplete (H5-perfil P1, INV-18, INV-24)', async () => {
    const emails = [...demo.members, ...demo.applicants].map((p) => p.email);
    expect(await count(`SELECT count(*) n FROM users WHERE email = ANY($1) AND email NOT LIKE '%@example.org'`, [emails])).toBe(0);
    expect(await count(`SELECT count(*) n FROM rescuer_profiles WHERE organization_id = $1 AND status = 'incomplete' AND completed_at IS NULL`, [orgId])).toBe(1);
    expect(await count(`SELECT count(*) n FROM rescuer_profiles WHERE organization_id = $1 AND status = 'complete' AND completed_at IS NOT NULL`, [orgId])).toBe(5);
    expect(await count(`SELECT count(*) n FROM rescuer_contact WHERE organization_id = $1`, [orgId])).toBe(5);
    expect(await count(`SELECT count(*) n FROM rescuer_sensitive WHERE organization_id = $1`, [orgId])).toBe(5);
    expect(await count(`SELECT count(DISTINCT document_hash) n FROM rescuer_sensitive WHERE organization_id = $1`, [orgId])).toBe(5);
    // Solo bytes cifrados en la base, y se descifran con las claves de la API, ligados a su perfil.
    const rows = await fixtures.query<{ profile_id: string; email: string; document_enc: Buffer; key_id: number }>(
      `SELECT s.profile_id, u.email, s.document_enc, s.key_id FROM rescuer_sensitive s JOIN rescuer_profiles p ON p.id = s.profile_id JOIN users u ON u.id = p.user_id WHERE s.organization_id = $1`,
      [orgId],
    );
    const cipher = new SensitiveCipher(sensitive);
    for (const row of rows) {
      const wanted = demo.members.find((m) => m.email === row.email)!.profile!.document.number;
      expect(row.document_enc.includes(Buffer.from(wanted))).toBe(false);
      expect(cipher.decrypt(row.profile_id, 'document', row.document_enc, row.key_id)).toBe(wanted);
    }
    expect(rows.map((r) => r.email).sort()).toEqual(
      demo.members
        .filter((m) => m.profile)
        .map((m) => m.email)
        .sort(),
    );
  });

  it('stores Argon2id hashes of the documented password, never the password itself, and a different salt per account', async () => {
    const rows = await fixtures.query<{ email: string; password_hash: string }>(`SELECT email, password_hash FROM users WHERE email = ANY($1)`, [
      [...demo.members, ...demo.applicants].map((p) => p.email),
    ]);
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
      expect(row.password_hash).not.toContain(demo.demoPassword);
    }
    expect(new Set(rows.map((r) => r.password_hash)).size).toBe(rows.length);
    expect(await verifyPassword(demo.demoPassword, rows[0]!.password_hash)).toBe(true);
    // The random invite code is not part of the repository.
    const [org] = await fixtures.query<{ invite_code: string }>(`SELECT invite_code FROM organizations WHERE id = $1`, [orgId]);
    expect(org!.invite_code).toMatch(/^DEMO-[0-9a-f]{24}$/);
  });

  const expectations: { key: string; role: string; nextStep: string }[] = [];
  for (const member of demo.members) {
    expectations.push({ key: member.key, role: member.role, nextStep: member.role === 'rescuer' && !member.profile ? 'complete-profile' : 'home' });
  }

  it.each(expectations)('$key logs in through the API with its role and next step', async ({ key, role, nextStep }) => {
    const member = demo.members.find((m) => m.key === key)!;
    const session = await mustLogin(app, member.email, demo.demoPassword);
    const response = await fetch(`${app.baseUrl}/auth/me`, { headers: withSession(session, false) });
    expect(response.status).toBe(200);
    const { user } = MeResponse.parse(await response.json());
    expect(user).toMatchObject({ role, nextStep, accountStatus: 'active', locale: member.locale, organization: { id: orgId, name: demo.organization.name } });
    if (role === 'rescuer') expect(user.profileStatus).toBe(member.profile ? 'complete' : 'incomplete');
  });

  it('the pending account logs in and only gets awaiting-approval, with no organization and no role (INV-25)', async () => {
    const applicant = demo.applicants[0]!;
    const session = await mustLogin(app, applicant.email, demo.demoPassword);
    const { user } = MeResponse.parse(await (await fetch(`${app.baseUrl}/auth/me`, { headers: withSession(session, false) })).json());
    expect(user).toMatchObject({ accountStatus: 'pending', role: null, organization: null, nextStep: 'awaiting-approval' });
    expect((await fetch(`${app.baseUrl}/org`, { headers: withSession(session, false) })).status).toBe(403);
  });

  it('a wrong password does not log in', async () => {
    expect((await login(app, demo.members[0]!.email, 'not-the-demo-password')).response.status).toBe(401);
  });

  it('organization B exists only as a test fixture: its admin logs in, and the demo data does not include it (D-H0-18, INV-01)', async () => {
    const orgB = await fixtures.organization('Org B');
    const adminB = await fixtures.member(orgB, 'admin', 'active', { password: TEST_PASSWORD });
    const session = await mustLogin(app, adminB.email, TEST_PASSWORD);
    const { user } = MeResponse.parse(await (await fetch(`${app.baseUrl}/auth/me`, { headers: withSession(session, false) })).json());
    expect(user).toMatchObject({ role: 'admin', nextStep: 'home', organization: { id: orgB } });
    expect(user.organization?.id).not.toBe(orgId);
    // demo.json names one organization; the seed never creates a second one.
    expect(Object.keys(demo)).not.toContain('organizations');
    expect(await count(`SELECT count(*) n FROM organizations WHERE id = $1 AND name = $2`, [orgB, demo.organization.name])).toBe(0);
  });

  describe('demo missions (P4 b, RN-07, INV-16)', () => {
    const missionRows = () =>
      fixtures.query<{ id: string; name: string; status: string; elevation: number; activated_at: Date | null; closed_at: Date | null; coordinator_email: string }>(
        `SELECT m.id, m.name, m.status::text, ST_Z(m.target) elevation, m.activated_at, m.closed_at, u.email coordinator_email
           FROM missions m JOIN users u ON u.id = m.coordinator_id WHERE m.organization_id = $1 ORDER BY m.name`,
        [orgId],
      );

    it('has one fictitious mission per state, each in its place, with the altitude of the configured ElevationProvider', async () => {
      const rows = await missionRows();
      expect(rows.map((r) => r.status).sort()).toEqual(['active', 'closed', 'planning']);
      for (const row of rows) {
        const wanted = demo.missions.find((m) => m.name === row.name)!;
        expect(row.name).toMatch(/ficticio/i);
        expect(row.status).toBe(wanted.status);
        expect(row.elevation).toBe(await elevation.elevationAt(wanted.target));
        expect(row.coordinator_email).toBe(demo.members.find((m) => m.key === wanted.coordinator)!.email);
        expect(row.activated_at !== null).toBe(wanted.status !== 'planning');
        expect(row.closed_at !== null).toBe(wanted.status === 'closed');
      }
      // Participations arrive with H6: the closed one has none.
      expect(await count(`SELECT count(*) n FROM participations WHERE organization_id = $1`, [orgId])).toBe(0);
    });

    it('the active one has an origin, an intermediate and a rendezvous point, each with its altitude and position', async () => {
      const active = demo.missions.find((m) => m.status === 'active')!;
      const points = await fixtures.query<{ kind: string; name: string; elevation: number; position: number }>(
        `SELECT p.kind::text, p.name, ST_Z(p.geom) elevation, p.position FROM mission_points p JOIN missions m ON m.id = p.mission_id WHERE m.organization_id = $1 AND m.name = $2 ORDER BY p.kind`,
        [orgId, active.name],
      );
      expect(points.map((p) => p.kind).sort()).toEqual(['origin', 'rendezvous', 'waypoint']);
      for (const point of points) {
        expect(point.position).toBe(0);
        expect(point.elevation).toBe(await elevation.elevationAt(active.points.find((p) => p.name === point.name)!));
      }
    });

    it('every mission has its mission_created row in the history, written by its coordinator (INV-16)', async () => {
      const rows = await fixtures.query<{ name: string; action: string; actor_email: string }>(
        `SELECT m.name, a.action, u.email actor_email FROM audit_log a JOIN missions m ON m.id = a.entity_id JOIN users u ON u.id = a.actor_user_id
          WHERE a.organization_id = $1 AND a.entity_type = 'mission' ORDER BY a.id`,
        [orgId],
      );
      for (const mission of demo.missions) {
        const own = rows.filter((r) => r.name === mission.name);
        expect(own.filter((r) => r.action === 'mission_created')).toHaveLength(1);
        expect(own[0]!.action).toBe('mission_created');
        expect(own.some((r) => r.action === 'mission_activated')).toBe(mission.status !== 'planning');
        expect(own.some((r) => r.action === 'mission_closed')).toBe(mission.status === 'closed');
        expect(new Set(own.map((r) => r.actor_email))).toEqual(new Set([demo.members.find((m) => m.key === mission.coordinator)!.email]));
      }
    });

    it('shows through the API: the coordinator lists and reads them, with a history; the rescuer sees only the active and the closed (RN-16)', async () => {
      const coordinator = demo.members.find((m) => m.key === 'coordinator-es')!;
      const staff = await mustLogin(app, coordinator.email, demo.demoPassword);
      const list = MissionsPage.parse(await (await fetch(`${app.baseUrl}/missions?pageSize=50`, { headers: withSession(staff, false) })).json());
      expect(list.items.map((m) => m.name).sort()).toEqual(demo.missions.map((m) => m.name).sort());

      const active = demo.missions.find((m) => m.status === 'active')!;
      const id = list.items.find((m) => m.name === active.name)!.id;
      const detail = MissionDetail.parse(await (await fetch(`${app.baseUrl}/missions/${id}`, { headers: withSession(staff, false) })).json());
      expect(detail.points.map((p) => p.kind).sort()).toEqual(['origin', 'rendezvous', 'waypoint']);
      expect(detail.target.elevationM).toBe(await elevation.elevationAt(active.target));
      const history = MissionHistoryPage.parse(await (await fetch(`${app.baseUrl}/missions/${id}/history`, { headers: withSession(staff, false) })).json());
      expect(history.items.map((h) => h.action)).toContain('mission_created');

      const rescuer = demo.members.find((m) => m.role === 'rescuer')!;
      const rescuerSession = await mustLogin(app, rescuer.email, demo.demoPassword);
      const mine = MyMissionsPage.parse(await (await fetch(`${app.baseUrl}/my/missions`, { headers: withSession(rescuerSession, false) })).json());
      expect(mine.items.map((m) => m.name).sort()).toEqual(
        demo.missions
          .filter((m) => m.status !== 'planning')
          .map((m) => m.name)
          .sort(),
      );
    });

    it('a stack seeded before the missions existed gains them on the next run, and a mission with no elevation source is skipped with a warning until it has one', async () => {
      const { owner } = inject('database');
      const other = {
        ...demo,
        organization: { ...demo.organization, name: 'Servicio de prueba del catch-up' },
        members: demo.members.map((m) => ({ ...m, email: `catchup-${m.email}` })),
        applicants: demo.applicants.map((a) => ({ ...a, email: `catchup-${a.email}` })),
        missions: demo.missions.map((m) => ({ ...m, name: `${m.name} (catch-up)` })),
      };
      const nothing: ElevationProvider = { elevationAt: async () => null, elevationsAt: async (points) => points.map(() => null) };
      const messages: string[] = [];
      const first = await seedDemo(owner, other, { elevation: nothing, sensitive, warn: (m) => messages.push(m) });
      expect(first).toMatchObject({ seeded: true, missions: 0, routes: 0, missionRoutes: 0 });
      expect(messages).toHaveLength(9); // the routes of a mission that was skipped add no warning of their own
      expect(messages[0]).toMatch(/skipped/);
      expect(await count(`SELECT count(*) n FROM missions WHERE organization_id = $1`, [first.organizationId])).toBe(0);

      const second = await seedDemo(owner, other, options);
      expect(second).toEqual({ seeded: false, organizationId: first.organizationId, missions: 3, routes: 6, missionRoutes: 4, profiles: 0 });
      expect(await count(`SELECT count(*) n FROM missions WHERE organization_id = $1`, [first.organizationId])).toBe(3);
      expect(await count(`SELECT count(*) n FROM routes WHERE organization_id = $1`, [first.organizationId])).toBe(6);
    });
  });

  describe('demo routes (P6, RN-10, INV-04, INV-16)', () => {
    const byName = (name: string) =>
      fixtures.query<{ id: string; status: string; latest_version_id: string; latest_validated_version_id: string | null; derived_from_route_id: string | null }>(
        `SELECT id, status::text AS status, latest_version_id, latest_validated_version_id, derived_from_route_id FROM routes WHERE organization_id = $1 AND name = $2`,
        [orgId, name],
      );
    const versions = (routeId: string) =>
      fixtures.query<{ version_number: number; status: string; provenance: string; distance_m: string; validated_by: string | null; created_at: Date; validated_at: Date | null }>(
        `SELECT version_number, status::text AS status, provenance::text AS provenance, distance_m::text AS distance_m, validated_by, created_at, validated_at FROM route_versions WHERE route_id = $1 ORDER BY version_number`,
        [routeId],
      );

    it('has the six routes of the agreement: one validated version, three versions, a Draft newer than the validated one, a copy, an archived one and a validation older than 90 days', async () => {
      const names = demo.routes.map((r) => r.name);
      expect(names).toHaveLength(6);
      const shape = [];
      for (const name of names) {
        const [route] = await byName(name);
        const all = await versions(route!.id);
        shape.push({ name, status: route!.status, versions: all.map((v) => v.status), derived: route!.derived_from_route_id !== null });
      }
      expect(shape.map((s) => [s.status, s.versions, s.derived])).toEqual([
        ['active', ['validated'], false],
        ['active', ['validated', 'validated', 'validated'], false],
        ['active', ['validated', 'draft'], false],
        ['active', ['draft'], true],
        ['archived', ['validated'], false],
        ['active', ['validated'], false],
      ]);
    });

    it('measures every version with the server’s altitudes and the same service as the API (RN-10): the stored line has no altitude from the file', async () => {
      const [route] = await byName(demo.routes[0]!.name);
      const [version] = await versions(route!.id);
      expect(Number(version!.distance_m)).toBeGreaterThan(1000);
      expect(version!.provenance).toBe('imported');
      const points = await fixtures.query<{ lon: number; lat: number; z: number }>(
        `SELECT ST_X((dp).geom) lon, ST_Y((dp).geom) lat, ST_Z((dp).geom) z FROM (SELECT ST_DumpPoints(geom) dp FROM route_versions WHERE route_id = $1) t LIMIT 20`,
        [route!.id],
      );
      for (const point of points) expect(point.z).toBe(await elevation.elevationAt({ lat: point.lat, lon: point.lon }));
    });

    it('points `latest_*` at the right versions, validated by a coordinator, and leaves the original of the copy as it was', async () => {
      const [circo] = await byName('Senda del Circo (ficticia)');
      expect(circo!.latest_validated_version_id).toBe(circo!.latest_version_id);
      const [collado] = await byName('Collado con borrador nuevo (ficticia)');
      expect(collado!.latest_validated_version_id).not.toBe(collado!.latest_version_id);
      const [variant] = await byName('Variante de la Pradera (ficticia)');
      const [pradera] = await byName('Pradera a la Brecha (ficticia)');
      expect(variant!.derived_from_route_id).toBe(pradera!.id);
      expect(variant!.latest_validated_version_id).toBeNull();
      const coordinators = await fixtures.query<{ id: string }>(`SELECT user_id AS id FROM memberships WHERE organization_id = $1 AND role = 'coordinator'`, [orgId]);
      for (const row of await versions(pradera!.id)) expect(coordinators.map((c) => c.id)).toContain(row.validated_by);
    });

    it('writes an audit row per route action, by its coordinator (INV-16)', async () => {
      const [circo] = await byName('Senda del Circo (ficticia)');
      const rows = await fixtures.query<{ action: string; actor: string }>(`SELECT action, actor_user_id AS actor FROM audit_log WHERE entity_type = 'route' AND entity_id = $1 ORDER BY id`, [
        circo!.id,
      ]);
      expect(rows.map((r) => r.action)).toEqual(['route_created', 'route_version_validated', 'route_version_created', 'route_version_validated', 'route_version_created', 'route_version_validated']);
      const [old] = await byName('Camino antiguo (ficticia)');
      expect((await fixtures.query<{ action: string }>(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id`, [old!.id])).map((r) => r.action)).toEqual([
        'route_created',
        'route_version_validated',
        'route_archived',
      ]);
      expect(await count(`SELECT count(*) n FROM audit_log WHERE organization_id = $1 AND entity_type = 'route'`, [orgId])).toBe(17);
    });
  });

  describe('routes in the demo mission (H4-T7, P1, INV-05, INV-13, INV-16)', () => {
    const active = () => demo.missions.find((m) => m.status === 'active')!;
    const rows = () =>
      fixtures.query<{ mission: string; route: string; version_number: number; version_status: string; status: string; origin_point_id: string | null; team_id: string | null; actor_email: string }>(
        `SELECT m.name mission, r.name route, v.version_number, v.status::text version_status, mr.status::text status, mr.origin_point_id, mr.team_id, u.email actor_email
           FROM mission_routes mr JOIN missions m ON m.id = mr.mission_id JOIN routes r ON r.id = mr.route_id JOIN route_versions v ON v.id = mr.pinned_version_id JOIN users u ON u.id = mr.added_by
          WHERE mr.organization_id = $1 ORDER BY r.name`,
        [orgId],
      );

    it('puts four routes in the active mission and nowhere else: a validated one, one validated and unavailable, one whose pinned version is a Draft, and one pinned two versions behind', async () => {
      const found = await rows();
      expect(found).toHaveLength(4);
      expect(new Set(found.map((r) => r.mission))).toEqual(new Set([active().name]));
      expect(found.map((r) => [r.route, r.version_number, r.version_status, r.status])).toEqual([
        ['Collado con borrador nuevo (ficticia)', 1, 'validated', 'unavailable'],
        ['Pradera a la Brecha (ficticia)', 1, 'validated', 'added'],
        ['Senda del Circo (ficticia)', 2, 'validated', 'added'],
        ['Variante de la Pradera (ficticia)', 1, 'draft', 'added'],
      ]);
      // Like the application would leave them: no origin or team chosen, added by the coordinator in charge of the mission.
      for (const row of found) {
        expect(row.origin_point_id).toBeNull();
        expect(row.team_id).toBeNull();
        expect(row.actor_email).toBe(demo.members.find((m) => m.key === active().coordinator)!.email);
      }
    });

    it('leaves the three missions and the six routes as they were (no new versions, no status change)', async () => {
      expect(await count(`SELECT count(*) n FROM missions WHERE organization_id = $1`, [orgId])).toBe(3);
      expect(await count(`SELECT count(*) n FROM routes WHERE organization_id = $1`, [orgId])).toBe(6);
      expect(await count(`SELECT count(*) n FROM route_versions WHERE organization_id = $1`, [orgId])).toBe(9);
      expect(await count(`SELECT count(*) n FROM routes WHERE organization_id = $1 AND status = 'archived'`, [orgId])).toBe(1);
      expect(await count(`SELECT count(*) n FROM missions WHERE organization_id = $1 AND status = 'active'`, [orgId])).toBe(1);
    });

    it('writes the history the application writes, one line per route and one more for the unavailable one, by the coordinator (INV-16)', async () => {
      const lines = await fixtures.query<{ action: string; name: string; versionNumber: number | null }>(
        `SELECT a.action, a.detail->>'name' AS name, (a.detail->>'versionNumber')::int AS "versionNumber"
           FROM audit_log a JOIN missions m ON m.id = a.entity_id WHERE a.organization_id = $1 AND a.entity_type = 'mission' AND m.name = $2 AND a.action LIKE 'route_%' ORDER BY a.id`,
        [orgId, active().name],
      );
      expect(
        lines
          .filter((l) => l.action === 'route_added')
          .map((l) => [l.name, l.versionNumber])
          .sort(),
      ).toEqual([
        ['Collado con borrador nuevo (ficticia)', 1],
        ['Pradera a la Brecha (ficticia)', 1],
        ['Senda del Circo (ficticia)', 2],
        ['Variante de la Pradera (ficticia)', 1],
      ]);
      expect(lines.filter((l) => l.action === 'route_marked_unavailable').map((l) => l.name)).toEqual(['Collado con borrador nuevo (ficticia)']);
      expect(lines).toHaveLength(5);
      const strangers = await count(`SELECT count(*) n FROM audit_log a JOIN users u ON u.id = a.actor_user_id WHERE a.organization_id = $1 AND a.action LIKE 'route_added' AND u.email <> $2`, [
        orgId,
        demo.members.find((m) => m.key === active().coordinator)!.email,
      ]);
      expect(strangers).toBe(0);
    });

    it('shows through the API: the coordinator reads all four, with the notice of the newer version; the rescuer reads three, one marked unavailable, and never the Draft (INV-05)', async () => {
      const id = (await fixtures.query<{ id: string }>(`SELECT id FROM missions WHERE organization_id = $1 AND name = $2`, [orgId, active().name]))[0]!.id;
      const coordinator = await mustLogin(app, demo.members.find((m) => m.key === 'coordinator-es')!.email, demo.demoPassword);
      const staff = MissionRoutesStaff.parse(await (await fetch(`${app.baseUrl}/missions/${id}/routes`, { headers: withSession(coordinator, false) })).json()).items;
      expect(staff.map((r) => r.name).sort()).toEqual(['Collado con borrador nuevo (ficticia)', 'Pradera a la Brecha (ficticia)', 'Senda del Circo (ficticia)', 'Variante de la Pradera (ficticia)']);
      const circo = staff.find((r) => r.name.startsWith('Senda'))!;
      expect(circo).toMatchObject({ pinned: { number: 2, status: 'validated' }, newerValidatedVersion: { number: 3 }, status: 'added' });
      expect(staff.find((r) => r.name.startsWith('Variante'))).toMatchObject({ pinned: { number: 1, status: 'draft' }, newerValidatedVersion: null });
      expect(staff.find((r) => r.name.startsWith('Collado'))).toMatchObject({ status: 'unavailable', pinned: { number: 1, status: 'validated' }, newerValidatedVersion: null });
      expect(staff.find((r) => r.name.startsWith('Pradera'))).toMatchObject({ status: 'added', validationIsStale: false });

      const rescuer = await mustLogin(app, demo.members.find((m) => m.role === 'rescuer')!.email, demo.demoPassword);
      const mine = MissionRoutesRescuer.parse(await (await fetch(`${app.baseUrl}/my/missions/${id}/routes`, { headers: withSession(rescuer, false) })).json()).items;
      expect(mine.map((r) => [r.name, r.versionNumber, r.status]).sort()).toEqual([
        ['Collado con borrador nuevo (ficticia)', 1, 'unavailable'],
        ['Pradera a la Brecha (ficticia)', 1, 'added'],
        ['Senda del Circo (ficticia)', 2, 'added'],
      ]);
      // The rescuer reads the pinned version 2 of the route, not the validated version 3.
      const geometry = await fetch(`${app.baseUrl}/my/missions/${id}/routes/${mine.find((r) => r.name.startsWith('Senda'))!.id}/geometry`, { headers: withSession(rescuer, false) });
      expect(MissionRouteGeometry.parse(await geometry.json()).versionNumber).toBe(2);
      const draft = staff.find((r) => r.name.startsWith('Variante'))!;
      expect((await fetch(`${app.baseUrl}/my/missions/${id}/routes/${draft.id}/geometry`, { headers: withSession(rescuer, false) })).status).toBe(404);
    });

    it('a stack seeded before H4 gains the four on the next run, and does not repeat them', async () => {
      const { owner } = inject('database');
      // The same demo as before H4: missions and routes, none of the missions with routes in it. An audit row is append-only, so this is a second organization.
      const old = {
        ...demo,
        organization: { ...demo.organization, name: 'Servicio de prueba anterior a H4' },
        members: demo.members.map((m) => ({ ...m, email: `h3-${m.email}` })),
        applicants: demo.applicants.map((a) => ({ ...a, email: `h3-${a.email}` })),
        missions: demo.missions.map((m) => ({ ...m, name: `${m.name} (antes de H4)`, routes: [] })),
        routes: demo.routes.map((r) => ({ ...r, name: `${r.name} (antes de H4)`, derivedFrom: r.derivedFrom && { ...r.derivedFrom, route: `${r.derivedFrom.route} (antes de H4)` } })),
      };
      const first = await seedDemo(owner, old, options);
      expect(first).toMatchObject({ seeded: true, missions: 3, routes: 6, missionRoutes: 0 });
      expect(await count(`SELECT count(*) n FROM mission_routes WHERE organization_id = $1`, [first.organizationId])).toBe(0);

      const withRoutes = {
        ...old,
        missions: old.missions.map((m, index) => ({
          ...m,
          routes: demo.missions[index]!.routes.map((r) => ({ ...r, route: `${r.route} (antes de H4)` })),
        })),
      };
      const again = await seedDemo(owner, withRoutes, options);
      expect(again).toEqual({ seeded: false, organizationId: first.organizationId, missions: 0, routes: 0, missionRoutes: 4, profiles: 0 });
      expect(await count(`SELECT count(*) n FROM mission_routes WHERE organization_id = $1`, [first.organizationId])).toBe(4);
      expect(await count(`SELECT count(*) n FROM audit_log WHERE organization_id = $1 AND action IN ('route_added', 'route_marked_unavailable')`, [first.organizationId])).toBe(5);
      expect((await seedDemo(owner, withRoutes, options)).missionRoutes).toBe(0);
      expect(await count(`SELECT count(*) n FROM mission_routes WHERE organization_id = $1`, [first.organizationId])).toBe(4);
    });
  });
});
