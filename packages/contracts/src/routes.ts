// Rutas: biblioteca, versiones, cálculo, y rutas dentro de una misión (documento 02, §3.6, 4.3, 4.4).
// El servidor recalcula SIEMPRE métricas, altitudes y tramos: el cliente envía solo geometría (RN-10).
import { z } from 'zod';
import { Id, LatLon, QueryLat, QueryLon, LineString3D, LineStringInput, LineStringPreview, PageQuery, Paged, PersonRef, PolygonInput, TeamRef, Timestamp } from './common.js';
import { JobKind, JobStatus, MissionRouteStatus, MissionStatus, Provenance, RoadType, RouteStatus, VersionStatus } from './enums.js';

// ---------- Métricas ----------
export const RouteMetrics = z.strictObject({
  distanceM: z.number().min(0),
  ascentM: z.number().min(0),
  descentM: z.number().min(0),
  minElevationM: z.number(),
  maxElevationM: z.number(),
  maxSlopePct: z.number().min(0), // sin tiempo estimado (D-03)
});
/** Composición por tipo de vía. */
export const RoadMix = z.array(z.strictObject({ roadType: RoadType, distanceM: z.number().min(0) }));

/** Trazado propuesto, calculado pero NO guardado (dibujar, importar, adaptar). Para guardarlo se envía su `geometry`. */
export const CandidateRoute = z.strictObject({
  geometry: LineString3D,
  metrics: RouteMetrics,
  roadMix: RoadMix,
  offTrailShare: z.number().min(0).max(1), // proporción de tramo sin camino, para avisar al coordinador
});

// ---------- Biblioteca (solo personal) ----------
export const RouteVersionBrief = z.strictObject({
  id: Id,
  number: z.number().int().min(1),
  status: VersionStatus,
  metrics: RouteMetrics,
});
export const ValidatedBrief = z.strictObject({
  versionId: Id,
  number: z.number().int().min(1),
  validatedAt: Timestamp,
  isStale: z.boolean(), // RF-519: la validación supera N días (configuración de la organización)
});

export const RouteListItem = z.strictObject({
  id: Id,
  name: z.string(),
  status: RouteStatus,
  latestVersion: RouteVersionBrief,
  latestValidated: ValidatedBrief.nullable(),
  usedInMissions: z.number().int().min(0),
  derivedFromRouteId: Id.nullable(),
  previewGeometry: LineStringPreview,
  updatedAt: Timestamp,
});

const bbox = z
  .string()
  .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, 'minLon,minLat,maxLon,maxLat')
  .transform((s) => {
    const [minLon, minLat, maxLon, maxLat] = s.split(',').map(Number) as [number, number, number, number];
    return { minLon, minLat, maxLon, maxLat };
  })
  .refine((b) => b.minLon < b.maxLon && b.minLat < b.maxLat && b.minLat >= -90 && b.maxLat <= 90 && b.minLon >= -180 && b.maxLon <= 180, 'bbox fuera de rango');

export const ListRoutesQuery = PageQuery.extend({
  bbox: bbox.optional(), // área visible del mapa; si falta, toda la biblioteca
  q: z.string().trim().max(120).optional(),
  status: RouteStatus.default('active'),
  versionStatus: VersionStatus.optional(),
  minDistanceM: z.coerce.number().min(0).optional(),
  maxDistanceM: z.coerce.number().min(0).optional(),
  minAscentM: z.coerce.number().min(0).optional(),
  maxAscentM: z.coerce.number().min(0).optional(),
  validatedWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
  sort: z.enum(['updated_desc', 'name_asc', 'distance_asc', 'distance_desc', 'ascent_desc']).default('updated_desc'),
});
export const RoutesPage = Paged(RouteListItem);

// ---------- Detalle de ruta y de versión (solo personal) ----------
export const RouteVersion = z.strictObject({
  id: Id,
  number: z.number().int().min(1),
  status: VersionStatus,
  provenance: Provenance,
  manuallyModified: z.boolean(),
  metrics: RouteMetrics,
  roadMix: RoadMix,
  note: z.string().nullable(),
  createdBy: PersonRef,
  createdAt: Timestamp,
  validatedBy: PersonRef.nullable(),
  validatedAt: Timestamp.nullable(),
});

