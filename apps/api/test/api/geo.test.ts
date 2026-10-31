import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { ERROR_HTTP, ElevationResponse, ErrorDetails, ErrorResponse, GeocodeResponse, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { SystemClock } from '../../src/clock/clock.js';
import { createElevationProvider, createGeocodingProvider } from '../../src/geo/config.js';
import { GeocodingRateLimitedError, GeocodingUnavailableError, InMemoryGeocodingProvider, type GeocodingProvider } from '../../src/geo/geocoding.js';
import { SYNTHETIC_COVERAGE, SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// `getElevation` and `geocode` (RF-302, RF-401, R-09) through the API, on real PostGIS for the sessions and roles. The
// providers are test implementations or the real adapters pointed at a local server: nothing here reaches the Internet.
let fixtures: Fixtures;
let coordinator: Member;
let admin: Member;
let rescuer: Member;
const sessions = new Map<string, Session>();
const apps: TestApp[] = [];

class FailingGeocoder implements GeocodingProvider {
  constructor(private readonly error: Error) {}
  async search(): Promise<never> {
    throw this.error;
  }
}

beforeAll(async () => {
  fixtures = new Fixtures(inject('database').owner);
  const orgId = await fixtures.organization('Geo org');
  const options = { password: TEST_PASSWORD };
  coordinator = await fixtures.member(orgId, 'coordinator', 'active', options);
  admin = await fixtures.member(orgId, 'admin', 'active', options);
  rescuer = await fixtures.member(orgId, 'rescuer', 'active', options);
});

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await fixtures?.close();
});

async function start(geo: Parameters<typeof startApp>[0]['geo'] = {}): Promise<TestApp> {
  const app = await startApp({ database: inject('database').app, geo });
  apps.push(app);
  return app;
}

async function get(app: TestApp, member: Member | null, path: string): Promise<Response> {
  if (!member) return fetch(`${app.baseUrl}${path}`);
  const key = `${app.baseUrl}|${member.userId}`;
  if (!sessions.has(key)) sessions.set(key, await mustLogin(app, member.email, TEST_PASSWORD));
  return fetch(`${app.baseUrl}${path}`, { headers: withSession(sessions.get(key)!, false) });
}

async function expectError(response: Response, code: ErrorCode) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed.error;
}

describe('getElevation', () => {
  it('answers the altitude of a point to a coordinator and an admin, in the shape the contract promises', async () => {
    const app = await start();
    for (const member of [coordinator, admin]) {
      const response = await get(app, member, '/geo/elevation?lat=42.63&lon=-0.1');
      expect(response.status).toBe(200);
      const body = ElevationResponse.parse(await response.json());
      expect(body.lat).toBe(42.63);
      expect(body.lon).toBe(-0.1);
      expect(body.elevationM).toBe(await new SyntheticElevationProvider().elevationAt({ lat: 42.63, lon: -0.1 }));
    }
  });

  it('is reserved to the staff: a rescuer gets 403 and nobody without a session gets in', async () => {
    const app = await start();
    await expectError(await get(app, rescuer, '/geo/elevation?lat=42.63&lon=-0.1'), 'FORBIDDEN');
    await expectError(await get(app, null, '/geo/elevation?lat=42.63&lon=-0.1'), 'UNAUTHENTICATED');
  });

  it('answers OUTSIDE_COVERAGE (422) when no source has the point', async () => {
    const app = await start();
    const outside = await get(app, coordinator, `/geo/elevation?lat=${SYNTHETIC_COVERAGE.north + 1}&lon=0`);
    await expectError(outside, 'OUTSIDE_COVERAGE');
  });

  it('rejects coordinates that are not coordinates', async () => {
    const app = await start();
    await expectError(await get(app, coordinator, '/geo/elevation?lat=95&lon=0'), 'VALIDATION_FAILED');
    await expectError(await get(app, coordinator, '/geo/elevation?lat=abc&lon=0'), 'VALIDATION_FAILED');
    await expectError(await get(app, coordinator, '/geo/elevation?lat=42'), 'VALIDATION_FAILED');
  });

  it('limits each user: past the burst it answers RATE_LIMITED with the seconds to wait, and other users are not affected (D-H1-09)', async () => {
    const app = await start({ elevationLimit: { burst: 3, perSecond: 0.01 } });
    for (let i = 0; i < 3; i += 1) expect((await get(app, coordinator, '/geo/elevation?lat=42.6&lon=0.6')).status).toBe(200);
    const error = await expectError(await get(app, coordinator, '/geo/elevation?lat=42.6&lon=0.6'), 'RATE_LIMITED');
    expect(ErrorDetails.RATE_LIMITED.parse(error.details).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect((await get(app, admin, '/geo/elevation?lat=42.6&lon=0.6')).status).toBe(200);
  });
});

describe('geocode', () => {
  it('searches an address for the staff and returns candidates with their country', async () => {
    const places = new InMemoryGeocodingProvider();
    const app = await start({ geocoding: places });
    const response = await get(app, coordinator, '/geo/geocode?q=Torla');
    expect(response.status).toBe(200);
    const body = GeocodeResponse.parse(await response.json());
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]).toMatchObject({ country: 'ES' });
    expect(places.queries).toEqual(['Torla']);
    expect(GeocodeResponse.parse(await (await get(app, admin, '/geo/geocode?q=Gavarnie')).json()).items[0]).toMatchObject({ country: 'FR' });
  });

  it('answers an empty list when nothing matches (a valid answer, not an error)', async () => {
    const app = await start();
    const response = await get(app, coordinator, '/geo/geocode?q=un-sitio-que-no-existe');
    expect(response.status).toBe(200);
    expect(GeocodeResponse.parse(await response.json()).items).toEqual([]);
  });

  it('is reserved to the staff and asks for at least 3 characters', async () => {
    const app = await start();
    await expectError(await get(app, rescuer, '/geo/geocode?q=Torla'), 'FORBIDDEN');
    await expectError(await get(app, coordinator, '/geo/geocode?q=To'), 'VALIDATION_FAILED');
    await expectError(await get(app, coordinator, '/geo/geocode'), 'VALIDATION_FAILED');
  });

  it('answers UPSTREAM_UNAVAILABLE (502) when the source is down and RATE_LIMITED (429) with retryAfterSeconds when its bucket is empty', async () => {
    const down = await start({ geocoding: new FailingGeocoder(new GeocodingUnavailableError('down')) });
    await expectError(await get(down, coordinator, '/geo/geocode?q=Torla'), 'UPSTREAM_UNAVAILABLE');

    const busy = await start({ geocoding: new FailingGeocoder(new GeocodingRateLimitedError(3)) });
    const error = await expectError(await get(busy, coordinator, '/geo/geocode?q=Torla'), 'RATE_LIMITED');
    expect(ErrorDetails.RATE_LIMITED.parse(error.details)).toEqual({ retryAfterSeconds: 3 });
  });
});

