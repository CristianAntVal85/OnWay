// Generar rutas (H3-T8, RF-501, RF-507, RN-08/INV-14 en interfaz): el formulario, la misión con y sin origen, el progreso, los errores y las zonas.
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es } from '@onway/i18n';
import { admin, apiError, json, renderApp, sessionServer, sessionUser, type Call } from './support';

const map: { onPick?: (p: { lat: number; lon: number }) => void; picking?: boolean; routes?: { id: string; tone: string; line: unknown[] }[] } = {};
vi.mock('../src/map', async () => {
  const edit = await vi.importActual<typeof import('../src/map/edit')>('../src/map/edit');
  return {
    MAP_LAYERS: [],
    ...edit,
    MapView: (props: {
      onPick?: (p: { lat: number; lon: number }) => void;
      picking?: boolean;
      routes?: { id: string; tone: string; line: unknown[] }[];
      markers?: { id: string; kind: string; lat: number; lon: number }[];
    }) => {
      map.onPick = props.onPick;
      map.picking = props.picking;
      map.routes = props.routes;
      return (
        <div data-testid="map">
          {props.markers?.map((m) => (
            <span key={m.id} data-testid={`marker-${m.id}`}>{`${m.lat},${m.lon}`}</span>
          ))}
        </div>
      );
    },
  };
});

const T = es.generate;
const MISSION = '44444444-4444-4444-8444-444444444444';
const ORIGIN = '55555555-5555-4555-8555-555555555555';
const JOB = '66666666-6666-4666-8666-666666666666';
const R1 = '11111111-aaaa-4aaa-8aaa-111111111111';
const R2 = '22222222-aaaa-4aaa-8aaa-222222222222';
const V1 = '33333333-aaaa-4aaa-8aaa-333333333333';
const V2 = '77777777-aaaa-4aaa-8aaa-777777777777';
const ZONE = '88888888-aaaa-4aaa-8aaa-888888888888';
const ZONE_RING: [number, number][] = [
  [0.6, 42.6],
  [0.61, 42.6],
  [0.61, 42.61],
  [0.6, 42.61],
  [0.6, 42.6],
];
const zone = { id: ZONE, missionId: null, geometry: { type: 'Polygon', coordinates: [ZONE_RING] }, reason: 'Derrumbe', createdAt: '2026-10-31T09:00:00.000Z' };

