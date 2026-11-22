// Comportamiento de los validadores y de los esquemas con reglas.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/index.js';
import { U } from './helpers.js';

const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) => assert.equal(s.safeParse(v).success, true, JSON.stringify(v));
const bad = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) => assert.equal(s.safeParse(v).success, false, JSON.stringify(v));

test('DNI y NIE: letra de control', () => {
  assert.ok(C.isValidDni('12345678Z'));
  assert.ok(C.isValidDni('12.345.678-z'));
  assert.ok(!C.isValidDni('12345678A'));
  assert.ok(!C.isValidDni('1234567Z'));
  assert.ok(C.isValidNie('X1234567L'));
  assert.ok(C.isValidNie('Y1234567X'));
  assert.ok(C.isValidNie('Z1234567R'));
  assert.ok(!C.isValidNie('X1234567A'));
  assert.ok(!C.isValidNie('A1234567L'));
});

test('pasaporte y «otro»: formato libre pero limpio', () => {
  assert.ok(C.isValidDocument('passport', 'AB 123-456'));
  assert.ok(!C.isValidDocument('passport', 'AB!23'));
  assert.ok(!C.isValidDocument('other', 'AB'));
  assert.equal(C.normalizeDocument('12.345.678-z'), '12345678Z');
  assert.equal(C.maskDocument('12345678Z'), '•••••••8Z');
});

test('perfil: documento con letra incorrecta se rechaza, y un bloque incompleto también', () => {
  ok(C.UpdateMyProfileRequest, { document: { type: 'dni', number: '12345678Z' } });
  bad(C.UpdateMyProfileRequest, { document: { type: 'dni', number: '12345678A' } });
  bad(C.UpdateMyProfileRequest, {});
  bad(C.UpdateMyProfileRequest, { address: { street: 'Mayor' } });
  bad(C.UpdateMyProfileRequest, { phone: 'abc' });
  ok(C.UpdateMyProfileRequest, { phone: '+34 600 11 22 33' });
});

test('curso con certificado sí, habilidad con certificado no, caducidad anterior no', () => {
  ok(C.SkillInput, { name: 'Primeros auxilios', kind: 'course', certificateFileId: U(1) });
  bad(C.SkillInput, { name: 'Dron', kind: 'skill', certificateFileId: U(1) });
  bad(C.SkillInput, { name: 'X', kind: 'course', issuedOn: '2026-05-01', expiresOn: '2026-04-01' });
});

test('registro: contraseñas iguales, mínimo de longitud, correo en minúsculas, sin campo de rol', () => {
  const base = { email: 'Ana@Example.com', password: 'una-clave-larga-1', passwordConfirm: 'una-clave-larga-1', displayName: 'Ana', inviteCode: 'ABCDEF123456' };
  ok(C.RegisterRequest, base);
  assert.equal(C.RegisterRequest.parse(base).email, 'ana@example.com');
  bad(C.RegisterRequest, { ...base, passwordConfirm: 'otra' });
  bad(C.RegisterRequest, { ...base, password: 'corta', passwordConfirm: 'corta' });
  bad(C.RegisterRequest, { ...base, role: 'coordinator' });
});

test('aprobar exige rol; rechazar no lo admite; coordinador solo lo concede aquí', () => {
  const sel = { mode: 'ids', ids: [U(1)] };
  ok(C.DecideSignupRequest, { action: 'approve', role: 'rescuer', selection: sel });
  ok(C.DecideSignupRequest, { action: 'approve', role: 'coordinator', selection: sel });
  bad(C.DecideSignupRequest, { action: 'approve', selection: sel });
  bad(C.DecideSignupRequest, { action: 'reject', role: 'rescuer', selection: sel });
  bad(C.DecideSignupRequest, { action: 'approve', role: 'admin', selection: sel });
  ok(C.DecideSignupRequest, { action: 'reject', selection: { mode: 'filter', filter: { status: 'pending' }, exceptIds: [] } });
});

test('misión: objetivo de las tres formas, rangos y etiqueta de dirección', () => {
  const mk = (target: unknown) => ({ name: 'Rescate Aneto', target });
  ok(C.CreateMissionRequest, mk({ source: 'coordinates', lat: 42.63, lon: 0.65 }));
  ok(C.CreateMissionRequest, mk({ source: 'map', lat: -90, lon: 180 }));
  ok(C.CreateMissionRequest, mk({ source: 'address', lat: 42.6, lon: 0.6, label: 'Benasque', country: 'ES' }));
  bad(C.CreateMissionRequest, mk({ source: 'address', lat: 42.6, lon: 0.6 }));
  bad(C.CreateMissionRequest, mk({ source: 'map', lat: 91, lon: 0 }));
  bad(C.CreateMissionRequest, mk({ source: 'map', lat: 0, lon: -181 }));
  bad(C.CreateMissionRequest, mk({ source: 'map', lat: 0, lon: 0, elevationM: 3000 })); // la altitud no la envía el cliente
  bad(C.CreateMissionRequest, { name: 'ab', target: { source: 'map', lat: 0, lon: 0 } });
  bad(C.CreateMissionRequest, mk({ source: 'address', lat: 0, lon: 0, label: 'x', country: 'es' }));
  const d = C.CreateMissionRequest.parse(mk({ source: 'map', lat: 0, lon: 0 }));
  assert.deepEqual([d.teamIds, d.rescuerIds, d.origins, d.routes], [[], [], [], []]);
});

