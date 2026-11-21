// «Rutas de la misión» en el detalle (H4-T4, RF-502, RF-504, RF-508, RF-518, RF-519, RF-805): tabla comparativa con sus tres estados, selección para
// ver varias rutas en el mapa con su perfil, el aviso de versión nueva (que nunca cambia sola), marcar como no disponible, quitar y exportar.
// `src/map/` es un doble (MapLibre no corre en jsdom) y la descarga también: se comprueba qué se pide, no el navegador.
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { admin, apiError, openMenu, chooseMenuItem, json, menuItemNames, renderApp, sessionServer, sessionUser, type Call } from './support';

interface FakeMapProps {
  routes?: readonly { id: string; name: string; tone: string }[];
  selectedRouteIds?: ReadonlySet<string>;
  highlightedRouteId?: string | null;
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
vi.mock('../src/library/download', () => ({ saveBlob: (blob: Blob, name: string) => saved.push({ blob, name }) }));

const R = es.missionRoutes;
const PROFILE = new RegExp(`^${es.routeDetail.profile.title}`); // el nombre accesible del SVG es su título más su descripción
import { MISSION_ID, PATH, allActions, geometryOf, mission, noActions, row } from './mission-fixtures';

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;
function setup(rows: unknown[] | Response, options: { actions?: Record<string, boolean>; status?: string; language?: 'es' | 'fr'; user?: ReturnType<typeof sessionUser>; extra?: Handlers } = {}) {
  const language = options.language ?? 'es';
  const state = { rows: Array.isArray(rows) ? rows : [] };
  const server = sessionServer(
    { user: options.user ?? sessionUser({ locale: language }) },
    {
      [`GET /missions/${MISSION_ID}`]: () => json(200, mission({ actions: options.actions ?? allActions, status: options.status ?? 'active' })),
      [`GET /missions/${MISSION_ID}/routes`]: () => (rows instanceof Response ? rows : json(200, { items: state.rows })),
      [`GET /missions/${MISSION_ID}/history`]: () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }),
      [`GET /missions/${MISSION_ID}/routes/export`]: ({ query }) => new Response(`archivo ${query.get('format')}`, { status: 200, headers: { 'Content-Type': 'application/gpx+xml' } }),
      'GET /geo/elevation': () => json(200, { lat: 42.6, lon: 0.65, elevationM: 2140 }),
      ...options.extra,
    },
  );
  const view = renderApp({ route: PATH, fetch: server.api.fetch, language });
  return { ...server, ...view, state, calls: () => server.api.calls };
}
/** El texto de un archivo descargado (jsdom no trae `Blob.text`). */
const textOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
const region = async (name = R.title) => screen.findByRole('region', { name });
const tableOf = async () => within(await region()).findByRole('table');
const rowOf = async (name: string) => within(await tableOf()).getByRole('row', { name: new RegExp(name) });
const ACTIONS = (name: string) => R.actionsFor.replace('{{name}}', name);
type User = Parameters<typeof chooseMenuItem>[0];
/** Abre el «⋯» de la fila y pulsa una de sus acciones. */
const rowAction = async (user: User, name: string, item: string | RegExp) => chooseMenuItem(user, ACTIONS(name), item, await rowOf(name));
const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET' && c.path.startsWith(`/missions/${MISSION_ID}/routes`));

beforeEach(() => {
  saved.length = 0;
  mapProps.current = {};
});

