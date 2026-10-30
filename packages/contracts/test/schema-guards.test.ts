// Pruebas de las reglas de privacidad y de separación de roles. Si alguien añade un campo prohibido a un listado, esto falla.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/index.js';
import { propertyNames } from './helpers.js';

const PERSONAL = ['phone', 'email', 'document', 'documentType', 'documentNumber', 'documentEnc', 'address', 'addressSummary', 'street', 'postalCode', 'password', 'passwordHash', 'history'];

const find = (id: string) => {
  const e = C.ENDPOINTS.find((x) => x.id === id);
  assert.ok(e, `endpoint ${id} no existe`);
  return e!;
};

// RN-21 y RN-18: ningún LISTADO ni respuesta de personal contiene datos personales más allá de lo permitido.
const STRICT_NO_PERSONAL: Record<string, string[]> = {
  // id de endpoint → campos personales permitidos (ninguno)
  listParticipations: [],
  listRescuers: [],
  listTeams: [],
  getTeam: [],
  addTeamMembers: [],
  createTeam: [],
  updateTeam: [],
  listMissions: [],
  getMission: [],
  listMyMissions: [],
  getMyMission: [],
  listRoutes: [],
  getRoute: [],
  listMissionRoutes: [],
  listMyMissionRoutes: [],
  listMissionHistory: [],
  listCoordinators: [],
  attendance: [],
  listAttendanceCandidates: [],
};

for (const [id, allowed] of Object.entries(STRICT_NO_PERSONAL)) {
  if (!C.ENDPOINTS.some((e) => e.id === id)) continue;
  test(`sin datos personales en ${id}`, () => {
    const e = find(id);
    const names = propertyNames(e.response.schema!);
    for (const f of PERSONAL) if (!allowed.includes(f)) assert.ok(!names.has(f), `${id} expone «${f}»`);
  });
}

test('la ficha del voluntario solo añade teléfono y correo (nunca documento, dirección ni historial)', () => {
  const names = propertyNames(find('getParticipationCard').response.schema!);
  for (const f of ['document', 'documentType', 'documentNumber', 'address', 'addressSummary', 'street', 'history', 'password']) {
    assert.ok(!names.has(f), `la ficha expone «${f}»`);
  }
  assert.ok(names.has('phone') && names.has('email'));
});

test('el selector de rescatistas y la bandeja no incluyen correo ni teléfono ni el estado del perfil', () => {
  for (const id of ['listRescuers', 'listParticipations']) {
    const names = propertyNames(find(id).response.schema!);
    for (const f of ['phone', 'email', 'profileStatus']) assert.ok(!names.has(f), `${id} expone «${f}»`);
  }
});

test('el rescatista no recibe notas internas, borradores ni quién validó', () => {
  const names = propertyNames(find('listMyMissionRoutes').response.schema!);
  for (const f of ['note', 'status_draft', 'createdBy', 'validatedBy', 'newerValidatedVersion', 'pinned', 'manuallyModified', 'provenance']) {
    assert.ok(!names.has(f), `ruta del rescatista expone «${f}»`);
  }
  const detail = propertyNames(find('getMyMission').response.schema!);
  for (const f of ['participants', 'readiness', 'actions', 'coordinator', 'teams', 'origins']) assert.ok(!detail.has(f), `MyMissionDetail expone «${f}»`);
});

test('el listado del rescatista nunca muestra «planning»', () => {
  const r = C.MyMissionListItem.shape.status;
  assert.equal(r.safeParse('planning').success, false);
  assert.equal(C.ListMyMissionsQuery.safeParse({ status: 'planning' }).success, false);
});

// Separación de roles por ruta.
const SHARED_WITH_RESCUER = new Set([
  'getHealth', 'register', 'login', 'logout', 'getMe', 'updateMe', 'changePassword', 'forgotPassword', 'resetPassword',
  'getOrganization', 'getEnvironment', 'uploadFile', 'getCertificateLink',
]);

test('los endpoints /my/ son solo del rescatista y el resto del API no los incluye', () => {
  for (const e of C.ENDPOINTS) {
    if (e.path.startsWith('/my/')) assert.deepEqual([...e.roles], ['rescuer'], `${e.id} debe ser solo rescuer`);
    else if (e.roles.includes('rescuer')) assert.ok(SHARED_WITH_RESCUER.has(e.id), `${e.id} abre a rescuer fuera de /my/`);
  }
});

test('/admin/ es solo del administrador', () => {
  for (const e of C.ENDPOINTS.filter((x) => x.path.startsWith('/admin/'))) assert.deepEqual([...e.roles], ['admin'], e.id);
});

test('nada que escriba sobre misiones o rutas está abierto al rescatista ni al pendiente', () => {
  for (const e of C.ENDPOINTS) {
    if (e.method === 'GET' || e.path.startsWith('/my/') || e.path.startsWith('/auth') || e.path.startsWith('/admin')) continue;
    if (SHARED_WITH_RESCUER.has(e.id)) continue;
    assert.ok(!e.roles.includes('rescuer') && !e.roles.includes('pending') && !e.roles.includes('public'), `${e.id} escribe y está abierto de más`);
  }
});

test('solo login, registro, salud y recuperación son públicos', () => {
  const pub = C.ENDPOINTS.filter((e) => e.roles.includes('public')).map((e) => e.id).sort();
  assert.deepEqual(pub, ['forgotPassword', 'getHealth', 'login', 'register', 'resetPassword']);
});

test('una cuenta pendiente solo puede llamar a logout y me', () => {
  const ids = C.ENDPOINTS.filter((e) => e.roles.includes('pending')).map((e) => e.id).sort();
  assert.deepEqual(ids, ['getMe', 'logout']);
});

test('lecturas con efecto de auditoría son POST', () => {
  for (const id of ['readUserSensitive', 'getCertificateLink']) assert.equal(find(id).method, 'POST', id);
});

test('no existe ningún DELETE de rutas ni de misiones (RN-14)', () => {
  const bad = C.ENDPOINTS.filter((e) => e.method === 'DELETE' && /^\/(routes|missions)\/\{[a-zA-Z]+\}$/.test(e.path));
  assert.deepEqual(bad.map((e) => e.id), []);
});

test('una misión se crea sin estado: el cliente no puede fijarlo', () => {
  assert.equal(C.CreateMissionRequest.safeParse({ name: 'Rescate', target: { source: 'map', lat: 42, lon: 0 }, status: 'active' }).success, false);
  assert.equal(C.UpdateMissionRequest.safeParse({ status: 'closed' }).success, false);
});
