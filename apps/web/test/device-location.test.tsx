// INV-30 en el cliente (RN-26, RF-708, D-H1-10): la ubicación del dispositivo se pide con permiso, se redondea a ~1 km, vive solo
// en memoria y no se envía a nada salvo `getEnvironment`. Contra el cliente real, con el navegador simulado.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { es } from '@onway/i18n';
import { json, pending, renderApp, sessionServer, sessionUser, type Call } from './support';
import { CELL, EXACT, environment, mockGeolocation, restoreGeolocation } from './environment-support';

vi.mock('../src/map', () => ({ MAP_LAYERS: [], MapView: () => null }));

afterEach(() => restoreGeolocation());

const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, total: items.length });
const EXACT_TEXTS = [String(EXACT.latitude), String(EXACT.longitude), '42.6345', '0.1098'];

/** Todo lo que el navegador tiene escrito al lado de la página: almacenamiento, cookies, dirección, historial. */
function browserTraces(): string[] {
  const traces: string[] = [window.location.href, document.cookie, JSON.stringify(window.history.state)];
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)!;
      traces.push(key, store.getItem(key) ?? '');
    }
  }
  return traces;
}

const mentionsExact = (text: string) => EXACT_TEXTS.some((exact) => text.includes(exact));
const callText = (call: Call) => `${call.path}?${call.query.toString()} ${JSON.stringify(call.body ?? null)} ${[...call.headers.values()].join(' ')}`;

function grantedHome() {
  mockGeolocation('granted');
  const server = sessionServer({ user: sessionUser() }, { 'GET /missions': () => json(200, page([])), 'GET /environment': () => json(200, environment()) });
  const view = renderApp({ route: '/home', fetch: server.api.fetch });
  return { ...server, ...view, calls: () => server.api.calls };
}

describe('INV-30: la ubicación del dispositivo en el cliente', () => {
  it('la petición a getEnvironment lleva la coordenada ya redondeada a la celda de ~1 km, nunca la exacta', async () => {
    const { calls } = grantedHome();
    await screen.findByRole('heading', { level: 3, name: es.environment.weather.title });
    const [request] = calls().filter((c) => c.path === '/environment');
    expect(request!.query.get('lat')).toBe(CELL.lat);
    expect(request!.query.get('lon')).toBe(CELL.lon);
    expect(mentionsExact(callText(request!))).toBe(false);
  });

  it('ninguna otra petición lleva la ubicación, ni exacta ni redondeada', async () => {
    const { calls } = grantedHome();
    await screen.findByRole('heading', { level: 3, name: es.environment.weather.title });
    const others = calls().filter((c) => c.path !== '/environment');
    expect(others.length).toBeGreaterThan(0);
    for (const call of others) {
      expect(mentionsExact(callText(call)), call.path).toBe(false);
      expect(call.query.get('lat'), call.path).toBeNull();
    }
    // Y solo es una: getEnvironment.
    expect(
      calls()
        .filter((c) => c.query.has('lat') && c.query.has('lon'))
        .map((c) => c.path),
    ).toEqual(['/environment']);
  });

  it('no se escribe en localStorage, sessionStorage, cookies, la dirección de la página ni el historial', async () => {
    grantedHome();
    await screen.findByRole('heading', { level: 3, name: es.environment.weather.title });
    for (const trace of browserTraces()) {
      expect(mentionsExact(trace), trace).toBe(false);
      expect(trace).not.toContain(CELL.lat);
    }
    expect(window.location.search).toBe('');
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('tampoco en IndexedDB ni en la caché del navegador', async () => {
    const open = vi.fn();
    const caches = { open: vi.fn(), put: vi.fn() };
    vi.stubGlobal('indexedDB', { open });
    vi.stubGlobal('caches', caches);
    try {
      grantedHome();
      await screen.findByRole('heading', { level: 3, name: es.environment.weather.title });
      expect(open).not.toHaveBeenCalled();
      expect(caches.open).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('el código de la ubicación y del tiempo no usa almacenamiento del navegador', () => {
    const forbidden = /\b(localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open|navigator\.serviceWorker|watchPosition)\b/;
    const dir = join(import.meta.dirname, '../src/environment');
    const found = readdirSync(dir)
      .filter((name) => statSync(join(dir, name)).isFile())
      .flatMap((name) => {
        const source = readFileSync(join(dir, name), 'utf8')
          .split('\n')
          .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
          .join('\n');
        return forbidden.test(source) ? [relative(dir, join(dir, name))] : [];
      });
    expect(found).toEqual([]);
  });

  it('se pide una sola vez por sesión, también con varias vistas', async () => {
    const geolocation = mockGeolocation('granted');
    const { api } = sessionServer({ user: sessionUser() }, { 'GET /missions': () => json(200, page([])), 'GET /environment': () => json(200, environment()) });
    const { user } = renderApp({ route: '/home', fetch: api.fetch });
    await screen.findByRole('heading', { level: 3, name: es.environment.weather.title });
    await user.click(screen.getByRole('link', { name: es.nav.missions }));
    await screen.findByRole('heading', { level: 1, name: es.missions.title });
    await user.click(screen.getByRole('link', { name: es.nav.account }));
    await screen.findByRole('heading', { level: 1, name: es.account.title });
    expect(geolocation).toHaveBeenCalledTimes(1);
    expect(geolocation.mock.calls[0]![2]).toMatchObject({ enableHighAccuracy: false });
  });

  it('una cuenta pendiente, que no ve datos, no recibe la petición de permiso', async () => {
    const geolocation = mockGeolocation('granted');
    const { api } = sessionServer({ user: pending() });
    renderApp({ route: '/home', fetch: api.fetch });
    await screen.findByRole('heading', { level: 1, name: es.waiting.title });
    expect(geolocation).not.toHaveBeenCalled();
  });

  it('al cerrar sesión no queda rastro: ni en el navegador ni en una sesión siguiente', async () => {
    const geolocation = mockGeolocation('granted');
    const { api, state } = sessionServer({ user: sessionUser() }, { 'GET /missions': () => json(200, page([])), 'GET /environment': () => json(200, environment()) });
    state.accounts.set('coordinador@example.org', sessionUser());
    const { user } = renderApp({ route: '/account', fetch: api.fetch });
    await user.click(await screen.findByRole('button', { name: es.account.logout }));
    await screen.findByRole('heading', { level: 1, name: es.login.title });
    for (const trace of browserTraces()) expect(mentionsExact(trace), trace).toBe(false);
    expect(geolocation).toHaveBeenCalledTimes(1);

    // Una sesión nueva vuelve a pedir el permiso: la posición no sobrevive al cierre.
    await user.type(screen.getByLabelText(es.login.email), 'coordinador@example.org');
    await user.type(screen.getByLabelText(es.login.password), 'OnWay-demo-ficticia-2026{Enter}');
    await screen.findByRole('heading', { level: 1, name: es.account.title });
    expect(geolocation).toHaveBeenCalledTimes(2);
  });
});
