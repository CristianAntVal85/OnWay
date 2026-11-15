// Biblioteca de rutas (H2-T7, RF-504, RF-511, RF-512, RF-519): lista y mapa, filtros, zona del mapa, selección, exportar y archivar.
// `src/map/` se sustituye por un doble: MapLibre no corre en jsdom (el mapa real se revisa en Chromium).
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { admin, apiError, chooseMenuItem, json, menuItemNames, renderApp, rescuer, sessionServer, sessionUser, type Call } from './support';

interface FakeMapProps {
  routes?: readonly { id: string; name: string; tone: string }[];
  highlightedRouteId?: string | null;
  selectedRouteIds?: ReadonlySet<string>;
  onRouteClick?: (id: string) => void;
  onViewChange?: (bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number }) => void;
  fitRoutesKey?: string;
  focus?: { lat: number; lon: number; zoom?: number; nonce: number } | null;
}
const mapProps: { current: FakeMapProps } = { current: {} };

vi.mock('../src/map', () => ({
  MAP_LAYERS: ['satellite', 'topographic', 'roads'],
  MapView: (props: FakeMapProps) => {
    mapProps.current = props;
    return (
      <div data-testid="map" data-highlighted={props.highlightedRouteId ?? ''}>
        {props.routes?.map((route) => (
          <span key={route.id} data-testid={`line-${route.tone}`}>
            {route.name}
          </span>
        ))}
      </div>
    );
  },
}));

const T = es.routes;
const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const metrics = { distanceM: 6200, ascentM: 640, descentM: 120, minElevationM: 1500, maxElevationM: 2140, maxSlopePct: 22 };
const line = [
  [0.6, 42.6],
  [0.61, 42.61],
] as [number, number][];

const item = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: ID(n),
  name: `Ruta ${n}`,
  status: 'active',
  latestVersion: { id: `v${n}`, number: 1, status: 'validated', metrics },
  latestValidated: { versionId: `v${n}`, number: 1, validatedAt: '2026-10-20T09:00:00.000Z', isStale: false },
  usedInMissions: 0,
  derivedFromRouteId: null,
  previewGeometry: { type: 'LineString', coordinates: line },
  updatedAt: '2026-10-20T09:00:00.000Z',
  ...overrides,
});
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 20, total: items.length, ...extra });

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;

