// Vista «Tiempo en detalle» (issue #18, RF-704, RF-705, RN-26): todo lo que ya no cabe en la tarjeta simple, más la luz y la luna.
// `src/map/` se sustituye por un doble: MapLibre no corre en jsdom.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { apiError, json, renderApp, rescuer, sessionServer, sessionUser, admin, type Call } from './support';
import { CELL, environment, mockGeolocation, restoreGeolocation, unavailableWeather } from './environment-support';

vi.mock('../src/map', () => ({ MAP_LAYERS: ['satellite', 'topographic', 'roads'], MapView: () => <div data-testid="map" /> }));
afterEach(() => restoreGeolocation());

const MISSION_ID = '44444444-4444-4444-8444-444444444444';
const E = es.environment;
const D = es.environment.detail;

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;
function setup(route: string, extra: Handlers = {}, options: { user?: ReturnType<typeof sessionUser>; language?: 'es' | 'fr' } = {}) {
  const language = options.language ?? 'es';
  const server = sessionServer(
    { user: options.user ?? sessionUser({ locale: language }) },
    { 'GET /environment': () => json(200, environment()), 'GET /missions': () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }), ...extra },
  );
  const view = renderApp({ route, fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}
const envCalls = (calls: Call[]) => calls.filter((c) => c.path === '/environment');
const complete = () => rescuer({ profileStatus: 'complete', nextStep: 'home' });

describe('tiempo en detalle: con la ubicación del dispositivo', () => {
  it('muestra todo: ubicación y altitud, ahora, próximos días, detalle por hora, luz y luna y la atribución', async () => {
    mockGeolocation('granted');
    const { calls } = setup('/weather');
    expect(await screen.findByRole('heading', { level: 1, name: D.title })).toBeTruthy();
    const weather = (await screen.findByRole('heading', { level: 3, name: E.weather.title })).closest('section')!;

    const requests = envCalls(calls());
    expect(requests).toHaveLength(1);
    expect(requests[0]!.query.get('lat')).toBe(CELL.lat);
    expect(requests[0]!.query.get('lon')).toBe(CELL.lon);
    expect(requests[0]!.query.get('missionId')).toBeNull();

    expect(screen.getByText(E.basis.device)).toBeTruthy();
    expect(screen.getByText(/calculado a 2\.?140 m de altitud/)).toBeTruthy();
    // Ahora: temperatura, viento con rachas, precipitación, nieve, nubosidad e isoterma
    expect(within(weather).getAllByText('2 °C').length).toBeGreaterThan(0);
    expect(within(weather).getByText('17 km/h, rachas de 32 km/h')).toBeTruthy();
    expect(within(weather).getByText(E.weather.precipitation)).toBeTruthy();
    expect(within(weather).getByText(E.weather.snowfall)).toBeTruthy();
    expect(within(weather).getByText(E.weather.cloud)).toBeTruthy();
    expect(within(weather).getByText(/^2\.?890 m$/)).toBeTruthy();
    // Próximos días y detalle por hora
    expect(within(weather).getByText(E.weather.nextDays)).toBeTruthy();
    expect(within(weather).getByText(E.weather.hourly)).toBeTruthy();
    // La atribución es texto, sin enlace
    const attribution = within(weather).getByText(E.weather.attribution);
    expect(attribution.closest('a')).toBeNull();
    // Luz y luna
    const light = screen.getByRole('heading', { level: 3, name: E.light.title }).closest('section')!;
    expect(within(light).getByText(E.light.sunrise)).toBeTruthy();
    expect(within(light).getByText(E.light.phases.waxing_gibbous)).toBeTruthy();
    expect(within(light).getByText('73 % iluminada')).toBeTruthy();
  });

  it('la posición no viaja en la dirección: la ruta queda en /weather', async () => {
    mockGeolocation('granted');
    setup('/weather');
    await screen.findByRole('heading', { level: 3, name: E.weather.title });
    expect(screen.getByTestId('path').textContent).toBe('/weather');
    expect(screen.getByTestId('path').textContent).not.toMatch(/42\.|0\.1/);
  });

  it('sin ubicación (denegada) lo explica y deja volver a pedirla; no pide el tiempo', async () => {
    const geolocation = mockGeolocation('denied');
    const { user, calls } = setup('/weather');
    expect(await screen.findByText(E.noLocation.title)).toBeTruthy();
    expect(envCalls(calls())).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: E.noLocation.retry }));
    expect(geolocation).toHaveBeenCalledTimes(2);
  });

  it('mientras llega la ubicación lo dice', async () => {
    const getCurrentPosition = mockGeolocation('granted');
    getCurrentPosition.mockImplementation(() => undefined);
    setup('/weather');
    expect(await screen.findByText(E.locating)).toBeTruthy();
  });

  it('dato guardado (stale): avisa con su hora; no disponible: lo dice con reintento y la luz y la luna siguen', async () => {
    mockGeolocation('granted');
    const stale = setup('/weather', { 'GET /environment': () => json(200, environment({ weather: { ...environment().weather, status: 'stale', fetchedAt: '2026-11-01T07:05:00.000Z' } })) });
    const weather = (await screen.findByRole('heading', { level: 3, name: E.weather.title })).closest('section')!;
    expect(within(weather).getByRole('status').textContent).toMatch(/^Último dato guardado a las \d{2}:\d{2}: no se ha podido actualizar\.$/);
    stale.unmount();

    setup('/weather', { 'GET /environment': () => json(200, environment({ weather: unavailableWeather })) });
    expect(await screen.findByText(E.weather.unavailable)).toBeTruthy();
    expect(screen.getByRole('button', { name: E.weather.retry })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: E.light.title })).toBeTruthy();
  });

  it('un error fuera de cobertura se explica sin reintento y uno transitorio ofrece reintentar', async () => {
    mockGeolocation('granted');
    const first = setup('/weather', { 'GET /environment': () => apiError(422, 'OUTSIDE_COVERAGE') });
    expect(await screen.findByText(es.errors.OUTSIDE_COVERAGE)).toBeTruthy();
    expect(within(screen.getByRole('alert')).queryByRole('button', { name: es.state.retry })).toBeNull();
    first.unmount();
    setup('/weather', { 'GET /environment': () => apiError(500, 'INTERNAL') });
    expect(within(await screen.findByRole('alert')).getByRole('button', { name: es.state.retry })).toBeTruthy();
  });
});

