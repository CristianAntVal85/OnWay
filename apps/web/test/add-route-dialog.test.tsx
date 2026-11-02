// «Añadir ruta» a la misión y validar desde la fila (H4-T5, RF-513, RF-506, RF-518, D-H4-01, D-H4-08): elegir de la biblioteca con búsqueda y filtro,
// hasta 20 a la vez, con la versión que fija la misión (la última validada por defecto), el origen y la nota; los otros dos caminos (generar e
// importar) y los errores con su mensaje. `src/map/` es un doble.
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { admin, apiError, json, renderApp, sessionServer, sessionUser, type Call } from './support';
import { MISSION_ID, PATH, allActions, libraryItem, libraryPage, mission, noActions, routeDetailOf, row, versionId } from './mission-fixtures';

vi.mock('../src/map', () => ({ MAP_LAYERS: ['satellite', 'topographic', 'roads'], MapView: () => <div data-testid="map" /> }));

const R = es.missionRoutes;
const A = R.add;
const ORIGIN = { id: 'p1', kind: 'origin', name: 'Refugio de la Renclusa', note: null, lat: 42.6, lon: 0.65, elevationM: 2140, position: 0 };

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;
interface Options {
  rows?: unknown[];
  library?: unknown[];
  details?: Record<string, ReturnType<typeof routeDetailOf>>;
  actions?: Record<string, boolean>;
  status?: string;
  points?: unknown[];
  language?: 'es' | 'fr';
  user?: ReturnType<typeof sessionUser>;
  extra?: Handlers;
}
function setup(options: Options = {}) {
  const language = options.language ?? 'es';
  const state = { rows: options.rows ?? [] };
  const library = options.library ?? [];
  const server = sessionServer(
    { user: options.user ?? sessionUser({ locale: language }) },
    {
      [`GET /missions/${MISSION_ID}`]: () => json(200, mission({ actions: options.actions ?? allActions, status: options.status ?? 'active', points: options.points ?? [ORIGIN] })),
      [`GET /missions/${MISSION_ID}/routes`]: () => json(200, { items: state.rows }),
      [`GET /missions/${MISSION_ID}/history`]: () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }),
      'GET /routes': () => json(200, libraryPage(library)),
      'GET /geo/elevation': () => json(200, { lat: 42.6, lon: 0.65, elevationM: 2140 }),
      ...Object.fromEntries(Object.values(options.details ?? {}).map((detail) => [`GET /routes/${detail.id}`, () => json(200, detail)])),
      ...options.extra,
    },
  );
  const view = renderApp({ route: PATH, fetch: server.api.fetch, language });
  return { ...server, ...view, state, calls: () => server.api.calls };
}
const section = async (name = R.title) => screen.findByRole('region', { name });
const openDialog = async (user: ReturnType<typeof setup>['user']) => {
  await user.click(await within(await section()).findByRole('button', { name: A.open }));
  return screen.findByRole('dialog', { name: A.title });
};
const libraryCalls = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === '/routes');
const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === `/missions/${MISSION_ID}/routes`);
const pick = (dialog: HTMLElement, name: string) => within(dialog).getByRole('checkbox', { name: `Elegir «${name}»` });

const circo = libraryItem(1, 'Senda del Circo');
const pradera = libraryItem(2, 'Pradera a la Brecha', {}, { status: 'draft', number: 2 });
const detailsOf = () => ({
  [circo.id]: routeDetailOf(circo, [
    { number: 3, status: 'draft' },
    { number: 2, status: 'validated' },
    { number: 1, status: 'validated' },
  ]),
  [pradera.id]: routeDetailOf(pradera, [{ number: 1, status: 'draft' }]),
});

beforeEach(() => undefined);

describe('el botón «Añadir ruta»', () => {
  it('está en la sección con la tabla y también cuando no hay rutas', async () => {
    setup({ rows: [row(1, 'Senda del Circo')] });
    expect(await within(await section()).findByRole('button', { name: A.open })).toBeTruthy();
  });

  it('con la misión vacía también se ofrece', async () => {
    setup({ rows: [] });
    const region = await section();
    await within(region).findByText(R.empty);
    expect(within(region).getByRole('button', { name: A.open })).toBeTruthy();
  });

  it.each([
    ['cerrada', { actions: noActions, status: 'closed' }],
    ['administrador (Q-14)', { actions: noActions, user: admin() }],
  ])('%s: no hay botón ni validar', async (_name, options) => {
    setup({ rows: [row(1, 'Borrador', {}, { status: 'draft', validatedAt: null })], ...options });
    const region = await section();
    await within(region).findByRole('table');
    expect(within(region).queryByRole('button', { name: A.open })).toBeNull();
    expect(within(region).queryByRole('button', { name: /Validar/ })).toBeNull();
  });
});

