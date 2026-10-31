// Misiones (T7, RF-204, RF-205, RF-402–404): lista con pestañas y búsqueda, detalle con puntos, y los estados de carga, vacío y error.
// `src/map/` se sustituye por un doble: MapLibre no corre en jsdom (el mapa real se prueba en Chromium).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { admin, apiError, json, renderApp, rescuer, sessionServer, sessionUser, type Call } from './support';

interface FakeMapProps {
  markers?: readonly { id: string; kind: string; lat: number; lon: number }[];
  onPick?: (point: { lat: number; lon: number }) => void;
  picking?: boolean;
  fitToMarkers?: boolean;
}
const mapProps: { current: FakeMapProps } = { current: {} };

vi.mock('../src/map', () => ({
  MAP_LAYERS: ['satellite', 'topographic', 'roads'],
  MapView: (props: FakeMapProps) => {
    mapProps.current = props;
    return (
      <div data-testid="map" data-picking={props.picking ? 'yes' : 'no'}>
        {props.markers?.map((m) => (
          <span key={m.id} data-testid={`marker-${m.kind}`}>{`${m.id}:${m.lat},${m.lon}`}</span>
        ))}
      </div>
    );
  },
}));

const MISSION_ID = '44444444-4444-4444-8444-444444444444';
const COORDINATOR = { id: sessionUser().id, displayName: 'Coordinador Demo' };
const T = es.missions;
const D = es.missionDetail;
const P = D.points;

const listItem = (overrides: Record<string, unknown> = {}) => ({
  id: MISSION_ID,
  name: 'Rescate en el Aneto',
  status: 'planning',
  coordinator: COORDINATOR,
  target: { lat: 42.6335, lon: 0.1021, elevationM: 3404, label: null, country: null, source: 'coordinates' },
  origins: [{ id: 'o1', name: 'Refugio de la Renclusa' }],
  routes: { validated: 0, total: 2 },
  participants: { accepted: 3, pending: 1 },
  createdAt: '2026-10-31T09:00:00+00:00',
  updatedAt: '2026-10-31T09:00:00+00:00',
  ...overrides,
});
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 20, total: items.length, ...extra });

const refugio = { id: 'p1', kind: 'origin', name: 'Refugio de la Renclusa', note: 'Aparcamiento', lat: 42.6, lon: 0.65, elevationM: 2140, position: 0 };
const collado = { id: 'p2', kind: 'waypoint', name: 'Collado de Coronas', note: null, lat: 42.62, lon: 0.7, elevationM: 2800, position: 0 };

const allActions = { edit: true, activate: true, close: false, reopen: false, duplicate: true, manageParticipants: true, manageRoutes: true };
const noActions = { edit: false, activate: false, close: false, reopen: false, duplicate: false, manageParticipants: false, manageRoutes: false };

type Mission = ReturnType<typeof detail>;
function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...listItem(),
    description: 'Búsqueda de un montañero.',
    activatedAt: null,
    closedAt: null,
    points: [refugio, collado],
    teams: [],
    readiness: { targetDefined: true, hasOrigins: true, hasParticipants: false, hasValidatedRoute: false },
    routesWithNewerValidatedVersion: 0,
    actions: allActions,
    ...overrides,
  };
}

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;

