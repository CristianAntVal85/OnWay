// Detalle de ruta (H2-T8, RF-502, RF-504, RF-506, RF-511, RF-516, RF-517, RF-519): versiones, perfil accesible, comparar, validar, derivar, archivar y exportar.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { admin, apiError, chooseMenuItem, json, menuItemNames, org, renderApp, sessionServer, sessionUser, type Call } from './support';

const MORE = es.common.more;
const EXPORT = es.common.export;
import { profileShape, tableRows } from '../src/library/profile-path';
import { difference } from '../src/library/compare';

interface FakeMapProps {
  routes?: readonly { id: string; name: string; tone: string }[];
}
vi.mock('../src/map', () => ({
  MAP_LAYERS: [],
  MapView: (props: FakeMapProps) => (
    <div data-testid="map">
      {props.routes?.map((route) => (
        <span key={route.id} data-testid={`line-${route.tone}`}>
          {route.name}
        </span>
      ))}
    </div>
  ),
}));

const T = es.routeDetail;
const ROUTE = '11111111-aaaa-4aaa-8aaa-111111111111';
const V1 = '22222222-aaaa-4aaa-8aaa-222222222222';
const V2 = '33333333-aaaa-4aaa-8aaa-333333333333';
const COORD = { id: sessionUser().id, displayName: 'Coordinador Demo' };
const metrics = (distanceM: number, ascentM: number) => ({ distanceM, ascentM, descentM: 100, minElevationM: 1500, maxElevationM: 2100, maxSlopePct: 18.5 });

