import { randomUUID } from 'node:crypto';
import { ERROR_HTTP, ErrorResponse, TeamDetail, TeamsPage } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// RF-801, INV-23, Q-12, D-E4 to D-E6, RN-21, rule 1 (INV-01), rule 2 and rule 3, against a real PostGIS.

let app: TestApp;
let fixtures: Fixtures;

interface Org {
  orgId: string;
  admin: Member;
  coordinator: Member;
  rescuer: Member;
  adminSession: Session;
  coordinatorSession: Session;
  rescuerSession: Session;
}

const options = { password: TEST_PASSWORD };
async function organization(label: string): Promise<Org> {
  const orgId = await fixtures.organization(label);
  const admin = await fixtures.member(orgId, 'admin', 'active', options);
  const coordinator = await fixtures.member(orgId, 'coordinator', 'active', options);
  const rescuer = await fixtures.member(orgId, 'rescuer', 'active', { ...options, profile: 'complete' });
  return {
    orgId,
    admin,
    coordinator,
    rescuer,
    adminSession: await mustLogin(app, admin.email, TEST_PASSWORD),
    coordinatorSession: await mustLogin(app, coordinator.email, TEST_PASSWORD),
    rescuerSession: await mustLogin(app, rescuer.email, TEST_PASSWORD),
  };
}
const rename = (member: Member, name: string) => fixtures.query(`UPDATE users SET display_name = $2 WHERE id = $1`, [member.userId, name]);
const aliasOf = async (member: Member) => (await fixtures.query<{ alias: string | null }>(`SELECT alias FROM memberships WHERE user_id = $1`, [member.userId]))[0]!.alias;