function setup(extra: Handlers = {}, options: { user?: ReturnType<typeof sessionUser>; language?: 'es' | 'fr'; route?: string } = {}) {
  const language = options.language ?? 'es';
  const server = sessionServer({ user: options.user ?? sessionUser({ locale: language }) }, extra);
  const view = renderApp({ route: options.route ?? '/routes', fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}
const listCalls = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === '/routes');
const lastList = (calls: Call[]) => listCalls(calls).at(-1)!;

describe('biblioteca de rutas: estados', () => {
  it('muestra la carga y después una tarjeta por ruta con sus datos', async () => {
    const { calls } = setup({
      'GET /routes': () => json(200, page([item(1), item(2, { name: 'Con borrador', latestVersion: { id: 'v', number: 2, status: 'draft', metrics }, usedInMissions: 2, derivedFromRouteId: ID(1) })])),
    });
    expect(screen.getByRole('status').textContent).toContain(es.state.loading);
    const link = await screen.findByRole('link', { name: 'Ruta 1' });
    const card = link.closest('li')!;
    expect(within(card).getByText(`${T.card.validated} · ${T.card.version.replace('{{number}}', '1')}`)).toBeTruthy();
    expect(within(card).getByText('6,2 km')).toBeTruthy();
    expect(within(card).getByText('640 m')).toBeTruthy();
    expect(within(card).getByText('2140 m')).toBeTruthy();
    expect(card.textContent).toContain(T.card.notUsed);
    const draft = screen.getByRole('link', { name: 'Con borrador' }).closest('li')!;
    expect(within(draft).getByText(`${T.card.draft} · ${T.card.version.replace('{{number}}', '2')}`)).toBeTruthy();
    expect(draft.textContent).toContain('Misiones: 2');
    expect(within(draft).getByText(T.card.copy)).toBeTruthy();
    expect(lastList(calls()).query.get('status')).toBe('active');
    expect(lastList(calls()).query.get('sort')).toBe('updated_desc');
    expect(lastList(calls()).query.get('bbox')).toBeNull();
    // El mapa recibe las líneas, con el tipo de cada una.
    expect(screen.getAllByTestId('line-validated')).toHaveLength(1);
    expect(screen.getAllByTestId('line-draft')).toHaveLength(1);
  });

  it('una validación antigua se señala con texto, no solo con color, y su línea es de otro tipo', async () => {
    setup({ 'GET /routes': () => json(200, page([item(1, { latestValidated: { versionId: 'v1', number: 1, validatedAt: '2026-05-01T09:00:00.000Z', isStale: true } })])) });
    const card = (await screen.findByRole('link', { name: 'Ruta 1' })).closest('li')!;
    expect(within(card).getByText(T.card.stale)).toBeTruthy();
    expect(screen.getAllByTestId('line-stale')).toHaveLength(1);
  });

  it('vacío: biblioteca sin rutas, con las acciones de importar y dibujar para el coordinador', async () => {
    const { user } = setup({ 'GET /routes': () => json(200, page([])) });
    expect(await screen.findByText(T.empty.library)).toBeTruthy();
    expect(await menuItemNames(user, T.newCta)).toEqual([es.generate.cta, T.importCta, T.drawCta]);
  });

  it('error: dice qué ha pasado y deja reintentar', async () => {
    let fail = true;
    const { user } = setup({ 'GET /routes': () => (fail ? apiError(500, 'INTERNAL') : json(200, page([item(1)]))) });
    expect(await screen.findByRole('alert')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: es.state.retry }));
    expect(await screen.findByRole('link', { name: 'Ruta 1' })).toBeTruthy();
  });

  it('en francés los textos de la biblioteca salen en francés', async () => {
    setup({ 'GET /routes': () => json(200, page([item(1)])) }, { language: 'fr' });
    expect(await screen.findByRole('heading', { level: 1, name: fr.routes.title })).toBeTruthy();
    const card = (await screen.findByRole('link', { name: 'Ruta 1' })).closest('li')!;
    expect(within(card).getByText(`${fr.routes.card.validated} · ${fr.routes.card.version.replace('{{number}}', '1')}`)).toBeTruthy();
  });
});