function setup(route: string, extra: Handlers = {}, options: { user?: ReturnType<typeof sessionUser>; language?: 'es' | 'fr' } = {}) {
  const language = options.language ?? 'es';
  const server = sessionServer(
    { user: options.user ?? sessionUser({ locale: language }) },
    {
      'GET /org/coordinators': () => json(200, { items: [COORDINATOR, { id: '33333333-3333-4333-8333-333333333333', displayName: 'Otra Coordinadora' }] }),
      'GET /geo/elevation': () => json(200, { lat: 42.6, lon: 0.65, elevationM: 2140 }),
      ...extra,
    },
  );
  const view = renderApp({ route, fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}

const listCalls = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === '/missions');
const lastQuery = (calls: Call[]) => listCalls(calls).at(-1)!;

const PATH = `/missions/${MISSION_ID}`;

describe('lista de misiones: pestañas y búsqueda (RF-204)', () => {
  const byTab = (items: Record<string, unknown[]>): Handlers => ({
    'GET /missions': ({ query }) => json(200, page(items[query.get('status') ?? ''] ?? [])),
  });

  it('empieza en «En planificación», pide al servidor ese estado y muestra los datos de cada misión', async () => {
    const { calls } = setup('/missions', byTab({ planning: [listItem()] }));
    const link = await screen.findByRole('link', { name: 'Rescate en el Aneto' });
    const request = lastQuery(calls());
    expect(request.query.get('status')).toBe('planning');
    expect(request.query.get('q')).toBeNull();
    expect(screen.getByRole('tab', { name: T.tabs.planning }).getAttribute('aria-selected')).toBe('true');
    const card = link.closest('li')!;
    expect(within(card).getByText('Coordinador Demo')).toBeTruthy();
    expect(within(card).getByText('42.63350, 0.10210')).toBeTruthy();
    expect(within(card).getByText('Refugio de la Renclusa')).toBeTruthy();
    expect(within(card).getByText('Validadas 0 · Total 2')).toBeTruthy();
    expect(within(card).getByText('Aceptados 3 · Pendientes 1')).toBeTruthy();
    expect(within(card).getByText(T.status.planning)).toBeTruthy();
  });

  it('cada pestaña pide su estado y enseña lo suyo; las flechas cambian de pestaña', async () => {
    const { user, calls } = setup(
      '/missions',
      byTab({ planning: [listItem()], active: [listItem({ id: 'a', name: 'Misión activa', status: 'active' })], closed: [listItem({ id: 'c', name: 'Misión cerrada', status: 'closed' })] }),
    );
    await screen.findByRole('link', { name: 'Rescate en el Aneto' });
    await user.click(screen.getByRole('tab', { name: T.tabs.active }));
    expect(await screen.findByRole('link', { name: 'Misión activa' })).toBeTruthy();
    expect(lastQuery(calls()).query.get('status')).toBe('active');
    expect(screen.queryByRole('link', { name: 'Rescate en el Aneto' })).toBeNull();
    expect(screen.getByRole('tab', { name: T.tabs.active }).getAttribute('aria-selected')).toBe('true');

    screen.getByRole('tab', { name: T.tabs.active }).focus();
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('link', { name: 'Misión cerrada' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: T.tabs.closed }));
    expect(lastQuery(calls()).query.get('status')).toBe('closed');
  });

  it('la búsqueda filtra por nombre en el servidor: al dejar de teclear y con Intro, y vuelve a la página 1', async () => {
    const { user, calls } = setup('/missions?page=2', {
      'GET /missions': ({ query }) => json(200, page(query.get('q') ? [listItem({ name: 'Aneto norte' })] : [listItem()], { page: Number(query.get('page') ?? 1), total: 45 })),
    });
    await screen.findByRole('link', { name: 'Rescate en el Aneto' });
    expect(lastQuery(calls()).query.get('page')).toBe('2');
    const before = listCalls(calls()).length;
    await user.type(screen.getByRole('searchbox', { name: T.searchLabel }), 'aneto');
    // Nada mientras se teclea: una sola petición, al dejar de escribir.
    expect(listCalls(calls()).length).toBe(before);
    expect(await screen.findByRole('link', { name: 'Aneto norte' })).toBeTruthy();
    expect(listCalls(calls()).length).toBe(before + 1);
    expect(lastQuery(calls()).query.get('q')).toBe('aneto');
    expect(lastQuery(calls()).query.get('page')).toBe('1');

    await user.clear(screen.getByRole('searchbox', { name: T.searchLabel }));
    await user.type(screen.getByRole('searchbox', { name: T.searchLabel }), 'norte{Enter}');
    await waitFor(() => expect(lastQuery(calls()).query.get('q')).toBe('norte'));
  });

  it('muestra «Cargando», y el error con reintento', async () => {
    let attempts = 0;
    const { user } = setup('/missions', { 'GET /missions': () => (++attempts === 1 ? apiError(500, 'INTERNAL') : json(200, page([listItem()]))) });
    expect(await screen.findByText(es.state.loading)).toBeTruthy();
    expect(await screen.findByText(es.state.errorTitle)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: es.state.retry }));
    expect(await screen.findByRole('link', { name: 'Rescate en el Aneto' })).toBeTruthy();
  });

  it('vacío: dice qué pestaña no tiene misiones y el coordinador puede crear; el administrador no', async () => {
    const coordinator = setup('/missions', byTab({}));
    expect(await screen.findByText(T.empty.planning)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: T.createCta }).length).toBeGreaterThan(0);
    await coordinator.user.click(screen.getByRole('tab', { name: T.tabs.closed }));
    expect(await screen.findByText(T.empty.closed)).toBeTruthy();
    coordinator.unmount();

    setup('/missions', byTab({}), { user: admin() });
    expect(await screen.findByText(T.empty.planning)).toBeTruthy();
    expect(screen.queryByRole('link', { name: T.createCta })).toBeNull();
    // El administrador ve también las misiones en planificación (doc 02 §3.3).
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([T.tabs.planning, T.tabs.active, T.tabs.closed]);
  });

  it('una búsqueda sin resultados lo dice y se puede quitar', async () => {
    const { user, calls } = setup('/missions?q=zzz', { 'GET /missions': ({ query }) => json(200, page(query.get('q') ? [] : [listItem()])) });
    expect(await screen.findByText(T.emptySearch.replace('{{query}}', 'zzz'))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: T.clearSearch }));
    expect(await screen.findByRole('link', { name: 'Rescate en el Aneto' })).toBeTruthy();
    expect(lastQuery(calls()).query.get('q')).toBeNull();
  });

  it('páginas: Siguiente pide la 2; Anterior está desactivado en la primera', async () => {
    const { user, calls } = setup('/missions', { 'GET /missions': ({ query }) => json(200, page([listItem()], { page: Number(query.get('page') ?? 1), total: 45 })) });
    await screen.findByText(T.pagination.page.replace('{{page}}', '1').replace('{{pages}}', '3'));
    expect(screen.getByRole('button', { name: T.pagination.previous }).getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('button', { name: T.pagination.next }));
    await screen.findByText(T.pagination.page.replace('{{page}}', '2').replace('{{pages}}', '3'));
    expect(lastQuery(calls()).query.get('page')).toBe('2');
  });

  it('abrir una misión lleva a su detalle', async () => {
    const { user } = setup('/missions', { ...byTab({ planning: [listItem()] }), [`GET ${PATH}`]: () => json(200, detail()) });
    await user.click(await screen.findByRole('link', { name: 'Rescate en el Aneto' }));
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe(PATH));
    expect(await screen.findByRole('heading', { level: 1, name: 'Rescate en el Aneto' })).toBeTruthy();
  });

  it('en francés, textos en francés', async () => {
    setup('/missions', byTab({}), { language: 'fr' });
    expect(await screen.findByRole('heading', { level: 1, name: fr.missions.title })).toBeTruthy();
    expect(screen.getByRole('tab', { name: fr.missions.tabs.planning })).toBeTruthy();
    expect(await screen.findByText(fr.missions.empty.planning)).toBeTruthy();
  });

  it('el rescatista no usa esta lista (tiene la suya, Mis misiones): no se llama a listMissions', async () => {
    const { calls } = setup('/missions', { 'GET /my/missions': () => json(200, page([])) }, { user: rescuer({ profileStatus: 'complete', nextStep: 'home' }) });
    expect(await screen.findByRole('heading', { level: 1, name: es.myMissions.title })).toBeTruthy();
    expect(listCalls(calls())).toHaveLength(0);
  });
});

/** Servidor con una misión que cambia como lo haría el real: las escrituras modifican `state.mission` y la siguiente lectura lo ve. */
function detailServer(initial: Mission = detail()) {
  const state: { mission: Mission } = { mission: initial };
  const handlers: Handlers = {
    [`GET ${PATH}`]: () => json(200, state.mission),
    [`POST ${PATH}/points`]: ({ body }) => {
      const input = body as { kind: string; name: string; note?: string; lat: number; lon: number };
      const created = { id: `new-${state.mission.points.length}`, kind: input.kind, name: input.name, note: input.note ?? null, lat: input.lat, lon: input.lon, elevationM: 1500, position: 0 };
      state.mission = { ...state.mission, points: [...state.mission.points, created] } as Mission;
      return json(201, created);
    },
    [`PATCH ${PATH}/points/p1`]: ({ body }) => {
      const patch = body as Record<string, unknown>;
      state.mission = { ...state.mission, points: state.mission.points.map((point) => (point.id === 'p1' ? { ...point, ...patch } : point)) } as Mission;
      return json(
        200,
        state.mission.points.find((point) => point.id === 'p1'),
      );
    },
    [`DELETE ${PATH}/points/p2`]: () => {
      state.mission = { ...state.mission, points: state.mission.points.filter((point) => point.id !== 'p2') } as Mission;
      return json(204, null);
    },
    [`PATCH ${PATH}`]: ({ body }) => {
      state.mission = { ...state.mission, ...(body as object), updatedAt: '2026-10-31T10:00:00+00:00' } as Mission;
      return json(200, state.mission);
    },
  };
  return { state, handlers };
}

