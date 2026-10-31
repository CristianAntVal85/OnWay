// Crear misión (T6, RF-201, RF-401, RF-402): las tres formas de dar un punto, la búsqueda solo al pulsar, los estados y los errores.
// `src/map/` se sustituye por un doble: MapLibre no corre en jsdom (el mapa real se prueba en Chromium, E2E y revisión con DevTools).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { apiError, json, renderApp, sessionServer, sessionUser, type Call } from './support';

interface FakeMapProps {
  markers?: readonly { id: string; kind: string; lat: number; lon: number }[];
  onPick?: (point: { lat: number; lon: number }) => void;
  picking?: boolean;
  elevationLookup?: unknown;
}
const mapProps: { current: FakeMapProps } = { current: {} };

vi.mock('../src/map', () => ({
  MAP_LAYERS: ['satellite', 'topographic', 'roads'],
  MapView: (props: FakeMapProps) => {
    mapProps.current = props;
    return (
      <div data-testid="map" data-picking={props.picking ? 'yes' : 'no'}>
        {props.markers?.map((m) => (
          <span key={m.id} data-testid={`marker-${m.kind}`}>{`${m.lat},${m.lon}`}</span>
        ))}
      </div>
    );
  },
}));

const COORDINATOR_ID = sessionUser().id;
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const MISSION_ID = '44444444-4444-4444-8444-444444444444';

const mission = (name: string) => ({
  id: MISSION_ID,
  name,
  status: 'planning',
  coordinator: { id: COORDINATOR_ID, displayName: 'Coordinador Demo' },
  target: { lat: 42.6335, lon: 0.1021, elevationM: 1820, label: null, country: null, source: 'coordinates' },
  origins: [],
  routes: { validated: 0, total: 0 },
  participants: { accepted: 0, pending: 0 },
  createdAt: '2026-10-31T09:00:00+00:00',
  updatedAt: '2026-10-31T09:00:00+00:00',
  description: null,
});

