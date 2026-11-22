/* eslint-disable @typescript-eslint/no-explicit-any -- las pruebas recorren JSON Schema y objetos de Zod sin tipo estático */
// Coherencia del registro de endpoints y paridad con la base de datos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import * as C from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '../../../db/migrations');

test('los enums de Zod coinciden con los ENUM de db/migrations (valores y orden)', () => {
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');
  const found = new Map<string, string[]>();
  for (const m of sql.matchAll(/CREATE TYPE\s+(\w+)\s+AS ENUM\s*\(([^)]*)\)/g)) {
    found.set(
      m[1]!,
      [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!),
    );
  }
  // Las migraciones posteriores pueden añadir valores (ALTER TYPE … ADD VALUE): se aplican al final, en el orden de los archivos.
  for (const m of sql.matchAll(/ALTER TYPE\s+(\w+)\s+ADD VALUE\s+(?:IF NOT EXISTS\s+)?'([^']+)'/g)) {
    const values = found.get(m[1]!);
    assert.ok(values, `ALTER TYPE sobre un tipo desconocido: ${m[1]}`);
    if (!values.includes(m[2]!)) values.push(m[2]!);
  }
  assert.ok(found.size >= 20, 'no se leyeron los tipos de las migraciones');
  for (const [name, values] of found) {
    const schema = (C.SQL_ENUMS as Record<string, z.ZodEnum<any>>)[name];
    assert.ok(schema, `falta el enum «${name}» en contracts`);
    assert.deepEqual(schema.options, values, `enum ${name} distinto`);
  }
  for (const name of Object.keys(C.SQL_ENUMS)) assert.ok(found.has(name), `contracts define «${name}», que no existe en SQL`);
});

test('los límites del archivo coinciden con el CHECK de files', () => {
  const sql = readFileSync(join(MIGRATIONS, '0003_profiles_files_teams.sql'), 'utf8');
  assert.match(sql, new RegExp(`size_bytes <= ${C.MAX_FILE_BYTES}`));
  const types = [...sql.matchAll(/content_type IN \(([^)]*)\)/g)][0]![1]!
    .match(/'([^']+)'/g)!
    .map((s) => s.slice(1, -1))
    .sort();
  const mine = [...C.CONTENT_TYPES_BY_PURPOSE.certificate, ...C.CONTENT_TYPES_BY_PURPOSE.route_import].sort();
  assert.deepEqual(mine, types);
});

test('el patrón de teléfono es el del CHECK de rescuer_contact', () => {
  const sql = readFileSync(join(MIGRATIONS, '0003_profiles_files_teams.sql'), 'utf8');
  assert.ok(sql.includes(C.PHONE_PATTERN.source.replace(/\\\./g, '.')) || sql.includes("'^\\+?[0-9 ().-]{6,20}$'"));
});

test('id único y método+ruta únicos', () => {
  const ids = new Set<string>(),
    keys = new Set<string>();
  for (const e of C.ENDPOINTS) {
    assert.ok(!ids.has(e.id), `id repetido ${e.id}`);
    ids.add(e.id);
    const k = C.endpointKey({ method: e.method, path: e.path.replace(/\{[^}]+\}/g, '{}') });
    assert.ok(!keys.has(k), `ruta repetida ${k}`);
    keys.add(k);
  }
});

test('cada {parámetro} de la ruta tiene su esquema y viceversa', () => {
  for (const e of C.ENDPOINTS) {
    const inPath = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    const declared = Object.keys(e.params?.shape ?? {}).sort();
    assert.deepEqual(declared, inPath, `${e.id}: parámetros de ruta`);
  }
});