const sends = (calls: Call[], method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
const missionReads = (calls: Call[]) => sends(calls, 'GET', PATH).length;

async function openDetail(extra: Handlers = {}, server = detailServer(), options: Parameters<typeof setup>[2] = {}) {
  const view = setup(PATH, { ...server.handlers, ...extra }, options);
  await screen.findByRole('heading', { level: 1, name: 'Rescate en el Aneto' });
  return { ...view, server };
}

async function useCoordinates(user: ReturnType<typeof setup>['user'], text: string) {
  await user.click(screen.getByRole('radio', { name: es.point.byCoordinates }));
  await user.type(screen.getByRole('textbox', { name: es.point.coordinates }), text);
  await user.click(screen.getByRole('button', { name: es.point.useCoordinates }));
}

describe('detalle de misión: lectura (RF-205)', () => {
  it('cabecera, lista de preparación, puntos por tipo y mapa con el objetivo y los puntos', async () => {
    await openDetail();
    expect(screen.getByText(T.status.planning)).toBeTruthy();
    expect(screen.getByText('Búsqueda de un montañero.')).toBeTruthy();
    expect(screen.getByText(D.fields.altitudeValue.replace('{{meters}}', '3404'))).toBeTruthy();
    const readiness = screen.getByRole('region', { name: D.readiness.title });
    const items = within(readiness).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-done'))).toEqual(['true', 'true', 'false', 'false']);
    expect(screen.getByRole('region', { name: P.groups.origin })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: P.groups.origin })).getByText('Refugio de la Renclusa')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: P.groups.waypoint })).getByText('Collado de Coronas')).toBeTruthy();
    expect(screen.getByText(P.empty.rendezvous)).toBeTruthy();
    expect(screen.getByTestId('marker-target')).toBeTruthy();
    expect(screen.getByTestId('marker-origin').textContent).toContain('p1');
    expect(screen.getByTestId('marker-waypoint').textContent).toContain('p2');
    expect(mapProps.current.fitToMarkers).toBe(true);
    expect(mapProps.current.onPick).toBeUndefined(); // sin editor abierto, el mapa solo se consulta
  });

  it('carga, error con reintento y 404 sin reintento', async () => {
    let attempts = 0;
    const failing = setup(PATH, { [`GET ${PATH}`]: () => (++attempts === 1 ? apiError(500, 'INTERNAL') : json(200, detail())) });
    expect(await screen.findByText(es.state.loading)).toBeTruthy();
    expect(await screen.findByText(es.state.errorTitle)).toBeTruthy();
    await failing.user.click(screen.getByRole('button', { name: es.state.retry }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Rescate en el Aneto' })).toBeTruthy();
    failing.unmount();

    setup(PATH, { [`GET ${PATH}`]: () => apiError(404, 'NOT_FOUND') });
    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeTruthy();
    expect(screen.queryByRole('button', { name: es.state.retry })).toBeNull();
    expect(screen.getByRole('link', { name: D.back })).toBeTruthy();
  });

  it('el administrador (actions a false) lo ve todo sin ningún control de escritura', async () => {
    await openDetail({}, detailServer(detail({ actions: noActions, readiness: { targetDefined: true, hasOrigins: false, hasParticipants: false, hasValidatedRoute: false } })), { user: admin() });
    expect(screen.getByText(D.readOnlyRole)).toBeTruthy();
    expect(screen.getByText('Refugio de la Renclusa')).toBeTruthy();
    const names = screen.queryAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');
    expect(names.filter((name) => /Editar|Añadir|Borrar|Guardar/.test(name))).toEqual([]);
    expect(screen.queryByRole('button', { name: D.readiness.addOrigin })).toBeNull();
    expect(screen.queryByRole('button', { name: D.editData })).toBeNull();
    expect(mapProps.current.onPick).toBeUndefined();
  });

  it('una misión cerrada no tiene controles de escritura aunque quien la mira sea su coordinador', async () => {
    await openDetail({}, detailServer(detail({ status: 'closed', closedAt: '2026-10-31T12:00:00+00:00', actions: { ...noActions, reopen: true, duplicate: true } })));
    expect(screen.getByText(D.readOnlyClosed)).toBeTruthy();
    expect(document.querySelector('.status-badge')?.textContent).toBe(T.status.closed);
    expect(screen.queryByRole('button', { name: D.editData })).toBeNull();
    expect(screen.queryByRole('button', { name: P.add.origin })).toBeNull();
    expect(screen.queryByRole('button', { name: P.edit.replace('{{name}}', 'Refugio de la Renclusa') })).toBeNull();
    expect(screen.queryByRole('button', { name: P.remove.replace('{{name}}', 'Collado de Coronas') })).toBeNull();
  });

  it('el rescatista no usa este detalle (tiene el suyo, solo lectura): no se llama a getMission', async () => {
    const { calls } = setup(PATH, { [`GET /my${PATH}`]: () => apiError(404, 'NOT_FOUND') }, { user: rescuer({ profileStatus: 'complete', nextStep: 'home' }) });
    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeTruthy();
    expect(missionReads(calls())).toBe(0);
  });
});

