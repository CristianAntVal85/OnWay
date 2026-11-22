// Inicio informativo del personal (T9, RF-701, RF-703, RF-704, RF-705, RF-708) y Mis misiones / detalle del rescatista (RF-601, RF-602).
// `src/map/` se sustituye por un doble: MapLibre no corre en jsdom (el mapa real se prueba en Chromium).
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { admin, apiError, json, renderApp, rescuer, sessionServer, sessionUser, type Call } from './support';
import { CELL, environment, mockGeolocation, restoreGeolocation, unavailableWeather } from './environment-support';

interface FakeMapProps {
  markers?: readonly { id: string; kind: string; lat: number; lon: number }[];
  onPick?: unknown;
  elevationLookup?: unknown;
}
const mapProps: { current: FakeMapProps } = { current: {} };

vi.mock('../src/map', () => ({
  MAP_LAYERS: ['satellite', 'topographic', 'roads'],
  MapView: (props: FakeMapProps) => {
    mapProps.current = props;
    return (
      <div data-testid="map">
        {props.markers?.map((m) => (
          <span key={m.id} data-testid={`marker-${m.kind}`}>{`${m.id}:${m.lat},${m.lon}`}</span>
        ))}
      </div>
    );
  },
}));

afterEach(() => restoreGeolocation());

const MISSION_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';
const H = es.home;
const E = es.environment;
const M = es.myMissions;

const activeItem = (overrides: Record<string, unknown> = {}) => ({
  id: MISSION_ID,
  name: 'Simulacro ficticio · Valle de Ordesa',
  status: 'active',
  coordinator: { id: sessionUser().id, displayName: 'Coordinador Demo' },
  target: { lat: 42.6, lon: -0.05, elevationM: 3100, label: null, country: 'ES', source: 'coordinates' },
  origins: [{ id: 'o1', name: 'Pradera de Ordesa' }],
  routes: { validated: 0, total: 0 },
  participants: { accepted: 2, pending: 3 },
  createdAt: '2026-10-31T09:00:00+00:00',
  updatedAt: '2026-10-31T09:00:00+00:00',
  ...overrides,
});
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 20, total: items.length, ...extra });

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;