const mission = (overrides: Record<string, unknown> = {}) => ({
  id: MISSION,
  name: 'Rescate en el Aneto',
  status: 'planning',
  coordinator: { id: sessionUser().id, displayName: 'C' },
  target: { lat: 42.63, lon: 0.65, elevationM: 3000, label: null, country: null, source: 'map' },
  origins: [],
  routes: { validated: 0, total: 0 },
  participants: { accepted: 0, pending: 0 },
  createdAt: '2026-10-31T09:00:00+00:00',
  updatedAt: '2026-10-31T09:00:00+00:00',
  description: null,
  activatedAt: null,
  closedAt: null,
  points: [{ id: ORIGIN, kind: 'origin', name: 'Refugio de la Renclusa', note: null, lat: 42.6, lon: 0.62, elevationM: 2100, position: 0 }],
  teams: [],
  readiness: { targetDefined: true, hasOrigins: true, hasParticipants: false, hasValidatedRoute: false },
  routesWithNewerValidatedVersion: 0,
  actions: { edit: true, activate: true, close: false, reopen: false, duplicate: true, manageParticipants: true, manageRoutes: true },
  ...overrides,
});
const metrics = (distanceM: number) => ({ distanceM, ascentM: 800, descentM: 100, minElevationM: 1500, maxElevationM: 2300, maxSlopePct: 25 });
const detail = (id: string, name: string, distanceM: number) => ({
  id,
  name,
  status: 'active',
  versions: [
    {
      id: id === R1 ? V1 : V2,
      number: 1,
      status: 'draft',
      provenance: 'generated',
      manuallyModified: false,
      metrics: metrics(distanceM),
      roadMix: [
        { roadType: 'road', distanceM: distanceM * 0.25 },
        { roadType: 'path', distanceM: distanceM * 0.75 },
      ],
      note: null,
      createdBy: { id: sessionUser().id, displayName: 'C' },
      createdAt: '2026-11-01T09:00:00.000Z',
      validatedBy: null,
      validatedAt: null,
    },
  ],
  derivedFrom: null,
  derivatives: [],
  usedIn: [],
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
});
const jobBody = (status: string, extra: Record<string, unknown> = {}) => ({
  id: JOB,
  kind: 'generate',
  status,
  progress: 0,
  errorCode: null,
  createdAt: '2026-11-01T09:00:00.000Z',
  finishedAt: null,
  result: null,
  ...extra,
});
const done = jobBody('completed', { progress: 100, finishedAt: '2026-11-01T09:00:05.000Z', result: { routeIds: [R1, R2] } });

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;
function setup(route: string, extra: Handlers = {}, user = sessionUser()) {
  const server = sessionServer(
    { user },
    {
      'GET /organization': () => json(200, { id: user.organization?.id, name: 'Servicio', country: 'ES', config: { validationMaxAgeDays: 90, maxUploadBytes: 1000 } }),
      'GET /avoid-zones': () => json(200, { items: [zone] }),
      'GET /geo/elevation': () => json(200, { lat: 42.6, lon: 0.65, elevationM: 2140 }),
      [`GET /missions/${MISSION}`]: () => json(200, mission()),
      [`GET /routes/${R1}`]: () => json(200, detail(R1, 'Subida 1', 6000)),
      [`GET /routes/${R2}`]: () => json(200, detail(R2, 'Subida 2', 7500)),
      [`GET /routes/${R1}/versions/${V1}`]: () =>
        json(200, {
          ...detail(R1, 'x', 1).versions[0],
          geometry: {
            type: 'LineString',
            coordinates: [
              [0.6, 42.6, 1500],
              [0.62, 42.62, 2000],
            ],
          },
          segments: [],
          elevationProfile: [
            [0, 1500],
            [100, 1600],
          ],
        }),
      [`GET /routes/${R2}/versions/${V2}`]: () =>
        json(200, {
          ...detail(R2, 'x', 1).versions[0],
          geometry: {
            type: 'LineString',
            coordinates: [
              [0.6, 42.6, 1500],
              [0.63, 42.61, 2100],
            ],
          },
          segments: [],
          elevationProfile: [
            [0, 1500],
            [100, 1600],
          ],
        }),
      ...extra,
    },
  );
  const view = renderApp({ route, fetch: server.api.fetch });
  return { ...server, ...view, calls: () => server.api.calls };
}
const pick = (lat: number, lon: number) => act(() => map.onPick!({ lat, lon }));
const posts = (calls: Call[], path: string) => calls.filter((c) => c.method === 'POST' && c.path === path);
const ready = () => screen.findByRole('heading', { level: 1 });

