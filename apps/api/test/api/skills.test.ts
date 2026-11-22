// Mis cursos y habilidades (H5-habilidades T3): RF-808, RF-806, D-29, D-S4, D-S5, INV-25. Datos ficticios (regla 10).
import { ErrorResponse, FileRef, MyProfile, Skill } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DatabaseService } from '../../src/db/database.service.js';
import { InMemoryFileStorage } from '../../src/files/file-storage.js';
import { MAX_SKILLS } from '../../src/profile/skills.service.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

let app: TestApp;
let fixtures: Fixtures;
let database: DatabaseService;
let orgId: string;
let otherOrgId: string;
const storage = new InMemoryFileStorage();

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('fictitious certificate')]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection, files: { storage } });
  database = app.app.get(DatabaseService);
  orgId = await fixtures.organization('Skills A');
  otherOrgId = await fixtures.organization('Skills B');
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

const rescuer = (org = orgId) => fixtures.member(org, 'rescuer', 'active', { password: TEST_PASSWORD, profile: 'complete' });
const signIn = (member: Member) => mustLogin(app, member.email, TEST_PASSWORD);
const call = (session: Session, method: string, path: string, body?: unknown) =>
  fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { ...withSession(session, method !== 'GET'), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.error.code).toBe(code);
  return body.error;
}

async function uploadCertificate(session: Session, content: Buffer = PDF) {
  const form = new FormData();
  form.set('purpose', 'certificate');
  form.set('file', new Blob([new Uint8Array(content)]), 'certificado.bin');
  const response = await fetch(`${app.baseUrl}/files`, { method: 'POST', headers: withSession(session), body: form });
  expect(response.status).toBe(201);
  return FileRef.parse(await response.json());
}

const create = async (session: Session, body: unknown) => call(session, 'POST', '/my/skills', body);
const fileRow = async (id: string) => (await fixtures.query<{ deleted_at: Date | null; storage_key: string }>(`SELECT deleted_at, storage_key FROM files WHERE id = $1`, [id]))[0]!;
const issuesOf = (error: { details?: unknown }) => (error.details as { issues: { path: string }[] }).issues.map((i) => i.path);