describe('tabla de rutas de la misión (RF-502, RF-504)', () => {
  it('muestra, de la versión fijada, distancia, desniveles, altitudes, pendiente, tipo de vía, validación, origen y equipo', async () => {
    const team = { id: 't1', name: 'Equipo Pirineos', locality: 'Benasque' };
    setup([row(1, 'Senda del Circo', { team }), row(2, 'Pista del valle', { origin: null })]);
    const table = await tableOf();
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([
        R.columns.route,
        R.columns.version,
        R.columns.distance,
        R.columns.ascent,
        R.columns.descent,
        R.columns.minElevation,
        R.columns.maxElevation,
        R.columns.maxSlope,
        R.columns.roadMix,
        R.columns.validatedOn,
        R.columns.origin,
        R.columns.team,
      ]),
    );

    const first = await rowOf('Senda del Circo');
    expect(within(first).getByText('12,5 km')).toBeTruthy();
    expect(within(first).getByText('850 m')).toBeTruthy();
    expect(within(first).getByText('420 m')).toBeTruthy();
    expect(within(first).getByText('1520 m')).toBeTruthy();
    expect(within(first).getByText('2380 m')).toBeTruthy();
    expect(within(first).getByText('21,4 %')).toBeTruthy();
    expect(within(first).getByText('Versión 1 · Validada')).toBeTruthy();
    expect(within(first).getByText(/2026/)).toBeTruthy();
    expect(within(first).getByText('Refugio de la Renclusa')).toBeTruthy();
    expect(within(first).getByText('Equipo Pirineos · Benasque')).toBeTruthy();
    expect(within(first).getByRole('img', { name: /Pista/ })).toBeTruthy(); // la barra de tipo de vía, con su texto

    const second = await rowOf('Pista del valle');
    expect(within(second).getByText(R.noOrigin)).toBeTruthy();
    expect(within(second).getByText(R.noTeam)).toBeTruthy();
  });

  it('una versión fijada en borrador se dice, con el aviso de que el rescatista no la ve', async () => {
    setup([row(1, 'Ruta en borrador', {}, { status: 'draft', validatedAt: null })]);
    const draft = await rowOf('Ruta en borrador');
    expect(within(draft).getByText('Versión 1 · Borrador')).toBeTruthy();
    expect(within(draft).getByText(R.notices.draft)).toBeTruthy();
    expect(within(draft).queryByText(/2026/)).toBeNull();
  });

  it('la validación antigua y la ruta no disponible se señalan con texto, no solo con color', async () => {
    setup([row(1, 'Ruta antigua', { validationIsStale: true }), row(2, 'Ruta cortada', { status: 'unavailable' })]);
    const stale = await rowOf('Ruta antigua');
    expect(within(stale).getByText(R.badges.stale)).toBeTruthy();
    const cut = await rowOf('Ruta cortada');
    expect(within(cut).getByText(R.badges.unavailable)).toBeTruthy();
    expect(within(await rowOf('Ruta antigua')).queryByText(R.badges.unavailable)).toBeNull();
  });

  it('carga: muestra el estado de carga mientras llega la tabla', async () => {
    let release: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => (release = resolve));
    setup([], { extra: { [`GET /missions/${MISSION_ID}/routes`]: () => pending } });
    const section = await region();
    expect(await within(section).findByText(es.state.loading)).toBeTruthy();
    release(json(200, { items: [row(1, 'Senda del Circo')] }));
    expect(await within(await region()).findByRole('table')).toBeTruthy();
    expect(within(section).queryByText(es.state.loading)).toBeNull();
  });

  it('vacío: dice que no hay rutas y lleva a la biblioteca', async () => {
    setup([]);
    const section = await region();
    expect(await within(section).findByText(R.empty)).toBeTruthy();
    expect(within(section).queryByRole('table')).toBeNull();
    expect(within(section).getByRole('link', { name: R.openLibrary }).getAttribute('href')).toBe('/routes');
  });

  it('error: lo dice y permite reintentar; al reintentar aparece la tabla', async () => {
    let fail = true;
    const { user } = setup([], {
      extra: { [`GET /missions/${MISSION_ID}/routes`]: () => (fail ? apiError(500, 'INTERNAL') : json(200, { items: [row(1, 'Senda del Circo')] })) },
    });
    const section = await region();
    expect(await within(section).findByRole('alert')).toBeTruthy();
    fail = false;
    await user.click(within(section).getByRole('button', { name: es.state.retry }));
    expect(await within(section).findByRole('table')).toBeTruthy();
  });

  it('la tabla tiene su propio desplazamiento, enfocable con el teclado y con nombre', async () => {
    setup([row(1, 'Senda del Circo')]);
    const scroller = await within(await region()).findByRole('region', { name: R.tableCaption });
    expect(scroller.getAttribute('tabindex')).toBe('0');
    expect(within(scroller).getByRole('table')).toBeTruthy();
  });
});