function setup(route: string, extra: Handlers = {}, options: { user?: ReturnType<typeof sessionUser>; language?: 'es' | 'fr' } = {}) {
  const language = options.language ?? 'es';
  const server = sessionServer({ user: options.user ?? sessionUser({ locale: language }) }, { 'GET /environment': () => json(200, environment()), ...extra });
  const view = renderApp({ route, fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}

const envCalls = (calls: Call[]) => calls.filter((c) => c.path === '/environment');
const activeList: Handlers = { 'GET /missions': () => json(200, page([activeItem(), activeItem({ id: OTHER_ID, name: 'Otra misión', origins: [], participants: { accepted: 0, pending: 0 } })])) };

describe('inicio: misiones activas (RF-703)', () => {
  it('pide las activas y cada tarjeta dice lo pendiente: voluntarios por decidir, sin origen, sin ruta validada', async () => {
    mockGeolocation('none');
    const { calls } = setup('/home', activeList);
    const first = (await screen.findByRole('link', { name: 'Simulacro ficticio · Valle de Ordesa' })).closest('li')!;
    expect(
      calls()
        .find((c) => c.path === '/missions')!
        .query.get('status'),
    ).toBe('active');
    expect(within(first).getByText('Coordinador Demo', { exact: false })).toBeTruthy();
    expect(within(first).getByText('Aceptados 2 · Pendientes 3')).toBeTruthy();
    expect(first.textContent).toContain('Voluntarios por decidir: 3');
    expect(first.textContent).toContain(H.todo.noRoute);
    expect(first.textContent).not.toContain(H.todo.noOrigin);
    const second = screen.getByRole('link', { name: 'Otra misión' }).closest('li')!;
    expect(second.textContent).toContain(H.todo.noOrigin);
    expect(second.textContent).not.toContain('Voluntarios por decidir');
  });

  it('sin misiones activas: mensaje claro con el botón de crear (coordinador); el administrador no lo tiene', async () => {
    mockGeolocation('none');
    const first = setup('/home', { 'GET /missions': () => json(200, page([])) });
    expect(await screen.findByText(H.missionsEmptyTitle)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: es.nav.createMission }).length).toBeGreaterThan(0);
    first.unmount();

    setup('/home', { 'GET /missions': () => json(200, page([])) }, { user: admin() });
    expect(await screen.findByText(H.missionsEmptyTitle)).toBeTruthy();
    const main = within(screen.getByRole('main'));
    expect(main.queryByRole('link', { name: es.nav.createMission })).toBeNull();
  });

  it('carga, error con reintento y enlace a todas si hay más de las que caben', async () => {
    mockGeolocation('none');
    let attempts = 0;
    const { user } = setup('/home', {
      'GET /missions': () => {
        attempts += 1;
        return attempts === 1 ? apiError(500, 'INTERNAL') : json(200, page([activeItem()], { total: 45 }));
      },
    });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(es.errors.INTERNAL)).toBeTruthy();
    await user.click(within(alert).getByRole('button', { name: es.state.retry }));
    const all = await screen.findByRole('link', { name: H.seeAll.replace('{{total}}', '45') });
    expect(all.getAttribute('href')).toBe('/missions?tab=active');
  });

  it('sin conexión dice que hace falta conexión, y el resto del inicio sigue', async () => {
    mockGeolocation('none');
    const { api } = sessionServer({ user: sessionUser() });
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).includes('/missions')) throw new TypeError('Failed to fetch');
      return api.fetch(input, init);
    };
    renderApp({ fetch: fetchImpl });
    expect(await screen.findByText(es.state.offline)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: es.home.title })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: E.title })).toBeTruthy();
  });

  it('sigue mostrando la organización de la sesión y su país (H0)', async () => {
    mockGeolocation('none');
    setup('/home', activeList);
    expect(await screen.findByText('Servicio de Rescate Valle Demo', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('España', { selector: 'dd' })).toBeTruthy();
  });

  it('no escribe nada: sin formularios ni campos de edición', async () => {
    mockGeolocation('granted');
    setup('/home', activeList);
    await screen.findByRole('link', { name: 'Otra misión' });
    const main = screen.getByRole('main');
    expect(main.querySelectorAll('input, textarea, select, form')).toHaveLength(0);
  });
});