function setup(extra: Record<string, (call: Call) => Response | Promise<Response>> = {}, language: 'es' | 'fr' = 'es') {
  const server = sessionServer(
    { user: sessionUser({ locale: language }) },
    {
      'GET /org/coordinators': () =>
        json(200, {
          items: [
            { id: COORDINATOR_ID, displayName: 'Coordinador Demo' },
            { id: OTHER_ID, displayName: 'Otra Coordinadora' },
          ],
        }),
      'GET /geo/elevation': () => json(200, { lat: 42.6335, lon: 0.1021, elevationM: 1820 }),
      'POST /missions': ({ body }) => json(201, mission((body as { name: string }).name)),
      ...extra,
    },
  );
  const view = renderApp({ route: '/missions/new', fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}

const copy = es.createMission;
const point = es.point;
const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === '/missions');

async function openForm(language = es) {
  await screen.findByRole('heading', { level: 1, name: language.createMission.title });
  await screen.findByRole('option', { name: 'Otra Coordinadora' });
}

async function fillCoordinates(user: ReturnType<typeof setup>['user'], text: string, within_?: HTMLElement) {
  const scope = within_ ?? document.body;
  await user.click(within(scope).getByRole('radio', { name: point.byCoordinates }));
  await user.type(within(scope).getByRole('textbox', { name: point.coordinates }), text);
  await user.click(within(scope).getByRole('button', { name: point.useCoordinates }));
}

describe('crear misión: datos y envío', () => {
  it('crea con nombre, el coordinador por defecto y el objetivo por coordenadas, y va a la misión; el cliente no envía altitud', async () => {
    const { user, calls } = setup();
    await openForm();
    expect((screen.getByLabelText(copy.coordinator) as HTMLSelectElement).value).toBe(COORDINATOR_ID);
    await user.type(screen.getByLabelText(copy.name), '  Rescate en el Aneto  ');
    await fillCoordinates(user, '42.6335, 0.1021');
    expect(await screen.findByText(point.selected.replace('{{position}}', '42.63350, 0.10210'))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: copy.submit }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    expect(posts(calls())[0]!.body).toEqual({
      name: 'Rescate en el Aneto',
      coordinatorId: COORDINATOR_ID,
      target: { source: 'coordinates', lat: 42.6335, lon: 0.1021 },
      teamIds: [],
      rescuerIds: [],
      routes: [],
      origins: [],
    });
    expect(JSON.stringify(posts(calls())[0]!.body)).not.toMatch(/elevation/i);
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe(`/missions/${MISSION_ID}`));
  });

  it('GMS y UTM llegan al mismo objeto que el decimal (RF-401)', async () => {
    const gms = setup();
    await openForm();
    await fillCoordinates(gms.user, '42°38′00.6″N 0°06′07.6″E');
    expect(await screen.findByText(/Punto elegido: 42\.63350, 0\.10211/)).toBeTruthy();
    gms.unmount();

    const utm = setup();
    await openForm();
    await fillCoordinates(utm.user, '31T 300000 4721345');
    expect(await screen.findByText(/Punto elegido: 42\.\d{5}, 0\.\d{5}/)).toBeTruthy();
  });

  it('un punto elegido en el mapa sale con source «map»', async () => {
    const { user, calls } = setup();
    await openForm();
    expect(screen.getByTestId('map').getAttribute('data-picking')).toBe('yes');
    mapProps.current.onPick?.({ lat: 42.7, lon: 0.05 });
    expect(await screen.findByTestId('marker-target')).toBeTruthy();
    await user.type(screen.getByLabelText(copy.name), 'Misión por mapa');
    await user.click(screen.getByRole('button', { name: copy.submit }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    expect((posts(calls())[0]!.body as { target: unknown }).target).toEqual({ source: 'map', lat: 42.7, lon: 0.05 });
  });

  it('enviar sin datos no llama al servidor: marca lo que falta y el botón avisa de por qué', async () => {
    const { user, calls } = setup();
    await openForm();
    const submit = screen.getByRole('button', { name: copy.submit });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(copy.incomplete)).toBeTruthy();
    await user.click(submit);
    expect(await screen.findByText(copy.nameInvalid)).toBeTruthy();
    expect(screen.getByText(copy.objectiveRequired)).toBeTruthy();
    expect(posts(calls())).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByLabelText(copy.name));
  });

  it('el botón se activa cuando nombre, coordinador y objetivo son válidos', async () => {
    const { user } = setup();
    await openForm();
    await user.type(screen.getByLabelText(copy.name), 'Misión válida');
    await fillCoordinates(user, '42.6335, 0.1021');
    await waitFor(() => expect(screen.getByRole('button', { name: copy.submit }).getAttribute('aria-disabled')).toBe('false'));
  });

  it('coordenadas no válidas: mensaje claro y no se fija el punto', async () => {
    const { user } = setup();
    await openForm();
    await fillCoordinates(user, '95, 0');
    expect(await screen.findByText(es.coordinates.latitudeRange)).toBeTruthy();
    expect(screen.getByText(point.notSelected)).toBeTruthy();
  });

  it('los orígenes se envían con el cuerpo: nombre, nota y coordenadas; uno incompleto bloquea el envío', async () => {
    const { user, calls } = setup();
    await openForm();
    await user.type(screen.getByLabelText(copy.name), 'Con orígenes');
    await fillCoordinates(user, '42.6335, 0.1021');
    await user.click(screen.getByRole('button', { name: copy.addOrigin }));
    const origin = screen.getByRole('group', { name: copy.originTitle.replace('{{number}}', '1') });
    expect(screen.getByTestId('map').getAttribute('data-picking')).toBe('yes'); // el nuevo origen espera el clic
    await user.click(screen.getByRole('button', { name: copy.submit }));
    expect(await within(origin).findByText(copy.originNameRequired)).toBeTruthy();
    expect(posts(calls())).toHaveLength(0);

    await user.type(within(origin).getByLabelText(copy.originName), 'Refugio base');
    await user.type(within(origin).getByLabelText(copy.originNote), 'Aparcamiento');
    mapProps.current.onPick?.({ lat: 42.65, lon: 0.2 });
    await waitFor(() => expect(screen.getByTestId('marker-origin')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: copy.submit }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    expect((posts(calls())[0]!.body as { origins: unknown }).origins).toEqual([{ name: 'Refugio base', note: 'Aparcamiento', lat: 42.65, lon: 0.2 }]);
  });

  it('un origen se puede quitar', async () => {
    const { user } = setup();
    await openForm();
    await user.click(screen.getByRole('button', { name: copy.addOrigin }));
    await user.click(screen.getByRole('button', { name: copy.removeOrigin.replace('{{number}}', '1') }));
    expect(screen.queryByRole('group', { name: copy.originTitle.replace('{{number}}', '1') })).toBeNull();
  });

  it('DUPLICATE_NAME se muestra en el campo del nombre; OUTSIDE_COVERAGE, en la barra', async () => {
    const duplicated = setup({ 'POST /missions': () => apiError(409, 'DUPLICATE_NAME') });
    await openForm();
    await duplicated.user.type(screen.getByLabelText(copy.name), 'Repetida');
    await fillCoordinates(duplicated.user, '42.6335, 0.1021');
    await duplicated.user.click(screen.getByRole('button', { name: copy.submit }));
    expect(await screen.findByText(copy.duplicateName)).toBeTruthy();
    expect(screen.getByLabelText(copy.name).getAttribute('aria-invalid')).toBe('true');
    duplicated.unmount();

    const outside = setup({ 'POST /missions': () => apiError(422, 'OUTSIDE_COVERAGE') });
    await openForm();
    await outside.user.type(screen.getByLabelText(copy.name), 'Lejos');
    await fillCoordinates(outside.user, '10, 10');
    await outside.user.click(screen.getByRole('button', { name: copy.submit }));
    expect(await screen.findByText(copy.outsideCoverage)).toBeTruthy();
  });
});

describe('crear misión: estados de carga, vacío y error', () => {
  it('coordinadores: carga, error con reintento y vacío', async () => {
    let attempts = 0;
    const failing = setup({
      'GET /org/coordinators': () => (++attempts === 1 ? apiError(500, 'INTERNAL') : json(200, { items: [{ id: COORDINATOR_ID, displayName: 'Coordinador Demo' }] })),
    });
    expect(await screen.findByText(es.state.loading)).toBeTruthy();
    expect(await screen.findByText(es.state.errorTitle)).toBeTruthy();
    await failing.user.click(screen.getByRole('button', { name: es.state.retry }));
    expect(await screen.findByRole('option', { name: 'Coordinador Demo' })).toBeTruthy();
    failing.unmount();

    setup({ 'GET /org/coordinators': () => json(200, { items: [] }) });
    expect(await screen.findByText(copy.coordinatorsEmpty)).toBeTruthy();
  });
});

describe('crear misión: dirección solo al pulsar Buscar (D-H1-16)', () => {
  const nominatim = (items: unknown[]) => ({ 'GET /geo/geocode': () => json(200, { items }) });
  const gavarnie = { label: 'Gavarnie, Hautes-Pyrénées, Francia', lat: 42.7333, lon: -0.0167, country: 'FR' };
  const torla = { label: 'Torla, Huesca, España', lat: 42.6333, lon: -0.1, country: 'ES' };

  async function openAddress(user: ReturnType<typeof setup>['user']) {
    await openForm();
    await user.click(screen.getByRole('radio', { name: point.byAddress }));
    return screen.getByLabelText(point.address);
  }

  it('teclear no llama a geocode; pulsar Buscar llama una vez; Intro también busca', async () => {
    const { user, calls } = setup(nominatim([torla]));
    const input = await openAddress(user);
    await user.type(input, 'Torla Huesca');
    expect(calls().filter((c) => c.path === '/geo/geocode')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: point.search }));
    expect(await screen.findByText(torla.label)).toBeTruthy();
    expect(calls().filter((c) => c.path === '/geo/geocode')).toHaveLength(1);
    await user.type(input, '{Enter}');
    await waitFor(() => expect(calls().filter((c) => c.path === '/geo/geocode')).toHaveLength(2));
    expect(posts(calls())).toHaveLength(0); // Intro en el campo no envía el formulario
  });

  it('menos de 3 caracteres: avisa y no llama', async () => {
    const { user, calls } = setup(nominatim([]));
    const input = await openAddress(user);
    await user.type(input, 'To');
    await user.click(screen.getByRole('button', { name: point.search }));
    expect(await screen.findByText(point.searchTooShort)).toBeTruthy();
    expect(calls().filter((c) => c.path === '/geo/geocode')).toHaveLength(0);
  });

  it('con varios candidatos se elige uno de la lista y el punto lleva su etiqueta y source «address»', async () => {
    const { user, calls } = setup(nominatim([torla, { ...torla, label: 'Torla, otra', lat: 42.5 }]));
    const input = await openAddress(user);
    await user.type(input, 'Torla');
    await user.click(screen.getByRole('button', { name: point.search }));
    await user.click(await screen.findByRole('radio', { name: new RegExp(torla.label) }));
    expect(await screen.findByText(/^Punto elegido: 42\.63330, -0\.10000/)).toBeTruthy();
    await user.type(screen.getByLabelText(copy.name), 'Por dirección');
    await user.click(screen.getByRole('button', { name: copy.submit }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    expect((posts(calls())[0]!.body as { target: unknown }).target).toEqual({ source: 'address', lat: 42.6333, lon: -0.1, label: torla.label, country: 'ES' });
  });

  it('un lugar de otro país que el de la organización pide confirmar antes de fijarse', async () => {
    const { user } = setup(nominatim([gavarnie]));
    const input = await openAddress(user);
    await user.type(input, 'Gavarnie');
    await user.click(screen.getByRole('button', { name: point.search }));
    await user.click(await screen.findByRole('radio', { name: new RegExp(gavarnie.label) }));
    expect(await screen.findByText(/Francia/, { selector: 'p' })).toBeTruthy();
    expect(screen.getByText(point.notSelected)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: point.confirmOtherCountry }));
    expect(await screen.findByText(/^Punto elegido: 42\.73330/)).toBeTruthy();
  });

  it('sin resultados: mensaje y el formulario sigue utilizable', async () => {
    const { user } = setup(nominatim([]));
    const input = await openAddress(user);
    await user.type(input, 'Lugar inexistente');
    await user.click(screen.getByRole('button', { name: point.search }));
    expect(await screen.findByText(point.noResults)).toBeTruthy();
  });

  it('proveedor caído (UPSTREAM_UNAVAILABLE): aviso claro y se puede crear por mapa o coordenadas', async () => {
    const { user, calls } = setup({ 'GET /geo/geocode': () => apiError(502, 'UPSTREAM_UNAVAILABLE') });
    const input = await openAddress(user);
    await user.type(input, 'Torla');
    await user.click(screen.getByRole('button', { name: point.search }));
    expect(await screen.findByText(point.searchUnavailable)).toBeTruthy();
    await fillCoordinates(user, '42.6335, 0.1021');
    await user.type(screen.getByLabelText(copy.name), 'Sin buscador');
    await user.click(screen.getByRole('button', { name: copy.submit }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
  });

  it('límite de uso (RATE_LIMITED): dice cuántos segundos esperar', async () => {
    const { user } = setup({ 'GET /geo/geocode': () => apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 2 }) });
    const input = await openAddress(user);
    await user.type(input, 'Torla');
    await user.click(screen.getByRole('button', { name: point.search }));
    expect(await screen.findByText(es.errors.RATE_LIMITED.replace('{{seconds}}', '2'))).toBeTruthy();
  });
});

