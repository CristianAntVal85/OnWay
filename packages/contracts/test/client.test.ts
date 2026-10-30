// Cliente generado desde el registro (D-H0-14): operaciones, cabecera CSRF y errores como ApiError.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENDPOINTS, ApiError, ERROR_HTTP, type ErrorCode } from '../src/index.js';
import { renderClient } from '../scripts/client-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../gen/client.ts');

// Se genera aquí mismo para que la prueba no dependa de haber lanzado `gen:client` antes.
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, renderClient());
const generated = (await import(pathToFileURL(OUT).href)) as typeof import('../gen/client.js');

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body, credentials: init?.credentials };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fn, calls };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const BASE = 'http://localhost/api/v1';

test('el cliente expone exactamente las operaciones del registro', () => {
  const { fn } = fakeFetch(() => json(200, {}));
  const client = generated.createApiClient({ baseUrl: BASE, fetch: fn });
  assert.deepEqual(Object.keys(client).sort(), ENDPOINTS.map((e) => e.id).sort());
  assert.deepEqual(Object.keys(generated.OPERATIONS).sort(), ENDPOINTS.map((e) => e.id).sort());
  for (const e of ENDPOINTS) {
    const op = generated.OPERATIONS[e.id as keyof typeof generated.OPERATIONS];
    assert.equal(op.id, e.id);
    assert.equal(op.method, e.method, e.id);
    assert.equal(op.path, e.path, e.id);
    assert.equal(typeof (client as unknown as Record<string, unknown>)[e.id], 'function', e.id);
  }
});

test('GET: sin X-CSRF-Token, con credenciales y con la ruta y la consulta construidas', async () => {
  const { fn, calls } = fakeFetch(() => json(200, { items: [], page: 1 }));
  const client = generated.createApiClient({ baseUrl: BASE + '/', fetch: fn, getCsrfToken: () => 'tok' });
  await client.listMissions({ query: { q: 'a b&c' } });
  const call = calls[0]!;
  assert.equal(call.method, 'GET');
  assert.equal(call.headers.get('x-csrf-token'), null);
  assert.equal(call.credentials, 'include');
  assert.equal(call.url, `${BASE}/missions?q=a+b%26c`);
});

test('fuera de GET añade X-CSRF-Token, y el cuerpo va como JSON', async () => {
  const { fn, calls } = fakeFetch(() => new Response(null, { status: 204 }));
  const client = generated.createApiClient({ baseUrl: BASE, fetch: fn, getCsrfToken: () => 'tok-1' });
  const out = await client.logout();
  assert.equal(out, undefined);
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.headers.get('x-csrf-token'), 'tok-1');
  await client.changePassword({ body: { currentPassword: 'a', newPassword: 'bbbbbbbbbbbbbbbb' } });
  assert.equal(calls[1]!.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(String(calls[1]!.body)), { currentPassword: 'a', newPassword: 'bbbbbbbbbbbbbbbb' });
});

test('el token CSRF de login y getMe se guarda solo y se olvida al cerrar sesión', async () => {
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  const { fn, calls } = fakeFetch((c) => (c.url.endsWith('/auth/logout') ? new Response(null, { status: 204 }) : json(200, { user, csrfToken: 'from-login' })));
  const client = generated.createApiClient({ baseUrl: BASE, fetch: fn });
  await client.login({ body: { email: 'a@example.org', password: 'x' } });
  assert.equal(calls[0]!.headers.get('x-csrf-token'), null, 'login aún no tiene token');
  await client.logout();
  assert.equal(calls[1]!.headers.get('x-csrf-token'), 'from-login');
  await client.logout();
  assert.equal(calls[2]!.headers.get('x-csrf-token'), null, 'tras cerrar sesión no se reutiliza');
});

test('parámetros de ruta codificados', async () => {
  const { fn, calls } = fakeFetch(() => json(200, {}));
  const client = generated.createApiClient({ baseUrl: BASE, fetch: fn });
  await client.getMission({ params: { missionId: 'a/b c' as never } });
  assert.equal(calls[0]!.url, `${BASE}/missions/a%2Fb%20c`);
});

test('el cuerpo de error se convierte en ApiError con código, estado, requestId y detalles', async () => {
  const body = { error: { code: 'ACCOUNT_LOCKED', message: 'locked', requestId: 'req-1', details: { retryAfterSeconds: 60 } } };
  const { fn } = fakeFetch(() => json(423, body));
  const client = generated.createApiClient({ baseUrl: BASE, fetch: fn });
  await assert.rejects(client.login({ body: { email: 'a@example.org', password: 'x' } }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.code, 'ACCOUNT_LOCKED');
    assert.equal(e.status, 423);
    assert.equal(e.requestId, 'req-1');
    assert.deepEqual(e.details, { retryAfterSeconds: 60 });
    return true;
  });
});

test('cada código de ERROR_HTTP llega como ApiError con su código', async () => {
  for (const code of Object.keys(ERROR_HTTP) as ErrorCode[]) {
    const { fn } = fakeFetch(() => json(ERROR_HTTP[code], { error: { code, message: 'm', requestId: 'r' } }));
    const client = generated.createApiClient({ baseUrl: BASE, fetch: fn });
    await assert.rejects(client.getMe(), (e: unknown) => e instanceof ApiError && e.code === code && e.status === ERROR_HTTP[code]);
  }
});

test('respuestas de error que no siguen el formato y fallos de red también son ApiError', async () => {
  const html = fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'x-request-id': 'edge-9' } }));
  await assert.rejects(
    generated.createApiClient({ baseUrl: BASE, fetch: html.fn }).getHealth(),
    (e: unknown) => e instanceof ApiError && e.code === 'UPSTREAM_UNAVAILABLE' && e.status === 502 && e.requestId === 'edge-9',
  );
  const odd = fakeFetch(() => json(500, { oops: true }));
  await assert.rejects(generated.createApiClient({ baseUrl: BASE, fetch: odd.fn }).getHealth(), (e: unknown) => e instanceof ApiError && e.code === 'INTERNAL' && e.status === 500);
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  await assert.rejects(generated.createApiClient({ baseUrl: BASE, fetch: down }).getHealth(), (e: unknown) => e instanceof ApiError && e.code === 'UPSTREAM_UNAVAILABLE' && e.status === 0);
});

test('las descargas devuelven un Blob', async () => {
  const { fn } = fakeFetch(() => new Response('<gpx/>', { status: 200, headers: { 'content-type': 'application/gpx+xml' } }));
  const client = generated.createApiClient({ baseUrl: BASE, fetch: fn });
  const blob = await client.exportRoute({
    params: { routeId: '00000000-0000-4000-8000-000000000001' as never },
    query: { versionId: '00000000-0000-4000-8000-000000000002' as never, format: 'gpx' } as never,
  });
  assert.ok(blob instanceof Blob);
  assert.equal(await blob.text(), '<gpx/>');
});

// ---- Comprobaciones de tipos (las verifica `tsc` en `typecheck`) ----
export async function typeChecks(): Promise<void> {
  const c = generated.createApiClient();
  // @ts-expect-error login exige cuerpo
  await c.login();
  // @ts-expect-error el cuerpo es estricto: campo desconocido
  await c.login({ body: { email: 'a@example.org', password: 'x', extra: 1 } });
  // @ts-expect-error una operación inexistente no está en el cliente
  await c.noSuchOperation();
  const me = await c.getMe();
  const role: 'admin' | 'coordinator' | 'rescuer' | null = me.user.role;
  void role;
  // @ts-expect-error la respuesta no tiene campos inventados
  void me.user.nope;
}