describe('inicio: tiempo, luz y luna de la ubicación (RF-704, RF-705, RF-708)', () => {
  it('con la ubicación concedida pide el entorno de la celda redondeada y pinta la tarjeta simple con la atribución (issue #18)', async () => {
    const geolocation = mockGeolocation('granted');
    const { calls } = setup('/home', activeList);
    expect(await screen.findByRole('heading', { level: 3, name: E.weather.title })).toBeTruthy();
    expect(geolocation).toHaveBeenCalledTimes(1);

    const requests = envCalls(calls());
    expect(requests).toHaveLength(1);
    expect(requests[0]!.query.get('lat')).toBe(CELL.lat);
    expect(requests[0]!.query.get('lon')).toBe(CELL.lon);
    expect(requests[0]!.query.get('missionId')).toBeNull();

    expect(screen.getByText(E.basis.device)).toBeTruthy();
    // Tarjeta simple: tres iconos por tramo del día, el termómetro con la temperatura y el viento
    const weather = screen.getByRole('heading', { level: 3, name: E.weather.title }).closest('section')!;
    expect(within(weather).getByRole('list', { name: E.simple.partsLabel }).querySelectorAll('li')).toHaveLength(3);
    expect(within(weather).getByText('2 °C')).toBeTruthy();
    expect(within(weather).getByText('17 km/h')).toBeTruthy();
    // Atribución: texto, sin enlace
    const attribution = within(weather).getByText(E.weather.attribution);
    expect(attribution.closest('a')).toBeNull();
    expect(attribution.querySelector('a')).toBeNull();
    // El botón lleva al detalle de este punto (el dispositivo: sin misión)
    expect(within(weather).getByRole('link', { name: E.simple.detailCta }).getAttribute('href')).toBe('/weather');
    // Lo demás ya no está en Inicio: ni altitud, ni rachas, ni isoterma, ni próximos días, ni detalle por hora, ni luz y luna
    expect(screen.queryByText(/calculado a/)).toBeNull();
    expect(within(weather).queryByText(/rachas/)).toBeNull();
    expect(within(weather).queryByText(/^2\.?890 m$/)).toBeNull();
    expect(within(weather).queryByText(E.weather.nextDays)).toBeNull();
    expect(within(weather).queryByText(E.weather.hourly)).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: E.light.title })).toBeNull();
  });

  it('la ubicación se pide una sola vez por sesión aunque se navegue y se vuelva al inicio', async () => {
    const geolocation = mockGeolocation('granted');
    const { user, calls } = setup('/home', { ...activeList, 'GET /teams': () => json(200, page([])) });
    await screen.findByRole('heading', { level: 3, name: E.weather.title });
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: es.nav.missions }));
    await screen.findByRole('heading', { level: 1, name: es.missions.title });
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: es.nav.home }));
    await screen.findByRole('heading', { level: 3, name: E.weather.title });
    expect(geolocation).toHaveBeenCalledTimes(1);
    expect(envCalls(calls())).toHaveLength(1); // la caché de consultas sirve el mismo punto
  });

  it('mientras se espera la ubicación lo dice, y no se pide el tiempo todavía', async () => {
    const getCurrentPosition = mockGeolocation('granted');
    getCurrentPosition.mockImplementation(() => undefined); // el permiso sigue pendiente
    const { calls } = setup('/home', activeList);
    expect(await screen.findByText(E.locating)).toBeTruthy();
    await screen.findByRole('link', { name: 'Otra misión' });
    expect(envCalls(calls())).toHaveLength(0);
  });

  it('pinchar una misión pasa al tiempo de su objetivo; «Volver a mi ubicación» regresa sin repetir la petición', async () => {
    mockGeolocation('granted');
    const { user, calls } = setup('/home', {
      ...activeList,
      'GET /environment': ({ query }) =>
        json(200, query.get('missionId') ? environment({ basis: 'mission', missionId: MISSION_ID, location: { lat: 42.6, lon: -0.05, elevationM: 3100, country: 'ES' } }) : environment()),
    });
    await screen.findByRole('heading', { level: 3, name: E.weather.title });
    const pick = screen.getByRole('button', { name: H.pickLabel.replace('{{name}}', 'Simulacro ficticio · Valle de Ordesa') });
    expect(pick.getAttribute('aria-pressed')).toBe('false');
    await user.click(pick);

    expect(await screen.findByText(E.basis.mission.replace('{{name}}', 'Simulacro ficticio · Valle de Ordesa'))).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('link', { name: E.simple.detailCta }).getAttribute('href')).toBe(`/weather?mission=${MISSION_ID}`));
    expect(pick.getAttribute('aria-pressed')).toBe('true');
    expect(pick.closest('li')!.getAttribute('data-picked')).toBe('true');
    const missionCall = envCalls(calls()).at(-1)!;
    expect(missionCall.query.get('missionId')).toBe(MISSION_ID);
    expect(missionCall.query.get('lat')).toBeNull();
    expect(screen.getByText(E.announceMission.replace('{{name}}', 'Simulacro ficticio · Valle de Ordesa'))).toBeTruthy(); // anunciado sin mover el foco

    await user.click(screen.getByRole('button', { name: E.backToDevice }));
    expect(await screen.findByText(E.basis.device)).toBeTruthy();
    expect(screen.queryByRole('button', { name: E.backToDevice })).toBeNull();
    expect(pick.getAttribute('aria-pressed')).toBe('false');
    expect(envCalls(calls())).toHaveLength(2); // dispositivo + misión; volver usa la caché
  });

  it('volver a pulsar la misma tarjeta también vuelve a la ubicación', async () => {
    mockGeolocation('granted');
    const { user } = setup('/home', activeList);
    await screen.findByRole('heading', { level: 3, name: E.weather.title });
    const pick = screen.getByRole('button', { name: H.pickLabel.replace('{{name}}', 'Otra misión') });
    await user.click(pick);
    expect(await screen.findByText(E.basis.mission.replace('{{name}}', 'Otra misión'))).toBeTruthy();
    await user.click(pick);
    expect(await screen.findByText(E.basis.device)).toBeTruthy();
  });

  it('con la ubicación denegada lo dice y deja elegir una misión; «Probar de nuevo» solo vuelve a pedirla al pulsarlo', async () => {
    const geolocation = mockGeolocation('denied');
    const { user, calls } = setup('/home', activeList);
    expect(await screen.findByText(E.noLocation.title)).toBeTruthy();
    expect(screen.getByText(E.noLocation.denied)).toBeTruthy();
    expect(envCalls(calls())).toHaveLength(0);
    expect(geolocation).toHaveBeenCalledTimes(1);

    // La pantalla no se rompe: se puede elegir una misión.
    await user.click(await screen.findByRole('button', { name: H.pickLabel.replace('{{name}}', 'Otra misión') }));
    expect(await screen.findByRole('heading', { level: 3, name: E.weather.title })).toBeTruthy();
    expect(envCalls(calls())[0]!.query.get('missionId')).toBe(OTHER_ID);

    await user.click(screen.getByRole('button', { name: E.backToDevice }));
    await user.click(await screen.findByRole('button', { name: E.noLocation.retry }));
    expect(geolocation).toHaveBeenCalledTimes(2);
  });

  it('si el navegador no la ofrece, o falla, también se degrada con el mensaje que toca', async () => {
    mockGeolocation('none');
    const first = setup('/home', activeList);
    expect(await screen.findByText(E.noLocation.unsupported)).toBeTruthy();
    expect(screen.queryByRole('button', { name: E.noLocation.retry })).toBeNull();
    first.unmount();

    mockGeolocation('unavailable');
    setup('/home', activeList);
    expect(await screen.findByText(E.noLocation.failed)).toBeTruthy();
    expect(screen.getByRole('button', { name: E.noLocation.retry })).toBeTruthy();
  });

  it('tiempo guardado (stale): enseña el último dato con su hora y avisa', async () => {
    mockGeolocation('granted');
    setup('/home', { ...activeList, 'GET /environment': () => json(200, environment({ weather: { ...environment().weather, status: 'stale', fetchedAt: '2026-11-01T07:05:00.000Z' } })) });
    const weather = (await screen.findByRole('heading', { level: 3, name: E.weather.title })).closest('section')!;
    expect(within(weather).getByRole('status').textContent).toMatch(/^Último dato guardado a las \d{2}:\d{2}: no se ha podido actualizar\.$/);
    expect(within(weather).getAllByText('2 °C').length).toBeGreaterThan(0);
    expect(within(weather).getByText(E.weather.attribution)).toBeTruthy();
  });

  it('tiempo no disponible (unavailable): lo dice con un reintento, y las misiones siguen funcionando', async () => {
    mockGeolocation('granted');
    let calls = 0;
    const { user } = setup('/home', {
      ...activeList,
      'GET /environment': () => {
        calls += 1;
        return json(200, environment(calls === 1 ? { weather: unavailableWeather } : {}));
      },
    });
    const weather = (await screen.findByRole('heading', { level: 3, name: E.weather.title })).closest('section')!;
    expect(within(weather).getByText(E.weather.unavailable)).toBeTruthy();
    expect(within(weather).queryByText(E.weather.attribution)).toBeNull();
    expect(screen.getByRole('link', { name: 'Otra misión' })).toBeTruthy();
    await user.click(within(weather).getByRole('button', { name: E.weather.retry }));
    await waitFor(() => expect(within(screen.getByRole('heading', { level: 3, name: E.weather.title }).closest('section')!).getAllByText('2 °C').length).toBeGreaterThan(0));
    expect(calls).toBe(2); // un reintento pedido por la persona, ninguno solo
  });

  it('un error del entorno (fuera de cobertura) se explica sin reintento; uno transitorio ofrece reintentar', async () => {
    mockGeolocation('granted');
    const first = setup('/home', { ...activeList, 'GET /environment': () => apiError(422, 'OUTSIDE_COVERAGE') });
    expect(await screen.findByText(es.errors.OUTSIDE_COVERAGE)).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(within(alert).queryByRole('button', { name: es.state.retry })).toBeNull();
    first.unmount();

    setup('/home', { ...activeList, 'GET /environment': () => apiError(500, 'INTERNAL') });
    const second = await screen.findByRole('alert');
    expect(within(second).getByRole('button', { name: es.state.retry })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Otra misión' })).toBeTruthy();
  });

  it('el tiempo no se vuelve a pedir al teclear ni al repintar: una consulta por punto', async () => {
    mockGeolocation('granted');
    const { user, calls } = setup('/home', activeList);
    await screen.findByRole('heading', { level: 3, name: E.weather.title });
    await user.tab();
    await user.tab();
    expect(envCalls(calls())).toHaveLength(1);
  });

  it('en francés, todo en francés', async () => {
    mockGeolocation('granted');
    setup('/home', activeList, { language: 'fr' });
    expect(await screen.findByRole('heading', { level: 1, name: fr.home.title })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 3, name: fr.environment.weather.title })).toBeTruthy();
    expect(screen.getByText(fr.environment.weather.attribution)).toBeTruthy();
    expect(screen.getByRole('link', { name: fr.environment.simple.detailCta })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: fr.home.missionsTitle })).toBeTruthy();
  });
});

