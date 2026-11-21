import { randomBytes } from 'node:crypto';
import { parseTrack } from '@onway/geo';
import { CreatedRoute, ERROR_HTTP, ErrorResponse, FileRef, MissionDetail, RouteDetail, RoutesPage, RouteVersionDetail, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { InMemoryFileStorage } from '../../src/files/file-storage.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { FixedClock } from '../support/clock.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// listRoutes, getRoute, getRouteVersion, exportRoute and exportRoutes (H2-T6) on real PostGIS.
let app: TestApp;
let fixtures: Fixtures;
const storage = new InMemoryFileStorage();
const clock = new FixedClock(new Date());

interface Org {
  orgId: string;
  admin: Member;
  coordinator: Member;
  rescuer: Member;
}
let a: Org;
let b: Org;
let applicant: Member;
const sessions = new Map<string, Session>();
const options = { password: TEST_PASSWORD };

async function build(label: string): Promise<Org> {
  const orgId = await fixtures.organization(label);
  return {
    orgId,
    admin: await fixtures.member(orgId, 'admin', 'active', options),
    coordinator: await fixtures.member(orgId, 'coordinator', 'active', options),
    rescuer: await fixtures.member(orgId, 'rescuer', 'active', options),
  };
}

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  // The clock moves by months in some tests (isStale): the sessions must outlive it.
  app = await startApp({ database: appConnection, files: { storage }, clock, identity: { sessionTtlMs: 3000 * 86_400_000 } });
  a = await build('Org A');
  b = await build('Org B');
  applicant = await fixtures.applicant(a.orgId, 'pending', options);
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

async function sessionOf(member: Member): Promise<Session> {
  if (!sessions.has(member.userId)) sessions.set(member.userId, await mustLogin(app, member.email, TEST_PASSWORD));
  return sessions.get(member.userId)!;
}

async function call(member: Member, method: string, path: string, body?: unknown): Promise<Response> {
  const session = await sessionOf(member);
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { ...withSession(session, method !== 'GET'), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectError(response: Response, code: ErrorCode) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed.error;
}

const uniq = (label: string) => `${label} ${randomBytes(4).toString('hex')}`;
/** A diagonal line of `count` points starting at (lon, lat) — inside the Pyrenees, where every elevation source answers. */
const line = (lon: number, lat: number, count = 6, step = 0.0012) => ({
  type: 'LineString' as const,
  coordinates: Array.from({ length: count }, (_, i) => [lon + i * step, lat + i * step * 0.75] as [number, number]),
});

async function createDrawn(member: Member, geometry = line(0.65, 42.6), name = uniq('Route'), extra: Record<string, unknown> = {}) {
  const response = await call(member, 'POST', '/routes', { source: 'drawn', name, geometry, ...extra });
  expect(response.status).toBe(201);
  return { ...CreatedRoute.parse(await response.json()), name };
}
const validate = async (member: Member, route: { routeId: string; versionId: string }) =>
  expect((await call(member, 'POST', `/routes/${route.routeId}/versions/${route.versionId}/validate`, { acknowledged: true })).status).toBe(200);
const list = async (member: Member, query: string) => {
  const response = await call(member, 'GET', `/routes?${query}`);
  expect(response.status).toBe(200);
  return RoutesPage.parse(await response.json());
};
const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);

describe('listRoutes: filters, order and pages (RF-502, RF-512, D-H2-11)', () => {
  it('bbox: returns only what intersects the visible area, boundary included, and nothing from the other side', async () => {
    const tag = uniq('bbox');
    const west = await createDrawn(a.coordinator, line(-0.9, 42.3), `${tag} west`);
    const east = await createDrawn(a.coordinator, line(0.8, 42.3), `${tag} east`);
    const onlyWest = await list(a.coordinator, `q=${encodeURIComponent(tag)}&bbox=-1,42,0,43`);
    expect(ids(onlyWest)).toEqual([west.routeId]);
    expect(ids(await list(a.coordinator, `q=${encodeURIComponent(tag)}&bbox=0,42,1,43`))).toEqual([east.routeId]);
    expect(ids(await list(a.coordinator, `q=${encodeURIComponent(tag)}&bbox=-1,42,1,43`)).sort()).toEqual([west.routeId, east.routeId].sort());
    expect(ids(await list(a.coordinator, `q=${encodeURIComponent(tag)}&bbox=2,42,3,43`))).toEqual([]);
    // A box that touches the line at one vertex still counts as intersecting.
    const first = line(-0.9, 42.3).coordinates[0]!;
    expect(ids(await list(a.coordinator, `q=${encodeURIComponent(tag)}&bbox=${first[0]},${first[1]},${first[0] + 0.5},${first[1] + 0.5}`))).toEqual([west.routeId]);
    await expectError(await call(a.coordinator, 'GET', '/routes?bbox=1,2,0,3'), 'VALIDATION_FAILED');
  });

  it('describes each route by its latest version, with brief metrics, a preview line and the validated one', async () => {
    const created = await createDrawn(a.coordinator);
    await validate(a.coordinator, created);
    const edited = CreatedRoute.parse(await (await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions`, { baseVersionId: created.versionId, geometry: line(0.65, 42.6, 9) })).json());
    const page = await list(a.coordinator, `q=${encodeURIComponent(created.name)}`);
    const [item] = page.items;
    expect(page.total).toBe(1);
    expect(item).toMatchObject({ id: created.routeId, name: created.name, status: 'active', usedInMissions: 0, derivedFromRouteId: null });
    expect(item!.latestVersion).toMatchObject({ id: edited.versionId, number: 2, status: 'draft' });
    expect(item!.latestVersion.metrics.distanceM).toBeGreaterThan(100);
    expect(item!.latestValidated).toMatchObject({ versionId: created.versionId, number: 1, isStale: false });
    expect(item!.previewGeometry.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(item!.previewGeometry.coordinates.every((position) => position.length === 2)).toBe(true);
  });

  it('filters by name (literal % and _), status, version status, distance, ascent and how recently it was validated', async () => {
    const tag = uniq('filters');
    const short = await createDrawn(a.coordinator, line(0.65, 42.6, 4), `${tag} short_one`);
    const long = await createDrawn(a.coordinator, line(0.65, 42.62, 30, 0.003), `${tag} long%one`);
    await validate(a.coordinator, long);
    const old = await createDrawn(a.coordinator, line(0.7, 42.6, 8), `${tag} archived`);
    expect((await call(a.coordinator, 'POST', `/routes/${old.routeId}/archive`)).status).toBe(200);
    const q = `q=${encodeURIComponent(tag)}`;

    expect(ids(await list(a.coordinator, q)).sort()).toEqual([short.routeId, long.routeId].sort());
    expect(ids(await list(a.coordinator, `q=${encodeURIComponent(`${tag} lo%ne`)}`))).toEqual([]); // the % is text, not a wildcard
    expect(ids(await list(a.coordinator, `q=${encodeURIComponent(`${tag} long%one`)}`))).toEqual([long.routeId]);
    expect(ids(await list(a.coordinator, `q=${encodeURIComponent(`${tag} long%`)}`))).toEqual([long.routeId]);
    expect(ids(await list(a.coordinator, `q=${encodeURIComponent(`${tag} short_`)}`))).toEqual([short.routeId]);
    expect(ids(await list(a.coordinator, `q=${encodeURIComponent(`${tag} shortXone`)}`))).toEqual([]);
    expect(ids(await list(a.coordinator, `${q}&status=archived`))).toEqual([old.routeId]);
    expect(ids(await list(a.coordinator, `${q}&versionStatus=validated`))).toEqual([long.routeId]);
    expect(ids(await list(a.coordinator, `${q}&versionStatus=draft`))).toEqual([short.routeId]);
    const { items } = await list(a.coordinator, q);
    const distance = (id: string) => items.find((i) => i.id === id)!.latestVersion.metrics.distanceM;
    expect(distance(short.routeId)).toBeLessThan(distance(long.routeId));
    expect(ids(await list(a.coordinator, `${q}&minDistanceM=${distance(short.routeId) + 1}`))).toEqual([long.routeId]);
    expect(ids(await list(a.coordinator, `${q}&maxDistanceM=${distance(short.routeId) + 1}`))).toEqual([short.routeId]);
    expect(ids(await list(a.coordinator, `${q}&minAscentM=100000`))).toEqual([]);
    expect(ids(await list(a.coordinator, `${q}&maxAscentM=100000`)).sort()).toEqual([short.routeId, long.routeId].sort());

    // validated within N days is read against the Clock, not the machine's time
    clock.set(new Date(Date.now() + 5 * 86_400_000));
    expect(ids(await list(a.coordinator, `${q}&validatedWithinDays=3`))).toEqual([]);
    expect(ids(await list(a.coordinator, `${q}&validatedWithinDays=10`))).toEqual([long.routeId]);
    clock.set(new Date());
  });

  it('orders by updated, name, distance and ascent, and pages are stable: no route twice, none missing', async () => {
    const tag = uniq('order');
    const created = [];
    for (const [i, name] of ['charlie', 'alpha', 'bravo', 'delta', 'echo'].entries()) created.push(await createDrawn(a.coordinator, line(0.65, 42.6 + i * 0.01, 3 + i * 2), `${tag} ${name}`));
    const q = `q=${encodeURIComponent(tag)}`;
    const names = async (sort: string) => (await list(a.coordinator, `${q}&sort=${sort}`)).items.map((item) => item.name.replace(`${tag} `, ''));
    expect(await names('name_asc')).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo']);
    expect(await names('distance_asc')).toEqual(['charlie', 'alpha', 'bravo', 'delta', 'echo']);
    expect(await names('distance_desc')).toEqual(['echo', 'delta', 'bravo', 'alpha', 'charlie']);
    expect(await names('updated_desc')).toEqual(['echo', 'delta', 'bravo', 'alpha', 'charlie']);
    expect((await names('ascent_desc')).sort()).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo']);

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const result = await list(a.coordinator, `${q}&sort=name_asc&pageSize=2&page=${page}`);
      expect(result).toMatchObject({ page, pageSize: 2, total: 5 });
      seen.push(...ids(result));
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(ids(await list(a.coordinator, `${q}&pageSize=2&page=9`))).toEqual([]);
  });

  it('keeps the preview line to 400 points however long the route is, with the same ends', async () => {
    const wander = Array.from({ length: 3000 }, (_, i) => [0.2 + i * 0.00009 + Math.sin(i / 20) * 0.0004, 42.4 + i * 0.00004 + Math.cos(i / 15) * 0.0004] as [number, number]);
    const created = await createDrawn(a.coordinator, { type: 'LineString', coordinates: wander });
    const [item] = (await list(a.coordinator, `q=${encodeURIComponent(created.name)}`)).items;
    const preview = item!.previewGeometry.coordinates;
    expect(preview.length).toBeLessThanOrEqual(400);
    expect(preview.length).toBeGreaterThan(10);
    const detail = RouteVersionDetail.parse(await (await call(a.coordinator, 'GET', `/routes/${created.routeId}/versions/${created.versionId}`)).json());
    expect(detail.geometry.coordinates.length).toBeGreaterThan(400);
    expect(preview[0]).toEqual([detail.geometry.coordinates[0]![0], detail.geometry.coordinates[0]![1]]);
    expect(preview.at(-1)).toEqual([detail.geometry.coordinates.at(-1)![0], detail.geometry.coordinates.at(-1)![1]]);
  });

  it('counts the missions a route is used in', async () => {
    const created = await createDrawn(a.coordinator);
    const { id: missionId } = MissionDetail.parse(await (await call(a.coordinator, 'POST', '/missions', { name: uniq('M'), target: { source: 'map', lat: 42.6, lon: 0.65 } })).json());
    await fixtures.query(`INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, added_by) VALUES ($1, $2, $3, $4, $5)`, [
      a.orgId,
      missionId,
      created.routeId,
      created.versionId,
      a.coordinator.userId,
    ]);
    const [item] = (await list(a.coordinator, `q=${encodeURIComponent(created.name)}`)).items;
    expect(item!.usedInMissions).toBe(1);
  });

  it('isStale: false at 89 and 90 days after the validation, true at 91 (RF-519), read with the Clock', async () => {
    const created = await createDrawn(a.coordinator);
    await validate(a.coordinator, created);
    const [row] = await fixtures.query<{ validated_at: Date }>(`SELECT validated_at FROM route_versions WHERE id = $1`, [created.versionId]);
    const validatedAt = row!.validated_at.getTime();
    const stale = async (days: number) => {
      clock.set(new Date(validatedAt + days * 86_400_000));
      const [item] = (await list(a.coordinator, `q=${encodeURIComponent(created.name)}`)).items;
      return item!.latestValidated!.isStale;
    };
    expect([await stale(89), await stale(90), await stale(91)]).toEqual([false, false, true]);
    clock.set(new Date());
  });
});

describe('getRoute and getRouteVersion (RF-502, RF-504, RN-14)', () => {
  it('getRoute: versions newest first with who and when, where it comes from, its copies and the missions that use it', async () => {
    const original = await createDrawn(a.coordinator);
    await validate(a.coordinator, original);
    const second = CreatedRoute.parse(
      await (await call(a.coordinator, 'POST', `/routes/${original.routeId}/versions`, { baseVersionId: original.versionId, geometry: line(0.66, 42.6, 7), note: 'east' })).json(),
    );
    const copy = CreatedRoute.parse(await (await call(a.coordinator, 'POST', `/routes/${original.routeId}/derive`, { name: uniq('Copy'), fromVersionId: original.versionId })).json());
    const { id: missionId, name: missionName } = MissionDetail.parse(
      await (await call(a.coordinator, 'POST', '/missions', { name: uniq('M'), target: { source: 'map', lat: 42.6, lon: 0.65 } })).json(),
    );
    const [{ id: missionRouteId }] = (await fixtures.query<{ id: string }>(
      `INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, added_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [a.orgId, missionId, original.routeId, original.versionId, a.coordinator.userId],
    )) as [{ id: string }];

    const response = await call(a.coordinator, 'GET', `/routes/${original.routeId}`);
    expect(response.status).toBe(200);
    const detail = RouteDetail.parse(await response.json());
    expect(detail.versions.map((v) => [v.number, v.status])).toEqual([
      [2, 'draft'],
      [1, 'validated'],
    ]);
    expect(detail.versions[0]).toMatchObject({
      id: second.versionId,
      note: 'east',
      provenance: 'edited',
      manuallyModified: true,
      createdBy: { id: a.coordinator.userId },
      validatedBy: null,
      validatedAt: null,
    });
    expect(detail.versions[1]).toMatchObject({ provenance: 'drawn', validatedBy: { id: a.coordinator.userId } });
    expect(detail.versions[1]!.roadMix).toEqual([{ roadType: 'unknown', distanceM: detail.versions[1]!.metrics.distanceM }]);
    expect(detail.derivatives.map((d) => d.id)).toEqual([copy.routeId]);
    // `missionRouteId` is the row of the route in that mission: the one `removeMissionRoute` takes.
    expect(detail.usedIn).toEqual([{ missionId, missionRouteId, missionName, missionStatus: 'planning', pinnedVersionNumber: 1 }]);
    expect(detail.derivedFrom).toBeNull();

    const copyDetail = RouteDetail.parse(await (await call(a.coordinator, 'GET', `/routes/${copy.routeId}`)).json());
    expect(copyDetail.derivedFrom).toEqual({ routeId: original.routeId, routeName: original.name, versionNumber: 1 });
  });

  it('getRouteVersion: the line with the server’s altitudes, the stretches and a profile of at most 500 points that matches the metrics', async () => {
    const created = await createDrawn(a.coordinator, line(0.3, 42.5, 60, 0.002));
    const response = await call(a.coordinator, 'GET', `/routes/${created.routeId}/versions/${created.versionId}`);
    expect(response.status).toBe(200);
    const version = RouteVersionDetail.parse(await response.json());
    expect(version).toMatchObject({ id: created.versionId, number: 1, status: 'draft' });
    expect(version.geometry.coordinates.length).toBeGreaterThan(60);
    expect(version.segments).toEqual([{ position: 0, roadType: 'unknown', distanceM: version.metrics.distanceM, ascentM: version.metrics.ascentM, descentM: version.metrics.descentM }]);
    const profile = version.elevationProfile;
    expect(profile.length).toBeGreaterThanOrEqual(2);
    expect(profile.length).toBeLessThanOrEqual(500);
    expect(profile[0]![0]).toBe(0);
    expect(profile.at(-1)![0]).toBeCloseTo(version.metrics.distanceM, 0);
    const heights = profile.map(([, z]) => z);
    expect(Math.min(...heights)).toBeCloseTo(version.metrics.minElevationM, 1);
    expect(Math.max(...heights)).toBeCloseTo(version.metrics.maxElevationM, 1);
  });

  it('answers 404 for a version that belongs to another route, and for ids that do not exist', async () => {
    const [one, other] = [await createDrawn(a.coordinator), await createDrawn(a.coordinator)];
    await expectError(await call(a.coordinator, 'GET', `/routes/${one.routeId}/versions/${other.versionId}`), 'NOT_FOUND');
    await expectError(await call(a.coordinator, 'GET', '/routes/00000000-0000-4000-8000-000000000000'), 'NOT_FOUND');
  });
});

