// Datos de prueba compartidos por las pruebas de «Rutas de la misión» (H4-T4, T5): una misión, sus filas y la geometría de una ruta.
import { sessionUser } from './support';

export const MISSION_ID = '44444444-4444-4444-8444-444444444444';
export const PATH = `/missions/${MISSION_ID}`;
export const COORDINATOR = { id: sessionUser().id, displayName: 'Coordinador Demo' };
export const allActions = { edit: true, activate: true, close: false, reopen: false, duplicate: true, manageParticipants: true, manageRoutes: true };
export const noActions = { edit: false, activate: false, close: false, reopen: false, duplicate: false, manageParticipants: false, manageRoutes: false };

export const mission = (overrides: Record<string, unknown> = {}) => ({
  id: MISSION_ID,
  name: 'Rescate en el Aneto',
  status: 'active',
  coordinator: COORDINATOR,
  target: { lat: 42.6335, lon: 0.1021, elevationM: 3404, label: null, country: null, source: 'coordinates' },
  origins: [{ id: 'p1', name: 'Refugio de la Renclusa' }],
  routes: { validated: 1, total: 2 },
  participants: { accepted: 0, pending: 0 },
  createdAt: '2026-10-31T09:00:00+00:00',
  updatedAt: '2026-10-31T09:00:00+00:00',
  description: null,
  activatedAt: '2026-10-31T10:00:00+00:00',
  closedAt: null,
  points: [{ id: 'p1', kind: 'origin', name: 'Refugio de la Renclusa', note: null, lat: 42.6, lon: 0.65, elevationM: 2140, position: 0 }],
  teams: [],
  readiness: { targetDefined: true, hasOrigins: true, hasParticipants: false, hasValidatedRoute: true },
  routesWithNewerValidatedVersion: 0,
  actions: allActions,
  ...overrides,
});

export const row = (n: number, name: string, overrides: Record<string, unknown> = {}, pinned: Record<string, unknown> = {}) => ({
  id: `0000000${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
  routeId: `0000000${n}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
  name,
  status: 'added',
  pinned: {
    versionId: `0000000${n}-cccc-4ccc-8ccc-cccccccccccc`,
    number: 1,
    status: 'validated',
    validatedAt: '2026-10-01T09:00:00.000Z',
    metrics: { distanceM: 12400 + n * 100, ascentM: 850, descentM: 420, minElevationM: 1520, maxElevationM: 2380, maxSlopePct: 21.4 },
    roadMix: [
      { roadType: 'track', distanceM: 8000 },
      { roadType: 'path', distanceM: 4400 },
    ],
    ...pinned,
  },
  newerValidatedVersion: null,
  validationIsStale: false,
  origin: { id: 'p1', name: 'Refugio de la Renclusa' },
  team: null,
  note: null,
  previewGeometry: {
    type: 'LineString',
    coordinates: [
      [0.65 + n / 100, 42.6],
      [0.66 + n / 100, 42.61],
    ],
  },
  addedAt: `2026-10-02T09:0${n}:00.000Z`,
  ...overrides,
});

export const geometryOf = (missionRouteId: string, versionNumber = 1) => ({
  missionRouteId,
  versionNumber,
  geometry: {
    type: 'LineString',
    coordinates: [
      [0.65, 42.6, 1520],
      [0.66, 42.61, 2380],
    ],
  },
  segments: [{ position: 0, roadType: 'track', distanceM: 12400, ascentM: 850, descentM: 420 }],
  elevationProfile: [
    [0, 1520],
    [6000, 1900],
    [12400, 2380],
  ],
});

/** Una ruta de la biblioteca tal como la lista `listRoutes`. */
export const libraryItem = (n: number, name: string, overrides: Record<string, unknown> = {}, latest: Record<string, unknown> = {}) => ({
  id: `0000000${n}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
  name,
  status: 'active',
  latestVersion: {
    id: `0000000${n}-dddd-4ddd-8ddd-dddddddddddd`,
    number: 1,
    status: 'validated',
    metrics: { distanceM: 8200 + n * 100, ascentM: 640, descentM: 300, minElevationM: 1400, maxElevationM: 2200, maxSlopePct: 18 },
    ...latest,
  },
  latestValidated: { versionId: `0000000${n}-dddd-4ddd-8ddd-dddddddddddd`, number: 1, validatedAt: '2026-10-01T09:00:00.000Z', isStale: false },
  usedInMissions: 0,
  derivedFromRouteId: null,
  previewGeometry: {
    type: 'LineString',
    coordinates: [
      [0.65, 42.6],
      [0.66, 42.61],
    ],
  },
  updatedAt: '2026-10-05T09:00:00.000Z',
  ...overrides,
});
export const libraryPage = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 10, total: items.length, ...extra });

/** El detalle de una ruta de la biblioteca (lo que lee el diálogo para ofrecer sus versiones): de la más nueva a la más antigua. */
export const routeDetailOf = (item: ReturnType<typeof libraryItem>, versions: { number: number; status: 'draft' | 'validated' }[]) => ({
  id: item.id,
  name: item.name,
  status: item.status,
  versions: versions.map((version) => ({
    id: `${item.id.slice(0, 8)}-v${version.number}-4eee-8eee-eeeeeeeeeeee`,
    number: version.number,
    status: version.status,
    provenance: 'drawn',
    manuallyModified: false,
    metrics: item.latestVersion.metrics,
    roadMix: [{ roadType: 'unknown', distanceM: item.latestVersion.metrics.distanceM }],
    note: null,
    createdBy: { id: sessionUser().id, displayName: 'Coordinador Demo' },
    createdAt: '2026-10-01T09:00:00.000Z',
    validatedBy: version.status === 'validated' ? { id: sessionUser().id, displayName: 'Coordinador Demo' } : null,
    validatedAt: version.status === 'validated' ? '2026-10-02T09:00:00.000Z' : null,
  })),
  derivedFrom: null,
  derivatives: [],
  usedIn: [],
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-03T09:00:00.000Z',
});
export const versionId = (item: { id: string }, number: number) => `${item.id.slice(0, 8)}-v${number}-4eee-8eee-eeeeeeeeeeee`;