describe('generar desde la biblioteca (dos puntos)', () => {
  it('pide el inicio y el final, envía el cálculo con los valores por defecto y muestra el progreso y las alternativas con su composición', async () => {
    let polls = 0;
    const { calls, user } = setup('/routes/generate', {
      'POST /routes/generate': () => json(202, { jobId: JOB }),
      [`GET /jobs/${JOB}`]: () => json(200, polls++ === 0 ? jobBody('running', { progress: 40 }) : done),
    });
    await ready();
    expect(map.picking).toBe(true); // el primer clic en el mapa elige el punto de inicio
    await pick(42.6, 0.62);
    // El segundo punto pide su propio clic en el mapa.
    await user.click(screen.getAllByRole('button', { name: es.point.pickOnMap })[0]!);
    await pick(42.63, 0.65);
    await user.click(screen.getByRole('button', { name: T.submit }));

    await waitFor(() => expect(posts(calls(), '/routes/generate')).toHaveLength(1));
    expect(posts(calls(), '/routes/generate')[0]!.body).toEqual({ from: { lat: 42.6, lon: 0.62 }, to: { lat: 42.63, lon: 0.65 }, via: [], avoidZoneIds: [], alternatives: 3 });
    expect(await screen.findByText(/40 %/)).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();

    const table = await screen.findByRole('table', { name: T.compareTitle }, { timeout: 6000 });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // cabecera y dos alternativas
    expect(within(rows[1]!).getByText('6,0 km')).toBeTruthy();
    expect(within(rows[1]!).getByRole('img', { name: /Carretera 25 %.*Sendero 75 %/ })).toBeTruthy();
    expect(within(rows[2]!).getByText('7,5 km')).toBeTruthy();
    expect(screen.getByText(T.resultsHelp)).toBeTruthy();
    expect(map.routes?.filter((r) => r.tone === 'draft')).toHaveLength(2);
    // El formulario queda bloqueado mientras se ven los resultados; «generar otras rutas» lo libera.
    await user.click(screen.getByRole('button', { name: T.again }));
    expect((screen.getByRole('button', { name: T.submit }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('table', { name: T.compareTitle })).toBeNull();
  });

  it('avisa de los puntos que faltan y no envía nada', async () => {
    const { calls, user } = setup('/routes/generate');
    await ready();
    await user.click(screen.getByRole('button', { name: T.submit }));
    expect((await screen.findAllByText(T.pointMissing)).length).toBeGreaterThan(0);
    expect(posts(calls(), '/routes/generate')).toHaveLength(0);
  });
});

describe('generar desde una misión (RN-08, INV-14)', () => {
  it('usa el objetivo y un origen de la misión, envía addToMission y avisa de que las rutas se añadirán', async () => {
    const { calls, user } = setup(`/routes/generate?mission=${MISSION}`, {
      'POST /routes/generate': () => json(202, { jobId: JOB }),
      [`GET /jobs/${JOB}`]: () => json(200, done),
    });
    expect(await screen.findByRole('heading', { level: 1, name: es.generate.missionTitle.replace('{{name}}', 'Rescate en el Aneto') })).toBeTruthy();
    expect(screen.getByText(T.missionAdds)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: T.originLabel })).toHaveProperty('value', ORIGIN);
    await user.click(screen.getByRole('button', { name: T.submit }));
    await waitFor(() => expect(posts(calls(), '/routes/generate')).toHaveLength(1));
    expect(posts(calls(), '/routes/generate')[0]!.body).toEqual({
      from: { lat: 42.6, lon: 0.62 },
      to: { lat: 42.63, lon: 0.65 },
      via: [],
      avoidZoneIds: [],
      alternatives: 3,
      addToMission: { missionId: MISSION, originPointId: ORIGIN },
    });
    expect(await screen.findByRole('table', { name: T.compareTitle })).toBeTruthy();
  });

  it('sin origen, no deja generar y explica por qué, con el enlace a la misión', async () => {
    const { calls } = setup(`/routes/generate?mission=${MISSION}`, { [`GET /missions/${MISSION}`]: () => json(200, mission({ points: [] })) });
    expect(await screen.findByText(new RegExp(T.noOrigin))).toBeTruthy();
    expect(screen.getByRole('link', { name: T.addOrigin }).getAttribute('href')).toBe(`/missions/${MISSION}`);
    expect(screen.getByRole('button', { name: T.submit })).toHaveProperty('disabled', true);
    expect(posts(calls(), '/routes/generate')).toHaveLength(0);
  });

  it('con la misión cerrada, no deja generar', async () => {
    setup(`/routes/generate?mission=${MISSION}`, { [`GET /missions/${MISSION}`]: () => json(200, mission({ status: 'closed' })) });
    expect(await screen.findByText(T.missionClosed)).toBeTruthy();
    expect(screen.getByRole('button', { name: T.submit })).toHaveProperty('disabled', true);
  });
});

