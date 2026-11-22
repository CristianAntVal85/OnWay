import { ERROR_HTTP, ErrorResponse, RescuersPage } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// listRescuers (RF-801, RN-21, rule 1, rule 2 and rule 3), against a real PostGIS. Fictitious data only.

let app: TestApp;
let fixtures: Fixtures;
let orgId: string;
let coordinator: Session;
let admin: Session;
let rescuerSession: Session;
let ana: Member;
let berto: Member;
let incomplete: Member;
let disabled: Member;
let teamId: string;
let archivedTeamId: string;

const options = { password: TEST_PASSWORD };
const rename = (member: Member, name: string) => fixtures.query(`UPDATE users SET display_name = $2 WHERE id = $1`, [member.userId, name]);
const list = (session: Session, query = '') => fetch(`${app.baseUrl}/rescuers${query}`, { headers: withSession(session, false) });
const page = async (response: Response) => {
  expect(response.status).toBe(200);
  return RescuersPage.parse(await response.json());
};

beforeAll(async () => {
  const { owner, app: connection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: connection });
  orgId = await fixtures.organization('Rescuers');
  coordinator = await mustLogin(app, (await fixtures.member(orgId, 'coordinator', 'active', options)).email, TEST_PASSWORD);
  admin = await mustLogin(app, (await fixtures.member(orgId, 'admin', 'active', options)).email, TEST_PASSWORD);
  const someone = await fixtures.member(orgId, 'rescuer', 'active', { ...options, profile: 'complete' });
  rescuerSession = await mustLogin(app, someone.email, TEST_PASSWORD);
  await rename(someone, 'Zoe Zarza');
  ana = await fixtures.member(orgId, 'rescuer', 'active', { ...options, profile: 'complete' });
  berto = await fixtures.member(orgId, 'rescuer', 'active', { ...options, profile: 'complete' });
  incomplete = await fixtures.member(orgId, 'rescuer', 'active', options);
  disabled = await fixtures.member(orgId, 'rescuer', 'disabled', { ...options, profile: 'complete' });
  await rename(ana, 'Ana Alba');
  await rename(berto, 'Berto Bruñe');
  await rename(incomplete, 'Carla Incompleta');
  await rename(disabled, 'Dani Desactivado');
  await fixtures.member(orgId, 'coordinator', 'active', options).then((m) => rename(m, 'Elena Coordinadora'));
  teamId = await fixtures.team(orgId, 'Picker');
  archivedTeamId = await fixtures.team(orgId, 'Old');
  await fixtures.addToTeam(teamId, ana);
  await fixtures.addToTeam(archivedTeamId, ana);
  await fixtures.query(`UPDATE teams SET status = 'archived' WHERE id = $1`, [archivedTeamId]);
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

describe('listRescuers (RF-801)', () => {
  it('by default offers the active rescuers with a complete profile, by name, with their active teams and nothing else', async () => {
    const response = await list(coordinator);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.clone().text();
    const result = await page(response);
    expect(result.items.map((i) => i.displayName)).toEqual(['Ana Alba', 'Berto Bruñe', 'Zoe Zarza']);
    expect(result.total).toBe(3);
    expect(result.items[0]!.teams).toEqual([{ id: teamId, name: expect.stringMatching(/^Picker/), locality: 'Locality' }]); // the archived team is not offered
    expect(result.items[1]!.teams).toEqual([]);
    expect(Object.keys(result.items[0]!).sort()).toEqual(['displayName', 'teams', 'userId']);
    expect(text).not.toMatch(/@example\.org|phone|document|address|alias|role/i);
    expect(text).not.toContain(incomplete.userId);
    expect(text).not.toContain(disabled.userId);
  });

  it('profileComplete=false also offers rescuers with an incomplete profile (still not the disabled or the staff)', async () => {
    const result = await page(await list(admin, '?profileComplete=false'));
    expect(result.items.map((i) => i.displayName)).toEqual(['Ana Alba', 'Berto Bruñe', 'Carla Incompleta', 'Zoe Zarza']);
  });

  it('searches by name ignoring case, filters by team and pages; % and _ are plain characters', async () => {
    expect((await page(await list(coordinator, '?q=BERTO'))).items.map((i) => i.userId)).toEqual([berto.userId]);
    expect((await page(await list(coordinator, `?teamId=${teamId}`))).items.map((i) => i.userId)).toEqual([ana.userId]);
    expect((await page(await list(coordinator, `?q=${encodeURIComponent('%')}`))).total).toBe(0);
    const second = await page(await list(coordinator, '?page=2&pageSize=2'));
    expect(second).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(second.items.map((i) => i.displayName)).toEqual(['Zoe Zarza']);
  });

  it('a rescuer gets 403, no session 401, and another organization sees none of these people (INV-01)', async () => {
    for (const response of [await list(rescuerSession), await fetch(`${app.baseUrl}/rescuers`)]) {
      const parsed = ErrorResponse.parse(await response.json());
      expect(parsed.error.code).toBe(response.status === 403 ? 'FORBIDDEN' : 'UNAUTHENTICATED');
      expect(response.status).toBe(response.status === 403 ? ERROR_HTTP.FORBIDDEN : ERROR_HTTP.UNAUTHENTICATED);
    }
    const otherOrg = await fixtures.organization('Rescuers other');
    const other = await mustLogin(app, (await fixtures.member(otherOrg, 'coordinator', 'active', options)).email, TEST_PASSWORD);
    expect(await page(await list(other))).toMatchObject({ items: [], total: 0 });
    expect(await page(await list(other, `?teamId=${teamId}`))).toMatchObject({ items: [], total: 0 });
  });
});