describe('elegir de la biblioteca (RF-513)', () => {
  it('abre el diálogo con el foco dentro, pide las rutas activas y las enseña con su última versión; Escape lo cierra y devuelve el foco', async () => {
    const { user, calls } = setup({ library: [circo, pradera] });
    const opener = await within(await section()).findByRole('button', { name: A.open });
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: A.title });
    await within(dialog).findByRole('checkbox', { name: 'Elegir «Senda del Circo»' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    const request = libraryCalls(calls()).at(-1)!;
    expect(request.query.get('status')).toBe('active');
    expect(request.query.get('page')).toBe('1');
    expect(request.query.get('pageSize')).toBe('10');
    expect(request.query.get('q')).toBeNull();
    expect(within(dialog).getByText('Última: Validada · versión 1')).toBeTruthy();
    expect(within(dialog).getByText('Última: Borrador · versión 2')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('la búsqueda y el filtro por última versión se piden al servidor y vuelven a la página 1', async () => {
    const { user, calls } = setup({ library: [circo] });
    const dialog = await openDialog(user);
    await within(dialog).findByRole('checkbox', { name: /Senda del Circo/ });
    await user.type(within(dialog).getByLabelText(es.routes.searchLabel), 'circo');
    await user.click(within(dialog).getByRole('button', { name: es.routes.searchSubmit }));
    await waitFor(() => expect(libraryCalls(calls()).at(-1)!.query.get('q')).toBe('circo'));
    await user.selectOptions(within(dialog).getByLabelText(es.routes.filters.version), 'draft');
    await waitFor(() => expect(libraryCalls(calls()).at(-1)!.query.get('versionStatus')).toBe('draft'));
    expect(libraryCalls(calls()).at(-1)!.query.get('q')).toBe('circo');
    expect(libraryCalls(calls()).at(-1)!.query.get('page')).toBe('1');
  });

  it('sin resultados lo dice; con un fallo ofrece reintentar', async () => {
    let fail = true;
    const { user } = setup({ extra: { 'GET /routes': () => (fail ? apiError(500, 'INTERNAL') : json(200, libraryPage([]))) } });
    const dialog = await openDialog(user);
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    fail = false;
    await user.click(within(dialog).getByRole('button', { name: es.state.retry }));
    expect(await within(dialog).findByText(A.empty)).toBeTruthy();
  });

  it('una ruta que ya está en la misión sale marcada y no se puede elegir (INV-13)', async () => {
    const inside = row(1, 'Senda del Circo', { routeId: circo.id });
    const { user } = setup({ rows: [inside], library: [circo, pradera] });
    const dialog = await openDialog(user);
    const box = await within(dialog).findByRole('checkbox', { name: 'Elegir «Senda del Circo»' });
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getByText(A.inMission)).toBeTruthy();
    expect((pick(dialog, 'Pradera a la Brecha') as HTMLInputElement).disabled).toBe(false);
  });

  it('se pueden elegir hasta 20 a la vez: la 21 queda bloqueada y lo dice; al quitar una vuelve a poder', async () => {
    const many = Array.from({ length: 22 }, (_, i) => libraryItem(i + 1, `Ruta ${String(i + 1).padStart(2, '0')}`));
    const { user } = setup({ library: many });
    const dialog = await openDialog(user);
    await within(dialog).findByRole('checkbox', { name: 'Elegir «Ruta 01»' });
    for (let i = 1; i <= 20; i += 1) await user.click(pick(dialog, `Ruta ${String(i).padStart(2, '0')}`));
    expect(within(dialog).getByText('Rutas elegidas: 20 de 20')).toBeTruthy();
    expect((pick(dialog, 'Ruta 21') as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getByText(A.limit.replace('{{max}}', '20'))).toBeTruthy();
    await user.click(pick(dialog, 'Ruta 05'));
    expect((pick(dialog, 'Ruta 21') as HTMLInputElement).disabled).toBe(false);
  });

  it('«Continuar» está desactivado hasta elegir alguna', async () => {
    const { user } = setup({ library: [circo] });
    const dialog = await openDialog(user);
    await within(dialog).findByRole('checkbox', { name: /Senda del Circo/ });
    expect(within(dialog).getByRole('button', { name: A.continue }).getAttribute('aria-disabled')).toBe('true');
    await user.click(pick(dialog, 'Senda del Circo'));
    expect(within(dialog).getByRole('button', { name: A.continue }).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('versión, origen y nota (D-H4-01)', () => {
  const toDetails = async (user: ReturnType<typeof setup>['user'], names: string[]) => {
    const dialog = await openDialog(user);
    await within(dialog).findByRole('checkbox', { name: /Senda del Circo/ });
    for (const name of names) await user.click(pick(dialog, name));
    await user.click(within(dialog).getByRole('button', { name: A.continue }));
    return dialog;
  };

  it('propone la última versión validada (no la última si es un borrador) y avisa solo cuando lo elegido es un borrador', async () => {
    const { user } = setup({ library: [circo, pradera], details: detailsOf() });
    const dialog = await toDetails(user, ['Senda del Circo', 'Pradera a la Brecha']);
    const circoBox = await within(dialog).findByRole('group', { name: 'Senda del Circo' });
    const version = within(circoBox).getByLabelText(A.details.version) as HTMLSelectElement;
    expect(version.value).toBe(versionId(circo, 2));
    expect(
      within(version)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Versión 3 · Borrador', 'Versión 2 · Validada', 'Versión 1 · Validada']);
    expect(within(circoBox).queryByText(A.details.draftWarning)).toBeNull();
    // Una ruta que solo tiene borradores: se propone el borrador y se avisa de que el rescatista no la verá.
    const praderaBox = within(dialog).getByRole('group', { name: 'Pradera a la Brecha' });
    expect(within(praderaBox).getByText(A.details.draftWarning)).toBeTruthy();
    // Elegir el borrador de la otra también avisa.
    await user.selectOptions(version, versionId(circo, 3));
    expect(within(circoBox).getByText(A.details.draftWarning)).toBeTruthy();
  });

  it('envía lo elegido: la versión fijada, el origen de la misión y la nota; al terminar cierra, lo anuncia y recarga la tabla', async () => {
    const added = row(1, 'Senda del Circo', { routeId: circo.id });
    const { user, calls, state } = setup({
      library: [circo],
      details: detailsOf(),
      extra: {
        [`POST /missions/${MISSION_ID}/routes`]: () => {
          state.rows = [added];
          return json(201, { items: [added] });
        },
      },
    });
    const opener = await within(await section()).findByRole('button', { name: A.open });
    const dialog = await toDetails(user, ['Senda del Circo']);
    const box = await within(dialog).findByRole('group', { name: 'Senda del Circo' });
    await user.selectOptions(within(box).getByLabelText(A.details.version), versionId(circo, 1));
    await user.selectOptions(within(box).getByLabelText(A.details.origin), 'p1');
    await user.type(within(box).getByLabelText(A.details.note), 'Subida por el collado');
    await user.click(within(dialog).getByRole('button', { name: 'Añadir rutas (1)' }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    expect(posts(calls())[0]!.body).toEqual({ items: [{ routeId: circo.id, versionId: versionId(circo, 1), originPointId: 'p1', note: 'Subida por el collado' }] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(await section()).findByText('Rutas añadidas a la misión: 1.')).toBeTruthy();
    expect(within(await section()).getByRole('table')).toBeTruthy();
    expect(document.activeElement).toBe(opener);
  });

  it('sin tocar nada fija la versión que se enseñaba (explícita) y no manda origen ni nota vacíos', async () => {
    const { user, calls } = setup({ library: [circo], details: detailsOf(), extra: { [`POST /missions/${MISSION_ID}/routes`]: () => json(201, { items: [] }) } });
    const dialog = await toDetails(user, ['Senda del Circo']);
    await within(dialog).findByRole('group', { name: 'Senda del Circo' });
    await user.click(within(dialog).getByRole('button', { name: 'Añadir rutas (1)' }));
    await waitFor(() => expect(posts(calls())).toHaveLength(1));
    expect(posts(calls())[0]!.body).toEqual({ items: [{ routeId: circo.id, versionId: versionId(circo, 2) }] });
  });

  it('«Volver» regresa a la lista con lo elegido intacto', async () => {
    const { user } = setup({ library: [circo, pradera], details: detailsOf() });
    const dialog = await toDetails(user, ['Senda del Circo']);
    await within(dialog).findByRole('group', { name: 'Senda del Circo' });
    await user.click(within(dialog).getByRole('button', { name: A.back }));
    expect((await within(dialog).findByRole('checkbox', { name: 'Elegir «Senda del Circo»' })) as HTMLInputElement).toHaveProperty('checked', true);
  });

  it('si no se puede leer las versiones de una ruta lo dice y no deja añadirla', async () => {
    const { user } = setup({ library: [circo], extra: { [`GET /routes/${circo.id}`]: () => apiError(500, 'INTERNAL') } });
    const dialog = await toDetails(user, ['Senda del Circo']);
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Añadir rutas (1)' }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('errores con su mensaje: el diálogo sigue abierto y no se añade nada', () => {
  const failWith = async (response: () => Response, options: Options = {}, made?: (result: ReturnType<typeof setup>) => void) => {
    const setupResult = setup({ library: [circo, pradera], details: detailsOf(), extra: { [`POST /missions/${MISSION_ID}/routes`]: response }, ...options });
    made?.(setupResult);
    const { user } = setupResult;
    const dialog = await openDialog(user);
    await within(dialog).findByRole('checkbox', { name: /Senda del Circo/ });
    await user.click(pick(dialog, 'Senda del Circo'));
    await user.click(within(dialog).getByRole('button', { name: A.continue }));
    await within(dialog).findByRole('group', { name: 'Senda del Circo' });
    await user.click(within(dialog).getByRole('button', { name: 'Añadir rutas (1)' }));
    return { ...setupResult, dialog };
  };

  it('ROUTE_ALREADY_IN_MISSION: dice cuál ya estaba (lo añadió otra persona mientras tanto) aunque la lista se recargue y ya no cuente para el lote', async () => {
    let state: { rows: unknown[] } | undefined;
    const { dialog, user } = await failWith(
      () => {
        state!.rows = [row(1, 'Senda del Circo', { routeId: circo.id })];
        return apiError(409, 'ROUTE_ALREADY_IN_MISSION', { routeId: circo.id });
      },
      {},
      (made) => (state = made.state),
    );
    expect((await within(dialog).findByRole('alert')).textContent).toBe('«Senda del Circo» ya está en la misión. No se ha añadido ninguna ruta.');
    expect(screen.getByRole('dialog', { name: A.title })).toBeTruthy();
    // Con la misión recargada, la ruta ya no entra en el lote: no queda nada que añadir hasta elegir otra.
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Añadir rutas (0)' }).getAttribute('aria-disabled')).toBe('true'));
    await user.click(within(dialog).getByRole('button', { name: A.back }));
    const box = await within(dialog).findByRole('checkbox', { name: 'Elegir «Senda del Circo»' });
    expect((box as HTMLInputElement).disabled).toBe(true);
  });

  it('INVALID_STATE_TRANSITION: una ruta archivada no se añade; hay que derivarla', async () => {
    const { dialog } = await failWith(() => apiError(409, 'INVALID_STATE_TRANSITION'));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(A.errors.archived);
  });

  it('MISSION_CLOSED: la misión se cerró mientras tanto', async () => {
    const { dialog } = await failWith(() => apiError(409, 'MISSION_CLOSED'));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(es.missionDetail.closedMeanwhile);
  });

  it('NOT_FOUND: algo ya no existe; se pide volver a elegir', async () => {
    const { dialog } = await failWith(() => apiError(404, 'NOT_FOUND'));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(A.errors.notFound);
  });

  it('cualquier otro código sale con el texto de su código, y se puede volver a intentar', async () => {
    const { dialog, user, calls } = await failWith(() => apiError(500, 'INTERNAL'));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(es.errors.INTERNAL);
    await user.click(within(dialog).getByRole('button', { name: 'Añadir rutas (1)' }));
    await waitFor(() => expect(posts(calls())).toHaveLength(2));
  });
});

describe('los otros dos caminos (§4.3-B)', () => {
  it('Generar lleva a generar con `?mission=` y Importar a importar con `?mission=`', async () => {
    const { user } = setup({ library: [circo] });
    const dialog = await openDialog(user);
    expect(within(dialog).getByRole('link', { name: A.other.generate }).getAttribute('href')).toBe(`/routes/generate?mission=${MISSION_ID}`);
    expect(within(dialog).getByRole('link', { name: A.other.import }).getAttribute('href')).toBe(`/routes/import?mission=${MISSION_ID}`);
  });

  it('sin origen, generar no se ofrece como enlace: se explica por qué (RN-08) y se puede importar', async () => {
    const { user } = setup({ library: [circo], points: [] });
    const dialog = await openDialog(user);
    expect(within(dialog).queryByRole('link', { name: A.other.generate })).toBeNull();
    expect(within(dialog).getByText(A.other.generateNoOrigin)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: A.other.import })).toBeTruthy();
  });
});

describe('validar desde la fila (RF-506, D-H4-08)', () => {
  const draftRow = () => row(1, 'Pradera a la Brecha', {}, { status: 'draft', validatedAt: null });

  it('una versión fijada en borrador ofrece «Validar»; una validada, no', async () => {
    setup({ rows: [draftRow(), row(2, 'Senda del Circo')] });
    const table = await within(await section()).findByRole('table');
    expect(within(within(table).getByRole('row', { name: /Pradera a la Brecha/ })).getByRole('button', { name: 'Validar «Pradera a la Brecha»' })).toBeTruthy();
    expect(within(within(table).getByRole('row', { name: /Senda del Circo/ })).queryByRole('button', { name: /Validar/ })).toBeNull();
  });

  it('pide confirmar el aviso; sin marcarlo no envía nada; al confirmar valida la versión fijada y la fila cambia sin recargar la página', async () => {
    const original = draftRow();
    const validated = row(1, 'Pradera a la Brecha', {}, { status: 'validated' });
    const { user, calls, state } = setup({
      rows: [original],
      extra: {
        [`POST /routes/${original.routeId}/versions/${original.pinned.versionId}/validate`]: () => {
          state.rows = [validated];
          return json(200, {});
        },
      },
    });
    const table = await within(await section()).findByRole('table');
    await user.click(within(within(table).getByRole('row', { name: /Pradera a la Brecha/ })).getByRole('button', { name: /Validar/ }));
    const dialog = await screen.findByRole('dialog', { name: es.routeDetail.validate.title.replace('{{number}}', '1') });
    expect(within(dialog).getByText(es.routeDetail.validate.warning)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: es.routeDetail.validate.confirm }));
    expect(within(dialog).getByText(es.routeDetail.validate.needsAcknowledge)).toBeTruthy();
    expect(calls().some((c) => c.path.endsWith('/validate'))).toBe(false);
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: es.routeDetail.validate.confirm }));
    await waitFor(() => expect(calls().filter((c) => c.path.endsWith('/validate'))).toHaveLength(1));
    expect(calls().find((c) => c.path.endsWith('/validate'))!.body).toEqual({ acknowledged: true });
    expect(await within(await section()).findByText('«Pradera a la Brecha» queda validada. Los rescatistas ya la ven si la misión está activa.')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('Versión 1 · Validada')).toBeTruthy());
    expect(within(screen.getByRole('table')).queryByRole('button', { name: /Validar/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape cierra el diálogo de validar sin validar', async () => {
    const original = draftRow();
    const { user, calls } = setup({ rows: [original] });
    const table = await within(await section()).findByRole('table');
    await user.click(within(table).getByRole('button', { name: /Validar/ }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls().some((c) => c.path.endsWith('/validate'))).toBe(false);
  });
});

describe('en francés', () => {
  it('el botón, el diálogo y sus avisos salen de packages/i18n (fr)', async () => {
    const { user } = setup({ library: [circo], details: detailsOf(), language: 'fr' });
    const F = fr.missionRoutes.add;
    await user.click(await within(await section(fr.missionRoutes.title)).findByRole('button', { name: F.open }));
    const dialog = await screen.findByRole('dialog', { name: F.title });
    expect(within(dialog).getByRole('link', { name: F.other.generate })).toBeTruthy();
    expect(within(dialog).getByText(F.limit.replace('{{max}}', '20'))).toBeTruthy();
  });
});
