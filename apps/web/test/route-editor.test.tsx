// Dibujar y editar a mano (H2-T9, RF-505, RF-510, RF-516; INV-15): solo se envían vértices; deshacer; alternativa de teclado con coordenadas.
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es } from '@onway/i18n';
import { admin, apiError, json, renderApp, sessionServer, sessionUser, type Call } from './support';

interface Editor {
  vertices: readonly (readonly [number, number])[];
  selected: number | null;
  onMove: (i: number, p: { lat: number; lon: number }) => void;
  onInsert: (i: number, p: { lat: number; lon: number }) => void;
  onSelect: (i: number | null) => void;
  onRemove: (i: number) => void;
  labelFor: (i: number) => string;
}
const map: { editor?: Editor; onPick?: (p: { lat: number; lon: number }) => void } = {};
vi.mock('../src/map', async () => {
  const edit = await vi.importActual<typeof import('../src/map/edit')>('../src/map/edit');
  return {
    MAP_LAYERS: [],
    ...edit,
    MapView: (props: { editor?: Editor; onPick?: (p: { lat: number; lon: number }) => void }) => {
      map.editor = props.editor;
      map.onPick = props.onPick;
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
function setup(route: string, extra: Handlers = {}, user = sessionUser()) {
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
  const view = renderApp({ route, fetch: server.api.fetch });
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
    await user.click(await screen.findByRole('button', { name: T.saveAsNew }));
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
    expect(screen.queryByRole('button', { name: T.saveAsNew })).toBeNull();
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