describe('tiempo en detalle: con una misión (?mission=)', () => {
  it('pide el entorno de esa misión y lo dice, y el enlace de vuelta lleva a la misión', async () => {
    mockGeolocation('granted');
    const { calls } = setup(`/weather?mission=${MISSION_ID}`, {
      'GET /environment': ({ query }) => json(200, environment({ basis: 'mission', missionId: query.get('missionId'), location: { lat: 42.6, lon: -0.05, elevationM: 3100, country: 'ES' } })),
    });
    expect(await screen.findByRole('heading', { level: 3, name: E.weather.title })).toBeTruthy();
    const request = envCalls(calls()).at(-1)!;
    expect(request.query.get('missionId')).toBe(MISSION_ID);
    expect(request.query.get('lat')).toBeNull();
    expect(screen.getByText(E.basis.missionUnnamed)).toBeTruthy();
    expect(screen.getByText(/calculado a 3\.?100 m/)).toBeTruthy();
    expect(screen.getByRole('link', { name: D.backToMission }).getAttribute('href')).toBe(`/missions/${MISSION_ID}`);
  });

  it('un identificador que no es de misión es «no encontrado» y no pide nada', async () => {
    mockGeolocation('granted');
    const { calls } = setup('/weather?mission=no-es-un-id');
    expect(await screen.findByRole('heading', { level: 1, name: es.notFound.title })).toBeTruthy();
    expect(envCalls(calls())).toHaveLength(0);
  });

  it('una misión que no existe (404) o de otra organización se explica sin romper la pantalla', async () => {
    mockGeolocation('granted');
    setup(`/weather?mission=${MISSION_ID}`, { 'GET /environment': () => apiError(404, 'NOT_FOUND') });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: D.backToMission })).toBeTruthy();
  });
});

describe('tiempo en detalle: quién lo abre y adónde se vuelve', () => {
  it('el coordinador y el administrador vuelven a Inicio', async () => {
    mockGeolocation('granted');
    const coordinator = setup('/weather');
    expect((await screen.findByRole('link', { name: D.backHome })).getAttribute('href')).toBe('/home');
    coordinator.unmount();
    setup('/weather', {}, { user: admin() });
    expect((await screen.findByRole('link', { name: D.backHome })).getAttribute('href')).toBe('/home');
  });

  it('el rescatista lo abre (sin «Inicio» en su barra) y vuelve a Mis misiones', async () => {
    mockGeolocation('granted');
    setup('/weather', { 'GET /my/missions': () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }) }, { user: complete() });
    expect(await screen.findByRole('heading', { level: 1, name: D.title })).toBeTruthy();
    expect(screen.getByRole('link', { name: D.backMissions }).getAttribute('href')).toBe('/missions');
    expect(screen.queryByRole('link', { name: D.backHome })).toBeNull();
    expect(within(screen.getByRole('navigation')).queryByRole('link', { name: D.title })).toBeNull(); // sin entrada propia en la barra
  });

  it('desde la tarjeta simple de Inicio, el botón lleva al detalle de la ubicación', async () => {
    mockGeolocation('granted');
    const { user } = setup('/home', { 'GET /missions': () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }) });
    await user.click(await screen.findByRole('link', { name: E.simple.detailCta }));
    expect(await screen.findByRole('heading', { level: 1, name: D.title })).toBeTruthy();
    expect(screen.getByTestId('path').textContent).toBe('/weather');
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: E.light.title })).toBeTruthy());
  });

  it('en francés, el título, la vuelta y la luz y la luna se leen en francés', async () => {
    mockGeolocation('granted');
    setup('/weather', {}, { language: 'fr' });
    expect(await screen.findByRole('heading', { level: 1, name: fr.environment.detail.title })).toBeTruthy();
    expect(screen.getByRole('link', { name: fr.environment.detail.backHome })).toBeTruthy();
    expect(await screen.findByText(fr.environment.light.phases.waxing_gibbous)).toBeTruthy();
  });
});
