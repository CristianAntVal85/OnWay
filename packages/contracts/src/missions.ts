// Misiones, puntos y ciclo de vida (documento 02, §3.3–3.5, 4.2, 4.5).
// Hay DOS familias de esquemas: la del personal (coordinador y administrador) y la del rescatista (/my/...). No comparten tipos de respuesta a propósito.
import { z } from 'zod';
import { CountryCode, GeoPoint, Id, LatLon, PageQuery, Paged, PersonRef, TeamRef, Timestamp } from './common.js';
import { MissionStatus, ParticipationStatus, PointKind, TargetSource } from './enums.js';

// ---------- Entrada de ubicaciones ----------
/** Las tres formas de entrada (RF-401) llegan aquí ya resueltas a coordenadas. La altitud la pone el servidor. */
export const TargetInput = z
  .strictObject({
    source: TargetSource,
    lat: LatLon.shape.lat,
    lon: LatLon.shape.lon,
    label: z.string().trim().min(1).max(200).optional(),
    country: CountryCode.optional(),
  })
  .refine((t) => t.source !== 'address' || !!t.label, { path: ['label'], message: 'Una dirección elegida lleva su etiqueta' });

export const Target = z.strictObject({
  lat: GeoPoint.shape.lat,
  lon: GeoPoint.shape.lon,
  elevationM: GeoPoint.shape.elevationM,
  label: z.string().nullable(),
  country: CountryCode.nullable(),
  source: TargetSource,
});

export const PointInput = z.strictObject({
  kind: PointKind,
  name: z.string().trim().min(1).max(120),
  note: z.string().trim().max(1000).optional(),
  lat: LatLon.shape.lat,
  lon: LatLon.shape.lon,
});
export const OriginInput = PointInput.omit({ kind: true });
export const UpdatePointRequest = PointInput.partial()
  .extend({ position: z.number().int().min(0).optional() })
  .refine((v) => Object.keys(v).length > 0, 'Indica al menos un campo');

export const MissionPoint = z.strictObject({
  id: Id,
  kind: PointKind,
  name: z.string(),
  note: z.string().nullable(),
  lat: GeoPoint.shape.lat,
  lon: GeoPoint.shape.lon,
  elevationM: GeoPoint.shape.elevationM,
  position: z.number().int(),
});

export const ImportPointsRequest = z.strictObject({ fileId: Id, kind: PointKind });

// ---------- Crear y editar ----------
const MissionName = z.string().trim().min(3).max(120);

export const CreateMissionRequest = z.strictObject({
  name: MissionName,
  coordinatorId: Id.optional(), // por defecto, quien crea
  target: TargetInput,
  description: z.string().trim().max(4000).optional(),
  teamIds: z.array(Id).max(50).default([]),
  rescuerIds: z.array(Id).max(200).default([]),
  origins: z.array(OriginInput).max(20).default([]),
  routes: z.array(z.strictObject({ routeId: Id, versionId: Id.optional() })).max(20).default([]),
});

export const UpdateMissionRequest = z
  .strictObject({
    name: MissionName.optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    coordinatorId: Id.optional(),
    target: TargetInput.optional(),
    /** Control de edición simultánea (Q-10): si la misión cambió desde que se leyó, 409 STALE_RESOURCE. */
    expectedUpdatedAt: Timestamp.optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'expectedUpdatedAt'), 'Indica al menos un campo');

export const DuplicateMissionRequest = z.strictObject({ name: MissionName, includeRoutes: z.boolean().default(true) });

export const ActivateMissionRequest = z.strictObject({
  /** Activar sin rutas validadas avisa pero se permite (§4.5): el cliente confirma con true tras el aviso CONFIRMATION_REQUIRED. */
  confirmWithoutValidatedRoute: z.boolean().default(false),
});

/** Cierre (RF-208, D-27). Debe incluir a TODOS los aceptados; con cero aceptados, lista vacía. */
export const CloseMissionRequest = z
  .strictObject({
    attendance: z.array(z.strictObject({ participationId: Id, participated: z.boolean() })).max(500),
  })
  .refine((v) => new Set(v.attendance.map((a) => a.participationId)).size === v.attendance.length, {
    path: ['attendance'],
    message: 'Participación repetida',
  });