const version = (id: string, number: number, status: 'draft' | 'validated', extra: Record<string, unknown> = {}) => ({
  id,
  number,
  status,
  provenance: number === 1 ? 'imported' : 'edited',
  manuallyModified: number > 1,
  metrics: metrics(number === 1 ? 5000 : 5600, number === 1 ? 500 : 640),
  roadMix: [{ roadType: 'unknown', distanceM: number === 1 ? 5000 : 5600 }],
  note: number === 1 ? 'Primera' : null,
  createdBy: COORD,
  createdAt: '2026-10-01T09:00:00.000Z',
  validatedBy: status === 'validated' ? COORD : null,
  validatedAt: status === 'validated' ? '2026-10-02T09:00:00.000Z' : null,
  ...extra,
});
const detail = (overrides: Record<string, unknown> = {}) => ({
  id: ROUTE,
  name: 'Senda del Circo',
  status: 'active',
  versions: [version(V2, 2, 'draft'), version(V1, 1, 'validated')],
  derivedFrom: null,
  derivatives: [],
  usedIn: [],
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-03T09:00:00.000Z',
  ...overrides,
});
const versionDetail = (v: ReturnType<typeof version>) => ({
  ...v,
  geometry: {
    type: 'LineString',
    coordinates: [
      [0.6, 42.6, 1500],
      [0.61, 42.61, 1600],
      [0.62, 42.62, 2100],
    ],
  },
  segments: [{ position: 0, roadType: 'unknown', distanceM: v.metrics.distanceM, ascentM: v.metrics.ascentM, descentM: 100 }],
  elevationProfile: [
    [0, 1500],
    [2500, 1800],
    [5000, 2100],
  ],
});

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;
function setup(extra: Handlers = {}, options: { user?: ReturnType<typeof sessionUser>; language?: 'es' | 'fr'; route?: string; data?: ReturnType<typeof detail> } = {}) {
  const language = options.language ?? 'es';
  const data = options.data ?? detail();
  const server = sessionServer(
    { user: options.user ?? sessionUser({ locale: language }) },
    {
      [`GET /routes/${ROUTE}`]: () => json(200, data),
      [`GET /routes/${ROUTE}/versions/${V1}`]: () => json(200, versionDetail(data.versions.find((v) => (v as { id: string }).id === V1) as ReturnType<typeof version>)),
      [`GET /routes/${ROUTE}/versions/${V2}`]: () => json(200, versionDetail(data.versions.find((v) => (v as { id: string }).id === V2) as ReturnType<typeof version>)),
      ...extra,
    },
  );
  const view = renderApp({ route: options.route ?? `/routes/${ROUTE}`, fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}

describe('detalle de ruta: datos y estados', () => {
  it('enseña la última versión con sus datos, el tipo de vía «sin clasificar» y las versiones de la más nueva a la más antigua', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Senda del Circo' })).toBeTruthy();
    expect(await screen.findByText('5,6 km')).toBeTruthy();
    expect(screen.getByText('640 m')).toBeTruthy();
    expect(screen.getByText('18,5 %')).toBeTruthy();
    expect(screen.getByText('Sin clasificar · 5,6 km')).toBeTruthy();
    const items = [...document.querySelectorAll('.version-row strong')].map((n) => n.textContent);
    expect(items).toEqual(['Versión 2', 'Versión 1']);
    expect(screen.getAllByText('Creada por Coordinador Demo el 1 oct 2026')).toHaveLength(2);
    expect(screen.getByText(/Validada por Coordinador Demo el 2 oct 2026/)).toBeTruthy();
    expect(screen.getByText('Primera')).toBeTruthy();
    expect(screen.getByText(T.versions.manuallyModified)).toBeTruthy();
    expect(await screen.findByTestId('line-draft')).toBeTruthy();
  });

  it('carga y error: una ruta que no existe (otra organización) muestra el error con su texto', async () => {
    setup({ [`GET /routes/${ROUTE}`]: () => apiError(404, 'NOT_FOUND') });
    expect(screen.getByRole('status').textContent).toContain(es.state.loading);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: T.back })).toBeTruthy();
  });

  it('«Deriva de», copias derivadas y «Usada en» con la misión, su estado y la versión fijada', async () => {
    setup(
      {},
      {
        data: detail({
          derivedFrom: { routeId: 'aaaa', routeName: 'Pradera', versionNumber: 3 },
          derivatives: [{ id: 'bbbb', name: 'Copia del Circo' }],
          usedIn: [{ missionId: 'cccc', missionRouteId: 'dddd', missionName: 'Simulacro Aneto', missionStatus: 'active', pinnedVersionNumber: 1 }],
        }),
      },
    );
    expect(await screen.findByRole('link', { name: 'Deriva de «Pradera» (versión 3)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Copia del Circo' }).getAttribute('href')).toBe('/routes/bbbb');
    expect(screen.getByRole('link', { name: 'Simulacro Aneto' }).getAttribute('href')).toBe('/missions/cccc');
    expect(screen.getByText('Activa · versión 1')).toBeTruthy();
  });

  it('avisa de una validación antigua según el límite de la organización (RF-519)', async () => {
    setup({ 'GET /org': () => json(200, { ...org(), config: { validationMaxAgeDays: 5, maxUploadBytes: 1 } }) });
    expect(await screen.findByText(/supera los 5 que fija tu organización/)).toBeTruthy();
  });

  it('una ruta archivada es de solo lectura: sin validar ni versión nueva ni archivar, pero sí derivar y exportar', async () => {
    const { user } = setup({}, { data: detail({ status: 'archived' }) });
    expect(await screen.findByText(T.archivedNotice)).toBeTruthy();
    expect(screen.queryByRole('button', { name: T.actions.validate })).toBeNull();
    expect(screen.queryByRole('link', { name: T.actions.edit })).toBeNull();
    expect(await menuItemNames(user, MORE)).toEqual([T.actions.duplicate]);
    expect(await menuItemNames(user, EXPORT)).toEqual([T.actions.exportGpx, T.actions.exportKml]);
    expect(await screen.findByTestId('line-archived')).toBeTruthy();
  });

  it('en francés los textos salen en francés', async () => {
    const { user } = setup({}, { language: 'fr' });
    expect(await screen.findByRole('heading', { level: 2, name: fr.routeDetail.versions.title })).toBeTruthy();
    expect(await menuItemNames(user, fr.common.more)).toEqual([fr.routeDetail.actions.rename, fr.routeDetail.actions.duplicate, fr.routeDetail.actions.archive]);
  });
});