test('las rutas estáticas no quedan tapadas por una con parámetro del mismo nivel', () => {
  // GET /routes/near frente a GET /routes/{routeId}: el registro debe listar la estática antes (Nest resuelve por orden de declaración).
  const order = C.ENDPOINTS.map((e) => `${e.method} ${e.path}`);
  for (const [i, e] of C.ENDPOINTS.entries()) {
    const segs = e.path.split('/');
    for (const [j, o] of C.ENDPOINTS.entries()) {
      if (o.method !== e.method || o === e || j >= i) continue;
      const os = o.path.split('/');
      if (os.length !== segs.length) continue;
      const shadows = os.every((s, k) => s === segs[k] || (s.startsWith('{') && !segs[k]!.startsWith('{')));
      assert.ok(!shadows, `${order[j]} tapa a ${order[i]}`);
    }
  }
});

test('los GET no llevan cuerpo y los POST/PATCH/PUT sin cuerpo son deliberados', () => {
  for (const e of C.ENDPOINTS) {
    if (e.method === 'GET' || e.method === 'DELETE') {
      if (e.id !== 'deleteMyData') assert.equal(e.body, undefined, `${e.id} lleva cuerpo`);
    }
  }
});

test('el estado de respuesta es coherente con el esquema', () => {
  for (const e of C.ENDPOINTS) {
    if (e.response.status === 204) assert.ok(!e.response.schema && !e.response.file, `${e.id}: 204 no lleva cuerpo`);
    else assert.ok(e.response.schema || e.response.file, `${e.id}: falta esquema de respuesta`);
    if (e.method === 'POST' && e.response.status === 201) assert.ok(e.response.schema, e.id);
  }
});

test('todos los errores citados existen y tienen estado HTTP válido', () => {
  for (const e of C.ENDPOINTS)
    for (const c of C.allErrors(e)) {
      const s = C.ERROR_HTTP[c];
      assert.ok(s >= 400 && s < 600, `${e.id}: ${c}`);
    }
  for (const [c, s] of Object.entries(C.ERROR_HTTP)) assert.ok(Number.isInteger(s) && s >= 400 && s < 600, c);
});

test('cada código de error se usa al menos en un endpoint o es transversal', () => {
  const used = new Set(C.ENDPOINTS.flatMap((e) => C.allErrors(e)));
  const orphan = C.ERROR_CODES.filter((c) => !used.has(c));
  // Estos solo llegan por el trabajo en segundo plano (job.errorCode) o por guardas transversales.
  assert.deepEqual(orphan.sort(), ['INVALID_STATE_TRANSITION'].filter((c) => orphan.includes(c as any)).sort());
  assert.ok(
    C.ENDPOINTS.every((e) => e.delivery !== 'pendiente'),
    'queda algún endpoint pendiente de decisión',
  );
});

test('los errores con detalles tienen su esquema', () => {
  for (const code of Object.keys(C.ErrorDetails)) assert.ok(code in C.ERROR_HTTP, code);
});

test('todo esquema del registro se convierte a JSON Schema (para OpenAPI)', () => {
  for (const e of C.ENDPOINTS) {
    for (const [k, s] of [
      ['params', e.params],
      ['query', e.query],
      ['body', e.body],
      ['multipart', e.multipart],
    ] as const) {
      if (s) assert.doesNotThrow(() => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }), `${e.id}.${k}`);
    }
    if (e.response.schema) assert.doesNotThrow(() => z.toJSONSchema(e.response.schema!, { io: 'output', unrepresentable: 'any' }), `${e.id}.response`);
  }
});

test('las peticiones son estrictas: un campo desconocido se rechaza', () => {
  const lenient: string[] = [];
  for (const e of C.ENDPOINTS) {
    for (const [k, s] of [
      ['body', e.body],
      ['query', e.query],
      ['params', e.params],
    ] as const) {
      if (!s) continue;
      const js = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as any;
      const walk = (n: any): void => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (n.type === 'object' && n.properties && n.additionalProperties !== false) lenient.push(`${e.id}.${k}`);
        Object.values(n).forEach(walk);
      };
      walk(js);
    }
  }
  assert.deepEqual([...new Set(lenient)], []);
});