// ---------- Listas (personal) ----------
export const MissionTab = z.enum(['planning', 'active', 'closed']);
export const ListMissionsQuery = PageQuery.extend({
  status: MissionTab.optional(),
  q: z.string().trim().max(120).optional(),
  coordinatorId: Id.optional(),
});

export const MissionListItem = z.strictObject({
  id: Id,
  name: z.string(),
  status: MissionStatus,
  coordinator: PersonRef.nullable(), // null = sin responsable (RN-11)
  target: Target,
  origins: z.array(z.strictObject({ id: Id, name: z.string() })),
  routes: z.strictObject({ validated: z.number().int(), total: z.number().int() }),
  participants: z.strictObject({ accepted: z.number().int(), pending: z.number().int() }),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export const MissionsPage = Paged(MissionListItem);

// ---------- Detalle (personal) ----------
export const Readiness = z.strictObject({
  targetDefined: z.boolean(),
  hasOrigins: z.boolean(),
  hasParticipants: z.boolean(),
  hasValidatedRoute: z.boolean(),
});

/** Lo que el usuario actual puede hacer ahora mismo. Los permisos viven en el servidor; la web solo pinta botones (RF-103). */
export const MissionActions = z.strictObject({
  edit: z.boolean(),
  activate: z.boolean(),
  close: z.boolean(),
  reopen: z.boolean(),
  duplicate: z.boolean(),
  manageParticipants: z.boolean(),
  manageRoutes: z.boolean(),
});

export const MissionDetail = MissionListItem.extend({
  description: z.string().nullable(),
  activatedAt: Timestamp.nullable(),
  closedAt: Timestamp.nullable(),
  points: z.array(MissionPoint),
  teams: z.array(TeamRef),
  readiness: Readiness,
  routesWithNewerValidatedVersion: z.number().int().min(0), // RF-518
  actions: MissionActions,
});

export const MissionHistoryAction = z.enum([
  'mission_created', 'mission_updated', 'mission_activated', 'mission_closed', 'mission_reopened',
  'point_added', 'point_updated', 'point_removed',
  'team_added', 'team_removed',
  'participation_offered', 'participation_withdrawn', 'participation_accepted', 'participation_rejected',
  'participation_reconsidered', 'participation_removed', 'participation_added',
  'route_added', 'route_removed', 'route_version_changed', 'route_marked_unavailable', 'route_reactivated',
  'route_version_validated',
]);
export const MissionHistoryItem = z.strictObject({
  id: z.number().int(),
  occurredAt: Timestamp,
  action: MissionHistoryAction,
  actor: PersonRef.nullable(),
  summary: z.string().nullable(), // texto corto ya compuesto: nombre de la ruta, del punto…
});
export const MissionHistoryPage = Paged(MissionHistoryItem);

// ---------- Rescatista (/my/missions) ----------
export const MyMissionTab = z.enum(['active', 'closed']);
export const ListMyMissionsQuery = PageQuery.extend({ status: MyMissionTab.optional(), q: z.string().trim().max(120).optional() });

/** Estado de MI oferta en una misión. Es lo único personal que aparece en esta lista. */
export const MyParticipation = z.strictObject({
  status: ParticipationStatus,
  offeredAt: Timestamp.nullable(),
  decidedAt: Timestamp.nullable(),
});

export const MyMissionListItem = z.strictObject({
  id: Id,
  name: z.string(),
  status: z.enum(['active', 'closed']), // nunca planning (RN-16)
  target: Target,
  coordinatorName: z.string().nullable(),
  validatedRoutes: z.number().int().min(0),
  myParticipation: MyParticipation.nullable(),
});
export const MyMissionsPage = Paged(MyMissionListItem);

export const OfferBlockedReason = z.enum(['profile_incomplete', 'mission_not_active', 'already_offered']);

export const MyMissionDetail = z.strictObject({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['active', 'closed']),
  target: Target,
  coordinatorName: z.string().nullable(),
  points: z.array(MissionPoint),
  myParticipation: MyParticipation.nullable(),
  canOffer: z.boolean(),
  canWithdraw: z.boolean(),
  offerBlockedReason: OfferBlockedReason.nullable(),
});