// ---------------------------------------------------------------- rescatista
const complete = () => rescuer({ profileStatus: 'complete', nextStep: 'home' });

const myItem = (overrides: Record<string, unknown> = {}) => ({
  id: MISSION_ID,
  name: 'Simulacro ficticio · Valle de Ordesa',
  status: 'active',
  target: { lat: 42.6, lon: -0.05, elevationM: 3100, label: null, country: 'ES', source: 'coordinates' },
  coordinatorName: null,
  validatedRoutes: 0,
  myParticipation: null,
  ...overrides,
});

const myDetail = (overrides: Record<string, unknown> = {}) => ({
  id: MISSION_ID,
  name: 'Simulacro ficticio · Valle de Ordesa',
  description: 'Búsqueda ficticia de un excursionista.',
  status: 'active',
  target: { lat: 42.6, lon: -0.05, elevationM: 3100, label: 'Circo de Soaso', country: 'ES', source: 'address' },
  coordinatorName: null,
  points: [
    { id: 'p1', kind: 'origin', name: 'Pradera de Ordesa', note: 'Aparcamiento', lat: 42.65, lon: -0.03, elevationM: 1320, position: 0 },
    { id: 'p2', kind: 'rendezvous', name: 'Refugio de Góriz', note: null, lat: 42.65, lon: -0.01, elevationM: 2200, position: 0 },
  ],
  myParticipation: null,
  canOffer: true,
  canWithdraw: false,
  offerBlockedReason: 'profile_incomplete',
  ...overrides,
});