export const RouteDetail = z.strictObject({
  id: Id,
  name: z.string(),
  status: RouteStatus,
  versions: z.array(RouteVersion), // de la más nueva a la más antigua
  derivedFrom: z.strictObject({ routeId: Id, routeName: z.string(), versionNumber: z.number().int() }).nullable(),
  derivatives: z.array(z.strictObject({ id: Id, name: z.string() })),
  usedIn: z.array(z.strictObject({ missionId: Id, missionName: z.string(), missionStatus: MissionStatus, pinnedVersionNumber: z.number().int() })),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const RouteSegment = z.strictObject({
  position: z.number().int().min(0),
  roadType: RoadType,
  distanceM: z.number().min(0),
  ascentM: z.number().min(0),
  descentM: z.number().min(0),
});
/** Pares [distancia acumulada en m, altitud en m], ≤ 500 puntos, para dibujar el perfil. */
export const ElevationProfile = z
  .array(z.tuple([z.number().min(0), z.number()]))
  .min(2)
  .max(500);

export const RouteVersionDetail = RouteVersion.extend({
  geometry: LineString3D,
  segments: z.array(RouteSegment),
  elevationProfile: ElevationProfile,
});

// ---------- Crear rutas ----------
const AddToMission = z.strictObject({ missionId: Id, originPointId: Id.optional(), teamId: Id.optional() });

export const CreateRouteRequest = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('import'),
    name: z.string().trim().min(1).max(160),
    fileId: Id,
    note: z.string().trim().max(1000).optional(),
    addToMission: AddToMission.optional(),
  }),
  z.strictObject({
    source: z.literal('drawn'),
    name: z.string().trim().min(1).max(160),
    geometry: LineStringInput,
    note: z.string().trim().max(1000).optional(),
    addToMission: AddToMission.optional(),
  }),
]);

/** Respuesta común al crear una ruta o una versión. */
export const CreatedRoute = z.strictObject({ routeId: Id, versionId: Id, versionNumber: z.number().int(), missionRouteId: Id.nullable() });

export const CreateVersionRequest = z.strictObject({
  baseVersionId: Id,
  geometry: LineStringInput,
  note: z.string().trim().max(1000).optional(),
  /** Si el trazado viene de una adaptación (RF-515), se indica el trabajo para registrar la procedencia 'adapted'. */
  calculationJobId: Id.optional(),
});

/** Guardar como nueva ruta derivada (RF-517). Sin `geometry` se copia la versión de origen tal cual. */
export const DeriveRouteRequest = z.strictObject({
  name: z.string().trim().min(1).max(160),
  fromVersionId: Id,
  geometry: LineStringInput.optional(),
  note: z.string().trim().max(1000).optional(),
  calculationJobId: Id.optional(),
  addToMission: AddToMission.optional(),
});

export const ValidateVersionRequest = z.strictObject({
  /** El aviso de RF-506 ("es una propuesta y no sustituye el criterio del equipo") se confirma explícitamente. */
  acknowledged: z.literal(true),
});

export const SnapRequest = z.strictObject({
  points: z.array(LatLon).min(2).max(50),
});
export const ImportPreviewRequest = z.strictObject({ fileId: Id });
export const ImportPreview = z.strictObject({
  trackName: z.string().nullable(),
  candidate: CandidateRoute,
  waypointCount: z.number().int().min(0),
  warnings: z.array(z.enum(['elevation_recomputed', 'multiple_tracks_only_first_used', 'waypoints_ignored'])),
});

// ---------- Cálculo en segundo plano ----------
export const GenerateRoutesRequest = z.strictObject({
  from: LatLon,
  to: LatLon,
  via: z.array(LatLon).max(10).default([]),
  avoidZoneIds: z.array(Id).max(20).default([]),
  alternatives: z.number().int().min(1).max(4).default(3),
  namePrefix: z.string().trim().min(1).max(100).optional(),
  /** Si se genera desde una misión, las rutas resultantes se añaden a ella (§4.3-B). Exige que la misión tenga origen (RN-08). */
  addToMission: AddToMission.optional(),
});

/** Segunda entrega (RF-515). */
export const AdaptRouteRequest = z.strictObject({
  versionId: Id,
  cutPoint: LatLon, // el servidor lo proyecta sobre la ruta
  newEnd: LatLon,
  avoidZoneIds: z.array(Id).max(20).default([]),
});

export const JobAccepted = z.strictObject({ jobId: Id });

const JobBase = z.strictObject({
  id: Id,
  status: JobStatus,
  progress: z.number().int().min(0).max(100),
  errorCode: z.enum(['NO_ROUTE_POSSIBLE', 'OUTSIDE_COVERAGE', 'ROUTING_UNAVAILABLE', 'INTERNAL']).nullable(),
  createdAt: Timestamp,
  finishedAt: Timestamp.nullable(),
});
export const Job = z.discriminatedUnion('kind', [
  JobBase.extend({ kind: z.literal(JobKind.enum.generate), result: z.strictObject({ routeIds: z.array(Id) }).nullable() }),
  JobBase.extend({
    kind: z.literal(JobKind.enum.adapt),
    result: z.strictObject({ candidate: CandidateRoute, keptDistanceM: z.number().min(0) }).nullable(),
  }),
]);