describe('detalle de misión: puntos (RF-402, RF-403, RF-404)', () => {
  it('alta por coordenadas: abre con el foco en el nombre, envía el cuerpo sin altitud, refresca y avisa', async () => {
    const { user, calls } = await openDetail();
    const reads = missionReads(calls());
    await user.click(screen.getByRole('button', { name: P.add.origin }));
    expect(document.activeElement).toBe(screen.getByLabelText(P.name));
    await user.type(screen.getByLabelText(P.name), '  Parking de Benasque  ');
    await user.type(screen.getByLabelText(P.note), 'Pista cerrada');
    await useCoordinates(user, '42.65, 0.2');
    await user.click(screen.getByRole('button', { name: P.save }));
    await waitFor(() => expect(sends(calls(), 'POST', `${PATH}/points`)).toHaveLength(1));
    expect(sends(calls(), 'POST', `${PATH}/points`)[0]!.body).toEqual({ kind: 'origin', name: 'Parking de Benasque', note: 'Pista cerrada', lat: 42.65, lon: 0.2 });
    expect(await screen.findByText(P.added.replace('{{name}}', 'Parking de Benasque'))).toBeTruthy();
    expect(missionReads(calls())).toBe(reads + 1); // invalida y refresca
    expect(within(screen.getByRole('region', { name: P.groups.origin })).getByText('Parking de Benasque')).toBeTruthy();
    expect(screen.queryByLabelText(P.name)).toBeNull(); // el formulario se cierra
    expect(document.activeElement?.id).toBe('points-origin');
  });

  it('alta pinchando el mapa: el mapa espera el clic y el punto sale con la forma de entrada del mapa', async () => {
    const { user, calls } = await openDetail();
    await user.click(screen.getByRole('button', { name: P.add.rendezvous }));
    expect(screen.getByTestId('map').getAttribute('data-picking')).toBe('yes');
    mapProps.current.onPick?.({ lat: 42.7, lon: 0.05 });
    expect(await screen.findByTestId('marker-rendezvous')).toBeTruthy();
    await user.type(screen.getByLabelText(P.name), 'Aparcamiento de Benasque');
    await user.click(screen.getByRole('button', { name: P.save }));
    await waitFor(() => expect(sends(calls(), 'POST', `${PATH}/points`)).toHaveLength(1));
    expect(sends(calls(), 'POST', `${PATH}/points`)[0]!.body).toEqual({ kind: 'rendezvous', name: 'Aparcamiento de Benasque', lat: 42.7, lon: 0.05 });
  });

  it('sin nombre o sin ubicación no se llama al servidor y el foco va a lo que falta', async () => {
    const { user, calls } = await openDetail();
    await user.click(screen.getByRole('button', { name: P.add.waypoint }));
    await user.click(screen.getByRole('button', { name: P.save }));
    expect(await screen.findByText(P.nameRequired)).toBeTruthy();
    expect(screen.getByText(P.locationRequired)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(P.name));
    expect(sends(calls(), 'POST', `${PATH}/points`)).toHaveLength(0);
  });

  it('editar: solo viaja lo que cambió; sin cambios no se llama al servidor', async () => {
    const { user, calls } = await openDetail();
    await user.click(screen.getByRole('button', { name: P.edit.replace('{{name}}', 'Refugio de la Renclusa') }));
    expect((screen.getByLabelText(P.name) as HTMLInputElement).value).toBe('Refugio de la Renclusa');
    expect((screen.getByLabelText(P.note) as HTMLInputElement).value).toBe('Aparcamiento');
    expect(screen.getByText(es.point.selected.replace('{{position}}', '42.60000, 0.65000'))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: P.save }));
    expect(await screen.findByText(P.noChanges)).toBeTruthy();
    expect(sends(calls(), 'PATCH', `${PATH}/points/p1`)).toHaveLength(0);

    await user.clear(screen.getByLabelText(P.name));
    await user.type(screen.getByLabelText(P.name), 'Refugio nuevo');
    await user.click(screen.getByRole('button', { name: P.save }));
    await waitFor(() => expect(sends(calls(), 'PATCH', `${PATH}/points/p1`)).toHaveLength(1));
    expect(sends(calls(), 'PATCH', `${PATH}/points/p1`)[0]!.body).toEqual({ name: 'Refugio nuevo' });
    expect(await screen.findByText(P.updated.replace('{{name}}', 'Refugio nuevo'))).toBeTruthy();
    expect(screen.getByText('Refugio nuevo')).toBeTruthy();
  });

  it('editar la ubicación por el mapa envía lat y lon', async () => {
    const { user, calls } = await openDetail();
    await user.click(screen.getByRole('button', { name: P.edit.replace('{{name}}', 'Refugio de la Renclusa') }));
    await user.click(screen.getByRole('button', { name: es.point.pickOnMap }));
    mapProps.current.onPick?.({ lat: 42.61, lon: 0.66 });
    await screen.findByText(es.point.selected.replace('{{position}}', '42.61000, 0.66000'));
    await user.click(screen.getByRole('button', { name: P.save }));
    await waitFor(() => expect(sends(calls(), 'PATCH', `${PATH}/points/p1`)).toHaveLength(1));
    expect(sends(calls(), 'PATCH', `${PATH}/points/p1`)[0]!.body).toEqual({ lat: 42.61, lon: 0.66 });
  });

  it('borrar pide confirmación en la fila, con el foco en «No borrar»; confirmar borra y refresca', async () => {
    const { user, calls } = await openDetail();
    const reads = missionReads(calls());
    await user.click(screen.getByRole('button', { name: P.remove.replace('{{name}}', 'Collado de Coronas') }));
    expect(screen.getByText(P.removeConfirm.replace('{{name}}', 'Collado de Coronas'), { selector: 'p' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: P.removeNo }));
    await user.click(screen.getByRole('button', { name: P.removeNo }));
    expect(sends(calls(), 'DELETE', `${PATH}/points/p2`)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: P.remove.replace('{{name}}', 'Collado de Coronas') }));
    await user.click(screen.getByRole('button', { name: P.removeYes }));
    await waitFor(() => expect(sends(calls(), 'DELETE', `${PATH}/points/p2`)).toHaveLength(1));
    expect(await screen.findByText(P.removed.replace('{{name}}', 'Collado de Coronas'))).toBeTruthy();
    expect(missionReads(calls())).toBe(reads + 1);
    expect(screen.getByText(P.empty.waypoint)).toBeTruthy();
    expect(screen.queryByTestId('marker-waypoint')).toBeNull();
  });

  it('MISSION_CLOSED al escribir: avisa, relee la misión y los controles de escritura desaparecen', async () => {
    const server = detailServer();
    const { user } = await openDetail(
      {
        [`POST ${PATH}/points`]: () => {
          server.state.mission = detail({ status: 'closed', actions: noActions }) as Mission;
          return apiError(409, 'MISSION_CLOSED');
        },
      },
      server,
    );
    await user.click(screen.getByRole('button', { name: P.add.origin }));
    await user.type(screen.getByLabelText(P.name), 'Tarde');
    await useCoordinates(user, '42.65, 0.2');
    await user.click(screen.getByRole('button', { name: P.save }));
    expect(await screen.findByText(D.readOnlyClosed)).toBeTruthy();
    expect(screen.queryByRole('button', { name: P.save })).toBeNull();
    expect(screen.queryByRole('button', { name: P.add.origin })).toBeNull();
    expect(screen.queryByRole('button', { name: D.editData })).toBeNull();
  });

  it('el error al escribir un punto se muestra en el formulario: fuera de cobertura', async () => {
    const { user } = await openDetail({ [`POST ${PATH}/points`]: () => apiError(422, 'OUTSIDE_COVERAGE') });
    await user.click(screen.getByRole('button', { name: P.add.origin }));
    await user.type(screen.getByLabelText(P.name), 'Lejos');
    await useCoordinates(user, '10, 10');
    await user.click(screen.getByRole('button', { name: P.save }));
    expect(await screen.findByText(es.createMission.outsideCoverage)).toBeTruthy();
    expect(screen.getByLabelText(P.name)).toBeTruthy(); // el formulario sigue abierto con lo escrito
  });

  it('la lista de preparación enlaza al alta de un origen cuando falta', async () => {
    const { user } = await openDetail({}, detailServer(detail({ points: [], readiness: { targetDefined: true, hasOrigins: false, hasParticipants: false, hasValidatedRoute: false } })));
    await user.click(screen.getByRole('button', { name: D.readiness.addOrigin }));
    expect(screen.getByLabelText(P.name)).toBeTruthy();
    expect(screen.getByTestId('map').getAttribute('data-picking')).toBe('yes');
  });
});

