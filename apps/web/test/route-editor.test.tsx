// Dibujar y editar a mano (H2-T9, RF-505, RF-510, RF-516; INV-15): solo se envían vértices; deshacer; alternativa de teclado con coordenadas.
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { admin, apiError, chooseMenuItem, json, renderApp, sessionServer, sessionUser, type Call } from './support';
import { MISSION_ID, allActions, mission, noActions } from './mission-fixtures';

interface Editor {
  vertices: readonly (readonly [number, number])[];
  selected: number | null;
  onMove: (i: number, p: { lat: number; lon: number }) => void;
  onInsert: (i: number, p: { lat: number; lon: number }) => void;
  onSelect: (i: number | null) => void;
  onRemove: (i: number) => void;
  labelFor: (i: number) => string;
}
const map: { editor?: Editor; onPick?: (p: { lat: number; lon: number }) => void; routes?: { id: string; tone: string; line: unknown[] }[]; markers?: { id: string; kind: string }[] } = {};
vi.mock('../src/map', async () => {
  const edit = await vi.importActual<typeof import('../src/map/edit')>('../src/map/edit');
  return {
    MAP_LAYERS: [],
    ...edit,
    MapView: (props: { editor?: Editor; onPick?: (p: { lat: number; lon: number }) => void; routes?: { id: string; tone: string; line: unknown[] }[]; markers?: { id: string; kind: string }[] }) => {
      map.markers = props.markers;
      map.editor = props.editor;
      map.onPick = props.onPick;
      map.routes = props.routes;
      return <div data-testid="map" />;
    },
  };
});

