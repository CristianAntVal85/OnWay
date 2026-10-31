import { createHash } from 'node:crypto';
import { MeResponse, MissionDetail, MissionHistoryPage, MissionsPage, MyMissionsPage } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadDemo } from '../../src/seed/demo.js';
import type { ElevationProvider } from '../../src/geo/elevation.js';
import { SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';
import { seedDemo } from '../../src/seed/seed.js';
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
const options = { elevation, warn: (message: string) => warnings.push(message) };

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
      `SELECT * FROM audit_log ORDER BY id`,
    ].map(async (query) => JSON.stringify(await fixtures.query(query))),
  );
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection });
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

describe('seed (T7: R-10, D-H0-17, D-H0-18)', () => {
  it('loads the agreed demo and a second run changes nothing', async () => {
    const { owner } = inject('database');
    const first = await seedDemo(owner, demo, options);
    expect(first).toMatchObject({ seeded: true, missions: 3 });
    orgId = first.organizationId;
    const before = await fingerprint();

    const second = await seedDemo(owner, demo, options);
    expect(second).toEqual({ seeded: false, organizationId: orgId, missions: 0 });
    expect(await fingerprint()).toBe(before);

    // Two runs at once also end with a single organization.
    await Promise.all([seedDemo(owner, demo, options), seedDemo(owner, demo, options)]);
    expect(await count(`SELECT count(*) n FROM organizations WHERE name = $1`, [demo.organization.name])).toBe(1);
    expect(await fingerprint()).toBe(before);
    expect(await count(`SELECT count(*) n FROM missions WHERE organization_id = $1`, [orgId])).toBe(3);
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
    // INV-25: the pending account holds no membership.
    expect(await count(`SELECT count(*) n FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.account_status = 'pending' AND m.organization_id = $1`, [orgId])).toBe(0);
    // No rejected, disabled or locked account in the demo (D-H0-18): those are test data only.
    expect(
      await count(`SELECT count(*) n FROM users WHERE email = ANY($1) AND (account_status IN ('rejected','disabled') OR locked_until IS NOT NULL)`, [
        [...demo.members, ...demo.applicants].map((p) => p.email),
      ]),
    ).toBe(0);
  });

  it('keeps every demo email on example.org, and rescuers incomplete with no contact and no sensitive data (D-H0-19, INV-18)', async () => {
    const emails = [...demo.members, ...demo.applicants].map((p) => p.email);
    expect(await count(`SELECT count(*) n FROM users WHERE email = ANY($1) AND email NOT LIKE '%@example.org'`, [emails])).toBe(0);
    expect(await count(`SELECT count(*) n FROM rescuer_profiles WHERE organization_id = $1 AND status = 'incomplete' AND completed_at IS NULL`, [orgId])).toBe(6);
    expect(await count(`SELECT count(*) n FROM rescuer_contact WHERE organization_id = $1`, [orgId])).toBe(0);
    expect(await count(`SELECT count(*) n FROM rescuer_sensitive WHERE organization_id = $1`, [orgId])).toBe(0);
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
    expectations.push({ key: member.key, role: member.role, nextStep: member.role === 'rescuer' ? 'complete-profile' : 'home' });
  }

  it.each(expectations)('$key logs in through the API with its role and next step', async ({ key, role, nextStep }) => {
    const member = demo.members.find((m) => m.key === key)!;
    const session = await mustLogin(app, member.email, demo.demoPassword);
    const response = await fetch(`${app.baseUrl}/auth/me`, { headers: withSession(session, false) });
    expect(response.status).toBe(200);
    const { user } = MeResponse.parse(await response.json());
    expect(user).toMatchObject({ role, nextStep, accountStatus: 'active', locale: member.locale, organization: { id: orgId, name: demo.organization.name } });
    if (role === 'rescuer') expect(user.profileStatus).toBe('incomplete');
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
      const first = await seedDemo(owner, other, { elevation: nothing, warn: (m) => messages.push(m) });
      expect(first).toMatchObject({ seeded: true, missions: 0 });
      expect(messages).toHaveLength(3);
      expect(messages[0]).toMatch(/skipped/);
      expect(await count(`SELECT count(*) n FROM missions WHERE organization_id = $1`, [first.organizationId])).toBe(0);

      const second = await seedDemo(owner, other, options);
      expect(second).toEqual({ seeded: false, organizationId: first.organizationId, missions: 3 });
      expect(await count(`SELECT count(*) n FROM missions WHERE organization_id = $1`, [first.organizationId])).toBe(3);
    });
  });
});