describe('detalle de misión: editar datos (RF-205, Q-10)', () => {
  it('envía solo lo que cambió y expectedUpdatedAt, refresca y avisa', async () => {
    const { user, calls } = await openDetail();
    await user.click(screen.getByRole('button', { name: D.editData }));
    expect((screen.getByLabelText(es.createMission.name) as HTMLInputElement).value).toBe('Rescate en el Aneto');
    expect((screen.getByLabelText(es.createMission.coordinator) as HTMLSelectElement).value).toBe(COORDINATOR.id);
    await user.clear(screen.getByLabelText(es.createMission.name));
    await user.type(screen.getByLabelText(es.createMission.name), 'Rescate en el Posets');
    await user.click(screen.getByRole('button', { name: D.edit.save }));
    await waitFor(() => expect(sends(calls(), 'PATCH', PATH)).toHaveLength(1));
    expect(sends(calls(), 'PATCH', PATH)[0]!.body).toEqual({ name: 'Rescate en el Posets', expectedUpdatedAt: '2026-10-31T09:00:00+00:00' });
    expect(await screen.findByText(D.edit.saved)).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: 'Rescate en el Posets' })).toBeTruthy();
    expect(document.activeElement?.id).toBe('mission-edit-button');
  });

  it('cambiar el objetivo por coordenadas envía target; sin cambios no se llama', async () => {
    const { user, calls } = await openDetail();
    await user.click(screen.getByRole('button', { name: D.editData }));
    await user.click(screen.getByRole('button', { name: D.edit.save }));
    expect(await screen.findByText(D.edit.noChanges)).toBeTruthy();
    expect(sends(calls(), 'PATCH', PATH)).toHaveLength(0);
    await useCoordinates(user, '42.7, 0.1');
    await user.click(screen.getByRole('button', { name: D.edit.save }));
    await waitFor(() => expect(sends(calls(), 'PATCH', PATH)).toHaveLength(1));
    expect(sends(calls(), 'PATCH', PATH)[0]!.body).toEqual({ target: { source: 'coordinates', lat: 42.7, lon: 0.1 }, expectedUpdatedAt: '2026-10-31T09:00:00+00:00' });
  });

  it('STALE_RESOURCE: mensaje útil y «Recargar los datos» vuelve a leer la misión', async () => {
    const { user, calls, server } = await openDetail({ [`PATCH ${PATH}`]: () => apiError(409, 'STALE_RESOURCE', { currentUpdatedAt: '2026-10-31T09:30:00+00:00' }) });
    server.state.mission = detail({ name: 'Nombre de otra persona', updatedAt: '2026-10-31T09:30:00+00:00' }) as Mission;
    await user.click(screen.getByRole('button', { name: D.editData }));
    await user.type(screen.getByLabelText(es.createMission.description), ' más');
    const reads = missionReads(calls());
    await user.click(screen.getByRole('button', { name: D.edit.save }));
    expect(await screen.findByText(D.edit.stale)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: D.edit.reload }));
    await waitFor(() => expect(missionReads(calls())).toBe(reads + 1));
    await waitFor(() => expect((screen.getByLabelText(es.createMission.name) as HTMLInputElement).value).toBe('Nombre de otra persona'));
    expect(screen.queryByText(D.edit.stale)).toBeNull();
  });

  it('DUPLICATE_NAME se muestra en el campo del nombre', async () => {
    const { user } = await openDetail({ [`PATCH ${PATH}`]: () => apiError(409, 'DUPLICATE_NAME') });
    await user.click(screen.getByRole('button', { name: D.editData }));
    await user.type(screen.getByLabelText(es.createMission.name), ' 2');
    await user.click(screen.getByRole('button', { name: D.edit.save }));
    expect(await screen.findByText(es.createMission.duplicateName)).toBeTruthy();
    expect(screen.getByLabelText(es.createMission.name).getAttribute('aria-invalid')).toBe('true');
  });

  it('el nombre fuera de 3–120 caracteres no se envía', async () => {
    const { user, calls } = await openDetail();
    await user.click(screen.getByRole('button', { name: D.editData }));
    await user.clear(screen.getByLabelText(es.createMission.name));
    await user.type(screen.getByLabelText(es.createMission.name), 'ab');
    await user.click(screen.getByRole('button', { name: D.edit.save }));
    expect(await screen.findByText(es.createMission.nameInvalid)).toBeTruthy();
    expect(sends(calls(), 'PATCH', PATH)).toHaveLength(0);
  });

  it('cancelar vuelve a la cabecera sin guardar y devuelve el foco al botón', async () => {
    const { user, calls } = await openDetail();
    await user.click(screen.getByRole('button', { name: D.editData }));
    await user.type(screen.getByLabelText(es.createMission.name), ' cambio');
    await user.click(screen.getByRole('button', { name: D.edit.cancel }));
    expect(screen.getByRole('button', { name: D.editData })).toBeTruthy();
    expect(sends(calls(), 'PATCH', PATH)).toHaveLength(0);
    expect(document.activeElement?.id).toBe('mission-edit-button');
  });
});

describe('detalle de misión en francés', () => {
  it('los textos salen de packages/i18n', async () => {
    setup(PATH, detailServer().handlers, { language: 'fr' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Rescate en el Aneto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.missionDetail.editData })).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.missionDetail.points.add.origin })).toBeTruthy();
    expect(screen.getByText(fr.missions.status.planning)).toBeTruthy();
    expect(screen.getByRole('region', { name: fr.missionDetail.readiness.title })).toBeTruthy();
  });
});

// ---------- Ciclo de vida, duplicar e historial (T8: RF-202, RF-203, RF-207, RF-208 sin asistencia, RN-05) ----------

const L = D.lifecycle;
const H = D.history;
const COPY_ID = '55555555-5555-4555-8555-555555555555';

const planningActions = { ...allActions, activate: true, close: false, reopen: false };
const activeActions = { ...allActions, activate: false, close: true, reopen: false };
const closedActions = { ...noActions, reopen: true, duplicate: true };

const entry = (id: number, action: string, extra: Record<string, unknown> = {}) => ({
  id,
  occurredAt: `2026-10-31T0${id}:00:00+00:00`,
  action,
  actor: COORDINATOR,
  summary: null,
  ...extra,
});