describe('the real adapters, wired as main.ts wires them, against local servers', () => {
  let server: Server;
  const received: { path: string; agent: string | undefined }[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '', 'http://stub');
      received.push({ path: url.pathname, agent: request.headers['user-agent'] });
      response.setHeader('content-type', 'application/json');
      if (url.pathname === '/v1/elevation') return void response.end(JSON.stringify({ elevation: [345.0] }));
      if (url.pathname === '/search' && url.searchParams.get('q') === 'Torla') {
        return void response.end(JSON.stringify([{ lat: '42.6297', lon: '-0.1', display_name: 'Torla (ficticio)', address: { country_code: 'es' } }]));
      }
      if (url.pathname === '/search' && url.searchParams.get('q') === 'caida503') return void response.writeHead(503).end('{}');
      response.end('[]');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  });
  afterAll(async () => void (await new Promise((done) => server?.close(done))));

  it('reads the DEM tiles inside their box, asks the remote source outside it and says OUTSIDE_COVERAGE when neither has the point', async () => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const env = {
      ELEVATION_DEM_DIR: resolve(import.meta.dirname, '../../../../data/seed/dem'),
      OPEN_METEO_ELEVATION_URL: `${base}/v1/elevation`,
      NOMINATIM_URL: `${base}/search`,
      NOMINATIM_CONTACT: 'tests@example.org',
    };
    const app = await start({ elevation: createElevationProvider(env), geocoding: createGeocodingProvider(new SystemClock(), env) });
    const inside = ElevationResponse.parse(await (await get(app, coordinator, '/geo/elevation?lat=42.63&lon=-0.1')).json());
    expect(inside.elevationM).toBe(await new SyntheticElevationProvider().elevationAt({ lat: 42.63, lon: -0.1 }));
    expect(received.filter((r) => r.path === '/v1/elevation')).toHaveLength(0);

    const outside = ElevationResponse.parse(await (await get(app, coordinator, '/geo/elevation?lat=45.5&lon=2.1')).json());
    expect(outside.elevationM).toBe(345);
    expect(received.filter((r) => r.path === '/v1/elevation')).toHaveLength(1);
    expect(received.find((r) => r.path === '/v1/elevation')?.agent).toBe('OnWay/0.1 (+tests@example.org)');

    const found = GeocodeResponse.parse(await (await get(app, coordinator, '/geo/geocode?q=Torla')).json());
    expect(found.items).toEqual([{ label: 'Torla (ficticio)', lat: 42.6297, lon: -0.1, country: 'ES' }]);
    expect(received.find((r) => r.path === '/search')?.agent).toBe('OnWay/0.1 (+tests@example.org)');

    await new Promise((done) => setTimeout(done, 1100)); // the 1 request/s bucket of the real adapter
    await expectError(await get(app, coordinator, '/geo/geocode?q=caida503'), 'UPSTREAM_UNAVAILABLE');

    const nowhere = createElevationProvider({ ...env, ELEVATION_DEM_DIR: '/nonexistent' }, { remote: false });
    expect(await nowhere.elevationAt({ lat: 42.6, lon: 0.6 })).toBeNull();
  });
});