describe('selección: varias rutas en el mapa y su perfil (RF-504)', () => {
  it('el mapa recibe todas las rutas de la misión con su estilo (borrador, validada, antigua, no disponible)', async () => {
    setup([row(1, 'Validada'), row(2, 'Borrador', {}, { status: 'draft', validatedAt: null }), row(3, 'Antigua', { validationIsStale: true }), row(4, 'Cortada', { status: 'unavailable' })]);
    await tableOf();
    await waitFor(() => expect(screen.getAllByTestId(/^line-/)).toHaveLength(4));
    expect(screen.getByTestId('line-validated').textContent).toBe('Validada');
    expect(screen.getByTestId('line-draft').textContent).toBe('Borrador');
    expect(screen.getByTestId('line-stale').textContent).toBe('Antigua');
    expect(screen.getByTestId('line-archived').textContent).toBe('Cortada');
  });

  it('marcar dos rutas las resalta en el mapa y pide el perfil de cada una, a la versión fijada', async () => {
    const first = row(1, 'Senda del Circo');
    const second = row(2, 'Pista del valle', {}, { number: 2 });
    const { user, calls } = setup([first, second], {
      extra: {
        [`GET /missions/${MISSION_ID}/routes/${first.id}/geometry`]: () => json(200, geometryOf(first.id)),
        [`GET /missions/${MISSION_ID}/routes/${second.id}/geometry`]: () => json(200, geometryOf(second.id, 2)),
      },
    });
    const section = await region();
    await within(section).findByRole('table');
    expect(calls().some((c) => c.path.endsWith('/geometry'))).toBe(false); // sin marcar, no se piden (D-H4-07)

    await user.click(within(section).getByRole('checkbox', { name: 'Ver «Senda del Circo» en el mapa y en el perfil' }));
    await user.click(within(section).getByRole('checkbox', { name: 'Ver «Pista del valle» en el mapa y en el perfil' }));
    await waitFor(() => expect(within(section).getAllByRole('img', { name: PROFILE })).toHaveLength(2));
    expect(
      calls()
        .filter((c) => c.path.endsWith('/geometry'))
        .map((c) => c.path)
        .sort(),
    ).toEqual([`/missions/${MISSION_ID}/routes/${first.id}/geometry`, `/missions/${MISSION_ID}/routes/${second.id}/geometry`].sort());
    expect(mapProps.current.selectedRouteIds).toEqual(new Set([first.id, second.id]));
    expect(within(section).getByRole('heading', { name: 'Senda del Circo · versión 1' })).toBeTruthy();
    expect(within(section).getByRole('heading', { name: 'Pista del valle · versión 2' })).toBeTruthy();

    await user.click(within(section).getByRole('checkbox', { name: 'Ver «Senda del Circo» en el mapa y en el perfil' }));
    await waitFor(() => expect(within(section).getAllByRole('img', { name: PROFILE })).toHaveLength(1));
    expect(mapProps.current.selectedRouteIds).toEqual(new Set([second.id]));
  });

  it('tocar una línea del mapa marca su fila', async () => {
    const first = row(1, 'Senda del Circo');
    setup([first], { extra: { [`GET /missions/${MISSION_ID}/routes/${first.id}/geometry`]: () => json(200, geometryOf(first.id)) } });
    const section = await region();
    await within(section).findByRole('table');
    await waitFor(() => expect(mapProps.current.onRouteClick).toBeTypeOf('function'));
    mapProps.current.onRouteClick!(first.id);
    await waitFor(() => expect((within(section).getByRole('checkbox', { name: /Senda del Circo/ }) as HTMLInputElement).checked).toBe(true));
  });

  it('si falla el perfil de una ruta lo dice en su sitio y deja el resto', async () => {
    const first = row(1, 'Senda del Circo');
    const { user } = setup([first], { extra: { [`GET /missions/${MISSION_ID}/routes/${first.id}/geometry`]: () => apiError(500, 'INTERNAL') } });
    const section = await region();
    await user.click(await within(section).findByRole('checkbox', { name: /Senda del Circo/ }));
    expect(await within(section).findByRole('alert')).toBeTruthy();
    expect(within(section).getByRole('table')).toBeTruthy();
  });
});