/** La misión cambia de estado como lo haría el servidor y el historial gana una línea por cada acción. */
function lifecycleServer(initial: Mission) {
  const server = detailServer(initial);
  const history = [entry(1, 'mission_created')];
  const transition = (status: string, actions: object, action: string, extra: Record<string, unknown> = {}) => {
    server.state.mission = { ...server.state.mission, status, actions, ...extra } as Mission;
    history.unshift(entry(history.length + 1, action));
    return json(200, server.state.mission);
  };
  const copy = detail({ id: COPY_ID, name: 'Rescate en el Aneto (copia)', status: 'planning', actions: planningActions });
  Object.assign(server.handlers, {
    [`POST ${PATH}/activate`]: () => transition('active', activeActions, 'mission_activated', { activatedAt: '2026-10-31T11:00:00+00:00' }),
    [`POST ${PATH}/close`]: () => transition('closed', closedActions, 'mission_closed', { closedAt: '2026-10-31T12:00:00+00:00' }),
    [`POST ${PATH}/reopen`]: () => transition('active', activeActions, 'mission_reopened', { closedAt: null }),
    [`POST ${PATH}/duplicate`]: () => json(201, copy),
    [`GET /missions/${COPY_ID}`]: () => json(200, copy),
    [`GET ${PATH}/history`]: ({ query }: Call) => json(200, { items: history, page: Number(query.get('page') ?? 1), pageSize: 20, total: history.length }),
    [`GET /missions/${COPY_ID}/history`]: () => json(200, { items: [entry(1, 'mission_created', { summary: null })], page: 1, pageSize: 20, total: 1 }),
  });
  return server;
}

const warning = () => apiError(409, 'CONFIRMATION_REQUIRED', { warning: 'no_validated_route' });
const currentPath = () => screen.getByTestId('path').textContent;

describe('historial de la misión (RN-05)', () => {
  it('muestra las acciones con su texto traducido, de más reciente a más antigua, con quién y cuándo', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    await openDetail(
      {
        [`GET ${PATH}/history`]: () =>
          json(200, {
            items: [entry(3, 'mission_updated', { summary: 'name, target' }), entry(2, 'point_added', { summary: 'Refugio de la Renclusa' }), entry(1, 'mission_created', { actor: null })],
            page: 1,
            pageSize: 20,
            total: 3,
          }),
      },
      server,
    );
    const region = await screen.findByRole('region', { name: H.title });
    const items = await within(region).findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain(`${H.actions.mission_updated}: ${H.fields.name}, ${H.fields.target}`);
    expect(items[1]!.textContent).toContain(`${H.actions.point_added}: Refugio de la Renclusa`);
    expect(items[2]!.textContent).toContain(H.actions.mission_created);
    expect(items[0]!.textContent).toContain(H.by.replace('{{actor}}', 'Coordinador Demo'));
    expect(items[2]!.textContent).toContain(H.by.replace('{{actor}}', H.system));
    expect(items[0]!.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-31T03:00:00+00:00');
    expect(items.map((item) => item.textContent).join(' ')).not.toMatch(/mission_|point_/); // nunca el nombre técnico
  });

  it('estados de carga, vacío y error con reintento', async () => {
    let attempts = 0;
    const server = lifecycleServer(detail({ actions: planningActions }));
    await openDetail(
      {
        [`GET ${PATH}/history`]: () => {
          attempts += 1;
          if (attempts === 1) return apiError(500, 'INTERNAL');
          return json(200, { items: [], page: 1, pageSize: 20, total: 0 });
        },
      },
      server,
    );
    const region = screen.getByRole('region', { name: H.title });
    expect(await within(region).findByText(es.state.errorTitle)).toBeTruthy();
    await userEventClick(within(region).getByRole('button', { name: es.state.retry }));
    expect(await within(region).findByText(H.empty)).toBeTruthy();
  });

  it('muestra el cargando mientras llega el historial', async () => {
    let release: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => (release = resolve));
    const server = lifecycleServer(detail({ actions: planningActions }));
    await openDetail({ [`GET ${PATH}/history`]: () => pending }, server);
    const region = screen.getByRole('region', { name: H.title });
    expect(within(region).getByText(es.state.loading)).toBeTruthy();
    release(json(200, { items: [entry(1, 'mission_created')], page: 1, pageSize: 20, total: 1 }));
    expect(await within(region).findByText(H.actions.mission_created)).toBeTruthy();
    expect(within(region).queryByText(es.state.loading)).toBeNull();
  });

  it('pagina cuando hay más de una página', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    const { user, calls } = await openDetail(
      {
        [`GET ${PATH}/history`]: ({ query }: Call) =>
          json(200, { items: [entry(Number(query.get('page') ?? 1), 'point_added', { summary: `Punto ${query.get('page')}` })], page: Number(query.get('page') ?? 1), pageSize: 20, total: 45 }),
      },
      server,
    );
    expect(await screen.findByText('Punto 1', { exact: false })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: es.missions.pagination.label });
    expect(within(nav).getByText('Página 1 de 3')).toBeTruthy();
    await user.click(within(nav).getByRole('button', { name: es.missions.pagination.next }));
    expect(await screen.findByText('Punto 2', { exact: false })).toBeTruthy();
    expect(
      calls()
        .filter((c) => c.path === `${PATH}/history`)
        .at(-1)!
        .query.get('page'),
    ).toBe('2');
  });

  it('en francés, textos en francés', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    setup(PATH, server.handlers, { language: 'fr' });
    const region = await screen.findByRole('region', { name: fr.missionDetail.history.title });
    expect(await within(region).findByText(fr.missionDetail.history.actions.mission_created)).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.missionDetail.lifecycle.activate })).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.missionDetail.lifecycle.duplicate })).toBeTruthy();
  });
});

/** Pulsa sin tener a mano el `user` de `setup`. */
async function userEventClick(element: HTMLElement) {
  const { default: userEvent } = await import('@testing-library/user-event');
  await userEvent.setup().click(element);
}

