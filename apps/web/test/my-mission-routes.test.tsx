// Rutas en la vista del rescatista (H4-T6, RF-601 a RF-604, RF-508, INV-05): tarjetas de las rutas validadas y fijadas, la no disponible señalada y
// sin descarga, mapa y perfil al elegir una, descargar GPX o KML de una ruta o de todas, y compartir la ubicación del objetivo. Solo lectura.
// `src/map/` es un doble (MapLibre no corre en jsdom) y la descarga también: se comprueba qué se pide, no el navegador.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { apiError, json, renderApp, rescuer, sessionServer, type Call } from './support';
import { environment, mockGeolocation, restoreGeolocation } from './environment-support';

interface FakeMapProps {
  routes?: readonly { id: string; name: string; tone: string }[];
  selectedRouteIds?: ReadonlySet<string>;
  onRouteClick?: (id: string) => void;
}
const mapProps: { current: FakeMapProps } = { current: {} };
vi.mock('../src/map', () => ({
  MAP_LAYERS: ['satellite', 'topographic', 'roads'],
  MapView: (props: FakeMapProps) => {
    mapProps.current = props;
    return (
      <div data-testid="map">
        {props.routes?.map((route) => (
          <span key={route.id} data-testid={`line-${route.tone}`} data-selected={props.selectedRouteIds?.has(route.id) ? 'yes' : 'no'}>
            {route.name}
          </span>
        ))}
      </div>
    );
  },
}));
const saved: { blob: Blob; name: string }[] = [];
vi.mock('../src/library/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/library/download')>()),
  saveBlob: (blob: Blob, name: string) => saved.push({ blob, name }),
}));

const M = es.myMissions;
const R = M.routes;
const S = M.share;
const MISSION_ID = '44444444-4444-4444-8444-444444444444';
const complete = (language: 'es' | 'fr' = 'es') => rescuer({ profileStatus: 'complete', nextStep: 'home', locale: language });

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: MISSION_ID,
  name: 'Simulacro ficticio · Valle de Ordesa',
  description: null,
  status: 'active',
  target: { lat: 42.62, lon: -0.05, elevationM: 3100, label: 'Circo de Soaso', country: 'ES', source: 'address' },
  coordinatorName: null,
  points: [{ id: 'p1', kind: 'origin', name: 'Pradera de Ordesa', note: null, lat: 42.65, lon: -0.03, elevationM: 1320, position: 0 }],
  myParticipation: null,
  canOffer: true,
  canWithdraw: false,
  offerBlockedReason: 'profile_incomplete',
  ...overrides,
});

const route = (n: number, name: string, overrides: Record<string, unknown> = {}) => ({
  id: `0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
  routeId: `0000000${n}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
  name,
  status: 'added',
  versionNumber: 2,
  validatedAt: '2026-10-01T09:00:00.000Z',
  validationIsStale: false,
  metrics: { distanceM: 12400 + n * 100, ascentM: 850, descentM: 420, minElevationM: 1520, maxElevationM: 2380, maxSlopePct: 21.4 },
  roadMix: [
    { roadType: 'track', distanceM: 8000 },
    { roadType: 'path', distanceM: 4400 },
  ],
  origin: { id: 'p1', name: 'Pradera de Ordesa' },
  team: null,
  previewGeometry: {
    type: 'LineString',
    coordinates: [
      [-0.05 + n / 100, 42.6],
      [-0.04 + n / 100, 42.61],
    ],
  },
  ...overrides,
});