describe('createMySkill and listMySkills (RF-808, D-29)', () => {
  it('a course with its certificate: 201 with hasCertificate, and the file never comes in the answer', async () => {
    const session = await signIn(await rescuer());
    const file = await uploadCertificate(session);
    const response = await create(session, {
      name: 'Primeros auxilios en montaña',
      kind: 'course',
      issuer: 'Entidad Ficticia',
      issuedOn: '2026-03-01',
      expiresOn: '2028-03-01',
      certificateFileId: file.id,
    });
    expect(response.status).toBe(201);
    const text = await response.text();
    const skill = Skill.parse(JSON.parse(text));
    expect(skill).toMatchObject({ name: 'Primeros auxilios en montaña', kind: 'course', issuer: 'Entidad Ficticia', issuedOn: '2026-03-01', expiresOn: '2028-03-01', hasCertificate: true });
    expect(text).not.toContain(file.id);
  });

  it('a skill without certificate and a course without one: hasCertificate false', async () => {
    const session = await signIn(await rescuer());
    expect(Skill.parse(await (await create(session, { name: 'Conducción 4x4', kind: 'skill' })).json())).toMatchObject({
      kind: 'skill',
      issuer: null,
      issuedOn: null,
      expiresOn: null,
      hasCertificate: false,
    });
    expect(Skill.parse(await (await create(session, { name: 'Curso sin papel', kind: 'course' })).json()).hasCertificate).toBe(false);
  });

  it('the list has the courses first and then by name, never cached, and getMyProfile.skills is the same list', async () => {
    const session = await signIn(await rescuer());
    for (const [name, kind] of [
      ['Zeta habilidad', 'skill'],
      ['Beta curso', 'course'],
      ['Alfa habilidad', 'skill'],
      ['Alfa curso', 'course'],
    ] as const)
      await create(session, { name, kind });
    const response = await call(session, 'GET', '/my/skills');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { items } = (await response.json()) as { items: unknown[] };
    expect(items.map((i) => Skill.parse(i).name)).toEqual(['Alfa curso', 'Beta curso', 'Alfa habilidad', 'Zeta habilidad']);
    const profile = MyProfile.parse(await (await call(session, 'GET', '/my/profile')).json());
    expect(profile.skills).toEqual(items);
  });

  it('only the own entries are listed', async () => {
    const [mine, theirs] = [await signIn(await rescuer()), await signIn(await rescuer())];
    await create(theirs, { name: 'De otra persona', kind: 'skill' });
    expect(await (await call(mine, 'GET', '/my/skills')).json()).toEqual({ items: [] });
  });

  it('the contract refuses what SkillInput refuses: a skill with a certificate, an expiry before its date, a blank name and unknown fields', async () => {
    const session = await signIn(await rescuer());
    const file = await uploadCertificate(session);
    const skillWithFile = await expectError(await create(session, { name: 'X', kind: 'skill', certificateFileId: file.id }), 400, 'VALIDATION_FAILED');
    expect(issuesOf(skillWithFile)).toContain('certificateFileId');
    const expiry = await expectError(await create(session, { name: 'X', kind: 'course', issuedOn: '2026-05-01', expiresOn: '2026-04-01' }), 400, 'VALIDATION_FAILED');
    expect(issuesOf(expiry)).toContain('expiresOn');
    await expectError(await create(session, { name: '  ', kind: 'course' }), 400, 'VALIDATION_FAILED');
    await expectError(await create(session, { name: 'X', kind: 'course', profileId: 'x' }), 400, 'VALIDATION_FAILED');
  });

  it('the certificate must be the own, alive and unattached: another person’s, a route import, a deleted one, one already attached and one that does not exist are VALIDATION_FAILED on certificateFileId', async () => {
    const owner = await signIn(await rescuer());
    const other = await signIn(await rescuer());
    const mine = await uploadCertificate(owner);
    const theirs = await uploadCertificate(other);
    expect(issuesOf(await expectError(await create(owner, { name: 'Ajeno', kind: 'course', certificateFileId: theirs.id }), 400, 'VALIDATION_FAILED'))).toEqual(['certificateFileId']);

    const coordinator = await fixtures.member(orgId, 'coordinator', 'active', { password: TEST_PASSWORD });
    const [route] = await fixtures.query<{ id: string }>(
      `INSERT INTO files (organization_id, purpose, content_type, size_bytes, storage_key, sha256, created_by) VALUES ($1, 'route_import', 'application/gpx+xml', 1, $2, '\\x00', $3) RETURNING id`,
      [orgId, `zz/${crypto.randomUUID()}`, coordinator.userId],
    );
    expect(issuesOf(await expectError(await create(owner, { name: 'Ruta', kind: 'course', certificateFileId: route!.id }), 400, 'VALIDATION_FAILED'))).toEqual(['certificateFileId']);

    const gone = await uploadCertificate(owner);
    await fixtures.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [gone.id]);
    expect(issuesOf(await expectError(await create(owner, { name: 'Borrado', kind: 'course', certificateFileId: gone.id }), 400, 'VALIDATION_FAILED'))).toEqual(['certificateFileId']);

    expect((await create(owner, { name: 'Primera', kind: 'course', certificateFileId: mine.id })).status).toBe(201);
    expect(issuesOf(await expectError(await create(owner, { name: 'Segunda', kind: 'course', certificateFileId: mine.id }), 400, 'VALIDATION_FAILED'))).toEqual(['certificateFileId']);
    expect(issuesOf(await expectError(await create(owner, { name: 'Falso', kind: 'course', certificateFileId: crypto.randomUUID() }), 400, 'VALIDATION_FAILED'))).toEqual(['certificateFileId']);
  });

  it(`D-S4: the entry ${MAX_SKILLS + 1} is VALIDATION_FAILED and nothing more is stored`, async () => {
    const member = await rescuer();
    const session = await signIn(member);
    await fixtures.query(
      `INSERT INTO skills (organization_id, profile_id, name, kind) SELECT $1, p.id, 'Habilidad ' || g, 'skill' FROM rescuer_profiles p, generate_series(1, $3::int) g WHERE p.user_id = $2`,
      [orgId, member.userId, MAX_SKILLS],
    );
    const error = await expectError(await create(session, { name: 'La 51', kind: 'skill' }), 400, 'VALIDATION_FAILED');
    expect(issuesOf(error)).toEqual(['name']);
    expect(((await (await call(session, 'GET', '/my/skills')).json()) as { items: unknown[] }).items).toHaveLength(MAX_SKILLS);
  });
});