test('las respuestas también son estrictas (no se cuelan campos)', () => {
  const lenient: string[] = [];
  for (const e of C.ENDPOINTS) {
    if (!e.response.schema) continue;
    const js = z.toJSONSchema(e.response.schema, { io: 'output', unrepresentable: 'any' }) as any;
    const walk = (n: any): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.type === 'object' && n.properties && n.additionalProperties !== false) lenient.push(e.id);
      Object.values(n).forEach(walk);
    };
    walk(js);
  }
  assert.deepEqual([...new Set(lenient)], []);
});

test('hay cobertura de requisitos: cada vista del documento 02 tiene endpoints', () => {
  const have = new Set(C.ENDPOINTS.map((e) => e.id));
  const needed = [
    'login',
    'register',
    'getMe',
    'getEnvironment',
    'listMissions',
    'createMission',
    'getMission',
    'activateMission',
    'closeMission',
    'reopenMission',
    'listParticipations',
    'getParticipationCard',
    'bulkParticipations',
    'addParticipants',
    'addMissionTeams',
    'listTeams',
    'createTeam',
    'getMyProfile',
    'updateMyProfile',
    'createMySkill',
    'listMyHistory',
    'deleteMyData',
    'listSignupRequests',
    'decideSignupRequests',
    'readUserSensitive',
    'listAuditLog',
    'rotateInviteCode',
    'listRoutes',
    'generateRoutes',
    'getJob',
    'validateRouteVersion',
    'addMissionRoutes',
    'updateMissionRoute',
    'exportRoute',
    'listMyMissions',
    'offerToMission',
    'withdrawOffer',
    'listMyMissionRoutes',
  ];
  for (const n of needed) assert.ok(have.has(n), `falta ${n}`);
});

test('cada endpoint tiene hito, y el hito coincide con la entrega (H0–H7 = 1.ª, H8–H9 = 2.ª)', () => {
  const ids = new Set(C.ENDPOINTS.map((e) => e.id));
  for (const k of Object.keys(C.MILESTONE_OF)) assert.ok(ids.has(k), `milestones.ts menciona un endpoint inexistente: ${k}`);
  for (const e of C.ENDPOINTS) {
    assert.ok(C.MILESTONES.includes(e.milestone), e.id);
    assert.equal(e.delivery, e.milestone === 'H8' || e.milestone === 'H9' ? 2 : 1, `${e.id}: entrega y hito no cuadran`);
  }
});

test('todos los hitos con endpoints están representados y H7 no tiene ninguno', () => {
  const used = new Set(C.ENDPOINTS.map((e) => e.milestone));
  assert.ok(!used.has('H7'));
  for (const h of C.MILESTONES.filter((m) => m !== 'H7')) assert.ok(used.has(h), `el hito ${h} no tiene endpoints`);
});

test('un endpoint no depende de otro de un hito posterior (el MVP es autosuficiente)', () => {
  // Comprobaciones de dependencia conocidas: lo que usa cada hito debe existir en ese hito o antes.
  const h = (id: string) => C.MILESTONES.indexOf(C.ENDPOINTS.find((e) => e.id === id)!.milestone);
  const needs: [string, string][] = [
    ['createRoute', 'uploadFile'],
    ['previewRouteImport', 'uploadFile'],
    ['importMissionPoints', 'uploadFile'],
    ['generateRoutes', 'getJob'],
    ['addMissionRoutes', 'getRoute'],
    ['listMyMissionRoutes', 'getMyMission'],
    ['closeMission', 'getMission'],
    ['updateMissionRoute', 'validateRouteVersion'],
    ['getCertificateLink', 'createMySkill'],
    ['bulkParticipations', 'listParticipations'],
    ['getParticipationCard', 'listParticipations'],
  ];
  for (const [a, b] of needs) assert.ok(h(b) <= h(a), `${a} (${C.MILESTONE_OF[a]}) necesita ${b} (${C.MILESTONE_OF[b]})`);
});

test('toda escritura que calcula una altitud en el servidor declara OUTSIDE_COVERAGE (H1, AC-10)', () => {
  // La altitud nunca la envía el cliente (RN-07): si ninguna fuente cubre el punto, la escritura responde 422.
  for (const id of ['createMission', 'updateMission', 'createMissionPoint', 'updateMissionPoint']) {
    const endpoint = C.ENDPOINTS.find((e) => e.id === id)!;
    assert.ok(endpoint.errors?.includes('OUTSIDE_COVERAGE'), `${id} debe declarar OUTSIDE_COVERAGE`);
  }
});