describe('exportRoute and exportRoutes (RF-511; INV-17, D-H2-14)', () => {
  it('GPX of a version: degrees and metres, a safe file name, no author, the validation notice in the description', async () => {
    const created = await createDrawn(a.coordinator, line(0.65, 42.6), 'Ruta "ñandú" / ../ <x>');
    await validate(a.coordinator, created);
    const response = await call(a.coordinator, 'GET', `/routes/${created.routeId}/export?format=gpx`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/gpx\+xml/);
    const disposition = response.headers.get('content-disposition')!;
    expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.gpx"$/);
    expect(disposition).toContain('v1');
    const text = await response.text();
    expect(text).not.toMatch(/<author|<email|<link|@/);
    expect(text).toContain('Es una propuesta y no sustituye el criterio del equipo');
    expect(text).toContain('validada');
    const detail = RouteVersionDetail.parse(await (await call(a.coordinator, 'GET', `/routes/${created.routeId}/versions/${created.versionId}`)).json());
    const points = [...text.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"><ele>([-\d.]+)<\/ele>/g)].map((m) => [Number(m[2]), Number(m[1]), Number(m[3])]);
    expect(points).toEqual(detail.geometry.coordinates);
  });

  it('KML: longitude first, then latitude, then metres', async () => {
    const created = await createDrawn(a.coordinator);
    const response = await call(a.coordinator, 'GET', `/routes/${created.routeId}/export?format=kml`);
    expect(response.headers.get('content-type')).toMatch(/^application\/vnd\.google-earth\.kml\+xml/);
    expect(response.headers.get('content-disposition')).toMatch(/\.kml"$/);
    const text = await response.text();
    expect(text).toContain('borrador');
    const detail = RouteVersionDetail.parse(await (await call(a.coordinator, 'GET', `/routes/${created.routeId}/versions/${created.versionId}`)).json());
    const coordinates = text
      .match(/<coordinates>([^<]+)<\/coordinates>/)![1]!
      .split(' ')
      .map((c) => c.split(',').map(Number));
    expect(coordinates).toEqual(detail.geometry.coordinates);
  });

  it('exports the latest version by default and the one asked for with versionId', async () => {
    const created = await createDrawn(a.coordinator);
    const second = CreatedRoute.parse(await (await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions`, { baseVersionId: created.versionId, geometry: line(0.7, 42.7, 9) })).json());
    const latest = await (await call(a.coordinator, 'GET', `/routes/${created.routeId}/export`)).text();
    const first = await (await call(a.coordinator, 'GET', `/routes/${created.routeId}/export?versionId=${created.versionId}`)).text();
    expect(latest).toContain('Versión 2');
    expect(first).toContain('Versión 1');
    expect(latest).not.toBe(first);
    expect((await call(a.coordinator, 'GET', `/routes/${created.routeId}/export?versionId=${second.versionId}`)).status).toBe(200);
    await expectError(await call(a.coordinator, 'GET', `/routes/${created.routeId}/export?format=pdf`), 'VALIDATION_FAILED');
  });

  it('round trip: exporting a version and importing the file gives the same vertices and metrics (GPX and KML)', async () => {
    for (const format of ['gpx', 'kml'] as const) {
      const original = await createDrawn(a.coordinator, line(0.4, 42.55, 12, 0.0021));
      const exported = await (await call(a.coordinator, 'GET', `/routes/${original.routeId}/export?format=${format}`)).text();
      const form = new FormData();
      form.set('purpose', 'route_import');
      form.set('file', new Blob([exported], { type: 'text/xml' }), `route.${format}`);
      const upload = await fetch(`${app.baseUrl}/files`, { method: 'POST', headers: withSession(await sessionOf(a.coordinator)), body: form });
      expect(upload.status).toBe(201);
      const fileId = FileRef.parse(await upload.json()).id;
      const imported = CreatedRoute.parse(await (await call(a.coordinator, 'POST', '/routes', { source: 'import', name: uniq('Again'), fileId })).json());
      const [one, two] = await Promise.all(
        [original, imported].map(async (r) => RouteVersionDetail.parse(await (await call(a.coordinator, 'GET', `/routes/${r.routeId}/versions/${r.versionId}`)).json())),
      );
      expect(two!.geometry.coordinates).toEqual(one!.geometry.coordinates);
      expect(two!.metrics).toEqual(one!.metrics);
      expect(parseTrack(exported).line).toEqual(one!.geometry.coordinates.map(([lon, lat]) => [lon, lat]));
    }
  });

  it('exportRoutes: one track per route in the order asked, the latest version of each or the latest validated one', async () => {
    const [one, two, three] = [
      await createDrawn(a.coordinator, line(0.5, 42.5), uniq('One')),
      await createDrawn(a.coordinator, line(0.52, 42.52), uniq('Two')),
      await createDrawn(a.coordinator, line(0.54, 42.54), uniq('Three')),
    ];
    await validate(a.coordinator, two);
    const all = await call(a.coordinator, 'GET', `/routes/export?ids=${three.routeId},${one.routeId},${two.routeId}`);
    expect(all.status).toBe(200);
    expect(all.headers.get('content-disposition')).toMatch(/^attachment; filename="onway-routes-\d{4}-\d{2}-\d{2}\.gpx"$/);
    const text = await all.text();
    expect(text.match(/<trk>/g)).toHaveLength(3);
    expect([...text.matchAll(/<trk><name>([^<]+)<\/name>/g)].map((m) => m[1])).toEqual([three.name, one.name, two.name]);

    const validatedOnly = await (await call(a.coordinator, 'GET', `/routes/export?ids=${one.routeId},${two.routeId}&validatedOnly=true&format=kml`)).text();
    expect(validatedOnly.match(/<Placemark>/g)).toHaveLength(1);
    expect(validatedOnly).toContain(two.name);
    await expectError(await call(a.coordinator, 'GET', `/routes/export?ids=${one.routeId}&validatedOnly=true`), 'NOT_FOUND');
    await expectError(await call(a.coordinator, 'GET', '/routes/export?ids=nope'), 'VALIDATION_FAILED');
    await expectError(await call(a.coordinator, 'GET', '/routes/export'), 'VALIDATION_FAILED');
  });
});

describe('isolation and roles (INV-01, rule 2)', () => {
  it('INV-01: the coordinator of B gets 404 on A’s route, version and export; the list of B holds nothing of A; exportRoutes never returns A’s', async () => {
    const mine = await createDrawn(a.coordinator, line(0.61, 42.61), uniq('Mine'));
    const theirs = await createDrawn(b.coordinator, line(0.61, 42.61), uniq('Theirs'));
    await expectError(await call(b.coordinator, 'GET', `/routes/${mine.routeId}`), 'NOT_FOUND');
    await expectError(await call(b.coordinator, 'GET', `/routes/${mine.routeId}/versions/${mine.versionId}`), 'NOT_FOUND');
    await expectError(await call(b.coordinator, 'GET', `/routes/${mine.routeId}/export`), 'NOT_FOUND');
    await expectError(await call(a.coordinator, 'GET', `/routes/${theirs.routeId}`), 'NOT_FOUND');

    const listed = await list(b.coordinator, 'bbox=0.5,42.5,0.7,42.7&pageSize=200');
    expect(ids(listed)).toContain(theirs.routeId);
    expect(ids(listed)).not.toContain(mine.routeId);
    await expectError(await call(b.coordinator, 'GET', `/routes/export?ids=${mine.routeId}`), 'NOT_FOUND');
    const mixed = await (await call(b.coordinator, 'GET', `/routes/export?ids=${mine.routeId},${theirs.routeId}`)).text();
    expect(mixed.match(/<trk>/g)).toHaveLength(1);
    expect(mixed).toContain(theirs.name);
    expect(mixed).not.toContain(mine.name);
  });

  it('the administrator reads and exports, and gets 403 on a write; the rescuer gets 403 on every read; a pending account has no access', async () => {
    const created = await createDrawn(a.coordinator);
    expect(ids(await list(a.admin, `q=${encodeURIComponent(created.name)}`))).toEqual([created.routeId]);
    for (const path of [`/routes/${created.routeId}`, `/routes/${created.routeId}/versions/${created.versionId}`, `/routes/${created.routeId}/export`, `/routes/export?ids=${created.routeId}`]) {
      expect((await call(a.admin, 'GET', path)).status).toBe(200);
      await expectError(await call(a.rescuer, 'GET', path), 'FORBIDDEN');
      await expectError(await call(applicant, 'GET', path), 'ACCOUNT_PENDING');
    }
    await expectError(await call(a.rescuer, 'GET', '/routes'), 'FORBIDDEN');
    await expectError(await call(applicant, 'GET', '/routes'), 'ACCOUNT_PENDING');
    await expectError(await call(a.admin, 'POST', `/routes/${created.routeId}/archive`), 'FORBIDDEN');
  });
});

describe('performance with 10 000 routes (doc 05 §12)', () => {
  it('listRoutes by visible area uses the GiST index of the geometry and answers within the budget', async () => {
    const perf = await build('Org Perf');
    await fixtures.query(
      `WITH ids AS (
         SELECT n, gen_random_uuid() AS rid, gen_random_uuid() AS vid, -3 + random() * 6 AS x, 41 + random() * 3 AS y FROM generate_series(1, 10000) n),
       r AS (INSERT INTO routes (id, organization_id, name, latest_version_id, created_by)
             SELECT rid, $1::uuid, 'Perf ' || n, vid, $2::uuid FROM ids RETURNING 1),
       v AS (INSERT INTO route_versions (id, organization_id, route_id, version_number, geom, distance_m, ascent_m, descent_m, min_elevation_m, max_elevation_m, max_slope_pct, provenance, created_by)
             SELECT vid, $1::uuid, rid, 1,
                    ST_SetSRID(ST_MakeLine(ARRAY[ST_MakePoint(x, y, 1000), ST_MakePoint(x + 0.01, y + 0.005, 1010), ST_MakePoint(x + 0.02, y + 0.01, 1020)]), 4326),
                    2500, 20, 0, 1000, 1020, 5, 'imported', $2::uuid FROM ids RETURNING 1)
       SELECT (SELECT count(*) FROM r) AS routes, (SELECT count(*) FROM v) AS versions`,
      [perf.orgId, perf.coordinator.userId],
    );
    await fixtures.query('ANALYZE routes');
    await fixtures.query('ANALYZE route_versions');

    const started = performance.now();
    const page = await list(perf.coordinator, 'bbox=0,42,0.5,42.5&pageSize=50&sort=updated_desc');
    const elapsed = performance.now() - started;
    expect(page.total).toBeGreaterThan(50);
    expect(page.items).toHaveLength(50);
    expect(elapsed).toBeLessThan(2000);

    const [plan] = await fixtures.query<{ 'QUERY PLAN': unknown }>(
      `EXPLAIN (FORMAT JSON) SELECT r.id FROM routes r JOIN route_versions lv ON lv.id = r.latest_version_id
        WHERE r.organization_id = $1 AND r.status = 'active' AND lv.geom && ST_MakeEnvelope(0, 42, 0.5, 42.5, 4326)`,
      [perf.orgId],
    );
    expect(JSON.stringify(plan!['QUERY PLAN'])).toContain('route_versions_geom_gix');
  });
});