describe('versión nueva validada (RF-518, RN-13): se avisa y nunca cambia sola', () => {
  const withNewer = () => row(1, 'Senda del Circo', { newerValidatedVersion: { versionId: '99999999-cccc-4ccc-8ccc-cccccccccccc', number: 3 } });

  it('avisa de la versión 3 y no cambia nada al cargar', async () => {
    const { user, calls } = setup([withNewer()]);
    const line = await rowOf('Senda del Circo');
    expect(within(line).getByText('Versión 3 disponible')).toBeTruthy();
    expect(await menuItemNames(user, ACTIONS('Senda del Circo'), line)).toContain('Actualizar a la versión 3');
    expect(writes(calls())).toEqual([]);
  });

  it('pide confirmación con el foco en la opción segura; «No actualizar» no envía nada', async () => {
    const { user, calls } = setup([withNewer()]);
    await rowAction(user, 'Senda del Circo', /^Actualizar a la versión/);
    const confirm = await screen.findByRole('group', { name: '¿Actualizar «Senda del Circo» a la versión 3? Los rescatistas verán la versión nueva.' });
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: R.update.no }));
    await user.click(within(confirm).getByRole('button', { name: R.update.no }));
    expect(screen.queryByRole('group', { name: /Actualizar/ })).toBeNull();
    expect(writes(calls())).toEqual([]);
  });

  it('al confirmar fija la versión nueva con `pinnedVersionId`, lo anuncia y recarga la tabla', async () => {
    const original = withNewer();
    const updated = row(1, 'Senda del Circo', {}, { number: 3, versionId: '99999999-cccc-4ccc-8ccc-cccccccccccc' });
    const { user, calls, state } = setup([original], {
      extra: {
        [`PATCH /missions/${MISSION_ID}/routes/${original.id}`]: () => {
          state.rows = [updated];
          return json(200, updated);
        },
      },
    });
    await rowAction(user, 'Senda del Circo', /^Actualizar a la versión/);
    await user.click(await screen.findByRole('button', { name: R.update.yes }));
    const [patch] = writes(calls());
    expect(patch).toMatchObject({ method: 'PATCH', path: `/missions/${MISSION_ID}/routes/${original.id}`, body: { pinnedVersionId: '99999999-cccc-4ccc-8ccc-cccccccccccc' } });
    expect(await within(await region()).findByText('«Senda del Circo» pasa a la versión 3.')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('Versión 3 · Validada')).toBeTruthy());
    expect(screen.queryByText('Hay una versión 3 validada más reciente.')).toBeNull();
  });

  it('si el servidor lo rechaza (la misión se cerró), lo dice con su mensaje', async () => {
    const original = withNewer();
    const { user } = setup([original], { extra: { [`PATCH /missions/${MISSION_ID}/routes/${original.id}`]: () => apiError(409, 'MISSION_CLOSED') } });
    await rowAction(user, 'Senda del Circo', /^Actualizar a la versión/);
    await user.click(await screen.findByRole('button', { name: R.update.yes }));
    expect(await screen.findByText(es.missionDetail.closedMeanwhile)).toBeTruthy();
  });
});

describe('no disponible (RF-508)', () => {
  it('marca una ruta como no disponible y la reactiva, cada vez con su aviso', async () => {
    const original = row(1, 'Senda del Circo');
    const { user, calls, state } = setup([original], {
      extra: {
        [`PATCH /missions/${MISSION_ID}/routes/${original.id}`]: ({ body }) => {
          const status = (body as { status: string }).status;
          const next = { ...original, status };
          state.rows = [next];
          return json(200, next);
        },
      },
    });
    await rowAction(user, 'Senda del Circo', R.unavailable.mark);
    expect(writes(calls()).at(-1)).toMatchObject({ method: 'PATCH', body: { status: 'unavailable' } });
    expect(await within(await region()).findByText('«Senda del Circo» queda marcada como no disponible en esta misión.')).toBeTruthy();
    expect(within(await rowOf('Senda del Circo')).getByText(R.badges.unavailable)).toBeTruthy();

    await rowAction(user, 'Senda del Circo', R.unavailable.reactivate);
    expect(writes(calls()).at(-1)).toMatchObject({ body: { status: 'added' } });
    expect(await within(await region()).findByText('«Senda del Circo» vuelve a estar disponible.')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText(R.badges.unavailable)).toBeNull());
  });

  it('un fallo al marcar se dice junto a la tabla', async () => {
    const original = row(1, 'Senda del Circo');
    const { user } = setup([original], { extra: { [`PATCH /missions/${MISSION_ID}/routes/${original.id}`]: () => apiError(409, 'INVALID_STATE_TRANSITION') } });
    await rowAction(user, 'Senda del Circo', R.unavailable.mark);
    expect(await within(await region()).findByText(es.errors.INVALID_STATE_TRANSITION)).toBeTruthy();
  });
});