test('cierre: sin repetidos; con cero aceptados vale una lista vacía', () => {
  ok(C.CloseMissionRequest, { attendance: [] });
  ok(C.CloseMissionRequest, {
    attendance: [
      { participationId: U(1), participated: true },
      { participationId: U(2), participated: false },
    ],
  });
  bad(C.CloseMissionRequest, {
    attendance: [
      { participationId: U(1), participated: true },
      { participationId: U(1), participated: false },
    ],
  });
  bad(C.CloseMissionRequest, { attendance: [{ participationId: U(1) }] });
});

test('bandeja: quitar exige el número esperado; la selección por filtro lleva excepciones', () => {
  const ids = { mode: 'ids', ids: [U(1), U(2)] };
  ok(C.BulkParticipationRequest, { action: 'accept', selection: ids });
  bad(C.BulkParticipationRequest, { action: 'remove', selection: ids });
  ok(C.BulkParticipationRequest, { action: 'remove', selection: ids, expectedCount: 2 });
  bad(C.BulkParticipationRequest, { action: 'ban', selection: ids });
  bad(C.BulkParticipationRequest, { action: 'accept', selection: { mode: 'ids', ids: [] } });
  const r = C.BulkParticipationRequest.parse({ action: 'accept', selection: { mode: 'filter', filter: {} } });
  assert.equal(r.selection.mode, 'filter');
  if (r.selection.mode === 'filter') {
    assert.equal(r.selection.filter.status, 'pending');
    assert.deepEqual(r.selection.exceptIds, []);
  }
});

test('consulta de bandeja: por defecto Pendientes, página 1, 25 por página; coerción desde texto', () => {
  const q = C.ListParticipationsQuery.parse({});
  assert.deepEqual([q.status, q.page, q.pageSize], ['pending', 1, 25]);
  const q2 = C.ListParticipationsQuery.parse({ page: '3', pageSize: '100', status: 'accepted' });
  assert.deepEqual([q2.page, q2.pageSize], [3, 100]);
  bad(C.ListParticipationsQuery, { pageSize: '1000' });
  bad(C.ListParticipationsQuery, { status: 'removed' });
});

test('booleano de consulta: "false" es falso', () => {
  assert.equal(C.ListRescuersQuery.parse({ profileComplete: 'false' }).profileComplete, false);
  assert.equal(C.ListRescuersQuery.parse({}).profileComplete, true);
  bad(C.ListRescuersQuery, { profileComplete: 'yes' });
});

test('geometría: rangos, mínimo de puntos, polígono cerrado', () => {
  ok(C.LineStringInput, {
    type: 'LineString',
    coordinates: [
      [0, 42],
      [0.1, 42.1, 1500],
    ],
  });
  bad(C.LineStringInput, { type: 'LineString', coordinates: [[0, 42]] });
  bad(C.LineStringInput, {
    type: 'LineString',
    coordinates: [
      [0, 91],
      [1, 1],
    ],
  });
  bad(C.LineStringInput, {
    type: 'LineString',
    coordinates: [
      [200, 0],
      [1, 1],
    ],
  });
  ok(C.PolygonInput, {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  });
  bad(C.PolygonInput, {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [2, 2],
      ],
    ],
  });
});

test('biblioteca: bbox se interpreta; fuera de rango o al revés se rechaza', () => {
  const q = C.ListRoutesQuery.parse({ bbox: '-0.1,42.5,0.9,42.9' });
  assert.deepEqual(q.bbox, { minLon: -0.1, minLat: 42.5, maxLon: 0.9, maxLat: 42.9 });
  assert.equal(q.status, 'active');
  bad(C.ListRoutesQuery, { bbox: '1,1,0,0' });
  bad(C.ListRoutesQuery, { bbox: '0,0,200,10' });
  bad(C.ListRoutesQuery, { bbox: 'a,b,c,d' });
});