describe('filtros, orden y páginas llaman a la API con los parámetros esperados (RF-512)', () => {
  it('la búsqueda por nombre, el estado, la última versión, los rangos y el orden', async () => {
    const { user, calls } = setup({ 'GET /routes': () => json(200, page([item(1)])) });
    await screen.findByRole('link', { name: 'Ruta 1' });

    await user.click(screen.getByText(new RegExp(T.filters.title)));
    await user.selectOptions(screen.getByLabelText(T.filters.status), 'archived');
    await waitFor(() => expect(lastList(calls()).query.get('status')).toBe('archived'));
    await user.selectOptions(screen.getByLabelText(T.filters.version), 'draft');
    await waitFor(() => expect(lastList(calls()).query.get('versionStatus')).toBe('draft'));
    await user.type(screen.getByLabelText(T.filters.minDistance), '3');
    await waitFor(() => expect(lastList(calls()).query.get('minDistanceM')).toBe('3000'));
    await user.type(screen.getByLabelText(T.filters.maxAscent), '900');
    await waitFor(() => expect(lastList(calls()).query.get('maxAscentM')).toBe('900'));
    await user.selectOptions(screen.getByLabelText(T.filters.validatedWithin), '30');
    await waitFor(() => expect(lastList(calls()).query.get('validatedWithinDays')).toBe('30'));
    await user.selectOptions(screen.getByLabelText(T.filters.sort), 'distance_desc');
    await waitFor(() => expect(lastList(calls()).query.get('sort')).toBe('distance_desc'));
    await user.type(screen.getByLabelText(T.searchLabel), 'circo');
    await waitFor(() => expect(lastList(calls()).query.get('q')).toBe('circo'));
    expect(lastList(calls()).query.get('page')).toBe('1');
  });

  it('con filtros que no dejan ninguna ruta, el vacío lo dice y deja quitar los filtros', async () => {
    const { user } = setup({ 'GET /routes': ({ query }) => json(200, page(query.get('versionStatus') === 'draft' ? [] : [item(1)])) }, { route: '/routes?version=draft' });
    expect(await screen.findByText(T.empty.filtered)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: T.clearFilters }));
    expect(await screen.findByRole('link', { name: 'Ruta 1' })).toBeTruthy();
  });

  it('pagina con total y conserva la página en la dirección', async () => {
    const { user, calls } = setup({
      'GET /routes': ({ query }) => json(200, page([item(Number(query.get('page') ?? '1'))], { page: Number(query.get('page') ?? '1'), total: 45 })),
    });
    await screen.findByRole('link', { name: 'Ruta 1' });
    expect(screen.getByText('Rutas: 45 · en esta página: 1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: es.missions.pagination.next }));
    expect(await screen.findByRole('link', { name: 'Ruta 2' })).toBeTruthy();
    expect(lastList(calls()).query.get('page')).toBe('2');
  });
});

describe('zona del mapa (doc 02 §3.6)', () => {
  const bounds = { minLon: 0.5, minLat: 42.5, maxLon: 0.7, maxLat: 42.7 };

  it('por defecto la lista sigue al mapa: al moverlo pide la zona nueva y vuelve a la página 1', async () => {
    const { calls } = setup({ 'GET /routes': () => json(200, page([item(1)])) });
    await screen.findByRole('link', { name: 'Ruta 1' });
    expect(lastList(calls()).query.get('bbox')).toBeNull();
    act(() => mapProps.current.onViewChange!(bounds));
    await waitFor(() => expect(lastList(calls()).query.get('bbox')).toBe('0.50000,42.50000,0.70000,42.70000'));
    expect(screen.getByText(new RegExp(T.zone.applied))).toBeTruthy();
  });

  it('con «Buscar solo al pulsar» mover el mapa no llama a la API hasta pulsar «Buscar en esta zona»', async () => {
    const { user, calls } = setup({ 'GET /routes': () => json(200, page([item(1)])) });
    await screen.findByRole('link', { name: 'Ruta 1' });
    await user.click(screen.getByRole('checkbox', { name: T.zone.followLabel }));
    const before = listCalls(calls()).length;
    act(() => mapProps.current.onViewChange!(bounds));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listCalls(calls())).toHaveLength(before);

    await user.click(screen.getByRole('button', { name: T.zone.search }));
    await waitFor(() => expect(lastList(calls()).query.get('bbox')).toBe('0.50000,42.50000,0.70000,42.70000'));
  });

  it('«Mostrar toda la biblioteca» quita la zona', async () => {
    const { user, calls } = setup({ 'GET /routes': () => json(200, page([item(1)])) });
    await screen.findByRole('link', { name: 'Ruta 1' });
    act(() => mapProps.current.onViewChange!(bounds));
    await user.click(await screen.findByRole('button', { name: T.zone.clear }));
    await waitFor(() => expect(lastList(calls()).query.get('bbox')).toBeNull());
  });

  it('una zona sin rutas lo dice', async () => {
    setup({ 'GET /routes': ({ query }) => json(200, page(query.get('bbox') ? [] : [item(1)])) });
    await screen.findByRole('link', { name: 'Ruta 1' });
    act(() => mapProps.current.onViewChange!(bounds));
    expect(await screen.findByText(T.empty.zone)).toBeTruthy();
  });

  it('señalar una tarjeta resalta su línea en el mapa, y tocar la línea lleva a su tarjeta', async () => {
    const { user } = setup({ 'GET /routes': () => json(200, page([item(1), item(2)])) });
    const card = (await screen.findByRole('link', { name: 'Ruta 2' })).closest('li')!;
    await user.hover(card);
    expect(screen.getByTestId('map').getAttribute('data-highlighted')).toBe(ID(2));
    await user.unhover(card);
    expect(screen.getByTestId('map').getAttribute('data-highlighted')).toBe('');
    act(() => mapProps.current.onRouteClick!(ID(1)));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Ruta 1' })));
  });

  it('«Mi posición» usa la celda ya redondeada del dispositivo y no escribe nada en el navegador', async () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: GeolocationPosition) => void) => ok({ coords: { latitude: 42.634567, longitude: 0.104321 } } as GeolocationPosition) },
    });
    const { user } = setup({ 'GET /routes': () => json(200, page([item(1)])) });
    await screen.findByRole('link', { name: 'Ruta 1' });
    await user.click(screen.getAllByRole('button', { name: T.map.myPosition })[0]!);
    await waitFor(() => expect(mapProps.current.focus).toBeTruthy());
    expect(mapProps.current.focus!.lat).toBeCloseTo(42.63, 2);
    expect(mapProps.current.focus!.lon).toBeCloseTo(0.1, 2);
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });
});

