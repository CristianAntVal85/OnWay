// Continuar a mano (issue-pintar-ruta, RF-505, D-P4 a D-P7): corte sobre la versión de partida y puntos a mano en línea recta.
// Solo se envían el corte y los puntos: la parte conservada la toma el servidor de la versión guardada (regla 6).
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { apiError, json, renderApp, sessionServer, sessionUser, type Call } from './support';
import { MISSION_ID, allActions, mission } from './mission-fixtures';

interface Editor {
  vertices: readonly (readonly [number, number])[];
}
const map: { editor?: Editor; onPick?: (p: { lat: number; lon: number }) => void; routes?: { id: string; tone: string; line: unknown[] }[]; markers?: { id: string; kind: string }[] } = {};
vi.mock('../src/map', async () => {
  const edit = await vi.importActual<typeof import('../src/map/edit')>('../src/map/edit');
  const cut = await vi.importActual<typeof import('../src/map/cut')>('../src/map/cut');
  return {
    MAP_LAYERS: [],
    ...edit,
    ...cut,
    MapView: (props: typeof map) => {
      map.editor = props.editor;
      map.onPick = props.onPick;
      map.routes = props.routes;
      map.markers = props.markers;
      return <div data-testid="map" />;
    },
  };
});

const T = es.routeContinue;
const E = es.routeEditor;
const ROUTE = '11111111-aaaa-4aaa-8aaa-111111111111';
const V1 = '22222222-aaaa-4aaa-8aaa-222222222222';
const V2 = '33333333-aaaa-4aaa-8aaa-333333333333';
// Due east along 42.6 N, a vertex every ~24.6 m (0.0003 degrees of longitude): 40 intervals, ~0.98 km.
const line = Array.from({ length: 41 }, (_, i) => [Number((0.6 + i * 0.0003).toFixed(7)), 42.6, 1500 + i]);
const metrics = { distanceM: 983, ascentM: 40, descentM: 0, minElevationM: 1500, maxElevationM: 1540, maxSlopePct: 5 };
const version = {
  id: V1,
  number: 1,
  status: 'draft',
  provenance: 'generated',
  manuallyModified: false,
  metrics,
  roadMix: [{ roadType: 'path', distanceM: 983 }],
  note: null,
  createdBy: { id: sessionUser().id, displayName: 'C' },
  createdAt: '2026-11-21T09:00:00.000Z',
  validatedBy: null,
  validatedAt: null,
};
const detail = (overrides: Record<string, unknown> = {}) => ({
  id: ROUTE,
  name: 'Collado Norte 1',
  status: 'active',
  versions: [version],
  derivedFrom: null,
  derivatives: [],
  usedIn: [],
  createdAt: version.createdAt,
  updatedAt: version.createdAt,
  ...overrides,
});

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;
function setup(route = `/routes/${ROUTE}/continue?base=${V1}`, extra: Handlers = {}, language: 'es' | 'fr' = 'es') {
  const server = sessionServer(
    { user: sessionUser({ locale: language }) },
    {
      [`GET /routes/${ROUTE}`]: () => json(200, detail()),
      [`GET /routes/${ROUTE}/versions/${V1}`]: () =>
        json(200, {
          ...version,
          geometry: { type: 'LineString', coordinates: line },
          segments: [],
          elevationProfile: [
            [0, 1500],
            [983, 1540],
          ],
        }),
      ...extra,
    },
  );
  const view = renderApp({ route, fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}
const pick = (lat: number, lon: number) => act(() => map.onPick!({ lat, lon }));
const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST');
const title = T.title.replace('{{name}}', 'Collado Norte 1');
const paint = () => screen.queryByRole('button', { name: E.paint });

describe('continuar a mano (D-P4)', () => {
  it('sin corte no hay «Pintar ruta» ni se puede guardar; tocar la ruta elige el corte y activa pintar', async () => {
    setup();
    await screen.findByRole('heading', { level: 1, name: title });
    expect(screen.getByText(T.noCut)).toBeTruthy();
    expect(paint()).toBeNull();
    expect((screen.getByRole('button', { name: E.saveVersion }) as HTMLButtonElement).disabled).toBe(true);
    pick(42.60001, line[20]![0]!);
    expect(await screen.findByText(/Se conservan 0,5 km/)).toBeTruthy();
    expect(paint()?.getAttribute('aria-pressed')).toBe('true');
    expect(map.routes?.map((route) => route.id)).toEqual(['kept', 'dropped']);
    expect(map.routes?.find((route) => route.id === 'kept')?.line).toHaveLength(21);
    expect(map.markers?.map((marker) => marker.id)).toEqual(['cut']);
  });

  it('un toque lejos de la ruta (o en su inicio) no corta y lo dice', async () => {
    setup();
    await screen.findByRole('heading', { level: 1, name: title });
    pick(42.603, line[20]![0]!); // ~330 m al norte
    expect(await screen.findByText(T.cutTooFar.replace('{{max}}', '200'))).toBeTruthy();
    expect(screen.getByText(T.noCut)).toBeTruthy();
    pick(42.6, line[0]![0]!);
    expect(screen.getByText(T.noCut)).toBeTruthy();
  });

  it('con teclado: «Conservar los primeros km» elige el corte', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { level: 1, name: title });
    const km = screen.getByLabelText(/Conservar los primeros km/);
    await user.type(km, '0,5{Enter}');
    expect(await screen.findByText(/Se conservan 0,5 km/)).toBeTruthy();
    // El campo enseña los km con la coma del idioma, como el resto de cifras
    expect((km as HTMLInputElement).value).toMatch(/^0,\d{2}$/);
    // Dentro de «Tramo a mano» (h2), la lista de puntos baja un nivel
    pick(42.601, 0.61);
    expect(await screen.findByRole('heading', { level: 3, name: E.verticesTitle })).toBeTruthy();
    expect(paint()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('con «Pintar ruta» los toques añaden puntos a mano; guardar envía el corte y los puntos, sin trazado, y lleva a la versión nueva', async () => {
    const { user, calls } = setup(undefined, {
      [`POST /routes/${ROUTE}/versions`]: () => json(201, { routeId: ROUTE, versionId: V2, versionNumber: 2, missionRouteId: null }),
    });
    await screen.findByRole('heading', { level: 1, name: title });
    pick(42.6, line[30]![0]!);
    await screen.findByText(/Se conservan/);
    pick(42.601, 0.61);
    pick(42.602, 0.612);
    expect(await screen.findByText(T.handCount.replace('{{count}}', '2'))).toBeTruthy();
    expect(map.routes?.find((route) => route.id === 'hand')?.line).toEqual([
      [line[30]![0], 42.6],
      [0.61, 42.601],
      [0.612, 42.602],
    ]);
    // Desactivado, un toque mueve el corte en vez de añadir un punto.
    await user.click(paint()!);
    pick(42.6, line[32]![0]!);
    expect(screen.getByText(T.handCount.replace('{{count}}', '2'))).toBeTruthy();
    await user.type(screen.getByLabelText(E.noteLabel), 'Por el sendero del barranco');
    await user.click(screen.getByRole('button', { name: E.saveVersion }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    const request = posts(calls())[0]!;
    expect(request.path).toBe(`/routes/${ROUTE}/versions`);
    expect(request.body).toEqual({
      baseVersionId: V1,
      continueFrom: {
        cutPoint: { lat: 42.6, lon: line[32]![0] },
        points: [
          { lat: 42.601, lon: 0.61 },
          { lat: 42.602, lon: 0.612 },
        ],
      },
      note: 'Por el sendero del barranco',
    });
  });

  it('desde una misión, «Terminar en el objetivo» añade el objetivo y al guardar vuelve a la misión avisando de que es un borrador', async () => {
    const { user, calls } = setup(`/routes/${ROUTE}/continue?base=${V1}&mission=${MISSION_ID}`, {
      [`GET /missions/${MISSION_ID}`]: () => json(200, mission({ actions: allActions, status: 'active' })),
      [`GET /missions/${MISSION_ID}/routes`]: () => json(200, { items: [] }),
      [`GET /missions/${MISSION_ID}/history`]: () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }),
      'GET /geo/elevation': () => json(200, { lat: 42.6, lon: 0.65, elevationM: 2140 }),
      [`POST /routes/${ROUTE}/versions`]: () => json(201, { routeId: ROUTE, versionId: V2, versionNumber: 2, missionRouteId: null }),
    });
    await screen.findByRole('heading', { level: 1, name: title });
    pick(42.6, line[30]![0]!);
    await user.click(await screen.findByRole('button', { name: E.mission.toTarget }));
    expect(map.editor?.vertices).toEqual([[0.1021, 42.6335]]);
    await user.click(screen.getByRole('button', { name: E.saveVersion }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    expect(await screen.findByText(T.savedDraft.replace('{{number}}', '2').replace('{{name}}', 'Collado Norte 1'))).toBeTruthy();
  });

  it('si el servidor rechaza el corte, lo dice y no se pierde lo pintado', async () => {
    const { user } = setup(undefined, { [`POST /routes/${ROUTE}/versions`]: () => apiError(400, 'VALIDATION_FAILED') });
    await screen.findByRole('heading', { level: 1, name: title });
    pick(42.6, line[30]![0]!);
    pick(42.601, 0.61);
    await user.click(await screen.findByRole('button', { name: E.saveVersion }));
    expect(await screen.findByText(es.errors.VALIDATION_FAILED)).toBeTruthy();
    expect(map.editor?.vertices).toHaveLength(1);
  });

  it('una ruta archivada no se continúa: lo dice, sin pintar ni guardar', async () => {
    setup(undefined, { [`GET /routes/${ROUTE}`]: () => json(200, detail({ status: 'archived' })) });
    expect(await screen.findByText(es.routeDetail.archivedNotice)).toBeTruthy();
    expect(screen.queryByRole('button', { name: E.saveVersion })).toBeNull();
    expect(map.onPick).toBeUndefined();
    expect(paint()).toBeNull();
  });

  it('si la versión no se puede leer, error con reintento', async () => {
    setup(undefined, { [`GET /routes/${ROUTE}/versions/${V1}`]: () => apiError(500, 'INTERNAL') });
    expect(await screen.findByRole('button', { name: es.state.retry })).toBeTruthy();
  });

  it('en francés', async () => {
    setup(undefined, {}, 'fr');
    expect(await screen.findByRole('heading', { level: 1, name: fr.routeContinue.title.replace('{{name}}', 'Collado Norte 1') })).toBeTruthy();
    expect(screen.getByText(fr.routeContinue.noCut)).toBeTruthy();
  });
});