// ---------- Zonas a evitar ----------
export const AvoidZone = z.strictObject({
  id: Id,
  missionId: Id.nullable(),
  geometry: PolygonInput,
  reason: z.string().nullable(),
  createdAt: Timestamp,
});
export const CreateAvoidZoneRequest = z.strictObject({
  missionId: Id.optional(),
  geometry: PolygonInput,
  reason: z.string().trim().max(300).optional(),
});
export const ListAvoidZonesQuery = z.strictObject({ missionId: Id.optional() });

// ---------- Búsqueda por punto (segunda entrega, RF-514) ----------
export const NearRoutesQuery = z.strictObject({
  lat: QueryLat,
  lon: QueryLon,
  radiusM: z.coerce.number().int().min(100).max(100000).default(5000),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const NearRouteItem = RouteListItem.extend({
  distanceToPointM: z.number().min(0),
  closestPoint: LatLon,
  withinRadius: z.boolean(),
});
export const NearRoutesResponse = z.strictObject({ items: z.array(NearRouteItem) });

// ---------- Rutas dentro de una misión ----------
export const AddMissionRoutesRequest = z.strictObject({
  items: z
    .array(
      z.strictObject({
        routeId: Id,
        versionId: Id.optional(), // por defecto, la última validada
        originPointId: Id.optional(),
        teamId: Id.optional(),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const UpdateMissionRouteRequest = z
  .strictObject({
    pinnedVersionId: Id.optional(),
    status: MissionRouteStatus.optional(),
    originPointId: Id.nullable().optional(),
    teamId: Id.nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Indica al menos un campo');

const PinnedVersion = z.strictObject({
  versionId: Id,
  number: z.number().int().min(1),
  status: VersionStatus,
  validatedAt: Timestamp.nullable(),
  metrics: RouteMetrics,
  roadMix: RoadMix,
});

/** Fila de "Rutas de la misión" para el coordinador: incluye borradores, nota y avisos de versión. */
export const MissionRouteStaff = z.strictObject({
  id: Id,
  routeId: Id,
  name: z.string(),
  status: MissionRouteStatus,
  pinned: PinnedVersion,
  newerValidatedVersion: z.strictObject({ versionId: Id, number: z.number().int() }).nullable(), // RF-518: la misión no se actualiza sola
  validationIsStale: z.boolean(),
  origin: z.strictObject({ id: Id, name: z.string() }).nullable(),
  team: TeamRef.nullable(),
  note: z.string().nullable(),
  previewGeometry: LineStringPreview,
  addedAt: Timestamp,
});
export const MissionRoutesStaff = z.strictObject({ items: z.array(MissionRouteStaff) });

/** Fila para el rescatista: SOLO versiones validadas (RN-03). Sin notas internas, sin borradores, sin quién validó. */
export const MissionRouteRescuer = z.strictObject({
  id: Id,
  routeId: Id,
  name: z.string(),
  status: MissionRouteStatus, // 'unavailable' se ve señalada, no desaparecida (RF-508)
  versionNumber: z.number().int().min(1),
  validatedAt: Timestamp,
  metrics: RouteMetrics,
  roadMix: RoadMix,
  origin: z.strictObject({ id: Id, name: z.string() }).nullable(),
  team: TeamRef.nullable(),
  previewGeometry: LineStringPreview,
});
export const MissionRoutesRescuer = z.strictObject({ items: z.array(MissionRouteRescuer) });

/** Detalle de una ruta de la misión (mapa y perfil). Mismo formato para ambos roles; el rescatista solo accede a validadas. */
export const MissionRouteGeometry = z.strictObject({
  missionRouteId: Id,
  versionNumber: z.number().int().min(1),
  geometry: LineString3D,
  segments: z.array(RouteSegment),
  elevationProfile: ElevationProfile,
});

export const ExportFormat = z.enum(['gpx', 'kml']);
export const ExportRouteQuery = z.strictObject({ versionId: Id.optional(), format: ExportFormat.default('gpx') });
/** Varias rutas de la biblioteca en un solo archivo (RF-511). Una `<trk>` por ruta, con su versión más reciente. */
export const ExportRoutesQuery = z.strictObject({
  ids: z.string().regex(/^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,49}$/, 'de 1 a 50 ids separados por comas'),
  format: ExportFormat.default('gpx'),
  validatedOnly: z.enum(['true', 'false']).default('false'), // true: la última versión validada de cada ruta (las que no tienen, se omiten)
});
export const ExportMissionRoutesQuery = z.strictObject({
  format: ExportFormat.default('gpx'),
  ids: z
    .string()
    .regex(/^[0-9a-f-]{36}(,[0-9a-f-]{36})*$/)
    .optional(), // mission_route ids; sin ellos, todas las exportables
});