describe('updateMySkill (RF-808)', () => {
  it('edits fields in part and the rest stays; the rules of SkillInput are checked on the resulting row', async () => {
    const session = await signIn(await rescuer());
    const skill = Skill.parse(await (await create(session, { name: 'Curso', kind: 'course', issuer: 'Entidad', issuedOn: '2026-03-01', expiresOn: '2027-03-01' })).json());
    const edited = Skill.parse(await (await call(session, 'PATCH', `/my/skills/${skill.id}`, { name: 'Curso editado', issuer: 'Otra entidad' })).json());
    expect(edited).toMatchObject({ id: skill.id, name: 'Curso editado', issuer: 'Otra entidad', issuedOn: '2026-03-01', expiresOn: '2027-03-01' });
    // Only the new expiry comes in, but it precedes the date already stored.
    const expiry = await expectError(await call(session, 'PATCH', `/my/skills/${skill.id}`, { expiresOn: '2026-01-01' }), 400, 'VALIDATION_FAILED');
    expect(issuesOf(expiry)).toEqual(['expiresOn']);
    expect(Skill.parse(await (await call(session, 'PATCH', `/my/skills/${skill.id}`, {})).json())).toEqual(edited);
  });

  it('going from course to skill while it keeps a certificate is VALIDATION_FAILED; with null it goes through and the certificate is retired', async () => {
    const session = await signIn(await rescuer());
    const file = await uploadCertificate(session);
    const skill = Skill.parse(await (await create(session, { name: 'Curso', kind: 'course', certificateFileId: file.id })).json());
    const refused = await expectError(await call(session, 'PATCH', `/my/skills/${skill.id}`, { kind: 'skill' }), 400, 'VALIDATION_FAILED');
    expect(issuesOf(refused)).toEqual(['certificateFileId']);
    expect((await fileRow(file.id)).deleted_at).toBeNull();

    const done = Skill.parse(await (await call(session, 'PATCH', `/my/skills/${skill.id}`, { kind: 'skill', certificateFileId: null })).json());
    expect(done).toMatchObject({ kind: 'skill', hasCertificate: false });
    expect((await fileRow(file.id)).deleted_at).not.toBeNull();
  });

  it('D-S5: changing the certificate marks the old one deleted and removes its bytes after the commit; the new one is attached', async () => {
    const session = await signIn(await rescuer());
    const first = await uploadCertificate(session);
    const second = await uploadCertificate(session, PNG);
    const skill = Skill.parse(await (await create(session, { name: 'Curso', kind: 'course', certificateFileId: first.id })).json());
    const firstKey = (await fileRow(first.id)).storage_key;
    expect((await storage.get(firstKey)).equals(PDF)).toBe(true);

    const changed = await call(session, 'PATCH', `/my/skills/${skill.id}`, { certificateFileId: second.id });
    expect(changed.status).toBe(200);
    expect(Skill.parse(await changed.json()).hasCertificate).toBe(true);
    expect((await fileRow(first.id)).deleted_at).not.toBeNull();
    await expect(storage.get(firstKey)).rejects.toThrow();
    const secondRow = await fileRow(second.id);
    expect(secondRow.deleted_at).toBeNull();
    expect((await storage.get(secondRow.storage_key)).equals(PNG)).toBe(true);
    expect((await fixtures.query<{ certificate_file_id: string }>(`SELECT certificate_file_id FROM skills WHERE id = $1`, [skill.id]))[0]!.certificate_file_id).toBe(second.id);
  });

  it('the same certificate again is a no-op that keeps the file; another entry’s certificate is refused', async () => {
    const session = await signIn(await rescuer());
    const [a, b] = [await uploadCertificate(session), await uploadCertificate(session)];
    const one = Skill.parse(await (await create(session, { name: 'Uno', kind: 'course', certificateFileId: a.id })).json());
    await create(session, { name: 'Dos', kind: 'course', certificateFileId: b.id });
    expect((await call(session, 'PATCH', `/my/skills/${one.id}`, { certificateFileId: a.id, name: 'Uno bis' })).status).toBe(200);
    expect((await fileRow(a.id)).deleted_at).toBeNull();
    expect(issuesOf(await expectError(await call(session, 'PATCH', `/my/skills/${one.id}`, { certificateFileId: b.id }), 400, 'VALIDATION_FAILED'))).toEqual(['certificateFileId']);
    expect((await fileRow(b.id)).deleted_at).toBeNull();
  });

  it('a skill that does not exist or belongs to someone else is 404, in the same organization or in another', async () => {
    const [mine, sameOrg, otherOrg] = [await signIn(await rescuer()), await rescuer(), await rescuer(otherOrgId)];
    const theirs = Skill.parse(await (await create(await signIn(sameOrg), { name: 'Ajena', kind: 'skill' })).json());
    const foreign = Skill.parse(await (await create(await signIn(otherOrg), { name: 'De otra organización', kind: 'skill' })).json());
    for (const id of [theirs.id, foreign.id, crypto.randomUUID()]) {
      await expectError(await call(mine, 'PATCH', `/my/skills/${id}`, { name: 'Intruso' }), 404, 'NOT_FOUND');
      await expectError(await call(mine, 'DELETE', `/my/skills/${id}`), 404, 'NOT_FOUND');
    }
    expect((await fixtures.query<{ name: string }>(`SELECT name FROM skills WHERE id = $1`, [theirs.id]))[0]!.name).toBe('Ajena');
  });
});