const get = (session: Session, path: string) => fetch(`${app.baseUrl}${path}`, { headers: withSession(session, false) });
const send = (session: Session, method: string, path: string, body?: unknown) =>
  fetch(`${app.baseUrl}${path}`, { method, headers: { ...withSession(session), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function expectError(response: Response, code: keyof typeof ERROR_HTTP) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed;
}
const detail = async (response: Response, status = 200) => {
  expect(response.status).toBe(status);
  return TeamDetail.parse(await response.json());
};
const created = (session: Session, body: { name: string; locality: string; code: string }) => send(session, 'POST', '/teams', body);
const audit = (teamId: string, action: string) =>
  fixtures.query<{ detail: Record<string, unknown>; actor_user_id: string }>(`SELECT detail, actor_user_id FROM audit_log WHERE entity_id = $1 AND action = $2 ORDER BY id`, [teamId, action]);

beforeAll(async () => {
  const { owner, app: connection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: connection });
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

describe('createTeam (RF-801, INV-23)', () => {
  let org: Org;
  beforeAll(async () => {
    org = await organization('TeamsCreate');
  });

  it('the coordinator and the administrator create a team with name, locality and code, and the audit has no name', async () => {
    const team = await detail(await created(org.coordinatorSession, { name: 'Rescate Alicante', locality: 'Alicante', code: 'ALC' }), 201);
    expect(team).toMatchObject({ name: 'Rescate Alicante', locality: 'Alicante', code: 'ALC', status: 'active', memberCount: 0, members: [] });
    const other = await detail(await created(org.adminSession, { name: 'Rescate Benasque', locality: 'Benasque', code: 'BNS' }), 201);
    expect(other.code).toBe('BNS');

    const [row] = await audit(team.id, 'team_created');
    expect(row!.actor_user_id).toBe(org.coordinator.userId);
    expect(JSON.stringify(row!.detail)).not.toMatch(/Alicante|Rescate/);
    expect(row!.detail).toEqual({ fields: ['name', 'locality', 'code'] });
  });

  it('a name or a code that already exists in the organization is DUPLICATE_NAME with the field, and another organization can repeat them', async () => {
    await detail(await created(org.coordinatorSession, { name: 'Uno', locality: 'Jaca', code: 'JCA' }), 201);
    const sameName = await expectError(await created(org.coordinatorSession, { name: 'UNO', locality: 'Jaca', code: 'JC2' }), 'DUPLICATE_NAME');
    expect(sameName.error.details).toEqual({ field: 'name' });
    const sameCode = await expectError(await created(org.adminSession, { name: 'Dos', locality: 'Jaca', code: 'JCA' }), 'DUPLICATE_NAME');
    expect(sameCode.error.details).toEqual({ field: 'code' });

    const foreign = await organization('TeamsCreateOther');
    await detail(await created(foreign.coordinatorSession, { name: 'Uno', locality: 'Jaca', code: 'JCA' }), 201);
  });

  it('INV-23: a team without locality or with a bad code is rejected', async () => {
    for (const body of [
      { name: 'Sin sitio', locality: '  ', code: 'SSS' },
      { name: 'Sin sitio', code: 'SSS' },
      { name: 'Sin codigo', locality: 'Huesca' },
      { name: 'Codigo corto', locality: 'Huesca', code: 'HS' },
      { name: 'Codigo minuscula', locality: 'Huesca', code: 'hsc' },
    ]) {
      await expectError(await send(org.coordinatorSession, 'POST', '/teams', body), 'VALIDATION_FAILED');
    }
  });

  it('the rescuer gets 403 and writes nothing (rule 2)', async () => {
    await expectError(await created(org.rescuerSession, { name: 'Intruso', locality: 'X', code: 'INT' }), 'FORBIDDEN');
    expect(await fixtures.query(`SELECT 1 FROM teams WHERE organization_id = $1 AND name = 'Intruso'`, [org.orgId])).toHaveLength(0);
  });
});

describe('listTeams and getTeam (RF-801, D-34, INV-01)', () => {
  let org: Org;
  let other: Org;
  let alicante: string;
  let archived: string;

  beforeAll(async () => {
    org = await organization('TeamsList');
    other = await organization('TeamsListOther');
    alicante = (await detail(await created(org.coordinatorSession, { name: 'Zeta Alicante', locality: 'Alicante', code: 'ALC' }), 201)).id;
    await detail(await created(org.coordinatorSession, { name: 'beta Biescas', locality: 'Biescas', code: 'BSC' }), 201);
    archived = (await detail(await created(org.coordinatorSession, { name: 'Alfa Torla_50%', locality: 'Torla', code: 'TRL' }), 201)).id;
    await detail(await send(org.coordinatorSession, 'PATCH', `/teams/${archived}`, { status: 'archived' }));
    await detail(await created(other.coordinatorSession, { name: 'Ajeno', locality: 'Ajena', code: 'AJN' }), 201);
    const members = [org.rescuer, await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' }), await fixtures.member(org.orgId, 'rescuer', 'disabled')];
    await detail(await send(org.coordinatorSession, 'POST', `/teams/${alicante}/members`, { userIds: [members[0]!.userId, members[1]!.userId] }));
    // A disabled person who belonged before does not count.
    await fixtures.query(`INSERT INTO team_members (team_id, user_id, organization_id) VALUES ($1, $2, $3)`, [alicante, members[2]!.userId, org.orgId]);
  });

  it('lists the teams of the organization by name, with the code and the active members, and nothing of another organization', async () => {
    const result = TeamsPage.parse(await (await get(org.adminSession, '/teams?pageSize=50')).json());
    expect(result.total).toBe(3);
    expect(result.items.map((i) => i.name)).toEqual(['Alfa Torla_50%', 'beta Biescas', 'Zeta Alicante']);
    expect(result.items.find((i) => i.id === alicante)).toEqual({ id: alicante, name: 'Zeta Alicante', locality: 'Alicante', code: 'ALC', status: 'active', memberCount: 2 });
    expect(JSON.stringify(result)).not.toMatch(/Ajeno/);
  });

  it('filters by status, searches by name or locality with the wildcards taken literally, and paginates', async () => {
    const names = async (query: string) => TeamsPage.parse(await (await get(org.coordinatorSession, `/teams${query}`)).json()).items.map((i) => i.name);
    expect(await names('?status=archived')).toEqual(['Alfa Torla_50%']);
    expect(await names('?status=active&pageSize=50')).toEqual(['beta Biescas', 'Zeta Alicante']);
    expect(await names('?q=alican')).toEqual(['Zeta Alicante']);
    expect(await names('?q=BIESCAS')).toEqual(['beta Biescas']);
    expect(await names(`?q=${encodeURIComponent('a_50%')}`)).toEqual(['Alfa Torla_50%']);
    expect(await names(`?q=${encodeURIComponent('a%50')}`)).toEqual([]);
    const first = TeamsPage.parse(await (await get(org.coordinatorSession, '/teams?pageSize=2')).json());
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(first.items).toHaveLength(2);
    expect(TeamsPage.parse(await (await get(org.coordinatorSession, '/teams?pageSize=2&page=2')).json()).items).toHaveLength(1);
  });

  it('the detail lists the active members by name and carries no contact data (RN-21)', async () => {
    await rename(org.rescuer, 'Zoe Miembro');
    const team = await detail(await get(org.coordinatorSession, `/teams/${alicante}`));
    expect(team.members.map((m) => m.displayName)).toEqual(['Fictitious rescuer', 'Zoe Miembro']);
    expect(team.memberCount).toBe(2);
    for (const member of team.members) expect(Object.keys(member).sort()).toEqual(['displayName', 'id']);
    expect(JSON.stringify(team)).not.toMatch(/@example|phone|email/);
  });

  it('the rescuer gets 403 in both reads (rule 2), and a team of another organization is 404 (INV-01)', async () => {
    await expectError(await get(org.rescuerSession, '/teams'), 'FORBIDDEN');
    await expectError(await get(org.rescuerSession, `/teams/${alicante}`), 'FORBIDDEN');
    await expectError(await get(other.coordinatorSession, `/teams/${alicante}`), 'NOT_FOUND');
    await expectError(await get(org.coordinatorSession, `/teams/${randomUUID()}`), 'NOT_FOUND');
  });
});

describe('updateTeam: edit, archive, reactivate (RF-801, D-E5, D-E6)', () => {
  let org: Org;
  let other: Org;
  let team: string;

  beforeAll(async () => {
    org = await organization('TeamsUpdate');
    other = await organization('TeamsUpdateOther');
    team = (await detail(await created(org.coordinatorSession, { name: 'Editable', locality: 'Huesca', code: 'HSC' }), 201)).id;
    await detail(await created(org.coordinatorSession, { name: 'Ocupado', locality: 'Jaca', code: 'JCA' }), 201);
  });

  it('edits the fields that arrive and leaves the rest; the audit has the names of the fields and not their values', async () => {
    const changed = await detail(await send(org.adminSession, 'PATCH', `/teams/${team}`, { locality: 'Huesca capital', code: 'HSX' }));
    expect(changed).toMatchObject({ name: 'Editable', locality: 'Huesca capital', code: 'HSX' });
    const [row] = await audit(team, 'team_updated');
    expect(row!.detail).toEqual({ fields: ['locality', 'code'] });
    expect(row!.actor_user_id).toBe(org.admin.userId);
    expect(JSON.stringify(row!.detail)).not.toMatch(/Huesca/);
  });

  it('a name or a code of another team is DUPLICATE_NAME with the field; the same values on the same team are fine', async () => {
    expect((await expectError(await send(org.coordinatorSession, 'PATCH', `/teams/${team}`, { name: 'ocupado' }), 'DUPLICATE_NAME')).error.details).toEqual({ field: 'name' });
    expect((await expectError(await send(org.coordinatorSession, 'PATCH', `/teams/${team}`, { code: 'JCA' }), 'DUPLICATE_NAME')).error.details).toEqual({ field: 'code' });
    await detail(await send(org.coordinatorSession, 'PATCH', `/teams/${team}`, { name: 'EDITABLE', code: 'HSX' }));
  });

  it('archives and reactivates keeping the members, and the audit says the new state', async () => {
    const member = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    await detail(await send(org.coordinatorSession, 'POST', `/teams/${team}/members`, { userIds: [member.userId] }));
    const archived = await detail(await send(org.coordinatorSession, 'PATCH', `/teams/${team}`, { status: 'archived' }));
    expect(archived).toMatchObject({ status: 'archived', memberCount: 1 });
    expect((await audit(team, 'team_updated')).at(-1)!.detail).toEqual({ fields: ['status'], status: 'archived' });
    const reactivated = await detail(await send(org.coordinatorSession, 'PATCH', `/teams/${team}`, { status: 'active' }));
    expect(reactivated).toMatchObject({ status: 'active', memberCount: 1 });
  });

  it('needs a field, is refused to the rescuer, and a team of another organization or a missing one is 404', async () => {
    await expectError(await send(org.coordinatorSession, 'PATCH', `/teams/${team}`, {}), 'VALIDATION_FAILED');
    await expectError(await send(org.rescuerSession, 'PATCH', `/teams/${team}`, { name: 'Hack' }), 'FORBIDDEN');
    await expectError(await send(other.coordinatorSession, 'PATCH', `/teams/${team}`, { name: 'Hack' }), 'NOT_FOUND');
    await expectError(await send(org.coordinatorSession, 'PATCH', `/teams/${randomUUID()}`, { name: 'Hack' }), 'NOT_FOUND');
    expect((await fixtures.query<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [team]))[0]!.name).toBe('EDITABLE');
  });
});

describe('addTeamMembers and removeTeamMember (RF-801, D-E4, D-E5, RN-21)', () => {
  let org: Org;
  let other: Org;
  let team: string;
  let second: string;

  beforeAll(async () => {
    org = await organization('TeamsMembers');
    other = await organization('TeamsMembersOther');
    team = (await detail(await created(org.coordinatorSession, { name: 'Miembros', locality: 'Alicante', code: 'ALC' }), 201)).id;
    second = (await detail(await created(org.coordinatorSession, { name: 'Segundo', locality: 'Biescas', code: 'BSC' }), 201)).id;
  });

  it('adds people of any role, ignores those who already belong, and the audit has ids and counts', async () => {
    const a = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    const b = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    await rename(a, 'Ana Miembro');
    await rename(b, 'Berta Miembro');
    const first = await detail(await send(org.coordinatorSession, 'POST', `/teams/${team}/members`, { userIds: [b.userId, a.userId, a.userId, org.coordinator.userId] }));
    expect(first.members.map((m) => m.displayName)).toEqual(['Ana Miembro', 'Berta Miembro', 'Fictitious coordinator']);
    expect(first.memberCount).toBe(3);
    const again = await detail(await send(org.adminSession, 'POST', `/teams/${team}/members`, { userIds: [a.userId] }));
    expect(again.memberCount).toBe(3);
    const rows = await audit(team, 'team_members_added');
    expect(rows).toHaveLength(1); // the second call added nobody and wrote nothing
    expect(rows[0]!.detail).toEqual({ userIds: expect.arrayContaining([a.userId, b.userId, org.coordinator.userId]), count: 3 });
    expect(JSON.stringify(rows[0]!.detail)).not.toMatch(/Miembro/);
  });

  it('a person who is not an active member of the organization is VALIDATION_FAILED on userIds and nobody is added', async () => {
    const good = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    const foreign = await fixtures.member(other.orgId, 'rescuer', 'active', { profile: 'complete' });
    const disabled = await fixtures.member(org.orgId, 'rescuer', 'disabled');
    const applicant = await fixtures.applicant(org.orgId, 'pending');
    for (const bad of [foreign.userId, disabled.userId, applicant.userId, randomUUID()]) {
      const error = await expectError(await send(org.coordinatorSession, 'POST', `/teams/${team}/members`, { userIds: [good.userId, bad] }), 'VALIDATION_FAILED');
      expect(JSON.stringify(error.error.details)).toContain('userIds');
    }
    expect(await fixtures.query(`SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2`, [team, good.userId])).toHaveLength(0);
  });

  it('D-E5: an archived team admits no new members, and a team of another organization is 404', async () => {
    const archived = (await detail(await created(org.coordinatorSession, { name: 'Archivado', locality: 'Torla', code: 'TRL' }), 201)).id;
    await detail(await send(org.coordinatorSession, 'PATCH', `/teams/${archived}`, { status: 'archived' }));
    const person = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    await expectError(await send(org.coordinatorSession, 'POST', `/teams/${archived}/members`, { userIds: [person.userId] }), 'INVALID_STATE_TRANSITION');
    await expectError(await send(other.coordinatorSession, 'POST', `/teams/${team}/members`, { userIds: [person.userId] }), 'NOT_FOUND');
    await expectError(await send(org.rescuerSession, 'POST', `/teams/${team}/members`, { userIds: [person.userId] }), 'FORBIDDEN');
    await expectError(await send(org.coordinatorSession, 'POST', `/teams/${team}/members`, { userIds: [] }), 'VALIDATION_FAILED');
  });

  it('removes a member (204) and the audit says who; whoever was not a member, or another organization, is 404', async () => {
    const person = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    await detail(await send(org.coordinatorSession, 'POST', `/teams/${team}/members`, { userIds: [person.userId] }));
    await expectError(await send(other.coordinatorSession, 'DELETE', `/teams/${team}/members/${person.userId}`), 'NOT_FOUND');
    await expectError(await send(org.rescuerSession, 'DELETE', `/teams/${team}/members/${person.userId}`), 'FORBIDDEN');
    const removed = await send(org.adminSession, 'DELETE', `/teams/${team}/members/${person.userId}`);
    expect(removed.status).toBe(204);
    expect((await audit(team, 'team_member_removed')).at(-1)!.detail).toEqual({ userId: person.userId });
    await expectError(await send(org.coordinatorSession, 'DELETE', `/teams/${team}/members/${person.userId}`), 'NOT_FOUND');
    await expectError(await send(org.coordinatorSession, 'DELETE', `/teams/${team}/members/${randomUUID()}`), 'NOT_FOUND');
  });

  it('Q-36: the first team adds its code to the alias once; the second team, leaving and renaming do not change it', async () => {
    const person = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    const without = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    await fixtures.query(`UPDATE memberships SET alias = 'criantval' WHERE user_id = $1`, [person.userId]);

    await detail(await send(org.coordinatorSession, 'POST', `/teams/${team}/members`, { userIds: [person.userId, without.userId] }));
    expect(await aliasOf(person)).toBe('criantval ALC');
    expect(await aliasOf(without)).toBeNull(); // no alias yet (the profile was not completed through the app): nothing to add to

    await detail(await send(org.coordinatorSession, 'POST', `/teams/${second}/members`, { userIds: [person.userId] }));
    expect(await aliasOf(person)).toBe('criantval ALC');
    expect((await send(org.coordinatorSession, 'DELETE', `/teams/${team}/members/${person.userId}`)).status).toBe(204);
    await detail(await send(org.coordinatorSession, 'PATCH', `/teams/${second}`, { code: 'BS2' }));
    expect(await aliasOf(person)).toBe('criantval ALC');
  });

  it('a clash on the alias puts the numeric suffix before the code', async () => {
    const a = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    const b = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    const solo = (await detail(await created(org.coordinatorSession, { name: 'Choque', locality: 'Sabiñánigo', code: 'SBN' }), 201)).id;
    await fixtures.query(`UPDATE memberships SET alias = 'marsan' WHERE user_id = $1`, [a.userId]);
    await fixtures.query(`UPDATE memberships SET alias = 'marsan SBN' WHERE user_id = $1`, [org.admin.userId]);
    await detail(await send(org.coordinatorSession, 'POST', `/teams/${solo}/members`, { userIds: [a.userId, b.userId] }));
    expect(await aliasOf(a)).toBe('marsan2 SBN');
  });
});