describe('perfil de elevación accesible (D-H2-13)', () => {
  it('es una imagen con título y descripción, y una tabla equivalente con los mismos datos', async () => {
    const { user } = setup();
    const image = await screen.findByRole('img', { name: new RegExp(T.profile.title) });
    expect(image.querySelector('title')?.textContent).toBe(T.profile.title);
    expect(image.querySelector('desc')?.textContent).toBe('Perfil de elevación de la versión 2: la altitud, en metros, a lo largo de la ruta. Va de 1500 m a 2100 m en 5,0 km.');
    await user.click(screen.getByText(T.profile.showTable));
    const table = screen.getByRole('table', { name: T.profile.tableCaption });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([T.profile.columnDistance, T.profile.columnElevation]);
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) =>
          within(row)
            .getAllByRole('cell')
            .map((c) => c.textContent),
        ),
    ).toEqual([
      ['0,0', '1500'],
      ['2,5', '1800'],
      ['5,0', '2100'],
    ]);
  });

  it('la escala del dibujo cubre el rango, no se sale de la caja y la tabla no pasa de 21 filas', () => {
    const profile = Array.from({ length: 500 }, (_, i) => [i * 20, 1000 + Math.sin(i / 30) * 300] as [number, number]);
    const box = { width: 640, height: 220, left: 52, right: 12, top: 12, bottom: 30 };
    const shape = profileShape(profile, box);
    for (const pair of shape.line.split(' ')) {
      const [x, y] = pair.split(',').map(Number) as [number, number];
      expect(x).toBeGreaterThanOrEqual(box.left);
      expect(x).toBeLessThanOrEqual(box.width - box.right + 0.1);
      expect(y).toBeGreaterThanOrEqual(box.top);
      expect(y).toBeLessThanOrEqual(box.height - box.bottom + 0.1);
    }
    expect(shape.yTicks.length).toBeGreaterThan(1);
    expect(tableRows(profile)).toHaveLength(21);
    expect(tableRows(profile)[0]).toEqual(profile[0]);
    expect(tableRows(profile).at(-1)).toEqual(profile.at(-1));
    // Una ruta llana no rompe la escala.
    expect(() =>
      profileShape(
        [
          [0, 1500],
          [100, 1500],
        ],
        box,
      ),
    ).not.toThrow();
  });
});

describe('comparar versiones (RF-504)', () => {
  it('pinta las dos en el mapa y la tabla da la diferencia B − A', async () => {
    const { user } = setup();
    await screen.findByText('5,6 km');
    await user.click(screen.getByRole('button', { name: T.compare.start }));
    expect(await screen.findByRole('heading', { name: T.compare.title })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('line-compare-a')).toBeTruthy());
    expect(screen.getByTestId('line-compare-b')).toBeTruthy();
    // Por defecto A es la anterior y B la más nueva.
    expect((screen.getByLabelText(T.compare.a) as HTMLSelectElement).value).toBe(V1);
    expect((screen.getByLabelText(T.compare.b) as HTMLSelectElement).value).toBe(V2);
    const table = await screen.findByRole('table');
    const row = (name: string) =>
      within(within(table).getByRole('rowheader', { name }).closest('tr')!)
        .getAllByRole('cell')
        .map((c) => c.textContent);
    expect(row(T.metrics.distance)).toEqual(['5,0 km', '5,6 km', '+600 m']);
    expect(row(T.metrics.ascent)).toEqual(['500 m', '640 m', '+140 m']);
    expect(row(T.metrics.descent)).toEqual(['100 m', '100 m', T.compare.same]);
    await user.click(screen.getByRole('button', { name: T.compare.stop }));
    expect(screen.queryByRole('heading', { name: T.compare.title })).toBeNull();
  });

  it('la diferencia se redondea a un decimal y no da −0', () => {
    const a = metrics(1000.04, 100);
    const b = metrics(1000.06, 100);
    expect(difference(a, b, 'distanceM')).toBe(0);
    expect(Object.is(difference(a, b, 'distanceM'), -0)).toBe(false);
    expect(difference(metrics(1000, 100), metrics(1250.5, 90), 'distanceM')).toBe(250.5);
  });
});