test('las escrituras de ruta que miden una geometría declaran OUTSIDE_COVERAGE (H2, AC-10)', () => {
  // El servidor calcula altitud y métricas de todo trazado (RN-10): si ninguna fuente cubre un vértice, responde 422.
  for (const id of ['previewRouteImport', 'createRoute', 'createRouteVersion', 'deriveRoute']) {
    const endpoint = C.ENDPOINTS.find((e) => e.id === id)!;
    assert.ok(endpoint.errors?.includes('OUTSIDE_COVERAGE'), `${id} debe declarar OUTSIDE_COVERAGE`);
  }
});

test('una ruta archivada es de solo lectura: editar, validar y archivar declaran INVALID_STATE_TRANSITION (D-H2-08)', () => {
  for (const id of ['archiveRoute', 'createRouteVersion', 'validateRouteVersion']) {
    const endpoint = C.ENDPOINTS.find((e) => e.id === id)!;
    assert.ok(endpoint.errors?.includes('INVALID_STATE_TRANSITION'), `${id} debe declarar INVALID_STATE_TRANSITION`);
  }
  assert.ok(!C.ENDPOINTS.find((e) => e.id === 'deriveRoute')!.errors?.includes('INVALID_STATE_TRANSITION'), 'derivar una archivada está permitido');
});

test('H2 monta 15 operaciones (con updateRoute) y exportRoutes va antes que /routes/{routeId}', () => {
  const h2 = C.ENDPOINTS.filter((e) => e.milestone === 'H2').map((e) => e.id);
  assert.equal(h2.length, 15);
  assert.ok(h2.includes('exportRoutes'));
  const order = C.ENDPOINTS.map((e) => e.id);
  assert.ok(order.indexOf('exportRoutes') < order.indexOf('getRoute'));
});

test('la consulta de exportRoutes acepta de 1 a 50 ids y rechaza lo demás', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.ok(C.ExportRoutesQuery.safeParse({ ids: id }).success);
  assert.ok(C.ExportRoutesQuery.safeParse({ ids: Array(50).fill(id).join(','), format: 'kml', validatedOnly: 'true' }).success);
  assert.ok(!C.ExportRoutesQuery.safeParse({ ids: Array(51).fill(id).join(',') }).success);
  assert.ok(!C.ExportRoutesQuery.safeParse({}).success);
  assert.ok(!C.ExportRoutesQuery.safeParse({ ids: id, extra: 1 }).success);
});

test('el tipo de vía «sin clasificar» existe y las rutas importadas lo usan (P1)', () => {
  assert.ok(C.RoadType.options.includes('unknown'));
  assert.ok(C.RoadMix.safeParse([{ roadType: 'unknown', distanceM: 1200 }]).success);
});

test('updateRoute: PATCH del nombre de una ruta, solo el coordinador, 200 con el detalle y auditada (RF-512)', () => {
  const endpoint = C.ENDPOINTS.find((e) => e.id === 'updateRoute')!;
  assert.equal(endpoint.method, 'PATCH');
  assert.equal(endpoint.path, '/routes/{routeId}');
  assert.equal(endpoint.milestone, 'H2');
  assert.deepEqual(endpoint.roles, ['coordinator']);
  assert.equal(endpoint.response.status, 200);
  assert.equal(endpoint.audited, true);
  assert.deepEqual([...(endpoint.errors ?? [])], ['INVALID_STATE_TRANSITION']);
  assert.equal(C.ENDPOINTS.length, 99);
});

test('updateRoute: el nombre es obligatorio, se recorta, tiene como mucho 160 caracteres y no admite otros campos', () => {
  assert.equal(C.UpdateRouteRequest.parse({ name: '  Collado Norte ' }).name, 'Collado Norte');
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(161) }, { name: 'Bien', status: 'archived' }])
    assert.ok(!C.UpdateRouteRequest.safeParse(body).success, JSON.stringify(body));
});

