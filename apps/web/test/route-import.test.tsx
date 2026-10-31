// Importar una ruta (H2-T9, RF-510): elegir archivo, vista previa del servidor, nombre y guardar; cada error del archivo se dice y no guarda nada.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es } from '@onway/i18n';
import { admin, apiError, json, renderApp, sessionServer, sessionUser, type Call } from './support';

vi.mock('../src/map', () => ({
  MAP_LAYERS: [],
  MapView: (props: { routes?: { id: string; tone: string; line: unknown[] }[] }) => (
    <div data-testid="map">
      {props.routes?.map((r) => (
        <span key={r.id} data-testid={`line-${r.tone}`}>
          {r.line.length}
        </span>
      ))}
    </div>
  ),
}));

const T = es.routeImport;
const FILE = '55555555-aaaa-4aaa-8aaa-555555555555';
const NEW = '66666666-aaaa-4aaa-8aaa-666666666666';
const preview = (overrides: Record<string, unknown> = {}) => ({
  trackName: 'Sendero ficticio',
  candidate: {
    geometry: {
      type: 'LineString',
      coordinates: [
        [0.6, 42.6, 1500],
        [0.61, 42.61, 1600],
      ],
    },
    metrics: { distanceM: 4200, ascentM: 310, descentM: 90, minElevationM: 1500, maxElevationM: 1810, maxSlopePct: 14 },
    roadMix: [{ roadType: 'unknown', distanceM: 4200 }],
    offTrailShare: 0,
  },
  waypointCount: 2,
  warnings: ['elevation_recomputed', 'waypoints_ignored'],
  ...overrides,
});
const gpx = (name = 'ruta.gpx', size?: number) => {
  const file = new File(['<gpx/>'], name, { type: 'application/gpx+xml' });
  if (size) Object.defineProperty(file, 'size', { value: size });
  return file;
};

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;
function setup(extra: Handlers = {}, user = sessionUser()) {
  const server = sessionServer(
    { user },
    {
      'POST /files': () => json(201, { id: FILE, purpose: 'route_import', contentType: 'application/gpx+xml', sizeBytes: 6, createdAt: '2026-10-31T09:00:00.000Z' }),
      'POST /routes/import/preview': () => json(200, preview()),
      ...extra,
    },
  );
  const view = renderApp({ route: '/routes/import', fetch: server.api.fetch });
  return { ...server, ...view, calls: () => server.api.calls };
}
const upload = async (user: ReturnType<typeof setup>['user'], file: File) => {
  await user.upload(await screen.findByLabelText(T.fileLabel), file);
  await user.click(screen.getByRole('button', { name: T.submit }));
};
const writes = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === '/routes');

describe('importar una ruta: archivo, vista previa y guardar', () => {
  it('sube el archivo, enseña la vista previa con los datos del servidor y los avisos, y no guarda nada hasta pulsar «Guardar»', async () => {
    const { user, calls } = setup({ 'POST /routes': () => json(201, { routeId: NEW, versionId: 'v', versionNumber: 1, missionRouteId: null }) });
    await upload(user, gpx());
    expect(await screen.findByText(T.previewNothingSaved)).toBeTruthy();
    expect(screen.getByText('4,2 km')).toBeTruthy();
    expect(screen.getByText('310 m')).toBeTruthy();
    expect(screen.getByText(T.warnings.elevation_recomputed)).toBeTruthy();
    expect(screen.getByText(T.warnings.waypoints_ignored)).toBeTruthy();
    expect(screen.getByTestId('line-draft')).toBeTruthy();
    expect(writes(calls())).toHaveLength(0);
    // El nombre de la pista se propone como nombre de la ruta.
    expect((screen.getByLabelText(T.nameLabel) as HTMLInputElement).value).toBe('Sendero ficticio');

    await user.clear(screen.getByLabelText(T.nameLabel));
    await user.click(screen.getByRole('button', { name: T.save }));
    expect(screen.getByText(T.nameRequired)).toBeTruthy();
    expect(writes(calls())).toHaveLength(0);
    await user.type(screen.getByLabelText(T.nameLabel), 'Mi importación');
    await user.type(screen.getByLabelText(T.noteLabel), 'de prueba');
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(writes(calls())).toHaveLength(1));
    expect(writes(calls())[0]!.body).toEqual({ source: 'import', name: 'Mi importación', fileId: FILE, note: 'de prueba' });
  });

  it('sin archivo, o con uno de más de 10 MB, lo dice sin subir nada', async () => {
    const { user, calls } = setup();
    await user.click(await screen.findByRole('button', { name: T.submit }));
    expect(screen.getByText(T.noFile)).toBeTruthy();
    await upload(user, gpx('grande.gpx', 11 * 1024 * 1024));
    expect(screen.getByText(T.tooLarge)).toBeTruthy();
    expect(calls().some((c) => c.path === '/files')).toBe(false);
  });

  it.each([
    ['FILE_TOO_LARGE', 413, es.errors.FILE_TOO_LARGE],
    ['UNSUPPORTED_FILE_TYPE', 415, es.errors.UNSUPPORTED_FILE_TYPE],
    ['INVALID_FILE_CONTENT', 422, es.errors.INVALID_FILE_CONTENT],
  ] as const)('%s al subir: se dice con su texto, no hay vista previa y no se guarda nada', async (code, status, text) => {
    const { user, calls } = setup({ 'POST /files': () => apiError(status, code) });
    await upload(user, gpx());
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByText(T.previewNothingSaved)).toBeNull();
    expect(calls().some((c) => c.path === '/routes/import/preview')).toBe(false);
    expect(writes(calls())).toHaveLength(0);
  });

  it('un 413 del proxy, que no sigue el formato de errores, también es «demasiado grande»', async () => {
    const { user } = setup({ 'POST /files': () => new Response('<html>too large</html>', { status: 413 }) });
    await upload(user, gpx());
    expect(await screen.findByText(es.errors.FILE_TOO_LARGE)).toBeTruthy();
  });

  it('OUTSIDE_COVERAGE en la vista previa: lo dice y deja elegir otro archivo', async () => {
    const { user } = setup({ 'POST /routes/import/preview': () => apiError(422, 'OUTSIDE_COVERAGE') });
    await upload(user, gpx());
    expect(await screen.findByText(es.errors.OUTSIDE_COVERAGE)).toBeTruthy();
    expect(screen.getByLabelText(T.fileLabel)).toBeTruthy();
  });

  it('«Elegir otro archivo» vuelve al primer paso sin guardar', async () => {
    const { user, calls } = setup();
    await upload(user, gpx());
    await user.click(await screen.findByRole('button', { name: T.changeFile }));
    expect(await screen.findByLabelText(T.fileLabel)).toBeTruthy();
    expect(writes(calls())).toHaveLength(0);
  });

  it('el administrador no puede importar: «sin acceso»', async () => {
    setup({}, admin());
    expect(await screen.findByText(es.forbidden.title)).toBeTruthy();
    expect(screen.queryByLabelText(T.fileLabel)).toBeNull();
  });

  it('un error al guardar se dice dentro del formulario', async () => {
    const { user } = setup({ 'POST /routes': () => apiError(404, 'NOT_FOUND') });
    await upload(user, gpx());
    await user.click(await screen.findByRole('button', { name: T.save }));
    const alert = await screen.findByRole('alert');
    expect(within(alert.closest('form')!).getByRole('alert')).toBeTruthy();
  });
});