const T = es.routeEditor;
const ROUTE = '11111111-aaaa-4aaa-8aaa-111111111111';
const V1 = '22222222-aaaa-4aaa-8aaa-222222222222';
const NEW = '77777777-aaaa-4aaa-8aaa-777777777777';
const created = { routeId: NEW, versionId: V1, versionNumber: 2, missionRouteId: null };
const metrics = { distanceM: 5000, ascentM: 500, descentM: 100, minElevationM: 1500, maxElevationM: 2100, maxSlopePct: 18 };
const version = {
  id: V1,
  number: 1,
  status: 'validated',
  provenance: 'imported',
  manuallyModified: false,
  metrics,
  roadMix: [],
  note: null,
  createdBy: { id: sessionUser().id, displayName: 'C' },
  createdAt: '2026-10-01T09:00:00.000Z',
  validatedBy: null,
  validatedAt: null,
};
const detail = (overrides: Record<string, unknown> = {}) => ({
  id: ROUTE,
  name: 'Senda del Circo',
  status: 'active',
  versions: [version],
  derivedFrom: null,
  derivatives: [],
  usedIn: [],
  createdAt: version.createdAt,
  updatedAt: version.createdAt,
  ...overrides,
});
const bigLine = Array.from({ length: 600 }, (_, i) => [0.6 + i * 0.0002, 42.6 + Math.sin(i / 20) * 0.004, 1500 + i]);

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;
function setup(route: string, extra: Handlers = {}, user = sessionUser(), language: 'es' | 'fr' = 'es') {
  const server = sessionServer(
    { user },
    {
      [`GET /routes/${ROUTE}`]: () => json(200, detail()),
      [`GET /routes/${ROUTE}/versions/${V1}`]: () =>
        json(200, {
          ...version,
          geometry: { type: 'LineString', coordinates: bigLine },
          segments: [],
          elevationProfile: [
            [0, 1500],
            [100, 1600],
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
const hasKey = (value: unknown, key: string): boolean => (value && typeof value === 'object' ? Object.entries(value).some(([k, v]) => k === key || hasKey(v, key)) : false);

describe('dibujar una ruta', () => {
  it('con menos de dos vértices no se puede guardar; con dos se envía solo la línea de vértices (sin altitud ni métricas)', async () => {
    const { user, calls } = setup('/routes/draw', { 'POST /routes': () => json(201, created), [`GET /routes/${NEW}`]: () => json(200, detail({ id: NEW })) });
    await screen.findByRole('heading', { level: 1, name: T.drawTitle });
    const save = screen.getByRole('button', { name: T.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(T.needTwo)).toBeTruthy();
    pick(42.6, 0.65);
    pick(42.61, 0.66);
    expect(await screen.findByText('Vértices: 2 · Vértice elegido: 2')).toBeTruthy();
    await user.click(save);
    expect(await screen.findByText(T.nameRequired)).toBeTruthy();
    expect(posts(calls())).toHaveLength(0);
    await user.type(screen.getByLabelText(T.nameLabel), 'A mano');
    await user.click(save);
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    const body = posts(calls())[0]!.body as { source: string; name: string; geometry: { type: string; coordinates: number[][] } };
    expect(body).toEqual({
      source: 'drawn',
      name: 'A mano',
      snapToPaths: false,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0.65, 42.6],
          [0.66, 42.61],
        ],
      },
    });
    for (const forbidden of ['elevationM', 'metrics', 'distanceM', 'ascentM', 'z']) expect(hasKey(body, forbidden)).toBe(false);
    expect(body.geometry.coordinates.every((p) => p.length === 2)).toBe(true);
  });

  it('deshacer quita el último cambio, y mover, insertar y borrar vértices actúan sobre la lista', async () => {
    const { user } = setup('/routes/draw');
    await screen.findByRole('heading', { level: 1, name: T.drawTitle });
    pick(42.6, 0.65);
    pick(42.62, 0.67);
    act(() => map.editor!.onInsert(1, { lat: 42.61, lon: 0.66 }));
    expect(await screen.findByText(/Vértices: 3/)).toBeTruthy();
    act(() => map.editor!.onMove(0, { lat: 42.5, lon: 0.5 }));
    expect((screen.getByLabelText(T.latLabel.replace('{{n}}', '1')) as HTMLInputElement).value).toBe('42.5');
    await user.click(screen.getByRole('button', { name: T.undo }));
    expect((screen.getByLabelText(T.latLabel.replace('{{n}}', '1')) as HTMLInputElement).value).toBe('42.6');
    act(() => map.editor!.onRemove(1));
    expect(await screen.findByText(/Vértices: 2/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: T.undo }));
    expect(await screen.findByText(/Vértices: 3/)).toBeTruthy();
  });

  it('sin ratón: se cambian las coordenadas escribiéndolas, con validación del rango, y se borra con el botón de la fila', async () => {
    const { user } = setup('/routes/draw');
    await screen.findByRole('heading', { level: 1, name: T.drawTitle });
    pick(42.6, 0.65);
    pick(42.61, 0.66);
    const lat = screen.getByLabelText(T.latLabel.replace('{{n}}', '2'));
    await user.clear(lat);
    await user.type(lat, '95{Enter}');
    expect(await screen.findByText(T.invalidCoordinates)).toBeTruthy();
    expect((screen.getByLabelText(T.latLabel.replace('{{n}}', '2')) as HTMLInputElement).value).toBe('42.61');
    await user.clear(lat);
    await user.type(lat, '42,7{Enter}');
    await waitFor(() => expect((screen.getByLabelText(T.latLabel.replace('{{n}}', '2')) as HTMLInputElement).value).toBe('42.7'));
    expect(screen.queryByText(T.invalidCoordinates)).toBeNull();
    await user.click(screen.getByRole('button', { name: T.removeVertex.replace('{{n}}', '1') }));
    expect(await screen.findByText(/Vértices: 1/)).toBeTruthy();
  });

  it('el administrador no puede dibujar', async () => {
    setup('/routes/draw', {}, admin());
    expect(await screen.findByText(es.forbidden.title)).toBeTruthy();
  });
});

describe('«Pintar ruta» (D-P1)', () => {
  const paint = () => screen.getByRole('button', { name: T.paint });

  it('al dibujar empieza activado y cada toque añade un punto; desactivado, tocar el mapa no añade nada', async () => {
    const { user } = setup('/routes/draw');
    await screen.findByRole('heading', { level: 1, name: T.drawTitle });
    expect(paint().getAttribute('aria-pressed')).toBe('true');
    pick(42.6, 0.65);
    expect(await screen.findByText(/Vértices: 1/)).toBeTruthy();
    await user.click(paint());
    expect(paint().getAttribute('aria-pressed')).toBe('false');
    expect(map.onPick).toBeUndefined();
    await user.click(paint());
    pick(42.61, 0.66);
    expect(await screen.findByText(/Vértices: 2/)).toBeTruthy();
  });

  it('desactivado, mover, insertar, deshacer y la lista de coordenadas siguen funcionando', async () => {
    const { user } = setup('/routes/draw');
    await screen.findByRole('heading', { level: 1, name: T.drawTitle });
    pick(42.6, 0.65);
    pick(42.62, 0.67);
    await user.click(paint());
    act(() => map.editor!.onInsert(1, { lat: 42.61, lon: 0.66 }));
    expect(await screen.findByText(/Vértices: 3/)).toBeTruthy();
    act(() => map.editor!.onMove(0, { lat: 42.5, lon: 0.5 }));
    await user.click(screen.getByRole('button', { name: T.undo }));
    expect((screen.getByLabelText(T.latLabel.replace('{{n}}', '1')) as HTMLInputElement).value).toBe('42.6');
    await user.click(screen.getByRole('button', { name: T.removeVertex.replace('{{n}}', '1') }));
    expect(await screen.findByText(/Vértices: 2/)).toBeTruthy();
  });

  it('al editar una versión empieza desactivado', async () => {
    setup(`/routes/${ROUTE}/edit?base=${V1}`);
    await waitFor(() => expect(map.editor?.vertices.length).toBeGreaterThan(2));
    expect(paint().getAttribute('aria-pressed')).toBe('false');
    expect(map.onPick).toBeUndefined();
  });

  it('con teclado: se alcanza y se cambia con Espacio y con Enter', async () => {
    const { user } = setup('/routes/draw');
    await screen.findByRole('heading', { level: 1, name: T.drawTitle });
    paint().focus();
    await user.keyboard(' ');
    expect(paint().getAttribute('aria-pressed')).toBe('false');
    await user.keyboard('{Enter}');
    expect(paint().getAttribute('aria-pressed')).toBe('true');
  });

  it('en francés se llama «Tracer l’itinéraire»', async () => {
    setup('/routes/draw', {}, sessionUser({ locale: 'fr' }), 'fr');
    expect(await screen.findByRole('button', { name: fr.routeEditor.paint })).toBeTruthy();
  });
});

describe('pintar desde una misión (D-P3, doc 02 §4.3-B)', () => {
  const M = es.routeEditor.mission;
  const ORIGIN_2 = { id: 'p2', kind: 'origin', name: 'Collado Norte', note: null, lat: 42.62, lon: 0.68, elevationM: 2300, position: 1 };
  const draw = `/routes/draw?mission=${MISSION_ID}`;
  const withMission = (overrides: Record<string, unknown> = {}, extra: Handlers = {}) =>
    setup(draw, { [`GET /missions/${MISSION_ID}`]: () => json(200, mission({ actions: allActions, status: 'active', ...overrides })), ...extra });
  const title = M.title.replace('{{name}}', mission().name);

  it('empieza en el origen, enseña origen y objetivo, propone el nombre del origen y «Terminar en el objetivo» añade el objetivo', async () => {
    const { user } = withMission();
    await screen.findByRole('heading', { level: 1, name: title });
    await waitFor(() => expect(map.editor?.vertices).toEqual([[0.65, 42.6]]));
    expect(map.markers?.map((marker) => marker.kind)).toEqual(['origin', 'target']);
    expect((screen.getByLabelText(new RegExp(T.nameLabel)) as HTMLInputElement).value).toBe('Refugio de la Renclusa');
    pick(42.61, 0.6);
    await user.click(screen.getByRole('button', { name: M.toTarget }));
    expect(map.editor?.vertices).toEqual([
      [0.65, 42.6],
      [0.6, 42.61],
      [0.1021, 42.6335],
    ]);
  });

  it('con varios orígenes, cambiar de origen mueve el primer punto y el nombre propuesto', async () => {
    const { user } = withMission({ points: [...mission().points, ORIGIN_2] });
    await screen.findByRole('heading', { level: 1, name: title });
    pick(42.61, 0.6);
    await user.selectOptions(screen.getByLabelText(M.origin), 'p2');
    await waitFor(() => expect(map.editor?.vertices[0]).toEqual([0.68, 42.62]));
    expect(map.editor?.vertices).toHaveLength(2);
    expect((screen.getByLabelText(new RegExp(T.nameLabel)) as HTMLInputElement).value).toBe('Collado Norte');
  });

  it('el nombre es obligatorio; al guardar se añade a la misión con su origen y se vuelve a ella avisando', async () => {
    const { user, calls } = withMission(
      {},
      {
        'POST /routes': () => json(201, { ...created, missionRouteId: '88888888-aaaa-4aaa-8aaa-888888888888' }),
        [`GET /missions/${MISSION_ID}/routes`]: () => json(200, { items: [] }),
        [`GET /missions/${MISSION_ID}/history`]: () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }),
        'GET /geo/elevation': () => json(200, { lat: 42.6, lon: 0.65, elevationM: 2140 }),
      },
    );
    await screen.findByRole('heading', { level: 1, name: title });
    pick(42.61, 0.6);
    const field = screen.getByLabelText(new RegExp(T.nameLabel));
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: T.save }));
    expect(await screen.findByText(T.nameRequired)).toBeTruthy();
    expect(posts(calls())).toHaveLength(0);
    await user.type(field, 'Por el barranco');
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    expect(posts(calls())[0]!.body).toMatchObject({ source: 'drawn', name: 'Por el barranco', snapToPaths: false, addToMission: { missionId: MISSION_ID, originPointId: 'p1' } });
    expect(await screen.findByText(M.added.replace('{{name}}', 'Por el barranco'))).toBeTruthy();
  });

  it('si la misión se cerró mientras tanto, el error se dice y no se pierde lo pintado', async () => {
    const { user } = withMission({}, { 'POST /routes': () => apiError(409, 'MISSION_CLOSED') });
    await screen.findByRole('heading', { level: 1, name: title });
    pick(42.61, 0.6);
    await user.click(screen.getByRole('button', { name: T.save }));
    expect(await screen.findByText(es.errors.MISSION_CLOSED)).toBeTruthy();
    expect(map.editor?.vertices).toHaveLength(2);
  });

  it('una misión cerrada no admite rutas nuevas: lo dice y no hay guardar ni interruptor', async () => {
    withMission({ actions: noActions, status: 'closed' });
    expect(await screen.findByText(M.closed.replace('{{name}}', mission().name))).toBeTruthy();
    expect(screen.queryByRole('button', { name: T.save })).toBeNull();
    expect(screen.queryByRole('button', { name: T.paint })).toBeNull();
  });

  it('sin origen lo dice y no deja guardar', async () => {
    withMission({ points: [] });
    expect(await screen.findByText(M.noOrigin, { exact: false })).toBeTruthy();
    expect((screen.getByRole('button', { name: T.save }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('carga y error de la misión', async () => {
    setup(draw, { [`GET /missions/${MISSION_ID}`]: () => apiError(500, 'INTERNAL') });
    expect(await screen.findByRole('button', { name: es.state.retry })).toBeTruthy();
  });
});

describe('editar una versión (RF-516)', () => {
  const editRoute = `/routes/${ROUTE}/edit?base=${V1}`;

  it('carga la versión simplificada a 150 vértices como mucho y lo avisa; guardar crea la versión siguiente con solo vértices', async () => {
    const { user, calls } = setup(editRoute, { [`POST /routes/${ROUTE}/versions`]: () => json(201, { ...created, routeId: ROUTE }) });
    expect(await screen.findByText(T.simplifiedNote.replace('{{max}}', '150'))).toBeTruthy();
    await waitFor(() => expect(map.editor!.vertices.length).toBeGreaterThan(2));
    expect(map.editor!.vertices.length).toBeLessThanOrEqual(150);
    act(() => map.editor!.onMove(0, { lat: 42.55, lon: 0.55 }));
    await user.type(screen.getByLabelText(T.noteLabel), 'movido');
    await user.click(screen.getByRole('button', { name: T.saveVersion }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    const request = posts(calls())[0]!;
    expect(request.path).toBe(`/routes/${ROUTE}/versions`);
    const body = request.body as { baseVersionId: string; geometry: { coordinates: number[][] }; note: string };
    expect(body.baseVersionId).toBe(V1);
    expect(body.note).toBe('movido');
    expect(body.geometry.coordinates[0]).toEqual([0.55, 42.55]);
    expect(body.geometry.coordinates.every((p) => p.length === 2)).toBe(true);
    for (const forbidden of ['elevationM', 'metrics', 'distanceM', 'provenance', 'manuallyModified']) expect(hasKey(body, forbidden)).toBe(false);
  });

  it('«Guardar como nueva ruta» pide un nombre y llama a derivar con la versión de partida y los vértices', async () => {
    const { user, calls } = setup(editRoute, { [`POST /routes/${ROUTE}/derive`]: () => json(201, created), [`GET /routes/${NEW}`]: () => json(200, detail({ id: NEW })) });
    await waitFor(() => expect(map.editor?.vertices.length).toBeGreaterThan(2));
    await chooseMenuItem(user, T.saveOptions, T.saveAsNew);
    const dialog = await screen.findByRole('dialog', { name: T.deriveTitle });
    const name = within(dialog).getByLabelText(T.nameLabel);
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: T.saveAsNew }));
    expect(within(dialog).getByText(T.nameRequired)).toBeTruthy();
    expect(posts(calls())).toHaveLength(0);
    await user.type(name, 'Variante a mano');
    await user.click(within(dialog).getByRole('button', { name: T.saveAsNew }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    const body = posts(calls())[0]!.body as { name: string; fromVersionId: string; geometry: { coordinates: number[][] } };
    expect(body.name).toBe('Variante a mano');
    expect(body.fromVersionId).toBe(V1);
    expect(body.geometry.coordinates.length).toBeGreaterThan(2);
  });

  it('una ruta archivada no se edita: sin botones de guardar', async () => {
    setup(editRoute, { [`GET /routes/${ROUTE}`]: () => json(200, detail({ status: 'archived' })) });
    expect(await screen.findByText(es.routeDetail.archivedNotice)).toBeTruthy();
    expect(screen.queryByRole('button', { name: T.saveVersion })).toBeNull();
    expect(screen.queryByRole('button', { name: T.saveOptions })).toBeNull();
  });

  it('un error del servidor al guardar se dice y no se pierde lo editado', async () => {
    const { user } = setup(editRoute, { [`POST /routes/${ROUTE}/versions`]: () => apiError(422, 'OUTSIDE_COVERAGE') });
    await waitFor(() => expect(map.editor?.vertices.length).toBeGreaterThan(2));
    const before = map.editor!.vertices.length;
    await user.click(screen.getByRole('button', { name: T.saveVersion }));
    expect(await screen.findByText(es.errors.OUTSIDE_COVERAGE)).toBeTruthy();
    expect(map.editor!.vertices.length).toBe(before);
  });
});

describe('dibujar uniendo los puntos por los caminos (H3-T9, RF-503)', () => {
  const candidate = {
    geometry: {
      type: 'LineString',
      coordinates: [
        [0.65, 42.6, 1500],
        [0.655, 42.603, 1560],
        [0.66, 42.61, 1700],
      ],
    },
    metrics: { distanceM: 2400, ascentM: 210, descentM: 10, minElevationM: 1500, maxElevationM: 1700, maxSlopePct: 22 },
    roadMix: [
      { roadType: 'road', distanceM: 600 },
      { roadType: 'path', distanceM: 1800 },
    ],
    offTrailShare: 0,
  };
  const snapHandlers = (answer: () => Response = () => json(200, candidate)): Record<string, (call: Call) => Response | Promise<Response>> => ({
    'POST /routes/snap': answer,
    'POST /routes': () => json(201, created),
    [`GET /routes/${NEW}`]: () => json(200, detail({ id: NEW })),
  });
  const snaps = (calls: Call[]) => calls.filter((c) => c.path === '/routes/snap');
  // Desmarcada de serie (D-P2): estas pruebas la marcan antes de nada.
  const drawBySnapping = async (user: { click: (element: Element) => Promise<void> }) => {
    await screen.findByRole('heading', { level: 1, name: T.drawTitle });
    await user.click(screen.getByRole('checkbox', { name: T.snapLabel }));
  };

  it('viene desmarcada (D-P2); marcada, calcula la ruta por los caminos con los puntos en orden y enseña métricas y composición del servidor', async () => {
    const { user, calls } = setup('/routes/draw', snapHandlers());
    await screen.findByRole('heading', { level: 1, name: T.drawTitle });
    const checkbox = screen.getByRole('checkbox', { name: T.snapLabel }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await user.click(checkbox);
    const calculate = screen.getByRole('button', { name: T.snapPreview }) as HTMLButtonElement;
    expect(calculate.disabled).toBe(true);
    pick(42.6, 0.65);
    pick(42.61, 0.66);
    await user.click(calculate);
    await waitFor(() => expect(snaps(calls())).toHaveLength(1));
    expect(snaps(calls())[0]!.body).toEqual({
      points: [
        { lat: 42.6, lon: 0.65 },
        { lat: 42.61, lon: 0.66 },
      ],
    });
    expect(await screen.findByText(/Ruta por los caminos: 2,4 km · subida 210 m · bajada 10 m/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /Carretera 25 %.*Sendero 75 %/ })).toBeTruthy();
    expect(map.routes?.some((r) => r.id === 'snapped' && r.tone === 'compare-a')).toBe(true);
  });

  it('si se cambian los puntos, la vista previa se retira para no enseñar una ruta que ya no corresponde', async () => {
    const { user } = setup('/routes/draw', snapHandlers());
    await drawBySnapping(user);
    pick(42.6, 0.65);
    pick(42.61, 0.66);
    await user.click(screen.getByRole('button', { name: T.snapPreview }));
    await screen.findByText(/Ruta por los caminos/);
    pick(42.62, 0.67);
    await waitFor(() => expect(screen.queryByText(/Ruta por los caminos/)).toBeNull());
    expect(map.routes?.some((r) => r.id === 'snapped')).toBe(false);
  });

  it('guarda los puntos de control con snapToPaths: el servidor es quien los une y los mide', async () => {
    const { user, calls } = setup('/routes/draw', snapHandlers());
    await drawBySnapping(user);
    pick(42.6, 0.65);
    pick(42.61, 0.66);
    await user.type(screen.getByLabelText(T.nameLabel), 'Por caminos');
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(posts(calls()).filter((c) => c.path === '/routes')).toHaveLength(1));
    const body = posts(calls()).find((c) => c.path === '/routes')!.body as { snapToPaths: boolean; geometry: { coordinates: number[][] } };
    expect(body.snapToPaths).toBe(true);
    expect(body.geometry.coordinates).toEqual([
      [0.65, 42.6],
      [0.66, 42.61],
    ]);
    expect(hasKey(body, 'roadMix')).toBe(false);
  });

  it('sin la opción (como viene), guarda la línea recta y no ofrece calcular por los caminos', async () => {
    const { user, calls } = setup('/routes/draw', snapHandlers());
    await screen.findByRole('heading', { level: 1, name: T.drawTitle });
    expect(screen.queryByRole('button', { name: T.snapPreview })).toBeNull();
    pick(42.6, 0.65);
    pick(42.61, 0.66);
    await user.type(screen.getByLabelText(T.nameLabel), 'Recta');
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(posts(calls()).filter((c) => c.path === '/routes')).toHaveLength(1));
    expect((posts(calls()).find((c) => c.path === '/routes')!.body as { snapToPaths: boolean }).snapToPaths).toBe(false);
    expect(snaps(calls())).toHaveLength(0);
  });

  it('con más de 50 puntos avisa, no deja calcular ni guardar, y desmarcar la opción lo permite', async () => {
    const { user } = setup('/routes/draw', snapHandlers());
    await drawBySnapping(user);
    for (let i = 0; i < 51; i++) pick(42.6 + i * 0.001, 0.65);
    expect(await screen.findByText(T.snapTooMany.replace('{{max}}', '50'))).toBeTruthy();
    expect((screen.getByRole('button', { name: T.snapPreview }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText(T.nameLabel), 'Larga');
    await user.click(screen.getByRole('button', { name: T.save }));
    expect(screen.getByText(T.snapTooMany.replace('{{max}}', '50'))).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: T.snapLabel }));
    expect(screen.queryByText(T.snapTooMany.replace('{{max}}', '50'))).toBeNull();
  });

  it.each([
    ['NO_ROUTE_POSSIBLE', 422, es.errors.NO_ROUTE_POSSIBLE],
    ['ROUTING_UNAVAILABLE', 503, es.errors.ROUTING_UNAVAILABLE],
    ['OUTSIDE_COVERAGE', 422, es.errors.OUTSIDE_COVERAGE],
  ] as const)('si el servidor no puede unir los puntos (%s), lo dice y propone guardar en línea recta', async (code, status, message) => {
    const { user } = setup(
      '/routes/draw',
      snapHandlers(() => apiError(status, code)),
    );
    await drawBySnapping(user);
    pick(42.6, 0.65);
    pick(42.61, 0.66);
    await user.click(screen.getByRole('button', { name: T.snapPreview }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent?.includes(message))).toBe(true);
    expect(screen.getByText(T.snapFailedHint)).toBeTruthy();
  });

  it('al editar una versión no hay unión por caminos: los vértices se guardan como están', async () => {
    setup(`/routes/${ROUTE}/edit`);
    await screen.findByRole('heading', { level: 1, name: T.editTitle.replace('{{name}}', 'Senda del Circo') });
    expect(screen.queryByRole('checkbox', { name: T.snapLabel })).toBeNull();
  });
});
