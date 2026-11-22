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