describe('crear misión: francés y altitud', () => {
  it('los textos salen de packages/i18n en francés', async () => {
    setup({}, 'fr');
    await screen.findByRole('heading', { level: 1, name: fr.createMission.title });
    expect(screen.getByLabelText(fr.createMission.name)).toBeTruthy();
    expect(screen.getByRole('button', { name: fr.createMission.submit })).toBeTruthy();
  });

  it('el mapa recibe la función de altitud (getElevation) y la pide por celda con caché', async () => {
    const { calls } = setup();
    await openForm();
    const lookup = mapProps.current.elevationLookup as (p: { lat: number; lon: number }) => Promise<number | null>;
    expect(await lookup({ lat: 42.63351, lon: 0.10214 })).toBe(1820);
    expect(await lookup({ lat: 42.63354, lon: 0.10213 })).toBe(1820); // misma celda de ~11 m: no repite
    expect(calls().filter((c) => c.path === '/geo/elevation')).toHaveLength(1);
  });

  it('sin dato de altitud (OUTSIDE_COVERAGE) la función devuelve null y se recuerda', async () => {
    const { calls } = setup({ 'GET /geo/elevation': () => apiError(422, 'OUTSIDE_COVERAGE') });
    await openForm();
    const lookup = mapProps.current.elevationLookup as (p: { lat: number; lon: number }) => Promise<number | null>;
    expect(await lookup({ lat: 10, lon: 10 })).toBeNull();
    expect(await lookup({ lat: 10, lon: 10 })).toBeNull();
    expect(calls().filter((c) => c.path === '/geo/elevation')).toHaveLength(1);
  });
});
