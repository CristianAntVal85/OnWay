// Importar una ruta desde una misión (H4-T5, RF-513 camino B, doc 02 §4.3): `?mission=` pasa `addToMission` a `createRoute`; la ruta queda en la
// biblioteca y en la misión con su versión 1 fijada. Una misión cerrada no admite rutas nuevas.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { apiError, json, renderApp, sessionServer, sessionUser, type Call } from './support';
import { MISSION_ID, mission, noActions } from './mission-fixtures';

vi.mock('../src/map', () => ({ MAP_LAYERS: [], MapView: () => <div data-testid="map" /> }));

const T = es.routeImport;
const M = T.mission;
const FILE = '55555555-aaaa-4aaa-8aaa-555555555555';
const NEW = '66666666-aaaa-4aaa-8aaa-666666666666';
const ORIGIN = { id: 'p1', kind: 'origin', name: 'Refugio de la Renclusa', note: null, lat: 42.6, lon: 0.65, elevationM: 2140, position: 0 };
const preview = () => ({
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
  waypointCount: 0,
  warnings: [],
});
const gpx = () => new File(['<gpx/>'], 'ruta.gpx', { type: 'application/gpx+xml' });

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;
function setup(options: { route?: string; mission?: Record<string, unknown>; language?: 'es' | 'fr'; extra?: Handlers } = {}) {
  const language = options.language ?? 'es';
  const server = sessionServer(
    { user: sessionUser({ locale: language }) },
    {
      [`GET /missions/${MISSION_ID}`]: () => json(200, mission({ points: [ORIGIN], ...options.mission })),
      [`GET /missions/${MISSION_ID}/routes`]: () => json(200, { items: [] }),
      [`GET /missions/${MISSION_ID}/history`]: () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }),
      'POST /files': () => json(201, { id: FILE, purpose: 'route_import', contentType: 'application/gpx+xml', sizeBytes: 6, createdAt: '2026-10-31T09:00:00.000Z' }),
      'POST /routes/import/preview': () => json(200, preview()),
      'POST /routes': () => json(201, { routeId: NEW, versionId: 'v', versionNumber: 1, missionRouteId: 'mr' }),
      'GET /geo/elevation': () => json(200, { lat: 42.6, lon: 0.65, elevationM: 2140 }),
      ...options.extra,
    },
  );
  const view = renderApp({ route: options.route ?? `/routes/import?mission=${MISSION_ID}`, fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}
const upload = async (user: ReturnType<typeof setup>['user']) => {
  await user.upload(await screen.findByLabelText(T.fileLabel), gpx());
  await user.click(screen.getByRole('button', { name: T.submit }));
};
const creates = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === '/routes');

describe('importar desde una misión (?mission=)', () => {
  it('avisa de que la ruta se añadirá a la misión, con su versión 1 fijada, y ofrece sus orígenes', async () => {
    const { user } = setup();
    await upload(user);
    expect(await screen.findByText(M.notice.replace('{{name}}', 'Rescate en el Aneto'))).toBeTruthy();
    const origin = screen.getByLabelText(M.origin) as HTMLSelectElement;
    expect(
      within(origin)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([M.noOrigin, 'Refugio de la Renclusa']);
    expect(screen.getByRole('link', { name: M.back }).getAttribute('href')).toBe(`/missions/${MISSION_ID}`);
  });

  it('al guardar manda `addToMission` con la misión y el origen elegido, y vuelve a la misión anunciando que se añadió', async () => {
    const { user, calls } = setup();
    await upload(user);
    await screen.findByText(T.previewNothingSaved);
    await user.selectOptions(screen.getByLabelText(M.origin), 'p1');
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(creates(calls())).toHaveLength(1));
    expect(creates(calls())[0]!.body).toEqual({ source: 'import', name: 'Sendero ficticio', fileId: FILE, addToMission: { missionId: MISSION_ID, originPointId: 'p1' } });
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe(`/missions/${MISSION_ID}`));
    expect(await screen.findByText(M.added.replace('{{name}}', 'Sendero ficticio'))).toBeTruthy();
  });

  it('sin origen elegido manda solo la misión', async () => {
    const { user, calls } = setup();
    await upload(user);
    await screen.findByText(T.previewNothingSaved);
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(creates(calls())).toHaveLength(1));
    expect(creates(calls())[0]!.body).toMatchObject({ addToMission: { missionId: MISSION_ID } });
    expect((creates(calls())[0]!.body as { addToMission: Record<string, unknown> }).addToMission).toEqual({ missionId: MISSION_ID });
  });

  it('si el servidor rechaza añadirla (la misión se cerró), lo dice y no cambia de página', async () => {
    const { user } = setup({ extra: { 'POST /routes': () => apiError(409, 'MISSION_CLOSED') } });
    await upload(user);
    await screen.findByText(T.previewNothingSaved);
    await user.click(screen.getByRole('button', { name: T.save }));
    expect(await screen.findByText(es.errors.MISSION_CLOSED)).toBeTruthy();
    expect(screen.getByTestId('path').textContent).toBe('/routes/import');
  });

  it('una misión cerrada no admite rutas nuevas: se dice y no se ofrece subir nada', async () => {
    const { calls } = setup({ mission: { status: 'closed', actions: noActions } });
    expect(await screen.findByText(M.closed.replace('{{name}}', 'Rescate en el Aneto'))).toBeTruthy();
    expect(screen.queryByLabelText(T.fileLabel)).toBeNull();
    expect(calls().some((c) => c.path === '/files')).toBe(false);
  });

  it('una misión que no existe se dice con su error', async () => {
    setup({ extra: { [`GET /missions/${MISSION_ID}`]: () => apiError(404, 'NOT_FOUND') } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByLabelText(T.fileLabel)).toBeNull();
  });

  it('sin `?mission=` todo sigue como antes: sin aviso, sin origen y sin `addToMission`', async () => {
    const { user, calls } = setup({ route: '/routes/import' });
    await upload(user);
    await screen.findByText(T.previewNothingSaved);
    expect(screen.queryByLabelText(M.origin)).toBeNull();
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(creates(calls())).toHaveLength(1));
    expect(creates(calls())[0]!.body).toEqual({ source: 'import', name: 'Sendero ficticio', fileId: FILE });
    expect(calls().some((c) => c.path === `/missions/${MISSION_ID}`)).toBe(false);
  });

  it('en francés', async () => {
    const { user } = setup({ language: 'fr' });
    await user.upload(await screen.findByLabelText(fr.routeImport.fileLabel), gpx());
    await user.click(screen.getByRole('button', { name: fr.routeImport.submit }));
    expect(await screen.findByText(fr.routeImport.mission.notice.replace('{{name}}', 'Rescate en el Aneto'))).toBeTruthy();
  });
});