describe('cuando algo falla', () => {
  it.each([
    ['NO_ROUTE_POSSIBLE', T.failure.NO_ROUTE_POSSIBLE],
    ['OUTSIDE_COVERAGE', T.failure.OUTSIDE_COVERAGE],
    ['ROUTING_UNAVAILABLE', T.failure.ROUTING_UNAVAILABLE],
    ['INTERNAL', T.failure.INTERNAL],
  ] as const)('un trabajo que termina con %s dice qué ha pasado y deja volver a intentarlo', async (code, message) => {
    const { user } = setup(`/routes/generate?mission=${MISSION}`, {
      'POST /routes/generate': () => json(202, { jobId: JOB }),
      [`GET /jobs/${JOB}`]: () => json(200, jobBody('failed', { errorCode: code, finishedAt: '2026-11-01T09:00:05.000Z' })),
    });
    await screen.findByRole('button', { name: T.submit });
    await user.click(screen.getByRole('button', { name: T.submit }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole('heading', { name: T.failedTitle })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: T.tryAgain }));
    expect(screen.queryByText(message)).toBeNull();
  });

  it('si el motor no responde al pedirlo, lo dice en el momento y no hay trabajo que seguir', async () => {
    const { calls, user } = setup(`/routes/generate?mission=${MISSION}`, { 'POST /routes/generate': () => apiError(503, 'ROUTING_UNAVAILABLE') });
    await screen.findByRole('button', { name: T.submit });
    await user.click(screen.getByRole('button', { name: T.submit }));
    expect((await screen.findByRole('alert')).textContent).toContain(es.errors.ROUTING_UNAVAILABLE);
    expect(calls().some((c) => c.path.startsWith('/jobs/'))).toBe(false);
  });
});

describe('zonas a evitar (RF-507)', () => {
  it('lista las zonas y envía las que se marcan', async () => {
    const { calls, user } = setup(`/routes/generate?mission=${MISSION}`, {
      'POST /routes/generate': () => json(202, { jobId: JOB }),
      [`GET /jobs/${JOB}`]: () => json(200, done),
    });
    const checkbox = await screen.findByRole('checkbox', { name: /Derrumbe/ });
    expect(map.routes?.some((r) => r.id === `zone-${ZONE}` && r.tone === 'avoid')).toBe(true);
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: T.submit }));
    await waitFor(() => expect(posts(calls(), '/routes/generate')).toHaveLength(1));
    expect((posts(calls(), '/routes/generate')[0]!.body as { avoidZoneIds: string[] }).avoidZoneIds).toEqual([ZONE]);
  });

  it('dibuja una zona en el mapa, la guarda cerrada y la deja marcada para evitar', async () => {
    const created = { ...zone, id: '99999999-aaaa-4aaa-8aaa-999999999999', reason: 'Río crecido', geometry: { type: 'Polygon', coordinates: [ZONE_RING] } };
    const { calls, user } = setup(`/routes/generate?mission=${MISSION}`, { 'POST /avoid-zones': () => json(201, created) });
    await user.click(await screen.findByRole('button', { name: T.drawZone }));
    expect(screen.getByRole('button', { name: T.saveZone })).toHaveProperty('disabled', true);
    await pick(42.6, 0.6);
    await pick(42.6, 0.61);
    expect(screen.getByRole('button', { name: T.saveZone })).toHaveProperty('disabled', true);
    await pick(42.61, 0.61);
    await user.type(screen.getByLabelText(T.zoneReasonLabel), 'Río crecido');
    await user.click(screen.getByRole('button', { name: T.saveZone }));
    await waitFor(() => expect(posts(calls(), '/avoid-zones')).toHaveLength(1));
    expect(posts(calls(), '/avoid-zones')[0]!.body).toEqual({
      missionId: MISSION,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0.6, 42.6],
            [0.61, 42.6],
            [0.61, 42.61],
            [0.6, 42.6],
          ],
        ],
      },
      reason: 'Río crecido',
    });
    expect(await screen.findByText(T.zoneSaved)).toBeTruthy();
    expect(screen.queryByRole('button', { name: T.saveZone })).toBeNull();
  });

  it('borra una zona', async () => {
    const { calls, user } = setup('/routes/generate', { [`DELETE /avoid-zones/${ZONE}`]: () => json(204, null) });
    await user.click(await screen.findByRole('button', { name: T.zoneDelete.replace('{{name}}', 'Derrumbe') }));
    await waitFor(() => expect(calls().some((c) => c.method === 'DELETE' && c.path === `/avoid-zones/${ZONE}`)).toBe(true));
    expect(await screen.findByText(T.zoneDeleted)).toBeTruthy();
  });
});

describe('quién puede abrir la página', () => {
  it('el administrador lee pero no escribe: la página le dice que no tiene acceso', async () => {
    setup('/routes/generate', {}, admin());
    expect(await screen.findByText(es.forbidden.title)).toBeTruthy();
  });
});
