// Perfil propio del rescatista (H5-perfil T3 y T4): RF-806, RF-807, RF-810, INV-18, INV-24, INV-31, INV-32. Datos ficticios (regla 10).
import { ErrorResponse, MyProfile, MySensitive } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DocumentFingerprint } from '../../src/sensitive/document-fingerprint.js';
import { SensitiveCipher } from '../../src/sensitive/sensitive-cipher.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

let app: TestApp;
let fixtures: Fixtures;
let orgId: string;
let otherOrgId: string;

const ADDRESS = { street: 'Calle Inventada', number: '7', floor: '2º B', postalCode: '22600', locality: 'Sabiñánigo', province: 'Huesca', country: 'ES' };

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection });
  orgId = await fixtures.organization('Profile A');
  otherOrgId = await fixtures.organization('Profile B');
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

const rescuer = (org = orgId) => fixtures.member(org, 'rescuer', 'active', { password: TEST_PASSWORD });
const signIn = (member: Member) => mustLogin(app, member.email, TEST_PASSWORD);
const profileIdOf = async (member: Member) => (await fixtures.query<{ id: string }>(`SELECT id FROM rescuer_profiles WHERE user_id = $1`, [member.userId]))[0]!.id;

/** Writes contact and sensitive data the way the API stores them, with the app's own keys (only to set up the reads of T3). */
async function storeAsTheApi(member: Member, phone: string, document: { type: 'dni' | 'nie' | 'passport' | 'other'; number: string }, address = ADDRESS) {
  const profileId = await profileIdOf(member);
  const cipher = app.app.get(SensitiveCipher);
  const fingerprint = app.app.get(DocumentFingerprint);
  await fixtures.query(`INSERT INTO rescuer_contact (profile_id, organization_id, phone) VALUES ($1, $2, $3)`, [profileId, member.orgId, phone]);
  await fixtures.query(`INSERT INTO rescuer_sensitive (profile_id, organization_id, document_type, document_enc, document_hash, address_enc, key_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
    profileId,
    member.orgId,
    document.type,
    cipher.encrypt(profileId, 'document', document.number),
    fingerprint.of(document.type, document.number),
    cipher.encrypt(profileId, 'address', JSON.stringify(address)),
    cipher.keyId,
  ]);
  return profileId;
}

const get = (session: Session, path: string) => fetch(`${app.baseUrl}${path}`, { headers: withSession(session, false) });

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.error.code).toBe(code);
  return body;
}

describe('getMyProfile (RF-806, INV-31, INV-32)', () => {
  it('an incomplete profile says what is missing; the email is the login one and nothing sensitive is there', async () => {
    const member = await rescuer();
    const response = await get(await signIn(member), '/my/profile');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const profile = MyProfile.parse(await response.json());
    expect(profile).toMatchObject({ status: 'incomplete', fullName: 'Fictitious Rescuer', email: member.email, phone: null, document: null, addressSummary: null, completedAt: null });
    expect(profile.missingFields).toEqual(['phone', 'document', 'address']);
    expect(profile.skills).toEqual([]);
  });

  it('with contact and sensitive data: the phone, the document masked to its last two characters and the address summary; and its teams', async () => {
    const member = await rescuer();
    await storeAsTheApi(member, '+34 600 000 001', { type: 'dni', number: '12345678Z' });
    const teamId = await fixtures.team(orgId, 'Equipo Ficticio');
    await fixtures.addToTeam(teamId, member);
    const profile = MyProfile.parse(await (await get(await signIn(member), '/my/profile')).json());
    expect(profile.phone).toBe('+34 600 000 001');
    expect(profile.document).toEqual({ type: 'dni', masked: '•••••••8Z' });
    expect(profile.addressSummary).toBe('•••••, 22600 Sabiñánigo (ES)');
    expect(profile.missingFields).toEqual([]);
    expect(profile.teams).toEqual([{ id: teamId, name: expect.stringMatching(/^Equipo Ficticio/), locality: 'Locality' }]);
    // Ni el número ni la calle salen en la lectura del perfil (INV-32: los sensibles no llegan «de paso»).
    const raw = JSON.stringify(profile);
    expect(raw).not.toContain('12345678');
    expect(raw).not.toContain('Calle Inventada');
  });
});

describe('getMySensitive (RF-810, INV-18)', () => {
  it('gives the person their own document and address in clear, never cached', async () => {
    const member = await rescuer();
    await storeAsTheApi(member, '+34 600 000 002', { type: 'nie', number: 'X1234567L' });
    const response = await get(await signIn(member), '/my/profile/sensitive');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(MySensitive.parse(await response.json())).toEqual({ document: { type: 'nie', number: 'X1234567L' }, address: ADDRESS });
  });

  it('without sensitive data, both are null', async () => {
    const member = await rescuer();
    expect(MySensitive.parse(await (await get(await signIn(member), '/my/profile/sensitive')).json())).toEqual({ document: null, address: null });
  });

  it('a coordinator and an administrator have no way in: FORBIDDEN for both operations', async () => {
    for (const role of ['coordinator', 'admin'] as const) {
      const staff = await fixtures.member(orgId, role, 'active', { password: TEST_PASSWORD });
      const session = await signIn(staff);
      await expectError(await get(session, '/my/profile'), 403, 'FORBIDDEN');
      await expectError(await get(session, '/my/profile/sensitive'), 403, 'FORBIDDEN');
    }
  });

  it('only the ciphertext is in the database, and it does not decrypt as another profile (additional data)', async () => {
    const member = await rescuer(otherOrgId);
    const profileId = await storeAsTheApi(member, '+34 600 000 003', { type: 'dni', number: '87654321X' });
    const [row] = await fixtures.query<{ document_enc: Buffer; address_enc: Buffer; key_id: number }>(`SELECT document_enc, address_enc, key_id FROM rescuer_sensitive WHERE profile_id = $1`, [
      profileId,
    ]);
    expect(row!.document_enc.includes(Buffer.from('87654321X'))).toBe(false);
    expect(row!.address_enc.includes(Buffer.from('Calle Inventada'))).toBe(false);
    const cipher = app.app.get(SensitiveCipher);
    expect(cipher.decrypt(profileId, 'document', row!.document_enc, row!.key_id)).toBe('87654321X');
    const another = await profileIdOf(await rescuer(otherOrgId));
    expect(() => cipher.decrypt(another, 'document', row!.document_enc, row!.key_id)).toThrow();
  });
});

const patch = (session: Session, body: unknown) =>
  fetch(`${app.baseUrl}/my/profile`, { method: 'PATCH', headers: { ...withSession(session), 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** A DNI with a valid control letter built from a number: each test uses its own so INV-24 never trips by chance. */
const dni = (n: number) => {
  const digits = String(n).padStart(8, '0');
  return `${digits}${'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23]}`;
};
let next = 10_000_000 + Math.floor(Math.random() * 80_000_000);
const freshDni = () => dni(next++);

describe('updateMyProfile (RF-807, RF-812, INV-24, INV-32)', () => {
  it('fills the signup in one go: the profile becomes complete, getMe stops asking for it, and one audit row names the blocks, never a value', async () => {
    const member = await rescuer();
    const session = await signIn(member);
    expect(session.body.user).toMatchObject({ nextStep: 'complete-profile' });
    const number = freshDni();
    const response = await patch(session, { fullName: 'Nombre Ficticio Completo', phone: '+34 600 000 010', document: { type: 'dni', number: number.toLowerCase() }, address: ADDRESS });
    expect(response.status).toBe(200);
    const profile = MyProfile.parse(await response.json());
    expect(profile).toMatchObject({ status: 'complete', fullName: 'Nombre Ficticio Completo', phone: '+34 600 000 010', missingFields: [] });
    expect(profile.document).toEqual({ type: 'dni', masked: `•••••••${number.slice(-2)}` });
    expect(profile.completedAt).not.toBeNull();

    const me = await (await get(session, '/auth/me')).json();
    expect(me.user).toMatchObject({ profileStatus: 'complete', nextStep: 'home' });

    const profileId = await profileIdOf(member);
    const audit = await fixtures.query<{ action: string; detail: unknown; actor_user_id: string; subject_user_id: string }>(
      `SELECT action, detail, actor_user_id, subject_user_id FROM audit_log WHERE entity_type = 'rescuer_profile' AND entity_id = $1`,
      [profileId],
    );
    expect(audit).toEqual([{ action: 'profile_completed', detail: { blocks: ['fullName', 'phone', 'document', 'address'] }, actor_user_id: member.userId, subject_user_id: member.userId }]);
    expect(JSON.stringify(audit)).not.toContain(number.slice(0, 6));

    // Lo guardado es el número normalizado y cifrado: en la base no hay texto en claro (INV-18).
    const [row] = await fixtures.query<{ document_enc: Buffer; address_enc: Buffer }>(`SELECT document_enc, address_enc FROM rescuer_sensitive WHERE profile_id = $1`, [profileId]);
    expect(row!.document_enc.includes(Buffer.from(number))).toBe(false);
    expect(row!.address_enc.includes(Buffer.from('Sabiñánigo'))).toBe(false);
    expect(MySensitive.parse(await (await get(session, '/my/profile/sensitive')).json()).document).toEqual({ type: 'dni', number });
  });

  it('part by part: name and phone leave it incomplete with what is missing; the first document needs the address too', async () => {
    const member = await rescuer();
    const session = await signIn(member);
    const partial = MyProfile.parse(await (await patch(session, { phone: '+34 600 000 011' })).json());
    expect(partial).toMatchObject({ status: 'incomplete', phone: '+34 600 000 011', missingFields: ['document', 'address'] });
    const body = await expectError(await patch(session, { document: { type: 'dni', number: freshDni() } }), 400, 'VALIDATION_FAILED');
    expect(body.error.details).toEqual({ issues: [expect.objectContaining({ path: 'address', code: 'required' })] });
    const complete = MyProfile.parse(await (await patch(session, { document: { type: 'passport', number: 'PAS123456' }, address: ADDRESS })).json());
    expect(complete.status).toBe('complete');
    // Corregir después: un bloque solo, y el perfil sigue completo (profile_updated).
    const corrected = MyProfile.parse(await (await patch(session, { address: { ...ADDRESS, locality: 'Jaca', postalCode: '22700' } })).json());
    expect(corrected).toMatchObject({ status: 'complete', addressSummary: '•••••, 22700 Jaca (ES)', document: { type: 'passport', masked: '•••••••56' } });
    const actions = await fixtures.query<{ action: string }>(`SELECT action FROM audit_log WHERE entity_type = 'rescuer_profile' AND entity_id = $1 ORDER BY id`, [await profileIdOf(member)]);
    expect(actions.map((a) => a.action)).toEqual(['profile_updated', 'profile_completed', 'profile_updated']);
  });

  it('a DNI with the wrong control letter is INVALID_DOCUMENT and nothing is stored', async () => {
    const member = await rescuer();
    const session = await signIn(member);
    // Las 8 cifras de un DNI válido con la letra siguiente de la tabla: siempre incorrecta.
    const valid = freshDni();
    const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
    const number = `${valid.slice(0, 8)}${letters[(letters.indexOf(valid.slice(-1)) + 1) % letters.length]}`;
    const body = await expectError(await patch(session, { document: { type: 'dni', number }, address: ADDRESS }), 422, 'INVALID_DOCUMENT');
    expect(body.error.details).toEqual({ issues: [expect.objectContaining({ path: 'document.number', message: 'INVALID_DOCUMENT' })] });
    expect(await fixtures.query(`SELECT 1 FROM rescuer_sensitive WHERE profile_id = $1`, [await profileIdOf(member)])).toHaveLength(0);
  });

  it('INV-24: the same document in another profile of the organization is DOCUMENT_ALREADY_REGISTERED and says nothing of whose; in another organization it is accepted', async () => {
    const number = freshDni();
    const first = await rescuer();
    expect((await patch(await signIn(first), { phone: '+34 600 000 012', document: { type: 'dni', number }, address: ADDRESS })).status).toBe(200);

    const second = await rescuer();
    const response = await patch(await signIn(second), {
      phone: '+34 600 000 013',
      document: { type: 'dni', number: `${number.slice(0, 2)}.${number.slice(2, 5)}.${number.slice(5)}` },
      address: ADDRESS,
    });
    const body = await expectError(response, 409, 'DOCUMENT_ALREADY_REGISTERED');
    expect(body.error.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(first.userId);
    expect(JSON.stringify(body)).not.toContain(first.email);
    // Todo se deshizo con el error: ni teléfono ni sensibles del segundo.
    const secondProfile = await profileIdOf(second);
    expect(await fixtures.query(`SELECT 1 FROM rescuer_contact WHERE profile_id = $1`, [secondProfile])).toHaveLength(0);

    const elsewhere = await rescuer(otherOrgId);
    expect((await patch(await signIn(elsewhere), { phone: '+34 600 000 014', document: { type: 'dni', number }, address: ADDRESS })).status).toBe(200);
  });

  it("saving one's own document again is not a duplicate", async () => {
    const member = await rescuer();
    const session = await signIn(member);
    const number = freshDni();
    expect((await patch(session, { phone: '+34 600 000 015', document: { type: 'dni', number }, address: ADDRESS })).status).toBe(200);
    expect((await patch(session, { document: { type: 'dni', number } })).status).toBe(200);
  });

  it('INV-31: there is no email to change here; the strict body refuses it', async () => {
    const member = await rescuer();
    await expectError(await patch(await signIn(member), { email: 'otro@example.org' }), 400, 'VALIDATION_FAILED');
    await expectError(await patch(await signIn(member), {}), 400, 'VALIDATION_FAILED');
  });

  it("a coordinator cannot write anyone's profile through it", async () => {
    const coordinator = await fixtures.member(orgId, 'coordinator', 'active', { password: TEST_PASSWORD });
    await expectError(await patch(await signIn(coordinator), { phone: '+34 600 000 016' }), 403, 'FORBIDDEN');
  });
});