test('crear ruta: importar necesita archivo; dibujar necesita trazado; no se acepta otra procedencia', () => {
  ok(C.CreateRouteRequest, { source: 'import', name: 'GPX', fileId: U(1) });
  ok(C.CreateRouteRequest, {
    source: 'drawn',
    name: 'A mano',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
  });
  bad(C.CreateRouteRequest, { source: 'import', name: 'GPX' });
  bad(C.CreateRouteRequest, { source: 'generated', name: 'x', fileId: U(1) });
  bad(C.CreateRouteRequest, {
    source: 'drawn',
    name: 'x',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    metrics: {},
  });
});

test('versión nueva: o el trazado entero o continuar a mano desde un corte, nunca los dos (issue-pintar-ruta, D-P4)', () => {
  const geometry = {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1],
    ],
  };
  const cutPoint = { lat: 42.6, lon: 0.6 };
  const points = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 42.6 + i / 1000, lon: 0.61 }));
  ok(C.CreateVersionRequest, { baseVersionId: U(1), geometry });
  ok(C.CreateVersionRequest, { baseVersionId: U(1), continueFrom: { cutPoint, points: points(1) } });
  ok(C.CreateVersionRequest, { baseVersionId: U(1), continueFrom: { cutPoint, points: points(200) }, note: 'Por el sendero del barranco' });
  bad(C.CreateVersionRequest, { baseVersionId: U(1) });
  bad(C.CreateVersionRequest, { baseVersionId: U(1), geometry, continueFrom: { cutPoint, points: points(1) } });
  bad(C.CreateVersionRequest, { baseVersionId: U(1), continueFrom: { cutPoint, points: [] } });
  bad(C.CreateVersionRequest, { baseVersionId: U(1), continueFrom: { cutPoint, points: points(201) } });
  bad(C.CreateVersionRequest, { baseVersionId: U(1), continueFrom: { cutPoint, points: points(1) }, calculationJobId: U(2) });
  bad(C.CreateVersionRequest, { baseVersionId: U(1), continueFrom: { cutPoint, points: points(1), elevation: 1200 } });
  bad(C.CreateVersionRequest, { baseVersionId: U(1), continueFrom: { points: points(1) } });
});

test('validar exige confirmar el aviso (RF-506)', () => {
  ok(C.ValidateVersionRequest, { acknowledged: true });
  bad(C.ValidateVersionRequest, { acknowledged: false });
  bad(C.ValidateVersionRequest, {});
});

test('generar: alternativas 1–4, valores por defecto y límites de puntos intermedios', () => {
  const g = C.GenerateRoutesRequest.parse({ from: { lat: 42, lon: 0 }, to: { lat: 42.5, lon: 0.5 }, namePrefix: 'Collado Norte' });
  assert.deepEqual([g.alternatives, g.via, g.avoidZoneIds], [3, [], []]);
  bad(C.GenerateRoutesRequest, { from: { lat: 42, lon: 0 }, to: { lat: 42.5, lon: 0.5 }, namePrefix: 'Collado Norte', alternatives: 5 });
  bad(C.GenerateRoutesRequest, { from: { lat: 42, lon: 0 }, to: { lat: 42.5, lon: 0.5 }, namePrefix: 'Collado Norte', alternatives: 0 });
});

test('generar: el nombre es obligatorio, se recorta y tiene como mucho 100 caracteres (RF-501)', () => {
  const points = { from: { lat: 42, lon: 0 }, to: { lat: 42.5, lon: 0.5 } };
  assert.equal(C.GenerateRoutesRequest.parse({ ...points, namePrefix: '  Collado Norte ' }).namePrefix, 'Collado Norte');
  bad(C.GenerateRoutesRequest, points);
  bad(C.GenerateRoutesRequest, { ...points, namePrefix: '' });
  bad(C.GenerateRoutesRequest, { ...points, namePrefix: '   ' });
  bad(C.GenerateRoutesRequest, { ...points, namePrefix: 'x'.repeat(101) });
});

test('trabajo: el resultado depende del tipo', () => {
  const base = { id: U(1), status: 'completed', progress: 100, errorCode: null, createdAt: '2026-10-29T10:00:00Z', finishedAt: '2026-10-29T10:01:00Z' };
  ok(C.Job, { ...base, kind: 'generate', result: { routeIds: [U(2)] } });
  bad(C.Job, { ...base, kind: 'generate', result: { candidate: {} } });
  ok(C.Job, { ...base, kind: 'generate', status: 'failed', errorCode: 'NO_ROUTE_POSSIBLE', result: null });
  bad(C.Job, { ...base, kind: 'generate', errorCode: 'SOMETHING', result: null });
});

test('entorno: misión o coordenadas, no ambos ni ninguno', () => {
  ok(C.EnvironmentQuery, { lat: '42.5', lon: '0.5' });
  ok(C.EnvironmentQuery, { missionId: U(1) });
  bad(C.EnvironmentQuery, { lat: '42.5' });
  bad(C.EnvironmentQuery, {});
  bad(C.EnvironmentQuery, { missionId: U(1), lat: '42', lon: '0' });
});

