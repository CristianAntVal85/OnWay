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