describe('rescatista: Mis misiones (RF-601)', () => {
  it('lista las activas de su organización con el tiempo arriba, sin control de escritura ni botón de oferta', async () => {
    mockGeolocation('granted');
    const { calls } = setup(
      '/missions',
      {
        'GET /my/missions': () =>
          json(200, page([myItem(), myItem({ id: OTHER_ID, name: 'Segunda misión', myParticipation: { status: 'pending', offeredAt: '2026-10-31T10:00:00+00:00', decidedAt: null } })])),
      },
      { user: complete() },
    );
    expect(await screen.findByRole('heading', { level: 1, name: M.title })).toBeTruthy();
    const link = await screen.findByRole('link', { name: 'Simulacro ficticio · Valle de Ordesa' });
    expect(
      calls()
        .find((c) => c.path === '/my/missions')!
        .query.get('status'),
    ).toBe('active');
    expect(calls().some((c) => c.path === '/missions')).toBe(false);

    const first = link.closest('li')!;
    expect(within(first).getByText(M.coordinatorNeutral)).toBeTruthy(); // coordinatorName llega null
    expect(within(first).getByText(M.participation.none)).toBeTruthy();
    const second = screen.getByRole('link', { name: 'Segunda misión' }).closest('li')!;
    expect(within(second).getByText(M.participation.status.pending)).toBeTruthy();

    // Versión reducida del inicio arriba: la ubicación redondeada
    expect(await screen.findByRole('heading', { level: 3, name: E.weather.title })).toBeTruthy();
    expect(envCalls(calls())[0]!.query.get('lat')).toBe(CELL.lat);

    // Solo lectura: ningún control de escritura ni oferta
    const names = screen.queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    expect(names.filter((n) => /ofrezc|ofrec|offre|Editar|Borrar|Crear|Activar|Cerrar misión/i.test(n))).toEqual([]);
    expect(screen.queryByRole('link', { name: es.missions.createCta })).toBeNull();
    expect(screen.getByRole('main').querySelectorAll('textarea, form[aria-label]')).toHaveLength(0);
  });

  it('la barra del rescatista no gana «Inicio»', async () => {
    mockGeolocation('none');
    setup('/missions', { 'GET /my/missions': () => json(200, page([])) }, { user: complete() });
    await screen.findByRole('heading', { level: 1, name: M.title });
    const names = within(screen.getByRole('navigation'))
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(names).toEqual([es.nav.missions, es.nav.myProfile, es.nav.account]);
  });

  it('pestañas Activas y Cerradas piden su estado; la búsqueda va al servidor', async () => {
    mockGeolocation('none');
    const { user, calls } = setup(
      '/missions',
      { 'GET /my/missions': ({ query }) => json(200, page(query.get('status') === 'closed' ? [myItem({ id: OTHER_ID, name: 'Misión cerrada', status: 'closed' })] : [myItem()])) },
      { user: complete() },
    );
    await screen.findByRole('link', { name: 'Simulacro ficticio · Valle de Ordesa' });
    expect(screen.getByRole('tab', { name: M.tabs.active }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: es.missions.tabs.planning })).toBeNull();
    await user.click(screen.getByRole('tab', { name: M.tabs.closed }));
    expect(await screen.findByRole('link', { name: 'Misión cerrada' })).toBeTruthy();
    expect(
      calls()
        .filter((c) => c.path === '/my/missions')
        .at(-1)!
        .query.get('status'),
    ).toBe('closed');

    await user.type(screen.getByRole('searchbox'), 'cer{Enter}');
    await waitFor(() =>
      expect(
        calls()
          .filter((c) => c.path === '/my/missions')
          .at(-1)!
          .query.get('q'),
      ).toBe('cer'),
    );
  });

  it('estado vacío, error con reintento y carga', async () => {
    mockGeolocation('none');
    const first = setup('/missions', { 'GET /my/missions': () => json(200, page([])) }, { user: complete() });
    expect(await screen.findByText(M.empty.active)).toBeTruthy();
    first.unmount();

    let attempts = 0;
    const { user } = setup(
      '/missions',
      {
        'GET /my/missions': () => {
          attempts += 1;
          return attempts === 1 ? apiError(500, 'INTERNAL') : json(200, page([myItem()]));
        },
      },
      { user: complete() },
    );
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: es.state.retry }));
    expect(await screen.findByRole('link', { name: 'Simulacro ficticio · Valle de Ordesa' })).toBeTruthy();
  });

  it('el tiempo es solo de su ubicación: las tarjetas no tienen botón «Tiempo» y, sin ubicación, se remite a abrir una misión', async () => {
    mockGeolocation('denied');
    const { calls } = setup('/missions', { 'GET /my/missions': () => json(200, page([myItem()])) }, { user: complete() });
    expect(await screen.findByRole('link', { name: 'Simulacro ficticio · Valle de Ordesa' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: H.pickLabel.replace('{{name}}', 'Simulacro ficticio · Valle de Ordesa') })).toBeNull();
    expect(screen.queryByRole('button', { name: H.pick })).toBeNull();
    expect(await screen.findByText(E.noLocation.open.title)).toBeTruthy();
    expect(screen.getByText(E.noLocation.open.denied)).toBeTruthy();
    expect(screen.queryByText(E.noLocation.title)).toBeNull();
    expect(envCalls(calls())).toHaveLength(0);
  });

  it('en francés', async () => {
    mockGeolocation('granted');
    setup('/missions', { 'GET /my/missions': () => json(200, page([myItem()])) }, { user: rescuer({ profileStatus: 'complete', nextStep: 'home', locale: 'fr' }), language: 'fr' });
    expect(await screen.findByRole('heading', { level: 1, name: fr.myMissions.title })).toBeTruthy();
    expect(await screen.findByText(fr.myMissions.coordinatorNeutral)).toBeTruthy();
    expect(screen.getByRole('tab', { name: fr.myMissions.tabs.closed })).toBeTruthy();
  });
});