test('usuario: hay que indicar rol o estado; no se puede «rechazar» desde aquí', () => {
  ok(C.UpdateUserRequest, { role: 'coordinator' });
  ok(C.UpdateUserRequest, { accountStatus: 'disabled', reassignMissionsTo: U(1) });
  bad(C.UpdateUserRequest, {});
  bad(C.UpdateUserRequest, { accountStatus: 'rejected' });
});

test('eliminar mis datos exige la palabra de confirmación', () => {
  ok(C.DeleteMyDataRequest, { password: 'x', confirm: 'ELIMINAR' });
  bad(C.DeleteMyDataRequest, { password: 'x', confirm: 'eliminar' });
});

test('subida: solo dos finalidades', () => {
  ok(C.UploadFileFields, { purpose: 'certificate' });
  bad(C.UploadFileFields, { purpose: 'avatar' });
});

test('equipo: la localidad es obligatoria (INV-23)', () => {
  bad(C.CreateTeamRequest, { name: 'Rescate Huesca', code: 'HSC' });
  bad(C.CreateTeamRequest, { name: 'Rescate Huesca', locality: '  ', code: 'HSC' });
  bad(C.CreateTeamRequest, { name: 'Rescate Huesca', locality: 'Huesca' });
  bad(C.CreateTeamRequest, { name: 'Rescate Huesca', locality: 'Huesca', code: 'hsc' });
  ok(C.CreateTeamRequest, { name: 'Rescate Huesca', locality: 'Huesca', code: 'HSC' });
});

test('error: forma única', () => {
  ok(C.ErrorResponse, { error: { code: 'MISSION_CLOSED', message: 'x', requestId: 'r1' } });
  bad(C.ErrorResponse, { error: { code: 'NOPE', message: 'x', requestId: 'r1' } });
  assert.equal(C.httpStatusOf('NOT_FOUND'), 404);
  assert.equal(C.httpStatusOf('ACCOUNT_LOCKED'), 423);
});

test('ejemplos de respuesta válidos para los listados clave', () => {
  const t = { id: U(5), name: 'Rescate Huesca', locality: 'Huesca' };
  const item = { id: U(1), userId: U(2), displayName: 'Ana', teams: [t], status: 'pending', origin: 'volunteer', offeredAt: '2026-10-29T10:00:00Z', decidedAt: null };
  ok(C.ParticipationsPage, { items: [item], page: 1, pageSize: 25, total: 1, counts: { pending: 1, accepted: 0, notSelected: 0 } });
  bad(C.ParticipationListItem, { ...item, phone: '600' });
  bad(C.ParticipationListItem, { ...item, email: 'a@b.c' });
  ok(C.VolunteerCard, { participation: item, skills: [], contact: { phone: '600111222', email: 'ana@x.org' } });
  ok(C.VolunteerCard, { participation: item, skills: [], contact: null });
  bad(C.VolunteerCard, { participation: item, skills: [], contact: null, document: '123' });
  const sin = { ...item, teams: [] };
  ok(C.ParticipationListItem, sin);
});

test('las consultas con coordenadas aceptan texto y validan el rango', () => {
  assert.deepEqual(C.ElevationQuery.parse({ lat: '42.5', lon: '-0.5' }), { lat: 42.5, lon: -0.5 });
  bad(C.ElevationQuery, { lat: '95', lon: '0' });
  const n = C.NearRoutesQuery.parse({ lat: '42.5', lon: '0.5' });
  assert.deepEqual([n.radiusM, n.limit], [5000, 20]);
  bad(C.NearRoutesQuery, { lat: '42.5', lon: '0.5', radiusM: '10' });
  bad(C.EnvironmentQuery, { lat: '99', lon: '0' });
});

test('recuperar contraseña: correo normalizado, token de cualquier longitud (lo juzga el servidor), contraseña con el mismo mínimo que el registro', () => {
  assert.equal(C.ForgotPasswordRequest.parse({ email: 'Ana@Example.com' }).email, 'ana@example.com');
  ok(C.ResetPasswordRequest, { token: 'a'.repeat(43), newPassword: 'una-clave-larga-1' });
  ok(C.ResetPasswordRequest, { token: 'corto', newPassword: 'una-clave-larga-1' }); // un token mal formado es INVALID_RESET_TOKEN, no VALIDATION_FAILED
  bad(C.ResetPasswordRequest, { token: 12345, newPassword: 'una-clave-larga-1' });
  bad(C.ResetPasswordRequest, { token: 'a'.repeat(43), newPassword: 'corta' });
  assert.equal(C.httpStatusOf('INVALID_RESET_TOKEN'), 422);
});