describe('quitar de la misión (RN-14)', () => {
  it('pide confirmación (foco en «No quitar»); al confirmar borra la fila y avisa de que la ruta sigue en la biblioteca', async () => {
    const original = row(1, 'Senda del Circo');
    const { user, calls, state } = setup([original, row(2, 'Pista del valle')], {
      extra: {
        [`DELETE /missions/${MISSION_ID}/routes/${original.id}`]: () => {
          state.rows = state.rows.filter((r) => (r as { id: string }).id !== original.id);
          return json(204, null);
        },
      },
    });
    await rowAction(user, 'Senda del Circo', R.remove.action);
    const confirm = await screen.findByRole('group', { name: '¿Quitar «Senda del Circo» de la misión? La ruta sigue en la biblioteca.' });
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: R.remove.no }));
    expect(writes(calls())).toEqual([]);
    await user.click(within(confirm).getByRole('button', { name: R.remove.yes }));
    expect(writes(calls())).toMatchObject([{ method: 'DELETE', path: `/missions/${MISSION_ID}/routes/${original.id}` }]);
    expect(await within(await region()).findByText('«Senda del Circo» ya no está en la misión. Sigue en la biblioteca.')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Senda del Circo')).toBeNull());
    expect(within(screen.getByRole('table')).getByText('Pista del valle')).toBeTruthy();
  });

  it('cancelar no envía nada; un fallo se dice en la confirmación', async () => {
    const original = row(1, 'Senda del Circo');
    const { user, calls } = setup([original], { extra: { [`DELETE /missions/${MISSION_ID}/routes/${original.id}`]: () => apiError(409, 'MISSION_CLOSED') } });
    await rowAction(user, 'Senda del Circo', R.remove.action);
    await user.click(await screen.findByRole('button', { name: R.remove.no }));
    expect(writes(calls())).toEqual([]);
    await rowAction(user, 'Senda del Circo', R.remove.action);
    await user.click(await screen.findByRole('button', { name: R.remove.yes }));
    expect(await screen.findByText(es.missionDetail.closedMeanwhile)).toBeTruthy();
  });
});

describe('cambiar el nombre desde la fila (RF-512)', () => {
  it('el «⋯» trae «Cambiar nombre» y «Quitar de la misión»; guardar envía updateRoute, recarga la tabla y lo anuncia', async () => {
    const original = row(1, 'Ruta generada 1');
    const { user, calls, state } = setup([original], {
      extra: {
        [`PATCH /routes/${original.routeId}`]: () => {
          state.rows = [{ ...original, name: 'Collado Norte 1' }];
          return json(200, {
            id: original.routeId,
            name: 'Collado Norte 1',
            status: 'active',
            versions: [],
            derivedFrom: null,
            derivatives: [],
            usedIn: [],
            createdAt: '2026-11-21T09:00:00+00:00',
            updatedAt: '2026-11-21T09:00:00+00:00',
          });
        },
      },
    });
    const line = await rowOf('Ruta generada 1');
    expect(await menuItemNames(user, ACTIONS('Ruta generada 1'), line)).toEqual(expect.arrayContaining([R.rename.action, R.remove.action]));
    await rowAction(user, 'Ruta generada 1', R.rename.action);
    const dialog = await screen.findByRole('dialog', { name: es.routeDetail.rename.title });
    const name = within(dialog).getByLabelText(es.routeDetail.rename.nameLabel);
    await user.clear(name);
    await user.type(name, 'Collado Norte 1');
    await user.click(within(dialog).getByRole('button', { name: es.routeDetail.rename.confirm }));
    expect(calls().find((c) => c.method === 'PATCH')).toMatchObject({ path: `/routes/${original.routeId}`, body: { name: 'Collado Norte 1' } });
    expect(await within(await region()).findByText('La ruta se llama ahora «Collado Norte 1».')).toBeTruthy();
    expect(await within(await tableOf()).findByText('Collado Norte 1')).toBeTruthy();
  });
});

describe('misión cerrada o sin permiso de escribir: solo lectura', () => {
  it.each([
    ['cerrada', { actions: noActions, status: 'closed' }],
    ['administrador (Q-14: lee, no escribe)', { actions: noActions, user: admin() }],
  ])('%s: la tabla se lee y se exporta, pero no hay ningún control que escriba', async (_name, options) => {
    const { user } = setup([row(1, 'Senda del Circo', { newerValidatedVersion: { versionId: '99999999-cccc-4ccc-8ccc-cccccccccccc', number: 3 } })], options);
    const line = await rowOf('Senda del Circo');
    expect(within(line).getByText('Versión 3 disponible')).toBeTruthy(); // se informa
    expect(within(line).queryByRole('button')).toBeNull(); // sin «⋯»: ninguna acción de fila
    expect(within(line).getByRole('checkbox', { name: /Senda del Circo/ })).toBeTruthy(); // ver en el mapa sigue siendo leer
    expect(await menuItemNames(user, R.more, await region())).toEqual([R.export.gpx, R.export.kml]);
    expect(within(await region()).queryByRole('button', { name: R.add.open })).toBeNull();
  });
});