describe('validar, derivar y archivar (coordinador)', () => {
  it('validar exige marcar la casilla y envía acknowledged: true; al terminar vuelve a leer la ruta', async () => {
    let validated = false;
    const { user, calls } = setup({
      [`POST /routes/${ROUTE}/versions/${V2}/validate`]: () => {
        validated = true;
        return json(200, version(V2, 2, 'validated'));
      },
      [`GET /routes/${ROUTE}`]: () => json(200, detail(validated ? { versions: [version(V2, 2, 'validated'), version(V1, 1, 'validated')] } : {})),
    });
    await user.click(await screen.findByRole('button', { name: T.actions.validate }));
    const dialog = await screen.findByRole('dialog', { name: 'Validar la versión 2' });
    expect(within(dialog).getByText(T.validate.warning)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: T.validate.confirm }));
    expect(await within(dialog).findByText(T.validate.needsAcknowledge)).toBeTruthy();
    expect(calls().some((c) => c.method === 'POST')).toBe(false);
    await user.click(within(dialog).getByRole('checkbox', { name: T.validate.acknowledge }));
    await user.click(within(dialog).getByRole('button', { name: T.validate.confirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls().find((c) => c.method === 'POST')!.body).toEqual({ acknowledged: true });
    // La versión validada ya no ofrece «validar»; «Editar ruta» sigue ahí (guardar crea otra versión).
    await waitFor(() => expect(screen.queryByRole('button', { name: T.actions.validate })).toBeNull());
    expect(screen.getByRole('link', { name: T.actions.edit })).toBeTruthy();
  });

  it('una versión validada no tiene «validar»; la acción para cambiarla crea otra versión (no «editar» sobre ella)', async () => {
    setup({}, { route: `/routes/${ROUTE}?v=${V1}` });
    await screen.findByText('5,0 km');
    expect(screen.queryByRole('button', { name: T.actions.validate })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Editar/ })).toBeNull();
    expect(screen.getByRole('link', { name: T.actions.edit }).getAttribute('href')).toBe(`/routes/${ROUTE}/edit?base=${V1}`);
  });

  it('derivar pide un nombre, envía la versión mostrada y lleva a la ruta nueva', async () => {
    const NEW = '44444444-aaaa-4aaa-8aaa-444444444444';
    const { user, calls } = setup({
      [`POST /routes/${ROUTE}/derive`]: () => json(201, { routeId: NEW, versionId: V1, versionNumber: 1, missionRouteId: null }),
      [`GET /routes/${NEW}`]: () => json(200, detail({ id: NEW, name: 'Mi copia', derivedFrom: { routeId: ROUTE, routeName: 'Senda del Circo', versionNumber: 2 } })),
      [`GET /routes/${NEW}/versions/${V2}`]: () => json(200, versionDetail(version(V2, 2, 'draft'))),
    });
    await chooseMenuItem(user, MORE, T.actions.duplicate);
    const dialog = await screen.findByRole('dialog', { name: T.derive.title });
    const name = within(dialog).getByLabelText(T.derive.nameLabel);
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: T.derive.confirm }));
    expect(within(dialog).getByText(T.derive.nameRequired)).toBeTruthy();
    await user.type(name, 'Mi copia');
    await user.click(within(dialog).getByRole('button', { name: T.derive.confirm }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Mi copia' })).toBeTruthy();
    expect(calls().find((c) => c.method === 'POST')!.body).toEqual({ name: 'Mi copia', fromVersionId: V2 });
    expect(screen.getByRole('link', { name: 'Deriva de «Senda del Circo» (versión 2)' })).toBeTruthy();
  });

  it('cambiar nombre está en «Más», pide un nombre, envía updateRoute y enseña el nombre nuevo (RF-512)', async () => {
    let renamed = false;
    const { user, calls } = setup({
      [`PATCH /routes/${ROUTE}`]: () => {
        renamed = true;
        return json(200, detail({ name: 'Collado Norte' }));
      },
      [`GET /routes/${ROUTE}`]: () => json(200, detail(renamed ? { name: 'Collado Norte' } : {})),
    });
    expect(await menuItemNames(user, MORE)).toEqual([T.actions.rename, T.actions.duplicate, T.actions.archive]);
    await chooseMenuItem(user, MORE, T.actions.rename);
    const dialog = await screen.findByRole('dialog', { name: T.rename.title });
    const name = within(dialog).getByLabelText(T.rename.nameLabel);
    expect(name).toHaveProperty('value', 'Senda del Circo');
    await waitFor(() => expect(document.activeElement).toBe(name));
    await user.clear(name);
    await user.type(name, '   ');
    await user.click(within(dialog).getByRole('button', { name: T.rename.confirm }));
    expect(within(dialog).getByText(T.rename.nameRequired)).toBeTruthy();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute('aria-required')).toBe('true');
    expect(calls().filter((c) => c.method === 'PATCH')).toHaveLength(0);
    await user.clear(name);
    await user.type(name, ' Collado Norte ');
    await user.click(within(dialog).getByRole('button', { name: T.rename.confirm }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Collado Norte' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls().find((c) => c.method === 'PATCH')!.body).toEqual({ name: 'Collado Norte' });
    // El cambio se anuncia: el título cambia, pero un lector de pantalla no lo sabría
    expect(screen.getAllByRole('status').map((node) => node.textContent)).toContain(T.rename.done.replace('{{name}}', 'Collado Norte'));
  });

  it('cambiar nombre: un error del servidor se dice y el diálogo sigue abierto', async () => {
    const { user } = setup({ [`PATCH /routes/${ROUTE}`]: () => apiError(409, 'INVALID_STATE_TRANSITION') });
    await chooseMenuItem(user, MORE, T.actions.rename);
    const dialog = await screen.findByRole('dialog', { name: T.rename.title });
    await user.click(within(dialog).getByRole('button', { name: T.rename.confirm }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: T.rename.title })).toBeTruthy();
  });

  it('archivar con ROUTE_IN_USE enseña las misiones y no cierra el diálogo', async () => {
    const { user } = setup({
      [`POST /routes/${ROUTE}/archive`]: () =>
        apiError(409, 'ROUTE_IN_USE', {
          missions: [
            { id: 'm1', name: 'Misión del Aneto' },
            { id: 'm2', name: 'Misión del Posets' },
          ],
        }),
    });
    await chooseMenuItem(user, MORE, T.actions.archive);
    const dialog = await screen.findByRole('dialog', { name: T.archive.title });
    await user.click(within(dialog).getByRole('button', { name: T.archive.confirm }));
    expect(
      await within(dialog).findByText('No se puede archivar: está en misiones que no están cerradas (Misión del Aneto, Misión del Posets). Quítala de ellas en «Usada en», en esta misma página.'),
    ).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('archivar con éxito vuelve a leer la ruta y queda de solo lectura', async () => {
    let archived = false;
    const { user } = setup({
      [`POST /routes/${ROUTE}/archive`]: () => {
        archived = true;
        return json(200, detail({ status: 'archived' }));
      },
      [`GET /routes/${ROUTE}`]: () => json(200, detail(archived ? { status: 'archived' } : {})),
    });
    await chooseMenuItem(user, MORE, T.actions.archive);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: T.archive.confirm }));
    expect(await screen.findByText(T.archivedNotice)).toBeTruthy();
  });

  it('exportar la versión mostrada pide su GPX o KML', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      names.push(this.download);
    };
    const { user, calls } = setup({ [`GET /routes/${ROUTE}/export`]: () => new Response('<kml/>', { status: 200, headers: { 'Content-Type': 'application/vnd.google-earth.kml+xml' } }) });
    await chooseMenuItem(user, EXPORT, T.actions.exportKml);
    await waitFor(() => expect(names).toEqual(['onway-route-v2.kml']));
    const request = calls().find((c) => c.path.endsWith('/export'))!;
    expect(request.query.get('versionId')).toBe(V2);
    expect(request.query.get('format')).toBe('kml');
    HTMLAnchorElement.prototype.click = click;
  });
});