describe('rescatista: detalle en solo lectura (RF-602)', () => {
  const detailHandlers = (body = myDetail()): Handlers => ({
    [`GET /my/missions/${MISSION_ID}`]: () => json(200, body),
    [`GET /my/missions/${MISSION_ID}/routes`]: () => json(200, { items: [] }),
    'GET /environment': ({ query }) => json(200, environment({ basis: 'mission', missionId: query.get('missionId'), location: { lat: 42.6, lon: -0.05, elevationM: 3100, country: 'ES' } })),
  });

  it('muestra puntos, mapa y el tiempo del objetivo, sin rutas, sin altitud en las coordenadas y sin ninguna escritura', async () => {
    mockGeolocation('granted');
    const { calls } = setup(`/missions/${MISSION_ID}`, detailHandlers(), { user: complete() });
    expect(await screen.findByRole('heading', { level: 1, name: 'Simulacro ficticio · Valle de Ordesa' })).toBeTruthy();
    expect(calls().some((c) => c.path === `/missions/${MISSION_ID}`)).toBe(false);

    // Cabecera
    expect(screen.getByText(M.coordinatorNeutral)).toBeTruthy();
    expect(screen.getByText('Circo de Soaso')).toBeTruthy();
    expect(screen.getByText('Búsqueda ficticia de un excursionista.')).toBeTruthy();
    expect(screen.getByText(M.detail.readOnly)).toBeTruthy();

    // Puntos por tipo, solo coordenadas
    const origins = screen.getByRole('heading', { level: 3, name: es.missionDetail.points.groups.origin }).closest('section')!;
    expect(within(origins).getByText('Pradera de Ordesa')).toBeTruthy();
    expect(within(origins).getByText('Aparcamiento')).toBeTruthy();
    expect(within(origins).getByText('42.65000, -0.03000')).toBeTruthy();
    expect(screen.getByRole('main').textContent).not.toMatch(/1\.?320\s*m|2\.?200\s*m/);
    expect(screen.getByText(es.missionDetail.points.empty.waypoint)).toBeTruthy();

    // Mapa: objetivo y puntos, de consulta (no se puede elegir punto) y sin altitud (el rescatista no tiene getElevation)
    expect(screen.getByTestId('marker-target').textContent).toContain('42.6,-0.05');
    expect(screen.getByTestId('marker-origin')).toBeTruthy();
    expect(mapProps.current.onPick).toBeUndefined();
    expect(mapProps.current.elevationLookup).toBeUndefined();

    // Tiempo del objetivo (por misión, no por la ubicación del dispositivo)
    expect(await screen.findByRole('heading', { level: 2, name: M.detail.environmentTitle })).toBeTruthy();
    await screen.findByRole('heading', { level: 3, name: E.weather.title });
    const env = calls().filter((c) => c.path === '/environment');
    expect(env).toHaveLength(1);
    expect(env[0]!.query.get('missionId')).toBe(MISSION_ID);
    expect(env[0]!.query.get('lat')).toBeNull();
    expect(screen.queryByRole('button', { name: E.backToDevice })).toBeNull();

    // Sin rutas ni oferta ni escritura
    expect(await screen.findByText(M.detail.noRoutes)).toBeTruthy();
    const names = screen.queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    expect(names.filter((n) => /ofrezc|ofrec|offre|Editar|Borrar|Añadir|Guardar|Activar|Cerrar|Reabrir|Duplicar/i.test(n))).toEqual([]);
    expect(screen.getByRole('main').querySelectorAll('input, textarea, select')).toHaveLength(0);
  });

  it('muestra el estado de mi oferta cuando existe, sin permitir cambiarla', async () => {
    mockGeolocation('none');
    setup(
      `/missions/${MISSION_ID}`,
      detailHandlers(
        myDetail({ myParticipation: { status: 'accepted', offeredAt: '2026-10-31T10:00:00+00:00', decidedAt: '2026-10-31T11:00:00+00:00' }, canOffer: false, offerBlockedReason: 'already_offered' }),
      ),
      { user: complete() },
    );
    await screen.findByRole('heading', { level: 1, name: 'Simulacro ficticio · Valle de Ordesa' });
    expect(screen.getByText(M.participation.status.accepted)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retirar|ofrezc/i })).toBeNull();
  });

  it('una misión en planificación o de otra organización (404) se explica, sin reintento, con enlace para volver', async () => {
    mockGeolocation('none');
    setup(`/missions/${MISSION_ID}`, { [`GET /my/missions/${MISSION_ID}`]: () => apiError(404, 'NOT_FOUND') }, { user: complete() });
    expect(await screen.findByText(es.errors.NOT_FOUND)).toBeTruthy();
    expect(screen.queryByRole('button', { name: es.state.retry })).toBeNull();
    expect(screen.getByRole('link', { name: M.detail.back }).getAttribute('href')).toBe('/missions');
  });

  it('un fallo transitorio ofrece reintentar; mientras carga lo anuncia', async () => {
    mockGeolocation('none');
    let attempts = 0;
    const { user } = setup(
      `/missions/${MISSION_ID}`,
      {
        ...detailHandlers(),
        [`GET /my/missions/${MISSION_ID}`]: () => {
          attempts += 1;
          return attempts === 1 ? apiError(500, 'INTERNAL') : json(200, myDetail());
        },
      },
      { user: complete() },
    );
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: es.state.retry }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Simulacro ficticio · Valle de Ordesa' })).toBeTruthy();
  });

  it('tiempo no disponible en el detalle no rompe la pantalla', async () => {
    mockGeolocation('none');
    setup(`/missions/${MISSION_ID}`, { ...detailHandlers(), 'GET /environment': () => json(200, environment({ weather: unavailableWeather })) }, { user: complete() });
    expect(await screen.findByText(E.weather.unavailable)).toBeTruthy();
    expect(screen.getByText(es.missionDetail.points.groups.origin)).toBeTruthy();
  });

  it('en francés', async () => {
    mockGeolocation('none');
    setup(`/missions/${MISSION_ID}`, detailHandlers(), { user: rescuer({ profileStatus: 'complete', nextStep: 'home', locale: 'fr' }), language: 'fr' });
    expect(await screen.findByText(fr.myMissions.detail.readOnly)).toBeTruthy();
    expect(await screen.findByText(fr.myMissions.detail.noRoutes)).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 3, name: fr.environment.weather.title })).toBeTruthy();
  });
});