describe('deleteMySkill (RF-808, D-S5)', () => {
  it('204: the entry is gone, its certificate is marked deleted and the bytes are removed', async () => {
    const session = await signIn(await rescuer());
    const file = await uploadCertificate(session);
    const skill = Skill.parse(await (await create(session, { name: 'Curso', kind: 'course', certificateFileId: file.id })).json());
    const { storage_key } = await fileRow(file.id);
    const response = await call(session, 'DELETE', `/my/skills/${skill.id}`);
    expect(response.status).toBe(204);
    expect(await fixtures.query(`SELECT 1 FROM skills WHERE id = $1`, [skill.id])).toEqual([]);
    expect((await fileRow(file.id)).deleted_at).not.toBeNull();
    await expect(storage.get(storage_key)).rejects.toThrow();
    expect(await (await call(session, 'GET', '/my/skills')).json()).toEqual({ items: [] });
  });

  it('an entry without certificate is deleted and nothing else is touched', async () => {
    const session = await signIn(await rescuer());
    const kept = await uploadCertificate(session);
    await create(session, { name: 'Con', kind: 'course', certificateFileId: kept.id });
    const skill = Skill.parse(await (await create(session, { name: 'Sin', kind: 'skill' })).json());
    const stored = storage.size;
    expect((await call(session, 'DELETE', `/my/skills/${skill.id}`)).status).toBe(204);
    expect(storage.size).toBe(stored);
    expect((await fileRow(kept.id)).deleted_at).toBeNull();
  });

  it('when the transaction rolls back the bytes stay: the file is only removed after the commit', async () => {
    const session = await signIn(await rescuer());
    const file = await uploadCertificate(session);
    await create(session, { name: 'Curso', kind: 'course', certificateFileId: file.id });
    const { storage_key } = await fileRow(file.id);
    // The same steps the service takes, in a transaction that fails afterwards: the file row stays alive and the bytes stay.
    await expect(
      database.withContext(
        { orgId, userId: (await fixtures.query<{ user_id: string }>(`SELECT owner_user_id AS user_id FROM files WHERE id = $1`, [file.id]))[0]!.user_id, role: 'rescuer' },
        async (tx) => {
          await tx.execute(sql`UPDATE files SET deleted_at = now() WHERE id = ${file.id}`);
          database.afterCommit(() => storage.delete(storage_key));
          throw new Error('the request fails after the mark');
        },
      ),
    ).rejects.toThrow('the request fails');
    expect((await fileRow(file.id)).deleted_at).toBeNull();
    expect((await storage.get(storage_key)).equals(PDF)).toBe(true);
  });
});

describe('who may use them (rule 2, INV-25)', () => {
  const calls = (session: Session) => [
    () => call(session, 'GET', '/my/skills'),
    () => call(session, 'POST', '/my/skills', { name: 'X', kind: 'skill' }),
    () => call(session, 'PATCH', `/my/skills/${crypto.randomUUID()}`, { name: 'X' }),
    () => call(session, 'DELETE', `/my/skills/${crypto.randomUUID()}`),
  ];

  it('the coordinator and the administrator get 403 FORBIDDEN in the four', async () => {
    for (const role of ['coordinator', 'admin'] as const) {
      const session = await signIn(await fixtures.member(orgId, role, 'active', { password: TEST_PASSWORD }));
      for (const run of calls(session)) await expectError(await run(), 403, 'FORBIDDEN');
    }
  });

  it('a pending account is ACCOUNT_PENDING, a rescuer who loses the account is refused, and without session is 401', async () => {
    const pending = await signIn(await fixtures.applicant(orgId, 'pending', { password: TEST_PASSWORD }));
    for (const run of calls(pending)) await expectError(await run(), 403, 'ACCOUNT_PENDING');
    for (const run of calls({ cookie: '', csrf: '', setCookie: '', body: { user: {}, csrfToken: '' } })) await expectError(await run(), 401, 'UNAUTHENTICATED');

    const member = await rescuer();
    const session = await signIn(member);
    await fixtures.query(`UPDATE users SET account_status = 'disabled' WHERE id = $1`, [member.userId]);
    for (const run of calls(session)) expect([401, 403]).toContain((await run()).status);
    expect(await fixtures.query(`SELECT 1 FROM skills s JOIN rescuer_profiles p ON p.id = s.profile_id WHERE p.user_id = $1`, [member.userId])).toEqual([]);
  });

  it('a missing CSRF token on a write is CSRF_FAILED', async () => {
    const session = await signIn(await rescuer());
    const response = await fetch(`${app.baseUrl}/my/skills`, {
      method: 'POST',
      headers: { ...withSession(session, false), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', kind: 'skill' }),
    });
    await expectError(response, 403, 'CSRF_FAILED');
  });
});