describe('exportar las rutas de la misión (RF-508, RF-603)', () => {
  it('descarga GPX o KML con la versión fijada y avisa de qué incluye', async () => {
    const { user, calls } = setup([row(1, 'Senda del Circo')]);
    const section = await region();
    await within(section).findByRole('table');
    await chooseMenuItem(user, R.more, R.export.gpx, section);
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe('onway-rutas-mision.gpx');
    expect(await textOf(saved[0]!.blob)).toBe('archivo gpx');
    expect(
      calls()
        .filter((c) => c.path.endsWith('/routes/export'))
        .map((c) => c.query.get('format')),
    ).toEqual(['gpx']);
    await chooseMenuItem(user, R.more, R.export.kml, section);
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]!.name).toBe('onway-rutas-mision.kml');
  });

  it('un fallo al exportar se dice y no descarga nada; sin rutas no hay botón', async () => {
    const { user } = setup([row(1, 'Senda del Circo')], { extra: { [`GET /missions/${MISSION_ID}/routes/export`]: () => apiError(404, 'NOT_FOUND') } });
    const section = await region();
    await within(section).findByRole('table');
    await chooseMenuItem(user, R.more, R.export.gpx, section);
    expect(await within(section).findByText(R.export.nothing)).toBeTruthy();
    expect(saved).toEqual([]);
  });

  it('sin rutas no se ofrece exportar', async () => {
    const { user } = setup([]);
    const section = await region();
    await within(section).findByText(R.empty);
    expect(await menuItemNames(user, R.more, section)).toEqual([es.generate.cta, es.routeEditor.paint]);
  });

  it('«Pintar ruta» lleva al editor con la misión (D-P3)', async () => {
    const { user } = setup([]);
    const section = await region();
    await within(section).findByText(R.empty);
    await user.click(within(section).getByRole('button', { name: R.more }));
    expect(screen.getByRole('menuitem', { name: es.routeEditor.paint }).getAttribute('href')).toBe(`/routes/draw?mission=${MISSION_ID}`);
  });

  it('el «⋯» de cada fila lleva a «Continuar a mano» desde la versión fijada, con la misión (D-P4)', async () => {
    const { user } = setup([row(1, 'Senda del Circo')]);
    const line = await rowOf('Senda del Circo');
    const list = await openMenu(user, ACTIONS('Senda del Circo'), line);
    const item = within(list).getByRole('menuitem', { name: R.continue.action });
    expect(item.getAttribute('href')).toBe(`/routes/${row(1, 'x').routeId}/continue?base=${row(1, 'x').pinned.versionId}&mission=${MISSION_ID}`);
  });

  it('sin origen, «Pintar ruta» y «Generar rutas» están desactivados', async () => {
    const server = sessionServer(
      { user: sessionUser() },
      {
        [`GET /missions/${MISSION_ID}`]: () => json(200, mission({ actions: allActions, status: 'active', points: [] })),
        [`GET /missions/${MISSION_ID}/routes`]: () => json(200, { items: [] }),
        [`GET /missions/${MISSION_ID}/history`]: () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }),
      },
    );
    const { user } = renderApp({ route: PATH, fetch: server.api.fetch });
    const section = await region();
    await within(section).findByText(R.empty);
    await user.click(within(section).getByRole('button', { name: R.more }));
    for (const name of [es.generate.cta, es.routeEditor.paint]) expect(screen.getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('en francés', () => {
  it('títulos, columnas y avisos salen de packages/i18n (fr)', async () => {
    const { user } = setup([row(1, 'Senda del Circo', { newerValidatedVersion: { versionId: '99999999-cccc-4ccc-8ccc-cccccccccccc', number: 3 } })], { language: 'fr' });
    const section = await region(fr.missionRoutes.title);
    const table = await within(section).findByRole('table');
    expect(within(table).getByRole('columnheader', { name: fr.missionRoutes.columns.distance })).toBeTruthy();
    expect(within(table).getByText(fr.missionRoutes.notices.newer.replace('{{number}}', '3'))).toBeTruthy();
    expect(await menuItemNames(user, fr.missionRoutes.more, section)).toContain(fr.missionRoutes.export.gpx);
  });
});