const geometryOf = (missionRouteId: string) => ({
  missionRouteId,
  versionNumber: 2,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-0.05, 42.6, 1520],
      [-0.04, 42.61, 2380],
    ],
  },
  segments: [{ position: 0, roadType: 'track', distanceM: 12400, ascentM: 850, descentM: 420 }],
  elevationProfile: [
    [0, 1520],
    [6000, 1900],
    [12400, 2380],
  ],
});

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;
function setup(rows: unknown[] | Response, options: { mission?: Record<string, unknown>; language?: 'es' | 'fr'; extra?: Handlers } = {}) {
  const language = options.language ?? 'es';
  const server = sessionServer(
    { user: complete(language) },
    {
      [`GET /my/missions/${MISSION_ID}`]: () => json(200, detail(options.mission)),
      [`GET /my/missions/${MISSION_ID}/routes`]: () => (rows instanceof Response ? rows : json(200, { items: rows })),
      [`GET /my/missions/${MISSION_ID}/routes/export`]: ({ query }) => new Response(`archivo ${query.get('format')}`, { status: 200, headers: { 'Content-Type': 'application/gpx+xml' } }),
      'GET /environment': () => json(200, environment()),
      ...options.extra,
    },
  );
  const view = renderApp({ route: `/missions/${MISSION_ID}`, fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}
const section = async (name = M.detail.routesTitle) => screen.findByRole('region', { name });
const cardOf = async (name: string) => (await within(await section()).findByRole('heading', { level: 3, name })).closest('li')!;
const exports = (calls: Call[]) => calls.filter((c) => c.path === `/my/missions/${MISSION_ID}/routes/export`);
const textOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

beforeEach(() => {
  mockGeolocation('none');
  saved.length = 0;
  mapProps.current = {};
});
afterEach(() => {
  restoreGeolocation();
  vi.restoreAllMocks();
});

describe('rutas validadas de la misión (RF-601, RF-602)', () => {
  it('vacío: dice que no hay rutas validadas todavía y no ofrece descargar nada', async () => {
    setup([]);
    const region = await section();
    expect(await within(region).findByText(M.detail.noRoutes)).toBeTruthy();
    expect(within(region).queryByRole('button')).toBeNull();
    expect(within(region).queryByRole('list')).toBeNull();
  });

  it('carga: lo anuncia mientras llegan las rutas', async () => {
    let release: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => (release = resolve));
    setup([], { extra: { [`GET /my/missions/${MISSION_ID}/routes`]: () => pending } });
    const region = await section();
    expect(await within(region).findByText(es.state.loading)).toBeTruthy();
    release(json(200, { items: [route(1, 'Senda del Circo')] }));
    expect(await within(region).findByRole('heading', { level: 3, name: 'Senda del Circo' })).toBeTruthy();
  });

  it('error: lo dice y permite reintentar', async () => {
    let fail = true;
    const { user } = setup([], { extra: { [`GET /my/missions/${MISSION_ID}/routes`]: () => (fail ? apiError(500, 'INTERNAL') : json(200, { items: [route(1, 'Senda del Circo')] })) } });
    const region = await section();
    expect(await within(region).findByRole('alert')).toBeTruthy();
    fail = false;
    await user.click(within(region).getByRole('button', { name: es.state.retry }));
    expect(await within(region).findByRole('heading', { level: 3, name: 'Senda del Circo' })).toBeTruthy();
  });

  it('cada tarjeta lleva la versión fijada y su validación, las métricas, la composición, el origen y el equipo, y el aviso de que es una propuesta', async () => {
    const team = { id: 't1', name: 'Equipo Ordesa', locality: 'Torla' };
    setup([route(1, 'Senda del Circo', { team })]);
    const card = await cardOf('Senda del Circo');
    expect(within(card).getByText(/Versión 2 · validada el .*2026/)).toBeTruthy();
    expect(within(card).getByText('12,5 km')).toBeTruthy();
    expect(within(card).getByText('850 m')).toBeTruthy();
    expect(within(card).getByText('420 m')).toBeTruthy();
    expect(within(card).getByText('1520 m')).toBeTruthy();
    expect(within(card).getByText('2380 m')).toBeTruthy();
    expect(within(card).getByText('21,4 %')).toBeTruthy();
    expect(within(card).getByRole('img', { name: /Pista/ })).toBeTruthy();
    expect(within(card).getByText('Sale de Pradera de Ordesa')).toBeTruthy();
    expect(within(card).getByText('Equipo: Equipo Ordesa · Torla')).toBeTruthy();
    expect(within(await section()).getByText(R.intro)).toBeTruthy();
    expect(within(card).queryByText(R.stale)).toBeNull();
    expect(within(card).queryByText(R.unavailable)).toBeNull();
  });

  it('una validación antigua se señala con texto (RF-519, R-08)', async () => {
    setup([route(1, 'Pista antigua', { validationIsStale: true })]);
    const card = await cardOf('Pista antigua');
    expect(within(card).getByText(R.stale)).toBeTruthy();
    expect(within(card).getByText(R.staleNotice)).toBeTruthy();
  });

  it('la ruta no disponible se ve señalada, con su aviso, y no tiene ningún botón de descarga (RF-508, P2)', async () => {
    setup([route(1, 'Senda del Circo'), route(2, 'Ruta cortada', { status: 'unavailable' })]);
    const cut = await cardOf('Ruta cortada');
    expect(within(cut).getByText(R.unavailable)).toBeTruthy();
    expect(within(cut).getByText(R.unavailableNotice)).toBeTruthy();
    expect(within(cut).queryByRole('button', { name: /Descargar/ })).toBeNull();
    expect(within(cut).getByRole('button', { name: R.showFor.replace('{{name}}', 'Ruta cortada') })).toBeTruthy(); // se puede ver, no bajar
    const ok = await cardOf('Senda del Circo');
    expect(within(ok).getAllByRole('button', { name: /Descargar/ })).toHaveLength(2);
  });
});

describe('mapa y perfil (RF-602)', () => {
  it('el mapa recibe todas las rutas con su estilo: la no disponible apagada y la antigua señalada', async () => {
    setup([route(1, 'Validada'), route(2, 'Antigua', { validationIsStale: true }), route(3, 'Cortada', { status: 'unavailable' })]);
    await cardOf('Validada');
    await waitFor(() => expect(screen.getAllByTestId(/^line-/)).toHaveLength(3));
    expect(screen.getByTestId('line-validated').textContent).toBe('Validada');
    expect(screen.getByTestId('line-stale').textContent).toBe('Antigua');
    expect(screen.getByTestId('line-archived').textContent).toBe('Cortada');
  });

  it('elegir una pide su geometría y enseña su perfil; elegir otra deja la anterior; volver a pulsar la deja de ver', async () => {
    const first = route(1, 'Senda del Circo');
    const second = route(2, 'Pista del valle');
    const { user, calls } = setup([first, second], {
      extra: {
        [`GET /my/missions/${MISSION_ID}/routes/${first.id}/geometry`]: () => json(200, geometryOf(first.id)),
        [`GET /my/missions/${MISSION_ID}/routes/${second.id}/geometry`]: () => json(200, geometryOf(second.id)),
      },
    });
    const region = await section();
    await cardOf('Senda del Circo');
    expect(calls().some((c) => c.path.endsWith('/geometry'))).toBe(false); // sin elegir, no se pide (D-H4-07)

    const show = (name: string) => within(region).getByRole('button', { name: R.showFor.replace('{{name}}', name) });
    await user.click(show('Senda del Circo'));
    await waitFor(() => expect(within(region).getAllByRole('img', { name: new RegExp(`^${es.routeDetail.profile.title}`) })).toHaveLength(1));
    expect(show('Senda del Circo').getAttribute('aria-pressed')).toBe('true');
    expect(mapProps.current.selectedRouteIds).toEqual(new Set([first.id]));
    expect(
      calls()
        .filter((c) => c.path.endsWith('/geometry'))
        .map((c) => c.path),
    ).toEqual([`/my/missions/${MISSION_ID}/routes/${first.id}/geometry`]);

    await user.click(show('Pista del valle'));
    await waitFor(() => expect(mapProps.current.selectedRouteIds).toEqual(new Set([second.id])));
    expect(show('Senda del Circo').getAttribute('aria-pressed')).toBe('false');
    expect(within(region).getAllByRole('img', { name: new RegExp(`^${es.routeDetail.profile.title}`) })).toHaveLength(1);

    await user.click(show('Pista del valle'));
    await waitFor(() => expect(mapProps.current.selectedRouteIds?.size ?? 0).toBe(0));
  });

  it('tocar una línea del mapa elige su ruta', async () => {
    const first = route(1, 'Senda del Circo');
    setup([first], { extra: { [`GET /my/missions/${MISSION_ID}/routes/${first.id}/geometry`]: () => json(200, geometryOf(first.id)) } });
    const region = await section();
    await cardOf('Senda del Circo');
    await waitFor(() => expect(mapProps.current.onRouteClick).toBeTypeOf('function'));
    mapProps.current.onRouteClick!(first.id);
    await waitFor(() =>
      expect(
        within(region)
          .getByRole('button', { name: /Ver «Senda del Circo»/ })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    );
  });

  it('si falla el perfil de una ruta lo dice en su tarjeta y deja el resto', async () => {
    const first = route(1, 'Senda del Circo');
    const { user } = setup([first], { extra: { [`GET /my/missions/${MISSION_ID}/routes/${first.id}/geometry`]: () => apiError(500, 'INTERNAL') } });
    const card = await cardOf('Senda del Circo');
    await user.click(within(card).getByRole('button', { name: /Ver «Senda del Circo»/ }));
    expect(await within(card).findByRole('alert')).toBeTruthy();
    expect(within(card).getAllByRole('button', { name: /Descargar/ })).toHaveLength(2);
  });
});

describe('descargar GPX o KML (RF-603)', () => {
  it('una ruta: pide solo esa (`ids`) en el formato elegido y entrega el archivo', async () => {
    const first = route(1, 'Senda del Circo');
    const { user, calls } = setup([first, route(2, 'Pista del valle')]);
    const card = await cardOf('Senda del Circo');
    await user.click(within(card).getByRole('button', { name: 'Descargar «Senda del Circo» en GPX' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(exports(calls())[0]!.query.get('format')).toBe('gpx');
    expect(exports(calls())[0]!.query.get('ids')).toBe(first.id);
    expect(saved[0]!.name).toBe('onway-ruta-senda-del-circo.gpx');
    expect(await textOf(saved[0]!.blob)).toBe('archivo gpx');
    await user.click(within(card).getByRole('button', { name: 'Descargar «Senda del Circo» en KML' }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(exports(calls())[1]!.query.get('format')).toBe('kml');
    expect(saved[1]!.name).toBe('onway-ruta-senda-del-circo.kml');
  });

  it('todas: sin `ids` (el servidor deja fuera las no disponibles)', async () => {
    const { user, calls } = setup([route(1, 'Senda del Circo'), route(2, 'Ruta cortada', { status: 'unavailable' })]);
    const region = await section();
    await cardOf('Senda del Circo');
    await user.click(within(region).getByRole('button', { name: 'Descargar todas en GPX' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(exports(calls())[0]!.query.get('ids')).toBeNull();
    expect(exports(calls())[0]!.query.get('format')).toBe('gpx');
    expect(saved[0]!.name).toBe('onway-rutas-mision.gpx');
  });

  it('si todas están marcadas como no disponibles no se ofrece descargar nada', async () => {
    setup([route(1, 'Ruta cortada', { status: 'unavailable' })]);
    const region = await section();
    await cardOf('Ruta cortada');
    expect(within(region).queryByRole('button', { name: /Descargar/ })).toBeNull();
  });

  it('un fallo al descargar se dice y no entrega nada', async () => {
    const { user } = setup([route(1, 'Senda del Circo')], { extra: { [`GET /my/missions/${MISSION_ID}/routes/export`]: () => apiError(409, 'MISSION_NOT_ACTIVE') } });
    const card = await cardOf('Senda del Circo');
    await user.click(within(card).getByRole('button', { name: /Descargar «Senda del Circo» en GPX/ }));
    expect(await within(await section()).findByText(es.errors.MISSION_NOT_ACTIVE)).toBeTruthy();
    expect(saved).toEqual([]);
  });

  it('misión cerrada: se leen las rutas pero no hay descarga (MISSION_NOT_ACTIVE) y se explica', async () => {
    setup([route(1, 'Senda del Circo')], { mission: { status: 'closed' } });
    const region = await section();
    const card = await cardOf('Senda del Circo');
    expect(within(card).queryByRole('button', { name: /Descargar/ })).toBeNull();
    expect(within(region).queryByRole('button', { name: /Descargar/ })).toBeNull();
    expect(within(region).getByText(R.closedNotice)).toBeTruthy();
    expect(within(card).getByRole('button', { name: /Ver «Senda del Circo»/ })).toBeTruthy();
  });

  it('la descarga no depende del mapa: con el mapa roto las tarjetas y los botones siguen y el archivo se baja (RF-603)', async () => {
    const { user } = setup([route(1, 'Senda del Circo')]);
    const card = await cardOf('Senda del Circo');
    // Los botones de descarga están en la tarjeta, fuera de la región del mapa.
    expect(card.closest('[data-testid="map"]')).toBeNull();
    await user.click(within(card).getByRole('button', { name: /Descargar «Senda del Circo» en GPX/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
  });
});

describe('compartir la ubicación del objetivo (RF-604, P4)', () => {
  it('enseña las coordenadas, las copia con un aviso para el lector de pantalla y ofrece abrirlas con `geo:`', async () => {
    const { user } = setup([]);
    const region = await screen.findByRole('region', { name: S.title });
    expect(within(region).getByText('42.62000, -0.05000')).toBeTruthy();
    const open = within(region).getByRole('link', { name: S.open });
    expect(open.getAttribute('href')).toBe('geo:42.62,-0.05');
    expect(within(region).getByRole('status').textContent).toBe('');

    await user.click(within(region).getByRole('button', { name: S.copy }));
    await waitFor(() => expect(within(region).getByRole('status').textContent).toBe('Coordenadas copiadas: 42.62000, -0.05000'));
    expect(await navigator.clipboard.readText()).toBe('42.62000, -0.05000');
  });

  it('si el navegador no deja copiar lo dice, y las coordenadas siguen a la vista', async () => {
    const { user } = setup([]);
    const region = await screen.findByRole('region', { name: S.title });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(within(region).getByRole('button', { name: S.copy }));
    expect(await within(region).findByText(S.copyFailed)).toBeTruthy();
    expect(within(region).getByText('42.62000, -0.05000')).toBeTruthy();
  });
});

describe('solo lectura', () => {
  it('no hay ningún campo ni botón de escritura ni de oferta en toda la vista', async () => {
    setup([route(1, 'Senda del Circo'), route(2, 'Ruta cortada', { status: 'unavailable' })]);
    await cardOf('Senda del Circo');
    const main = screen.getByRole('main');
    expect(main.querySelectorAll('input, textarea, select')).toHaveLength(0);
    const names = screen.queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    expect(names.filter((n) => /ofrezc|ofrec|offre|Editar|Borrar|Quitar|Añadir|Guardar|Activar|Cerrar|Reabrir|Duplicar|Validar|Actualizar|Marcar/i.test(n))).toEqual([]);
  });
});

describe('en francés', () => {
  it('títulos, avisos, descarga y compartir salen de packages/i18n (fr)', async () => {
    const { user } = setup([route(1, 'Senda del Circo'), route(2, 'Ruta cortada', { status: 'unavailable' })], { language: 'fr' });
    const F = fr.myMissions;
    const region = await section(F.detail.routesTitle);
    const card = (await within(region).findByRole('heading', { level: 3, name: 'Senda del Circo' })).closest('li')!;
    expect(within(card).getByRole('button', { name: F.routes.downloadFor.replace('{{name}}', 'Senda del Circo').replace('{{format}}', 'GPX') })).toBeTruthy();
    const cut = (await within(region).findByRole('heading', { level: 3, name: 'Ruta cortada' })).closest('li')!;
    expect(within(cut).getByText(F.routes.unavailable)).toBeTruthy();
    const share = await screen.findByRole('region', { name: F.share.title });
    await user.click(within(share).getByRole('button', { name: F.share.copy }));
    await waitFor(() => expect(within(share).getByRole('status').textContent).toBe(F.share.copied.replace('{{value}}', '42.62000, -0.05000')));
  });
});