describe('activar misión (RF-207, D-H1-04)', () => {
  it('sin ruta validada avisa y solo activa al confirmar; Escape devuelve el foco y no activa', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    let attempts = 0;
    const { user, calls } = await openDetail(
      {
        [`POST ${PATH}/activate`]: ({ body }) => {
          attempts += 1;
          if (!(body as { confirmWithoutValidatedRoute?: boolean }).confirmWithoutValidatedRoute) return warning();
          server.state.mission = detail({ status: 'active', activatedAt: '2026-10-31T11:00:00+00:00', actions: activeActions }) as Mission;
          return json(200, server.state.mission);
        },
      },
      server,
    );
    const activate = screen.getByRole('button', { name: L.activate });
    await user.click(activate);

    // El aviso es un diálogo modal con el foco en la opción segura; el resto de la página queda inerte.
    const dialog = await screen.findByRole('dialog', { name: L.activateWarning.title });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByText(L.activateWarning.body)).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: L.activateWarning.cancel }));
    expect(document.body.querySelector('[inert]')).not.toBeNull();
    expect(sends(calls(), 'POST', `${PATH}/activate`)).toHaveLength(1);
    expect(sends(calls(), 'POST', `${PATH}/activate`)[0]!.body as object).toEqual({});

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.querySelector('[inert]')).toBeNull();
    expect(document.activeElement).toBe(activate); // el foco vuelve al botón que lo abrió
    expect(attempts).toBe(1); // cancelar no activa
    expect(screen.getByText(T.status.planning)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: L.activate }));
    await user.click(await screen.findByRole('button', { name: L.activateWarning.confirm }));
    await waitFor(() => expect(attempts).toBe(3));
    expect(sends(calls(), 'POST', `${PATH}/activate`).at(-1)!.body).toEqual({ confirmWithoutValidatedRoute: true });
    expect(await screen.findByText(L.activated)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.status-badge')?.textContent).toBe(T.status.active);
    expect(screen.queryByRole('button', { name: L.activate })).toBeNull();
    expect(screen.getByRole('button', { name: L.close })).toBeTruthy();
    expect(document.activeElement?.id).toBe('mission-title');
  });

  it('con una ruta validada (sin aviso) activa a la primera y sin diálogo', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    const { user, calls } = await openDetail({}, server);
    await user.click(screen.getByRole('button', { name: L.activate }));
    expect(await screen.findByText(L.activated)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sends(calls(), 'POST', `${PATH}/activate`)).toHaveLength(1);
    // El historial se refresca con la acción nueva.
    expect(await within(screen.getByRole('region', { name: H.title })).findByText(H.actions.mission_activated)).toBeTruthy();
  });

  it('INVALID_STATE_TRANSITION: explica que alguien se adelantó y vuelve a leer la misión', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    const { user, calls } = await openDetail(
      {
        [`POST ${PATH}/activate`]: () => {
          server.state.mission = detail({ status: 'active', actions: activeActions }) as Mission;
          return apiError(409, 'INVALID_STATE_TRANSITION');
        },
      },
      server,
    );
    const reads = missionReads(calls());
    await user.click(screen.getByRole('button', { name: L.activate }));
    expect(await screen.findByText(L.invalidTransition)).toBeTruthy();
    await waitFor(() => expect(missionReads(calls())).toBe(reads + 1));
    await waitFor(() => expect(screen.queryByRole('button', { name: L.activate })).toBeNull());
    expect(screen.getByRole('button', { name: L.close })).toBeTruthy();
  });

  it('un fallo al repetir con confirmación se muestra dentro del diálogo, que sigue abierto', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    const { user } = await openDetail(
      { [`POST ${PATH}/activate`]: ({ body }) => ((body as { confirmWithoutValidatedRoute?: boolean }).confirmWithoutValidatedRoute ? apiError(500, 'INTERNAL') : warning()) },
      server,
    );
    await user.click(screen.getByRole('button', { name: L.activate }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: L.activateWarning.confirm }));
    expect(await within(dialog).findByText(es.errors.INTERNAL)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Tab y Mayús+Tab no sacan el foco del diálogo', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    const { user } = await openDetail({ [`POST ${PATH}/activate`]: () => warning() }, server);
    await user.click(screen.getByRole('button', { name: L.activate }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: L.activateWarning.confirm });
    const cancel = within(dialog).getByRole('button', { name: L.activateWarning.cancel });
    expect(document.activeElement).toBe(cancel);
    await user.tab(); // «Ahora no» es el último: vuelve al primero
    expect(document.activeElement).toBe(confirm);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    await user.tab({ shift: true }); // desde el primero, al último
    expect(document.activeElement).toBe(cancel);
  });
});

describe('cerrar y reabrir (RF-202, RF-208 sin asistencia, RN-09)', () => {
  it('cerrar solo pide confirmar (cero aceptados) y envía una asistencia vacía; después la misión es de solo lectura', async () => {
    const server = lifecycleServer(detail({ status: 'active', activatedAt: '2026-10-31T11:00:00+00:00', actions: activeActions }));
    const { user, calls } = await openDetail({}, server);
    await user.click(screen.getByRole('button', { name: L.close }));
    const dialog = await screen.findByRole('dialog', { name: L.closeDialog.title });
    expect(within(dialog).getByText(L.closeDialog.noParticipants)).toBeTruthy();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: L.closeDialog.cancel }));

    await user.click(within(dialog).getByRole('button', { name: L.closeDialog.confirm }));
    expect(await screen.findByText(L.closed)).toBeTruthy();
    expect(sends(calls(), 'POST', `${PATH}/close`)).toHaveLength(1);
    expect(sends(calls(), 'POST', `${PATH}/close`)[0]!.body).toEqual({ attendance: [] });
    expect(document.querySelector('.status-badge')?.textContent).toBe(T.status.closed);
    expect(screen.getByText(D.readOnlyClosed)).toBeTruthy();
    expect(screen.queryByRole('button', { name: L.close })).toBeNull();
    expect(screen.queryByRole('button', { name: D.editData })).toBeNull();
    expect(screen.getByRole('button', { name: L.reopen })).toBeTruthy();
    expect(document.activeElement?.id).toBe('mission-title');
  });

  it('cancelar el diálogo de cierre deja la misión activa y no llama al servidor', async () => {
    const server = lifecycleServer(detail({ status: 'active', actions: activeActions }));
    const { user, calls } = await openDetail({}, server);
    const close = screen.getByRole('button', { name: L.close });
    await user.click(close);
    await user.click(await screen.findByRole('button', { name: L.closeDialog.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sends(calls(), 'POST', `${PATH}/close`)).toHaveLength(0);
    expect(document.activeElement).toBe(close);
    expect(document.querySelector('.status-badge')?.textContent).toBe(T.status.active);
  });

  it('cerrar con la misión ya cerrada por otra persona: INVALID_STATE_TRANSITION, mensaje y datos recargados', async () => {
    const server = lifecycleServer(detail({ status: 'active', actions: activeActions }));
    const { user } = await openDetail(
      {
        [`POST ${PATH}/close`]: () => {
          server.state.mission = detail({ status: 'closed', actions: closedActions }) as Mission;
          return apiError(409, 'INVALID_STATE_TRANSITION');
        },
      },
      server,
    );
    await user.click(screen.getByRole('button', { name: L.close }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: L.closeDialog.confirm }));
    expect(await screen.findByText(L.invalidTransition)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.querySelector('.status-badge')?.textContent).toBe(T.status.closed));
  });

  it('ATTENDANCE_INCOMPLETE se explica dentro del diálogo, que sigue abierto', async () => {
    const server = lifecycleServer(detail({ status: 'active', actions: activeActions }));
    const { user } = await openDetail({ [`POST ${PATH}/close`]: () => apiError(422, 'ATTENDANCE_INCOMPLETE', { missingParticipationIds: [] }) }, server);
    await user.click(screen.getByRole('button', { name: L.close }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: L.closeDialog.confirm }));
    expect(await within(dialog).findByText(es.errors.ATTENDANCE_INCOMPLETE)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('reabrir vuelve a Activa y devuelve las acciones; DUPLICATE_NAME explica el choque y la misión sigue cerrada', async () => {
    const server = lifecycleServer(detail({ status: 'closed', closedAt: '2026-10-31T12:00:00+00:00', actions: closedActions }));
    let first = true;
    const { user, calls } = await openDetail(
      {
        [`POST ${PATH}/reopen`]: () => {
          if (first) {
            first = false;
            return apiError(409, 'DUPLICATE_NAME');
          }
          server.state.mission = detail({ status: 'active', actions: activeActions }) as Mission;
          return json(200, server.state.mission);
        },
      },
      server,
    );
    await user.click(screen.getByRole('button', { name: L.reopen }));
    expect(await screen.findByText(L.reopenDuplicateName)).toBeTruthy();
    expect(document.querySelector('.status-badge')?.textContent).toBe(T.status.closed);
    expect(screen.getByRole('button', { name: L.reopen })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: L.reopen }));
    expect(await screen.findByText(L.reopened)).toBeTruthy();
    expect(sends(calls(), 'POST', `${PATH}/reopen`)).toHaveLength(2);
    expect(document.querySelector('.status-badge')?.textContent).toBe(T.status.active);
    expect(screen.queryByText(L.reopenDuplicateName)).toBeNull();
    expect(screen.getByRole('button', { name: D.editData })).toBeTruthy();
    expect(screen.getByRole('button', { name: L.close })).toBeTruthy();
  });
});

