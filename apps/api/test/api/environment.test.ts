import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ERROR_HTTP, EnvironmentResponse, ErrorResponse, MissionDetail, type ErrorCode } from '@onway/contracts';
import { elevationBand, moonLight, roundToCell, sunLight } from '@onway/geo';
import type { z } from 'zod';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';
import { FAILURE_BACKOFF_MS } from '../../src/weather/weather.service.js';
import { FORECAST_TTL_MS } from '../../src/weather/forecast-cache.js';
import { InMemoryWeatherProvider } from '../../src/weather/in-memory-weather.js';
import { OpenMeteoWeatherProvider } from '../../src/weather/open-meteo-weather.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { FixedClock } from '../support/clock.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// H1-T5 on real PostGIS: `getEnvironment` (RF-704, RF-705, RF-708), INV-30, INV-08, INV-01, R-06, D-H1-10..12.
// The weather provider is the in-memory test implementation: nothing here reaches the Internet.
type Environment = z.infer<typeof EnvironmentResponse>;

const elevation = new SyntheticElevationProvider();

// A new app, clock and provider for every test: the backoff after a failure and the passive health live in the app, and a
// test must not inherit them from the one before.
let clock: FixedClock;
let weather: InMemoryWeatherProvider;
let fixtures: Fixtures;
let app: TestApp;
let coordinator: Member;
let admin: Member;
let rescuer: Member;
let otherCoordinator: Member;
let otherRescuer: Member;
const sessions = new Map<string, Session>();

beforeAll(async () => {
  const { owner } = inject('database');
  fixtures = new Fixtures(owner);
  const options = { password: TEST_PASSWORD };
  const orgA = await fixtures.organization('Env org A');
  coordinator = await fixtures.member(orgA, 'coordinator', 'active', options);
  admin = await fixtures.member(orgA, 'admin', 'active', options);
  rescuer = await fixtures.member(orgA, 'rescuer', 'active', options);
  const orgB = await fixtures.organization('Env org B');
  otherCoordinator = await fixtures.member(orgB, 'coordinator', 'active', options);
  otherRescuer = await fixtures.member(orgB, 'rescuer', 'active', options);
});

afterAll(async () => {
  await fixtures?.close();
});

beforeEach(async () => {
  await fixtures.query('DELETE FROM forecast_cache');
  clock = new FixedClock(new Date());
  weather = new InMemoryWeatherProvider(clock);
  app = await startApp({ database: inject('database').app, clock, weather: { provider: weather } });
});

afterEach(async () => {
  await app?.close();
});

