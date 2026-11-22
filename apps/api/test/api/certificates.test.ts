// getCertificateLink and openCertificate (H5-habilidades T4): INV-26, INV-28 (the certificate), RN-24, D-S2, D-S3, D-S7. Fictitious data (rule 10).
import { ErrorResponse, FileRef, SignedLink, Skill } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { InMemoryFileStorage } from '../../src/files/file-storage.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { FixedClock } from '../support/clock.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

let app: TestApp;
let fixtures: Fixtures;
let orgId: string;
let otherOrgId: string;
let missionId: string;
let missionCoordinator: Member;
const clock = new FixedClock(new Date('2026-11-22T10:00:00Z'));
const storage = new InMemoryFileStorage();
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('fictitious certificate')]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection, files: { storage }, clock });
  orgId = await fixtures.organization('Certificates A');
  otherOrgId = await fixtures.organization('Certificates B');
  missionCoordinator = await fixtures.member(orgId, 'coordinator', 'active', { password: TEST_PASSWORD });
  const [mission] = await fixtures.query<{ id: string }>(
    `INSERT INTO missions (organization_id, name, coordinator_id, status, target, target_source, created_by, activated_at) VALUES ($1, 'Mision de certificados', $2, 'active', 'POINT Z (0 0 0)', 'map', $2, now()) RETURNING id`,
    [orgId, missionCoordinator.userId],
  );
  missionId = mission!.id;
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

const signIn = (member: Member) => mustLogin(app, member.email, TEST_PASSWORD);
const rescuer = (org = orgId) => fixtures.member(org, 'rescuer', 'active', { password: TEST_PASSWORD, profile: 'complete' });
const request = (session: Session, method: string, path: string, body?: unknown) =>
  fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { ...withSession(session, method !== 'GET'), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** A course with a certificate for a new rescuer, through the API. */
async function courseOf(member: Member, content: Buffer = PDF) {
  const session = await signIn(member);
  const form = new FormData();
  form.set('purpose', 'certificate');
  form.set('file', new Blob([new Uint8Array(content)]), 'x.bin');
  const file = FileRef.parse(await (await fetch(`${app.baseUrl}/files`, { method: 'POST', headers: withSession(session), body: form })).json());
  const skill = Skill.parse(await (await request(session, 'POST', '/my/skills', { name: 'Curso muy privado', kind: 'course', certificateFileId: file.id })).json());
  return { session, file, skill };
}

const linkOf = (session: Session, skillId: string) => request(session, 'POST', `/skills/${skillId}/certificate-link`);
const auditRows = (skillId: string) =>
  fixtures.query<{ action: string; actor_user_id: string; subject_user_id: string; entity_type: string; detail: Record<string, unknown> }>(
    `SELECT action, actor_user_id, subject_user_id, entity_type, detail FROM audit_log WHERE entity_id = $1 AND action = 'certificate_opened'`,
    [skillId],
  );
async function expectNotFound(response: Response) {
  expect(response.status).toBe(404);
  expect(ErrorResponse.parse(await response.json()).error.code).toBe('NOT_FOUND');
}
async function participate(member: Member, status: 'pending' | 'accepted' | 'withdrawn') {
  if (status === 'accepted') {
    await fixtures.query(
      `INSERT INTO participations (organization_id, mission_id, user_id, status, origin, decided_by, decided_at) VALUES ($1, $2, $3, 'accepted', 'coordinator', $4, now())`,
      [orgId, missionId, member.userId, missionCoordinator.userId],
    );
    return;
  }
  await fixtures.query(`INSERT INTO participations (organization_id, mission_id, user_id, status, origin, offered_at) VALUES ($1, $2, $3, 'pending', 'volunteer', now())`, [orgId, missionId, member.userId]);
  if (status === 'withdrawn') await fixtures.query(`UPDATE participations SET status = 'withdrawn' WHERE mission_id = $1 AND user_id = $2`, [missionId, member.userId]);
}

describe('the owner (RN-24)', () => {
  it('asks for their own link without any audit row and opens it: 200 with the type of the row and the headers of D-S3', async () => {
    const { session, skill } = await courseOf(await rescuer());
    const response = await linkOf(session, skill.id);
    expect(response.status).toBe(200);
    const link = SignedLink.parse(await response.json());
    expect(link.url).toMatch(/^\/api\/v1\/certificates\/[A-Za-z0-9._~-]+$/);
    expect(new Date(link.expiresAt).getTime()).toBe(clock.now().getTime() + 5 * 60_000);
    expect(await auditRows(skill.id)).toEqual([]);

    const opened = await fetch(`${app.baseUrl.replace(/\/api\/v1$/, '')}${link.url}`, { headers: withSession(session, false) });
    expect(opened.status).toBe(200);
    expect(opened.headers.get('content-type')).toBe('application/pdf');
    expect(opened.headers.get('content-disposition')).toBe('inline; filename="certificado.pdf"');
    expect(opened.headers.get('x-content-type-options')).toBe('nosniff');
    expect(opened.headers.get('cache-control')).toBe('no-store, private');
    expect(Buffer.from(await opened.arrayBuffer()).equals(PDF)).toBe(true);
    expect(await auditRows(skill.id)).toEqual([]); // opening a link audits nothing: the row is written when it is signed
  });

  it('an image certificate comes out with its own type', async () => {
    const { session, skill } = await courseOf(await rescuer(), PNG);
    const link = SignedLink.parse(await (await linkOf(session, skill.id)).json());
    const opened = await fetch(`${app.baseUrl.replace(/\/api\/v1$/, '')}${link.url}`, { headers: withSession(session, false) });
    expect(opened.headers.get('content-type')).toBe('image/png');
    expect(opened.headers.get('content-disposition')).toContain('certificado.png');
  });

  it('an entry without certificate and one that does not exist are 404', async () => {
    const member = await rescuer();
    const session = await signIn(member);
    const skill = Skill.parse(await (await request(session, 'POST', '/my/skills', { name: 'Sin papel', kind: 'course' })).json());
    await expectNotFound(await linkOf(session, skill.id));
    await expectNotFound(await linkOf(session, crypto.randomUUID()));
  });
});

describe('INV-26: a foreign opening leaves exactly one row, without the name of the course', () => {
  it('the administrator of the organization', async () => {
    const { skill, file } = await courseOf(await rescuer());
    const admin = await signIn(await fixtures.member(orgId, 'admin', 'active', { password: TEST_PASSWORD }));
    expect((await linkOf(admin, skill.id)).status).toBe(200);
    const rows = await auditRows(skill.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: 'skill', detail: { fileId: file.id } });
    expect(JSON.stringify(rows[0])).not.toContain('Curso muy privado');
    expect(Object.keys(rows[0]!.detail)).toEqual(['fileId']);
  });

  it.each(['pending', 'accepted'] as const)('a coordinator when the rescuer has a %s participation', async (status) => {
    const member = await rescuer();
    const { skill } = await courseOf(member);
    await participate(member, status);
    const coordinator = await fixtures.member(orgId, 'coordinator', 'active', { password: TEST_PASSWORD });
    const session = await signIn(coordinator);
    const response = await linkOf(session, skill.id);
    expect(response.status).toBe(200);
    const link = SignedLink.parse(await response.json());
    const rows = await auditRows(skill.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'certificate_opened', actor_user_id: coordinator.userId, subject_user_id: member.userId });
    const opened = await fetch(`${app.baseUrl.replace(/\/api\/v1$/, '')}${link.url}`, { headers: withSession(session, false) });
    expect(opened.status).toBe(200);
    expect(await auditRows(skill.id)).toHaveLength(1);
  });
});