describe('duplicar (RF-203, D-H1-05)', () => {
  it('pide el nombre de la copia, con foco y texto seleccionado, y lleva al detalle de la copia en planificación', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    const { user, calls } = await openDetail({}, server);
    await user.click(screen.getByRole('button', { name: L.duplicate }));
    const dialog = await screen.findByRole('dialog', { name: L.duplicateDialog.title });
    const name = within(dialog).getByLabelText(L.duplicateDialog.name) as HTMLInputElement;
    expect(document.activeElement).toBe(name);
    expect(name.value).toBe('Rescate en el Aneto (copia)');
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe(name.value.length);

    await user.clear(name);
    await user.type(name, '  Rescate del Posets  ');
    await user.click(within(dialog).getByRole('button', { name: L.duplicateDialog.confirm }));
    await waitFor(() => expect(sends(calls(), 'POST', `${PATH}/duplicate`)).toHaveLength(1));
    expect(sends(calls(), 'POST', `${PATH}/duplicate`)[0]!.body).toEqual({ name: 'Rescate del Posets' });
    await waitFor(() => expect(currentPath()).toBe(`/missions/${COPY_ID}`));
    expect(await screen.findByRole('heading', { level: 1, name: 'Rescate en el Aneto (copia)' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.status-badge')?.textContent).toBe(T.status.planning);
    expect(screen.getByText(L.duplicated.replace('{{name}}', 'Rescate en el Aneto'))).toBeTruthy();
  });

  it('DUPLICATE_NAME se muestra en el campo y el diálogo sigue abierto; un nombre corto no se envía', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    const { user, calls } = await openDetail({ [`POST ${PATH}/duplicate`]: () => apiError(409, 'DUPLICATE_NAME') }, server);
    await user.click(screen.getByRole('button', { name: L.duplicate }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText(L.duplicateDialog.name);
    await user.clear(name);
    await user.type(name, 'ab');
    await user.click(within(dialog).getByRole('button', { name: L.duplicateDialog.confirm }));
    expect(await within(dialog).findByText(es.createMission.nameInvalid)).toBeTruthy();
    expect(sends(calls(), 'POST', `${PATH}/duplicate`)).toHaveLength(0);

    await user.type(name, 'c');
    await user.click(within(dialog).getByRole('button', { name: L.duplicateDialog.confirm }));
    expect(await within(dialog).findByText(es.createMission.duplicateName)).toBeTruthy();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(currentPath()).toBe(PATH);
    await user.type(name, 'd'); // escribir de nuevo quita el aviso
    expect(within(dialog).queryByText(es.createMission.duplicateName)).toBeNull();
  });

  it('cancelar con Escape no crea nada', async () => {
    const server = lifecycleServer(detail({ actions: planningActions }));
    const { user, calls } = await openDetail({}, server);
    const button = screen.getByRole('button', { name: L.duplicate });
    await user.click(button);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sends(calls(), 'POST', `${PATH}/duplicate`)).toHaveLength(0);
    expect(document.activeElement).toBe(button);
  });

  it('una misión cerrada también se puede duplicar', async () => {
    const server = lifecycleServer(detail({ status: 'closed', actions: closedActions }));
    await openDetail({}, server);
    expect(screen.getByRole('button', { name: L.duplicate })).toBeTruthy();
  });
});

describe('acciones del ciclo de vida según `actions`', () => {
  it('sin permisos (administrador) no hay ninguna acción del ciclo de vida', async () => {
    const server = lifecycleServer(detail({ actions: noActions }));
    await openDetail({}, server, { user: admin() });
    for (const name of [L.activate, L.close, L.reopen, L.duplicate]) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('group', { name: L.groupLabel })).toBeNull();
    // El administrador sí lee el historial.
    expect(await screen.findByRole('region', { name: H.title })).toBeTruthy();
  });

  it('cada estado ofrece lo suyo: planificación activa y duplica; activa cierra y duplica; cerrada reabre y duplica', async () => {
    const planning = lifecycleServer(detail({ actions: planningActions }));
    const view = await openDetail({}, planning);
    const labels = () =>
      within(screen.getByRole('group', { name: L.groupLabel }))
        .getAllByRole('button')
        .map((button) => button.textContent);
    expect(labels()).toEqual([L.activate, L.duplicate]);
    view.unmount();

    const active = lifecycleServer(detail({ status: 'active', actions: activeActions }));
    const second = await openDetail({}, active);
    expect(labels()).toEqual([L.close, L.duplicate]);
    second.unmount();

    const closed = lifecycleServer(detail({ status: 'closed', actions: closedActions }));
    await openDetail({}, closed);
    expect(labels()).toEqual([L.reopen, L.duplicate]);
  });
});