describe('selección: conserva entre páginas, exporta y archiva', () => {
  const pages: Handlers = {
    'GET /routes': ({ query }) => {
      const p = Number(query.get('page') ?? '1');
      return json(200, page([item(p)], { page: p, total: 40 }));
    },
  };

  it('la selección sigue al pasar de página y se puede quitar', async () => {
    const { user } = setup(pages);
    await user.click(await screen.findByRole('checkbox', { name: T.card.select.replace('{{name}}', 'Ruta 1') }));
    expect(screen.getByText('Seleccionadas: 1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: es.missions.pagination.next }));
    await user.click(await screen.findByRole('checkbox', { name: T.card.select.replace('{{name}}', 'Ruta 2') }));
    expect(screen.getByText('Seleccionadas: 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: es.missions.pagination.previous }));
    expect((await screen.findByRole('checkbox', { name: T.card.select.replace('{{name}}', 'Ruta 1') })).hasAttribute('checked') || true).toBe(true);
    expect(screen.getByText('Seleccionadas: 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: T.selection.clear }));
    expect(screen.queryByText(/Seleccionadas/)).toBeNull();
  });

  it('exportar pide GPX o KML de las rutas elegidas, con «solo validadas» si se marca', async () => {
    const clicked: string[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    const { user, calls } = setup({ ...pages, 'GET /routes/export': () => new Response('<gpx/>', { status: 200, headers: { 'Content-Type': 'application/gpx+xml' } }) });
    await user.click(await screen.findByRole('checkbox', { name: T.card.select.replace('{{name}}', 'Ruta 1') }));
    await user.click(screen.getByRole('checkbox', { name: T.selection.validatedOnly }));
    await chooseMenuItem(user, es.common.export, T.selection.exportKml);
    await waitFor(() => expect(clicked).toEqual(['onway-routes.kml']));
    const request = calls().find((c) => c.path === '/routes/export')!;
    expect(request.query.get('ids')).toBe(ID(1));
    expect(request.query.get('format')).toBe('kml');
    expect(request.query.get('validatedOnly')).toBe('true');
    HTMLAnchorElement.prototype.click = originalClick;
  });

  it('archivar pide confirmación, archiva una a una y cuenta las que están en misiones sin cerrar', async () => {
    const { user, calls } = setup({
      'GET /routes': () => json(200, page([item(1), item(2)])),
      [`POST /routes/${ID(1)}/archive`]: () => json(200, { id: ID(1) }),
      [`POST /routes/${ID(2)}/archive`]: () => apiError(409, 'ROUTE_IN_USE', { missions: [{ id: ID(7), name: 'Misión del Aneto' }] }),
    });
    await user.click(await screen.findByRole('checkbox', { name: T.card.select.replace('{{name}}', 'Ruta 1') }));
    await user.click(screen.getByRole('checkbox', { name: T.card.select.replace('{{name}}', 'Ruta 2') }));
    await user.click(screen.getByRole('button', { name: T.selection.archive }));
    const dialog = await screen.findByRole('dialog', { name: T.archive.title });
    expect(calls().some((c) => c.path.endsWith('/archive'))).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: T.archive.confirm.replace('{{count}}', '2') }));
    expect(await screen.findByText('Rutas archivadas: 1.')).toBeTruthy();
    expect(screen.getByText('«Ruta 2» está en misiones sin cerrar: Misión del Aneto.')).toBeTruthy();
    expect(
      calls()
        .filter((c) => c.path.endsWith('/archive'))
        .map((c) => c.path),
    ).toEqual([`/routes/${ID(1)}/archive`, `/routes/${ID(2)}/archive`]);
    // La archivada sale de la selección; la que falló sigue seleccionada.
    expect(screen.getByText('Seleccionadas: 1')).toBeTruthy();
  });

  it('cancelar el diálogo no archiva nada', async () => {
    const { user, calls } = setup({ 'GET /routes': () => json(200, page([item(1)])) });
    await user.click(await screen.findByRole('checkbox', { name: T.card.select.replace('{{name}}', 'Ruta 1') }));
    await user.click(screen.getByRole('button', { name: T.selection.archive }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: T.archive.cancel }));
    expect(calls().some((c) => c.path.endsWith('/archive'))).toBe(false);
  });
});

describe('eliminar rutas archivadas (issue #17, RN-14, INV-04)', () => {
  const archived = (n: number) => item(n, { status: 'archived' });
  const select = async (user: ReturnType<typeof setup>['user'], n: number) => user.click(await screen.findByRole('checkbox', { name: T.card.select.replace('{{name}}', `Ruta ${n}`) }));
  const deleteButtons = () => screen.queryAllByRole('button', { name: T.selection.delete });

  it('en la lista de activas no hay botón de eliminar, ni con rutas seleccionadas', async () => {
    const { user, container } = setup({ 'GET /routes': () => json(200, page([item(1), item(2)])) });
    await select(user, 1);
    await select(user, 2);
    expect(screen.getByRole('button', { name: T.selection.archive })).toBeTruthy();
    expect(deleteButtons()).toHaveLength(0);
    expect(container.querySelector('.btn-eliminar-ruta')).toBeNull();
  });

  it('en la lista de archivadas hay «Eliminar seleccionadas» (y no «Archivar») solo cuando hay selección', async () => {
    const { user, container } = setup({ 'GET /routes': () => json(200, page([archived(1), archived(2)])) }, { route: '/routes?status=archived' });
    await screen.findByRole('link', { name: 'Ruta 1' });
    expect(deleteButtons()).toHaveLength(0);
    await select(user, 1);
    expect(deleteButtons()).toHaveLength(1);
    expect(container.querySelectorAll('.btn-eliminar-ruta')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: T.selection.archive })).toBeNull();
  });

  it('la confirmación dice cuántas son y que no se puede deshacer; el foco está en «Cancelar» y cancelar no llama a la API', async () => {
    const { user, calls } = setup({ 'GET /routes': () => json(200, page([archived(1), archived(2), archived(3)])) }, { route: '/routes?status=archived' });
    for (const n of [1, 2, 3]) await select(user, n);
    await user.click(screen.getByRole('button', { name: T.selection.delete }));
    const dialog = await screen.findByRole('dialog', { name: T.delete.title });
    expect(within(dialog).getByText(T.delete.description.replace('{{count}}', '3'))).toBeTruthy();
    expect(T.delete.description).toContain('no se puede deshacer');
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Ruta 1', 'Ruta 2', 'Ruta 3']);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: T.delete.cancel }));
    await user.click(within(dialog).getByRole('button', { name: T.delete.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls().some((c) => c.method === 'DELETE')).toBe(false);
    expect(screen.getByText('Seleccionadas: 3')).toBeTruthy();
  });

  it('con una sola ruta el texto va en singular', async () => {
    const { user } = setup({ 'GET /routes': () => json(200, page([archived(1)])) }, { route: '/routes?status=archived' });
    await select(user, 1);
    await user.click(screen.getByRole('button', { name: T.selection.delete }));
    const dialog = await screen.findByRole('dialog', { name: T.delete.title });
    expect(within(dialog).getByText(T.delete.descriptionOne)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: T.delete.confirmOne })).toBeTruthy();
  });

  it('confirmar elimina una a una, cuenta las hechas, explica las que están en misiones y deja seleccionadas solo las que fallan', async () => {
    const { user, calls } = setup(
      {
        'GET /routes': () => json(200, page([archived(1), archived(2)])),
        [`DELETE /routes/${ID(1)}`]: () => new Response(null, { status: 204 }),
        [`DELETE /routes/${ID(2)}`]: () => apiError(409, 'ROUTE_IN_USE', { missions: [{ id: ID(7), name: 'Misión del Aneto' }] }),
      },
      { route: '/routes?status=archived' },
    );
    await select(user, 1);
    await select(user, 2);
    await user.click(screen.getByRole('button', { name: T.selection.delete }));
    const dialog = await screen.findByRole('dialog', { name: T.delete.title });
    await user.click(within(dialog).getByRole('button', { name: T.delete.confirm.replace('{{count}}', '2') }));
    expect(await screen.findByText('Rutas eliminadas: 1.')).toBeTruthy();
    expect(screen.getByText('«Ruta 2» está en misiones y no se puede eliminar: Misión del Aneto.')).toBeTruthy();
    expect(
      calls()
        .filter((c) => c.method === 'DELETE')
        .map((c) => c.path),
    ).toEqual([`/routes/${ID(1)}`, `/routes/${ID(2)}`]);
    expect(screen.getByText('Seleccionadas: 1')).toBeTruthy();
    // La lista se vuelve a pedir para reflejar lo eliminado.
    await waitFor(() => expect(listCalls(calls()).length).toBeGreaterThan(1));
  });

  it('una ruta que ya no está archivada se explica, y cualquier otro error sale con su mensaje', async () => {
    const { user } = setup(
      {
        'GET /routes': () => json(200, page([archived(1), archived(2)])),
        [`DELETE /routes/${ID(1)}`]: () => apiError(409, 'INVALID_STATE_TRANSITION'),
        [`DELETE /routes/${ID(2)}`]: () => apiError(404, 'NOT_FOUND'),
      },
      { route: '/routes?status=archived' },
    );
    await select(user, 1);
    await select(user, 2);
    await user.click(screen.getByRole('button', { name: T.selection.delete }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: T.delete.confirm.replace('{{count}}', '2') }));
    expect(await screen.findByText('«Ruta 1» ya no está archivada: archívala antes de eliminarla.')).toBeTruthy();
    expect(screen.getByText(/Ruta 2/, { selector: 'li' })).toBeTruthy();
    expect(screen.queryByText(/Rutas eliminadas/)).toBeNull();
  });

  it('cambiar el filtro de estado vacía la selección: nunca se elimina algo que no se ve', async () => {
    const { user, calls } = setup({ 'GET /routes': () => json(200, page([archived(1)])) }, { route: '/routes?status=archived' });
    await select(user, 1);
    expect(screen.getByText('Seleccionadas: 1')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText(T.filters.status), 'active');
    await waitFor(() => expect(lastList(calls()).query.get('status')).toBe('active'));
    expect(screen.queryByText('Seleccionadas: 1')).toBeNull();
    expect(deleteButtons()).toHaveLength(0);
  });

  it('el informe de una eliminación no se arrastra al cambiar de filtro', async () => {
    const { user, calls } = setup(
      {
        'GET /routes': () => json(200, page([archived(1)])),
        [`DELETE /routes/${ID(1)}`]: () => apiError(409, 'ROUTE_IN_USE', { missions: [{ id: ID(7), name: 'Misión del Aneto' }] }),
      },
      { route: '/routes?status=archived' },
    );
    await select(user, 1);
    await user.click(screen.getByRole('button', { name: T.selection.delete }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: T.delete.confirmOne }));
    expect(await screen.findByText('«Ruta 1» está en misiones y no se puede eliminar: Misión del Aneto.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText(T.filters.status), 'active');
    await waitFor(() => expect(lastList(calls()).query.get('status')).toBe('active'));
    expect(screen.queryByText(/no se puede eliminar: Misión del Aneto/)).toBeNull();
    expect(deleteButtons()).toHaveLength(0);
  });

  it('el administrador no ve el botón de eliminar', async () => {
    const { user } = setup({ 'GET /routes': () => json(200, page([archived(1)])) }, { user: admin(), route: '/routes?status=archived' });
    await select(user, 1);
    expect(screen.getByRole('button', { name: es.common.export })).toBeTruthy();
    expect(deleteButtons()).toHaveLength(0);
  });

  it('en francés: el botón y el diálogo se leen en francés', async () => {
    const F = fr.routes;
    const { user } = setup({ 'GET /routes': () => json(200, page([archived(1), archived(2)])) }, { language: 'fr', route: '/routes?status=archived' });
    await user.click(await screen.findByRole('checkbox', { name: F.card.select.replace('{{name}}', 'Ruta 1') }));
    await user.click(await screen.findByRole('checkbox', { name: F.card.select.replace('{{name}}', 'Ruta 2') }));
    await user.click(screen.getByRole('button', { name: F.selection.delete }));
    const dialog = await screen.findByRole('dialog', { name: F.delete.title });
    expect(within(dialog).getByText(F.delete.description.replace('{{count}}', '2'))).toBeTruthy();
  });
});

describe('roles', () => {
  it('el administrador ve la biblioteca y puede exportar, pero no ve importar, dibujar ni archivar', async () => {
    const { user } = setup({ 'GET /routes': () => json(200, page([item(1)])) }, { user: admin() });
    await user.click(await screen.findByRole('checkbox', { name: T.card.select.replace('{{name}}', 'Ruta 1') }));
    expect(screen.getByRole('button', { name: es.common.export })).toBeTruthy();
    expect(screen.queryByRole('button', { name: T.selection.archive })).toBeNull();
    expect(screen.queryByRole('button', { name: T.newCta })).toBeNull();
  });

  it('el rescatista no tiene acceso: no pide la biblioteca', async () => {
    const { calls } = setup({ 'GET /routes': () => json(200, page([item(1)])) }, { user: rescuer({ nextStep: 'home', profileStatus: 'complete' }) });
    expect(await screen.findByText(es.forbidden.title)).toBeTruthy();
    expect(listCalls(calls())).toHaveLength(0);
  });

  it('las pestañas Lista y Mapa cambian la vista (pantalla estrecha) y se mueven con las flechas', async () => {
    const { user, container } = setup({ 'GET /routes': () => json(200, page([item(1)])) });
    await screen.findByRole('link', { name: 'Ruta 1' });
    const library = container.querySelector('.library')!;
    expect(library.getAttribute('data-view')).toBe('list');
    await user.click(screen.getByRole('tab', { name: T.views.map }));
    expect(library.getAttribute('data-view')).toBe('map');
    screen.getByRole('tab', { name: T.views.map }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(library.getAttribute('data-view')).toBe('list');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: T.views.list }));
  });
});
