// Enumeraciones del dominio. Los valores son IDÉNTICOS a los tipos ENUM de db/migrations (hay una prueba que lo comprueba).
import { z } from 'zod';

export const AccountStatus = z.enum(['pending', 'active', 'rejected', 'disabled']);
export const MemberRole = z.enum(['coordinator', 'rescuer', 'admin']);
export const MemberStatus = z.enum(['active', 'disabled']);
export const RequestStatus = z.enum(['pending', 'approved', 'rejected']);

export const FilePurpose = z.enum(['certificate', 'route_import']);
export const ProfileStatus = z.enum(['incomplete', 'complete', 'deleted']);
export const SkillKind = z.enum(['course', 'skill']);
export const DocumentType = z.enum(['dni', 'nie', 'passport', 'other']);
export const TeamStatus = z.enum(['active', 'archived']);

export const MissionStatus = z.enum(['planning', 'active', 'closed']);
export const PointKind = z.enum(['origin', 'waypoint', 'rendezvous']);
export const TargetSource = z.enum(['coordinates', 'map', 'address']);
export const ParticipationStatus = z.enum(['pending', 'accepted', 'not_selected', 'withdrawn', 'removed']);
export const ParticipationOrigin = z.enum(['volunteer', 'team', 'coordinator']);

export const RouteStatus = z.enum(['active', 'archived']);
export const VersionStatus = z.enum(['draft', 'validated']);
export const Provenance = z.enum(['generated', 'imported', 'drawn', 'edited', 'adapted']);
export const RoadType = z.enum(['road', 'track', 'path', 'offtrail']);
export const MissionRouteStatus = z.enum(['added', 'unavailable']);
export const JobKind = z.enum(['generate', 'adapt']);
export const JobStatus = z.enum(['pending', 'running', 'completed', 'failed']);

/** Idiomas de la interfaz. Coincide con el CHECK de users.locale. */
export const Locale = z.enum(['es', 'fr']);

/** Mapa nombre del tipo SQL → esquema Zod. Lo usa la prueba de paridad con las migraciones. */
export const SQL_ENUMS = {
  account_status: AccountStatus,
  member_role: MemberRole,
  member_status: MemberStatus,
  request_status: RequestStatus,
  file_purpose: FilePurpose,
  profile_status: ProfileStatus,
  skill_kind: SkillKind,
  document_type: DocumentType,
  team_status: TeamStatus,
  mission_status: MissionStatus,
  point_kind: PointKind,
  target_source: TargetSource,
  participation_status: ParticipationStatus,
  participation_origin: ParticipationOrigin,
  route_status: RouteStatus,
  version_status: VersionStatus,
  provenance: Provenance,
  road_type: RoadType,
  mission_route_status: MissionRouteStatus,
  job_kind: JobKind,
  job_status: JobStatus,
} as const;

export type MemberRole = z.infer<typeof MemberRole>;
export type MissionStatus = z.infer<typeof MissionStatus>;
export type ParticipationStatus = z.infer<typeof ParticipationStatus>;