describe('INV-28: who gets 404 (D-S7)', () => {
  it('a coordinator without participation, with a withdrawn one, another rescuer and another organization', async () => {
    const member = await rescuer();
    const { skill } = await courseOf(member);
    const coordinator = await signIn(await fixtures.member(orgId, 'coordinator', 'active', { password: TEST_PASSWORD }));
    await expectNotFound(await linkOf(coordinator, skill.id));

    await participate(member, 'withdrawn');
    await expectNotFound(await linkOf(coordinator, skill.id));

    await expectNotFound(await linkOf(await signIn(await rescuer()), skill.id));
    await expectNotFound(await linkOf(await signIn(await fixtures.member(otherOrgId, 'admin', 'active', { password: TEST_PASSWORD })), skill.id));
    await expectNotFound(await linkOf(await signIn(await fixtures.member(otherOrgId, 'coordinator', 'active', { password: TEST_PASSWORD })), skill.id));
    expect(await auditRows(skill.id)).toEqual([]); // a refusal writes nothing
  });
});

describe('the link (D-S2)', () => {
  const absolute = (url: string) => `${app.baseUrl.replace(/\/api\/v1$/, '')}${url}`;

  it('expired, tampered, from another session, of a deleted file and without session: 404', async () => {
    const { session, skill, file } = await courseOf(await rescuer());
    const { url } = SignedLink.parse(await (await linkOf(session, skill.id)).json());

    const tampered = url.slice(0, -3) + (url.endsWith('AAA') ? 'BBB' : 'AAA');
    await expectNotFound(await fetch(absolute(tampered), { headers: withSession(session, false) }));
    await expectNotFound(await fetch(absolute('/api/v1/certificates/basura'), { headers: withSession(session, false) }));
    await expectNotFound(await fetch(absolute(url), { headers: withSession(await signIn(await rescuer()), false) }));
    expect((await fetch(absolute(url))).status).toBe(401);

    clock.advance(5 * 60_000);
    await expectNotFound(await fetch(absolute(url), { headers: withSession(session, false) }));
    clock.advance(-5 * 60_000);

    expect((await fetch(absolute(url), { headers: withSession(session, false) })).status).toBe(200);
    await fixtures.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [file.id]);
    await expectNotFound(await fetch(absolute(url), { headers: withSession(session, false) }));
  });
});