async function sessionOf(member: Member, target = app): Promise<Session> {
  const key = `${target.baseUrl}|${member.userId}`;
  if (!sessions.has(key)) sessions.set(key, await mustLogin(target, member.email, TEST_PASSWORD));
  return sessions.get(key)!;
}
async function call(member: Member, method: string, path: string, body?: unknown, target = app): Promise<Response> {
  const session = await sessionOf(member, target);
  return fetch(`${target.baseUrl}${path}`, {
    method,
    headers: { ...withSession(session, method !== 'GET'), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const environment = (member: Member, query: string, target = app) => call(member, 'GET', `/environment?${query}`, undefined, target);
async function ok(response: Response): Promise<Environment> {
  expect(response.status).toBe(200);
  return EnvironmentResponse.parse(await response.json());
}
async function expectError(response: Response, code: ErrorCode) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed.error;
}

const uniq = (label: string) => `${label} ${randomBytes(4).toString('hex')}`;
async function createMission(member: Member, lat: number, lon: number, activate = false): Promise<z.infer<typeof MissionDetail>> {
  const created = await call(member, 'POST', '/missions', { name: uniq('Env mission'), target: { source: 'map', lat, lon } });
  expect(created.status).toBe(201);
  const mission = MissionDetail.parse(await created.json());
  if (!activate) return mission;
  const activated = await call(member, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: true });
  expect(activated.status).toBe(200);
  return MissionDetail.parse(await activated.json());
}
const cacheRows = () =>
  fixtures.query<{ provider: string; cell_lat: string; cell_lon: string; elevation_band: number; data: unknown }>('SELECT * FROM forecast_cache ORDER BY cell_lat, cell_lon, elevation_band');

const EXACT = { lat: 42.634567, lon: -0.104321 };
const CELL = roundToCell(EXACT);
const query = (p: { lat: number; lon: number }, extra = '') => `lat=${p.lat}&lon=${p.lon}${extra}`;
const synthetic = async (p: { lat: number; lon: number }) => (await elevation.elevationAt(p))!;

describe('getEnvironment for the device position (RF-704, RF-705, RF-708)', () => {
  it('answers weather, sun and moon in the shape of the contract, for the ~1 km cell and not for the exact point', async () => {
    const body = await ok(await environment(coordinator, query(EXACT)));
    expect(body.basis).toBe('device');
    expect(body.missionId).toBeNull();
    expect(body.location).toEqual({ ...CELL, elevationM: await synthetic(CELL), country: null });
    expect(body.weather.status).toBe('ok');
    expect(body.weather.provider).toBe('in-memory');
    expect(body.weather.fetchedAt).toBe(clock.now().toISOString());
    expect(body.weather.current).not.toBeNull();
    expect(body.bulletins).toEqual([]);
  });

  it('computes sun and moon with @onway/geo for the instant of the clock (D-H1-11)', async () => {
    const body = await ok(await environment(coordinator, query(EXACT)));
    expect(body.sun).toEqual(sunLight(clock.now(), CELL));
    expect(body.moon).toEqual(moonLight(clock.now(), CELL));
  });

  it('serves every role with a session, admin and rescuer included', async () => {
    for (const member of [coordinator, admin, rescuer]) await ok(await environment(member, query(EXACT)));
  });

  it('gives the next `days` days from the current hour on (3 by default)', async () => {
    const start = Math.floor(clock.now().getTime() / 3_600_000) * 3_600_000;
    const normal = await ok(await environment(coordinator, query(EXACT)));
    expect(normal.weather.daily).toHaveLength(3);
    expect(normal.weather.hourly).toHaveLength(72);
    expect(Date.parse(normal.weather.hourly[0]!.time)).toBe(start);
    const one = await ok(await environment(coordinator, query(EXACT, '&days=1')));
    expect([one.weather.daily.length, one.weather.hourly.length]).toEqual([1, 24]);
    const week = await ok(await environment(coordinator, query(EXACT, '&days=7')));
    expect([week.weather.daily.length, week.weather.hourly.length]).toEqual([7, 168 - new Date(start).getUTCHours()]);
    expect(weather.calls).toHaveLength(1); // the cache has no `days`: one call serves all three
  });

  it('answers OUTSIDE_COVERAGE when no elevation source covers the point, without calling the weather provider', async () => {
    await expectError(await environment(coordinator, query({ lat: 10, lon: 10 })), 'OUTSIDE_COVERAGE');
    expect(weather.calls).toEqual([]);
  });

  it('validates the query: a place or a mission, not both, not neither, not half; 1 to 7 days', async () => {
    const mission = await createMission(coordinator, 42.6, 0.65);
    for (const bad of ['', 'lat=42.6', 'lon=0.5', `${query(EXACT)}&missionId=${mission.id}`, `${query(EXACT)}&days=0`, `${query(EXACT)}&days=8`, 'missionId=not-a-uuid', 'lat=91&lon=0']) {
      await expectError(await environment(coordinator, bad), 'VALIDATION_FAILED');
    }
  });

  it('needs a session', async () => {
    await expectError(await fetch(`${app.baseUrl}/environment?${query(EXACT)}`), 'UNAUTHENTICATED');
  });
});

describe('getEnvironment for the target of a mission', () => {
  it('uses the target and its stored altitude, for the staff, in any status', async () => {
    const planning = await createMission(coordinator, 42.6, 0.65);
    for (const member of [coordinator, admin]) {
      const body = await ok(await environment(member, `missionId=${planning.id}`));
      expect(body).toMatchObject({ basis: 'mission', missionId: planning.id });
      expect(body.location).toEqual({ lat: 42.6, lon: 0.65, elevationM: planning.target.elevationM, country: planning.target.country });
      expect(body.sun).toEqual(sunLight(clock.now(), { lat: 42.6, lon: 0.65 }));
    }
  });

  it('INV-08: a rescuer gets the mission once it is active, and 404 while it is in planning', async () => {
    const mission = await createMission(coordinator, 42.61, 0.66);
    await expectError(await environment(rescuer, `missionId=${mission.id}`), 'NOT_FOUND');
    expect(weather.calls).toEqual([]);
    await call(coordinator, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: true });
    expect(await ok(await environment(rescuer, `missionId=${mission.id}`))).toMatchObject({ basis: 'mission', missionId: mission.id });
  });

  it('INV-01: another organization gets 404 for a planning or an active mission, and for one that does not exist; nothing is called', async () => {
    const planning = await createMission(coordinator, 42.62, 0.67);
    const active = await createMission(coordinator, 42.63, 0.68, true);
    for (const member of [otherCoordinator, otherRescuer]) {
      for (const id of [planning.id, active.id, '00000000-0000-4000-8000-000000000000']) await expectError(await environment(member, `missionId=${id}`), 'NOT_FOUND');
    }
    expect(weather.calls).toEqual([]);
    expect(await cacheRows()).toEqual([]);
  });
});

describe('the cache by cell and altitude band (R-06, R-09, D-H1-12)', () => {
  it('asks the provider for OUR altitude, taken to its 100 m band (R-06), at the center of the cell', async () => {
    const body = await ok(await environment(coordinator, query(EXACT)));
    expect(weather.calls).toEqual([{ lat: CELL.lat, lon: CELL.lon, elevationM: elevationBand(body.location.elevationM) }]);
    expect(weather.calls[0]!.elevationM % 100).toBe(0);
  });

  it('shares one forecast between positions in the same cell, in any role, and stores one row in the cell', async () => {
    await ok(await environment(coordinator, query(EXACT)));
    await ok(await environment(rescuer, query({ lat: 42.6349, lon: -0.1049 })));
    await ok(await environment(admin, query({ lat: 42.63, lon: -0.1 })));
    expect(weather.calls).toHaveLength(1);
    const rows = await cacheRows();
    expect(rows).toHaveLength(1);
    expect([Number(rows[0]!.cell_lat), Number(rows[0]!.cell_lon)]).toEqual([CELL.lat, CELL.lon]);
  });

  it('asks again for another cell and for another altitude band of the same cell', async () => {
    await ok(await environment(coordinator, query(EXACT)));
    await ok(await environment(coordinator, query({ lat: 42.65, lon: -0.1 })));
    expect(weather.calls).toHaveLength(2);

    // Two mission targets in one cell whose altitudes fall in different bands (the made-up terrain climbs steeply).
    const lat0 = 42.6;
    const target = (dLat: number) => ({ lat: Math.round((lat0 + dLat) * 1e5) / 1e5, lon: 0.65 });
    let pair: [{ lat: number; lon: number }, { lat: number; lon: number }] | null = null;
    for (let i = 1; i <= 4 && !pair; i++) {
      const [a, b] = [target(0), target(i / 1000)];
      if (elevationBand(await synthetic(a)) !== elevationBand(await synthetic(b))) pair = [a, b];
    }
    expect(pair, 'the made-up terrain must change band inside a cell').not.toBeNull();
    expect(roundToCell(pair![0])).toEqual(roundToCell(pair![1]));
    weather.calls.length = 0;
    for (const place of pair!) await ok(await environment(coordinator, `missionId=${(await createMission(coordinator, place.lat, place.lon)).id}`));
    expect(weather.calls).toHaveLength(2);
    expect(new Set(weather.calls.map((c) => c.elevationM)).size).toBe(2);
    expect(new Set(weather.calls.map((c) => `${c.lat},${c.lon}`)).size).toBe(1);
  });

  it('refreshes after 3 hours and keeps the time of the data', async () => {
    const first = await ok(await environment(coordinator, query(EXACT)));
    clock.advance(FORECAST_TTL_MS - 1);
    await ok(await environment(coordinator, query(EXACT)));
    expect(weather.calls).toHaveLength(1);
    clock.advance(1);
    const later = await ok(await environment(coordinator, query(EXACT)));
    expect(weather.calls).toHaveLength(2);
    expect(Date.parse(later.weather.fetchedAt!) - Date.parse(first.weather.fetchedAt!)).toBe(FORECAST_TTL_MS);
  });

  it('makes a single call when simultaneous requests ask for the same cell (R-09)', async () => {
    let release!: () => void;
    weather.hold = new Promise<void>((resolve) => (release = resolve));
    const pending = Array.from({ length: 5 }, (_, i) => environment([coordinator, admin, rescuer][i % 3]!, query(EXACT)));
    await vi.waitFor(() => expect(weather.calls).toHaveLength(1), { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 150)); // time for the others to arrive and wait
    release();
    const bodies = await Promise.all(pending.map((response) => response.then(ok)));
    expect(weather.calls).toHaveLength(1);
    expect(new Set(bodies.map((b) => b.weather.fetchedAt)).size).toBe(1);
    for (const b of bodies) expect(b.weather.status).toBe('ok');
    expect(await cacheRows()).toHaveLength(1);
  });
});

describe('the provider fails: 200 with stale or unavailable (doc 06), never an HTTP error', () => {
  it('unavailable when there is nothing cached, and sun and moon still answer', async () => {
    weather.failing = true;
    const body = await ok(await environment(coordinator, query(EXACT)));
    expect(body.weather).toEqual({ status: 'unavailable', provider: null, fetchedAt: null, current: null, hourly: [], daily: [] });
    expect(body.sun).toEqual(sunLight(clock.now(), CELL));
    expect(body.moon.phaseName).toBeTruthy();
    expect(await cacheRows()).toEqual([]);
  });

  it('stale, with the last data and its time, when the cached one has expired', async () => {
    const fresh = await ok(await environment(coordinator, query(EXACT)));
    clock.advance(FORECAST_TTL_MS + 60_000);
    weather.failing = true;
    const body = await ok(await environment(coordinator, query(EXACT)));
    expect(body.weather.status).toBe('stale');
    expect(body.weather.fetchedAt).toBe(fresh.weather.fetchedAt);
    expect(body.weather.current).toEqual(fresh.weather.current);
    expect(body.weather.provider).toBe('in-memory');
  });

  it('does not call a provider that has just failed again for the same cell, and recovers when time has passed', async () => {
    weather.failing = true;
    await ok(await environment(coordinator, query(EXACT)));
    await ok(await environment(coordinator, query(EXACT)));
    expect(weather.calls).toHaveLength(1);
    await ok(await environment(coordinator, query({ lat: 42.7, lon: -0.1 }))); // another cell is not held back
    expect(weather.calls).toHaveLength(2);
    weather.failing = false;
    clock.advance(FAILURE_BACKOFF_MS);
    expect((await ok(await environment(coordinator, query(EXACT)))).weather.status).toBe('ok');
    expect(weather.calls).toHaveLength(3);
  });

  it('getHealth follows the last real call and never makes one (D-H1-12)', async () => {
    const health = async () => (await (await fetch(`${app.baseUrl}/health`)).json()) as { status: string; checks: { weatherProvider: boolean } };
    expect(await health()).toMatchObject({ status: 'ok', checks: { weatherProvider: true } });
    expect(weather.calls).toEqual([]);

    weather.failing = true;
    await ok(await environment(coordinator, query(EXACT)));
    expect(await health()).toMatchObject({ status: 'degraded', checks: { weatherProvider: false } });
    expect(weather.calls).toHaveLength(1); // asking for the health added no call

    weather.failing = false;
    clock.advance(FAILURE_BACKOFF_MS);
    await ok(await environment(coordinator, query(EXACT)));
    expect(await health()).toMatchObject({ status: 'ok', checks: { weatherProvider: true } });
  });
});

describe('INV-30: the position of the device is not kept (RN-26)', () => {
  /** Every table of the schema as text, read as `onway_owner`: if the exact position were anywhere, it would show. */
  async function tablesHolding(...needles: string[]): Promise<string[]> {
    const tables = await fixtures.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
    const found: string[] = [];
    for (const { table_name } of tables) {
      const rows = await fixtures.query<{ doc: string }>(`SELECT t::text AS doc FROM "${table_name}" t`);
      if (rows.some((r) => needles.some((n) => r.doc.includes(n)))) found.push(table_name);
    }
    return found;
  }

  it('no table holds the exact position; the only trace is the rounded cell, without user or organization', async () => {
    const auditBefore = (await fixtures.query<{ n: string }>('SELECT count(*) AS n FROM audit_log'))[0]!.n;
    await ok(await environment(coordinator, query(EXACT)));
    await ok(await environment(rescuer, query(EXACT)));
    weather.failing = true;
    await ok(await environment(admin, query({ lat: 42.911111, lon: 0.222222 }))); // a failed call too

    expect(await tablesHolding('42.634567', '-0.104321', '0.104321', '42.911111', '0.222222')).toEqual([]);
    expect((await fixtures.query<{ n: string }>('SELECT count(*) AS n FROM audit_log'))[0]!.n).toBe(auditBefore);

    const rows = await cacheRows();
    expect(rows).toHaveLength(1);
    expect([Number(rows[0]!.cell_lat), Number(rows[0]!.cell_lon)]).toEqual([CELL.lat, CELL.lon]);
    const columns = await fixtures.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'forecast_cache'`);
    expect(columns.map((c) => c.column_name).sort()).toEqual(['cell_lat', 'cell_lon', 'data', 'elevation_band', 'expires_at', 'fetched_at', 'provider']);
  });

  it('the logs of the API do not contain the position, in successes, failures and errors, and the access line carries no query string', async () => {
    // The REAL Open-Meteo adapter, fed by a fetch that answers with the recorded forecast, or with a 503 for one cell.
    const recorded = readFileSync(new URL('../fixtures/open-meteo-forecast.json', import.meta.url), 'utf8');
    const stubbedFetch = (async (url: URL) =>
      url.searchParams.get('latitude') === '42.56'
        ? new Response('down', { status: 503 })
        : new Response(recorded, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const adapter = new OpenMeteoWeatherProvider({ baseUrl: 'https://weather.invalid/v1/forecast', fetch: stubbedFetch });
    const loud = await startApp({ database: inject('database').app, clock, weather: { provider: adapter } });

    // Everything the API writes through Nest's logger, with its arguments, is collected in `logged`.
    const logged: string[] = [];
    const collect = (...args: unknown[]) => void logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    Logger.overrideLogger({ log: collect, warn: collect, error: collect, debug: collect, verbose: collect, fatal: collect });
    try {
      await ok(await environment(coordinator, query(EXACT), loud));
      await ok(await environment(rescuer, query({ lat: 42.987654, lon: 0.123456 }), loud));
      await ok(await environment(coordinator, query({ lat: 42.55555, lon: 0.33333 }), loud)); // the provider answers 503
      await expectError(await environment(coordinator, query({ lat: 10.123456, lon: 10.654321 }), loud), 'OUTSIDE_COVERAGE');
      await expectError(await environment(coordinator, 'lat=91.123456&lon=0', loud), 'VALIDATION_FAILED');
    } finally {
      Logger.overrideLogger(false);
      await loud.close();
    }
    const text = logged.join('\n');
    expect(text).toMatch(/GET \/api\/v1\/environment 200 \d+ ms/); // the capture works and the access line is there
    expect(text).toMatch(/weather source answered 503/); // and so is the warning of the failed call
    for (const needle of ['42.634567', '-0.104321', '0.104321', '42.987654', '0.123456', '42.55555', '0.33333', '10.123456', '10.654321', '91.123456', 'lat=', 'lon=', '42.63', '42.56']) {
      expect(text, needle).not.toContain(needle);
    }
  });
});