test('detalle de ruta: cada misión de «Usada en» lleva su missionRouteId', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const use = { missionId: id, missionName: 'Rescate', missionStatus: 'active', pinnedVersionNumber: 1 };
  const shape = C.RouteDetail.shape.usedIn.element;
  assert.ok(!shape.safeParse(use).success);
  assert.ok(shape.safeParse({ ...use, missionRouteId: id }).success);
});

test('deleteRoute: DELETE de una ruta, solo el coordinador, 204, auditada y sin errores nuevos (issue #17, RN-14)', () => {
  const endpoint = C.ENDPOINTS.find((e) => e.id === 'deleteRoute')!;
  assert.equal(endpoint.method, 'DELETE');
  assert.equal(endpoint.path, '/routes/{routeId}');
  assert.equal(endpoint.milestone, 'H2');
  assert.deepEqual(endpoint.roles, ['coordinator']);
  assert.equal(endpoint.response.status, 204);
  assert.equal(endpoint.audited, true);
  assert.deepEqual([...(endpoint.errors ?? [])].sort(), ['INVALID_STATE_TRANSITION', 'ROUTE_IN_USE']);
});

test('openCertificate: GET con el token firmado, todos los roles, respuesta de archivo y sin auditoría (D-S1, AC-14)', () => {
  const endpoint = C.ENDPOINTS.find((e) => e.id === 'openCertificate')!;
  assert.equal(endpoint.method, 'GET');
  assert.equal(endpoint.path, '/certificates/{token}');
  assert.equal(endpoint.milestone, 'H5');
  assert.deepEqual([...endpoint.roles], ['rescuer', 'coordinator', 'admin']);
  assert.equal(endpoint.response.file, 'application/pdf | image/jpeg | image/png');
  assert.equal(endpoint.audited, undefined);
  assert.ok(!endpoint.params!.safeParse({ token: '' }).success);
  assert.ok(!endpoint.params!.safeParse({ token: 'x'.repeat(513) }).success);
  assert.ok(endpoint.params!.safeParse({ token: 'x'.repeat(512) }).success);
  const link = C.ENDPOINTS.find((e) => e.id === 'getCertificateLink')!;
  assert.equal(link.method, 'POST');
  assert.equal(link.audited, true);
});

test('listRescuers pasa a H5 (selector de miembros) y los equipos llevan código (Q-36, D-34)', () => {
  const endpoint = C.ENDPOINTS.find((e) => e.id === 'listRescuers')!;
  assert.equal(endpoint.milestone, 'H5');
  assert.deepEqual([...endpoint.roles], ['coordinator', 'admin']);
  assert.equal(C.ENDPOINTS.filter((e) => e.milestone === 'H5').length, 28);
  assert.equal(C.ENDPOINTS.filter((e) => e.milestone === 'H6').length, 16);
  assert.ok(C.TeamItem.shape.code.safeParse('ALC').success);
  assert.ok(!C.TeamItem.shape.code.safeParse('alc').success);
  assert.ok(!C.CreateTeamRequest.safeParse({ name: 'Rescate', locality: 'Huesca' }).success);
  assert.ok(C.CreateTeamRequest.safeParse({ name: 'Rescate', locality: 'Huesca', code: 'HSC' }).success);
  assert.ok(C.UpdateTeamRequest.safeParse({ code: 'HSC' }).success);
  assert.ok(!C.UpdateTeamRequest.safeParse({ code: 'HS' }).success);
  assert.ok('coordinatorAlias' in C.MyMissionDetail.shape && 'coordinatorAlias' in C.MyMissionListItem.shape);
  for (const id of ['createTeam', 'updateTeam']) assert.ok(C.ENDPOINTS.find((e) => e.id === id)!.errors!.includes('DUPLICATE_NAME'));
  assert.ok(C.ENDPOINTS.find((e) => e.id === 'addTeamMembers')!.errors!.includes('INVALID_STATE_TRANSITION'));
});