describe('quitar de la misión desde «Usada en» (RF-512, D-N6, D-N7)', () => {
  const open = { missionId: 'm-open', missionRouteId: 'mr-open', missionName: 'Simulacro Aneto', missionStatus: 'active', pinnedVersionNumber: 1 };
  const planned = { missionId: 'm-plan', missionRouteId: 'mr-plan', missionName: 'Rescate Posets', missionStatus: 'planning', pinnedVersionNumber: 2 };
  const closed = { missionId: 'm-closed', missionRouteId: 'mr-closed', missionName: 'Ejercicio Monte Perdido', missionStatus: 'closed', pinnedVersionNumber: 1 };
  const removeFor = (mission: string) => T.relations.removeFor.replace('{{mission}}', mission);

  it('solo las misiones en planificación o activas tienen el botón; la cerrada dice «solo lectura»', async () => {
    setup({}, { data: detail({ usedIn: [open, planned, closed] }) });
    expect(await screen.findByRole('button', { name: removeFor('Simulacro Aneto') })).toBeTruthy();
    expect(screen.getByRole('button', { name: removeFor('Rescate Posets') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: removeFor('Ejercicio Monte Perdido') })).toBeNull();
    expect(screen.getByText(new RegExp(`${T.relations.readOnly}$`))).toBeTruthy();
  });

  it('pide confirmación con el foco en «No quitar»; «No quitar» no envía nada; confirmar llama a removeMissionRoute y lo anuncia', async () => {
    let removed = false;
    const { user, calls } = setup({
      [`GET /routes/${ROUTE}`]: () => json(200, detail({ usedIn: removed ? [] : [open] })),
      [`DELETE /missions/m-open/routes/mr-open`]: () => {
        removed = true;
        return json(204, null);
      },
    });
    await user.click(await screen.findByRole('button', { name: removeFor('Simulacro Aneto') }));
    const group = screen.getByRole('group', { name: T.relations.removeConfirm.replace('{{mission}}', 'Simulacro Aneto') });
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: T.relations.removeNo }));
    await user.click(within(group).getByRole('button', { name: T.relations.removeNo }));
    expect(calls().filter((c) => c.method === 'DELETE')).toHaveLength(0);
    // Al cancelar, el foco vuelve al botón que abrió la confirmación (no cae al cuerpo de la página)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: removeFor('Simulacro Aneto') }));
    await user.click(screen.getByRole('button', { name: removeFor('Simulacro Aneto') }));
    await user.click(screen.getByRole('button', { name: T.relations.removeYes }));
    expect(calls().find((c) => c.method === 'DELETE')).toMatchObject({ path: '/missions/m-open/routes/mr-open' });
    expect(await screen.findByText(T.relations.removeDone.replace('{{mission}}', 'Simulacro Aneto'))).toBeTruthy();
    expect(await screen.findByText(T.relations.notUsed)).toBeTruthy();
    // La fila ya no existe: el foco pasa al bloque «Usada en», que contiene el resultado
    expect(document.activeElement).toBe(screen.getByText(T.relations.notUsed).closest('.used-in'));
  });

  it('el nombre accesible del botón empieza por su texto visible (WCAG 2.5.3)', async () => {
    setup({}, { data: detail({ usedIn: [open] }) });
    const button = await screen.findByRole('button', { name: removeFor('Simulacro Aneto') });
    expect(removeFor('Simulacro Aneto').startsWith(button.textContent ?? '')).toBe(true);
  });

  it('si la misión se cerró mientras tanto, lo dice', async () => {
    const { user } = setup({ [`DELETE /missions/m-open/routes/mr-open`]: () => apiError(409, 'MISSION_CLOSED') }, { data: detail({ usedIn: [open] }) });
    await user.click(await screen.findByRole('button', { name: removeFor('Simulacro Aneto') }));
    await user.click(screen.getByRole('button', { name: T.relations.removeYes }));
    expect(await screen.findByText(es.missionDetail.closedMeanwhile)).toBeTruthy();
  });

  it('el administrador ve «Usada en» sin ningún botón', async () => {
    setup({}, { user: admin(), data: detail({ usedIn: [open] }) });
    expect(await screen.findByRole('link', { name: 'Simulacro Aneto' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: removeFor('Simulacro Aneto') })).toBeNull();
  });
});

describe('administrador', () => {
  it('lee y exporta, pero no ve validar, versión nueva, derivar ni archivar', async () => {
    const { user } = setup({}, { user: admin() });
    await screen.findByText('5,6 km');
    expect(await menuItemNames(user, EXPORT)).toEqual([T.actions.exportGpx, T.actions.exportKml]);
    expect(screen.queryByRole('button', { name: T.actions.validate })).toBeNull();
    expect(screen.queryByRole('button', { name: MORE })).toBeNull();
    expect(screen.queryByRole('link', { name: T.actions.edit })).toBeNull();
  });
});
