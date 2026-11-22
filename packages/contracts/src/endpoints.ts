// REGISTRO DE ENDPOINTS: la fuente única de rutas, roles, esquemas y errores.
// De aquí salen la tabla del documento 06, el OpenAPI y (en apps/api) la comprobación de que cada controlador cumple su contrato.
import { z } from 'zod';
import { ERROR_HTTP, ErrorCode } from './errors.js';
import { Empty, Id, Ok, PageQuery } from './common.js';
import * as A from './auth.js';
import * as P from './profile.js';
import * as F from './files.js';
import * as T from './teams.js';
import * as M from './missions.js';
import * as PA from './participations.js';
import * as R from './routes.js';
import * as E from './environment.js';
import * as AD from './admin.js';
import { MILESTONE_OF, type Milestone } from './milestones.js';

export type Role = 'public' | 'pending' | 'rescuer' | 'coordinator' | 'admin';
export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface Endpoint {
  /** operationId del OpenAPI y nombre del método del cliente generado. */
  id: string;
  method: Method;
  /** Ruta relativa a /api/v1, con {parámetros}. */
  path: string;
  tag: string;
  summary: string;
  /** Roles que pueden llamar. 'public' = sin sesión. 'pending' = con sesión pero cuenta sin aprobar. */
  roles: readonly Role[];
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Campos de formulario cuando el cuerpo es multipart/form-data (el archivo va en `file`). */
  multipart?: z.ZodObject;
  response: { status: 200 | 201 | 202 | 204; schema?: z.ZodType; file?: string };
  /** Errores propios del endpoint, además de los transversales. */
  errors?: readonly ErrorCode[];
  /** Hito en que se construye (documento 07). Se rellena desde `MILESTONE_OF`. */
  milestone: Milestone;
  /** 1 = primera entrega; 2 = segunda entrega (el contrato existe, el servidor responde 501 hasta entonces); 'pendiente' = bloqueado por una decisión. */
  delivery: 1 | 2 | 'pendiente';
  /** Si la operación deja huella en audit_log. */
  audited?: boolean;
  notes?: string;
}

// ---------- Grupos de roles (un solo sitio para cambiar permisos) ----------
const ALL: Role[] = ['rescuer', 'coordinator', 'admin'];
const SESSION: Role[] = ['pending', ...ALL];
const STAFF: Role[] = ['coordinator', 'admin'];
/** Q-14 = no (resuelta 2026-10-31): el administrador lee misiones y rutas pero no las escribe. Cambiarlo exige también las políticas de la base (migración 0011) y INV-03, no solo esta constante. */
const MISSION_WRITERS: Role[] = ['coordinator'];
/** Q-12 (propuesto): administrador y coordinador gestionan equipos. */
const TEAM_MANAGERS: Role[] = ['coordinator', 'admin'];

// ---------- Parámetros de ruta ----------
const p = {
  mission: z.strictObject({ missionId: Id }),
  missionPoint: z.strictObject({ missionId: Id, pointId: Id }),
  missionTeam: z.strictObject({ missionId: Id, teamId: Id }),
  participation: z.strictObject({ missionId: Id, participationId: Id }),
  missionRoute: z.strictObject({ missionId: Id, missionRouteId: Id }),
  route: z.strictObject({ routeId: Id }),
  version: z.strictObject({ routeId: Id, versionId: Id }),
  team: z.strictObject({ teamId: Id }),
  teamMember: z.strictObject({ teamId: Id, userId: Id }),
  skill: z.strictObject({ skillId: Id }),
  certificateToken: z.strictObject({ token: z.string().min(1).max(512) }),
  user: z.strictObject({ userId: Id }),
  job: z.strictObject({ jobId: Id }),
  zone: z.strictObject({ zoneId: Id }),
};

const Health = z.strictObject({
  status: z.enum(['ok', 'degraded']),
  checks: z.strictObject({
    database: z.boolean(),
    routingEngine: z.boolean(),
    weatherProvider: z.boolean(),
  }),
});

const Items = <T extends z.ZodType>(t: T) => z.strictObject({ items: z.array(t) });

// Una operación por línea, como en el documento 06.
// prettier-ignore
const RAW = [
  // ================= Sistema =================
  { id: 'getHealth', method: 'GET', path: '/health', tag: 'Sistema', summary: 'Estado del servicio y de sus dependencias', roles: ['public'], response: { status: 200, schema: Health }, delivery: 1,
    notes: 'Lo consulta el comprobador externo. 200 aunque una dependencia falle (status "degraded"): la degradación es controlada. La base de datos se comprueba con SELECT 1 sin contexto de usuario. weatherProvider es pasivo (D-H1-12): refleja la última llamada real al proveedor del tiempo y nunca provoca una llamada solo para la salud; vale false únicamente si esa llamada falló en los últimos 30 minutos, y entonces status pasa a degraded. routingEngine vale false mientras no exista su adaptador (puerto RoutingProvider) y no degrada status hasta que lo haya.' },

  // ================= Acceso =================
  { id: 'register', method: 'POST', path: '/auth/register', tag: 'Acceso', summary: 'Solicitar el alta con código de invitación', roles: ['public'],
    body: A.RegisterRequest, response: { status: 202, schema: A.RegisterResponse }, errors: ['REGISTRATION_FAILED'], delivery: 1, audited: true,
    notes: 'Código inválido y correo ya registrado devuelven el mismo REGISTRATION_FAILED. Nunca concede rol (RN-25): crea una cuenta pendiente, sin sesión. Límite de peticiones por IP y operación: 429 RATE_LIMITED con retryAfterSeconds.' },
  { id: 'login', method: 'POST', path: '/auth/login', tag: 'Acceso', summary: 'Iniciar sesión (cookie de sesión + token CSRF)', roles: ['public'],
    body: A.LoginRequest, response: { status: 200, schema: A.LoginResponse }, errors: ['INVALID_CREDENTIALS', 'ACCOUNT_LOCKED', 'ACCOUNT_DISABLED', 'ACCOUNT_REJECTED'], delivery: 1,
    notes: 'Una cuenta pendiente SÍ inicia sesión: la respuesta trae nextStep = awaiting-approval y no puede llamar a nada más que /auth/me y /auth/logout.' },
  { id: 'logout', method: 'POST', path: '/auth/logout', tag: 'Acceso', summary: 'Cerrar sesión', roles: SESSION, response: { status: 204 }, delivery: 1 },
  { id: 'getMe', method: 'GET', path: '/auth/me', tag: 'Acceso', summary: 'Usuario de la sesión actual y a dónde debe ir la web', roles: SESSION,
    response: { status: 200, schema: A.MeResponse }, errors: ['SESSION_EXPIRED'], delivery: 1 },
  { id: 'updateMe', method: 'PATCH', path: '/auth/me', tag: 'Acceso', summary: 'Cambiar nombre visible o idioma', roles: ALL,
    body: A.UpdateMeRequest, response: { status: 200, schema: A.MeResponse }, delivery: 1,
    notes: '`locale` es el idioma de la cuenta: el de los correos y el inicial de la web. El rol y el correo no se cambian aquí (cuerpo estricto: `VALIDATION_FAILED`).' },
  { id: 'changePassword', method: 'POST', path: '/auth/password/change', tag: 'Acceso', summary: 'Cambiar la contraseña (cierra las demás sesiones)', roles: ALL,
    body: A.ChangePasswordRequest, response: { status: 204 }, errors: ['INVALID_CREDENTIALS', 'ACCOUNT_LOCKED'], delivery: 1, audited: true,
    notes: 'Mantiene la sesión actual y cierra todas las demás. Una contraseña actual errónea responde `INVALID_CREDENTIALS` y cuenta como intento fallido, con el mismo bloqueo que el inicio de sesión (`ACCOUNT_LOCKED` con retryAfterSeconds).' },
  { id: 'forgotPassword', method: 'POST', path: '/auth/password/forgot', tag: 'Acceso', summary: 'Pedir enlace para restablecer contraseña', roles: ['public'],
    body: A.ForgotPasswordRequest, response: { status: 202, schema: Ok }, delivery: 1, audited: false,
    notes: 'Responde siempre 202, exista o no el correo. Envía por el puerto Mailer un enlace con un token de un solo uso que caduca en 1 h (auth_request_password_reset; máx. 3 por hora y cuenta). El enlace es PUBLIC_BASE_URL/reset-password#token=<token>: el token viaja en el fragmento, que el navegador no envía al servidor. Límite de peticiones por IP y operación: 429 RATE_LIMITED con retryAfterSeconds.' },
  { id: 'resetPassword', method: 'POST', path: '/auth/password/reset', tag: 'Acceso', summary: 'Restablecer la contraseña con el token recibido', roles: ['public'],
    body: A.ResetPasswordRequest, response: { status: 204 }, errors: ['INVALID_RESET_TOKEN'], delivery: 1, audited: true,
    notes: 'Cierra todas las sesiones y quita el bloqueo por intentos (auth_consume_password_reset). Token inexistente, usado, caducado o mal formado (también demasiado corto o largo): el mismo error 422 INVALID_RESET_TOKEN. La contraseña nueva cumple el mismo esquema que la del registro; si no lo cumple, 400 VALIDATION_FAILED y el token no se consume. Límite de peticiones por IP y operación: 429 RATE_LIMITED con retryAfterSeconds.' },

  // ================= Organización =================
  { id: 'getOrganization', method: 'GET', path: '/org', tag: 'Organización', summary: 'Datos y configuración de mi organización', roles: ALL,
    response: { status: 200, schema: AD.OrgInfo }, delivery: 1 },
  { id: 'listCoordinators', method: 'GET', path: '/org/coordinators', tag: 'Organización', summary: 'Coordinadores activos (selector «Coordinador responsable»)', roles: STAFF,
    response: { status: 200, schema: Items(T.CoordinatorOption) }, delivery: 1 },

  // ================= Mapa: búsqueda y altitud =================
  { id: 'geocode', method: 'GET', path: '/geo/geocode', tag: 'Geo', summary: 'Buscar una dirección (solo al pulsar buscar)', roles: STAFF,
    query: E.GeocodeQuery, response: { status: 200, schema: E.GeocodeResponse }, errors: ['UPSTREAM_UNAVAILABLE'], delivery: 1,
    notes: 'Límite estricto hacia Nominatim: 1 petición/s en servidor y caché. 429 RATE_LIMITED con retryAfterSeconds.' },
  { id: 'getElevation', method: 'GET', path: '/geo/elevation', tag: 'Geo', summary: 'Altitud de un punto', roles: STAFF,
    query: E.ElevationQuery, response: { status: 200, schema: E.ElevationResponse }, errors: ['OUTSIDE_COVERAGE'], delivery: 1 },
  { id: 'getEnvironment', method: 'GET', path: '/environment', tag: 'Inicio', summary: 'Tiempo, luz y luna para la ubicación del dispositivo o el objetivo de una misión', roles: ALL,
    query: E.EnvironmentQuery, response: { status: 200, schema: E.EnvironmentResponse }, errors: ['OUTSIDE_COVERAGE', 'NOT_FOUND'], delivery: 1,
    notes: 'Si el proveedor falla: 200 con weather.status = stale | unavailable. La posición se redondea a ~1 km y no se guarda (RN-26). Un rescatista solo puede pedir misionId de misiones que ve: una misión en planificación o de otra organización responde 404 NOT_FOUND, como en getMyMission.' },

  // ================= Misiones (personal) =================
  { id: 'listMissions', method: 'GET', path: '/missions', tag: 'Misiones', summary: 'Lista de misiones con pestañas por estado', roles: STAFF,
    query: M.ListMissionsQuery, response: { status: 200, schema: M.MissionsPage }, delivery: 1 },
  { id: 'createMission', method: 'POST', path: '/missions', tag: 'Misiones', summary: 'Crear misión (nace En planificación)', roles: MISSION_WRITERS,
    body: M.CreateMissionRequest, response: { status: 201, schema: M.MissionDetail }, errors: ['DUPLICATE_NAME', 'OUTSIDE_COVERAGE'], delivery: 1, audited: true,
    notes: 'La altitud del objetivo y de los orígenes la calcula el servidor (RN-07); si ninguna fuente la tiene, 422 OUTSIDE_COVERAGE. teamIds, rescuerIds y routes llegan vacíos hasta H4/H6 (RF-513, RF-802, RF-804): no vacíos dan 400 VALIDATION_FAILED con issues en esos campos. Un coordinatorId que no es un coordinador activo de la organización da 400 VALIDATION_FAILED en coordinatorId.' },
  { id: 'getMission', method: 'GET', path: '/missions/{missionId}', tag: 'Misiones', summary: 'Detalle de misión (centro de trabajo)', roles: STAFF,
    params: p.mission, response: { status: 200, schema: M.MissionDetail }, delivery: 1 },
  { id: 'updateMission', method: 'PATCH', path: '/missions/{missionId}', tag: 'Misiones', summary: 'Editar datos de la misión', roles: MISSION_WRITERS,
    params: p.mission, body: M.UpdateMissionRequest, response: { status: 200, schema: M.MissionDetail }, errors: ['MISSION_CLOSED', 'DUPLICATE_NAME', 'STALE_RESOURCE', 'OUTSIDE_COVERAGE'], delivery: 1, audited: true,
    notes: 'Si cambia el objetivo, el servidor recalcula la altitud (422 OUTSIDE_COVERAGE si ninguna fuente la tiene).' },
  { id: 'duplicateMission', method: 'POST', path: '/missions/{missionId}/duplicate', tag: 'Misiones', summary: 'Duplicar misión (puntos y, si se pide, rutas; sin participantes)', roles: MISSION_WRITERS,
    params: p.mission, body: M.DuplicateMissionRequest, response: { status: 201, schema: M.MissionDetail }, errors: ['DUPLICATE_NAME'], delivery: 1, audited: true },
  { id: 'activateMission', method: 'POST', path: '/missions/{missionId}/activate', tag: 'Misiones', summary: 'Activar misión (abre el voluntariado)', roles: MISSION_WRITERS,
    params: p.mission, body: M.ActivateMissionRequest, response: { status: 200, schema: M.MissionDetail }, errors: ['INVALID_STATE_TRANSITION', 'CONFIRMATION_REQUIRED'], delivery: 1, audited: true },
  { id: 'closeMission', method: 'POST', path: '/missions/{missionId}/close', tag: 'Misiones', summary: 'Cerrar misión confirmando quién participó', roles: MISSION_WRITERS,
    params: p.mission, body: M.CloseMissionRequest, response: { status: 200, schema: M.MissionDetail }, errors: ['INVALID_STATE_TRANSITION', 'ATTENDANCE_INCOMPLETE'], delivery: 1, audited: true,
    notes: 'Atómica: cambia el estado y guarda `participated` de todos los aceptados en una transacción.' },
  { id: 'reopenMission', method: 'POST', path: '/missions/{missionId}/reopen', tag: 'Misiones', summary: 'Reabrir una misión cerrada como Activa', roles: MISSION_WRITERS,
    params: p.mission, response: { status: 200, schema: M.MissionDetail }, errors: ['INVALID_STATE_TRANSITION', 'DUPLICATE_NAME'], delivery: 1, audited: true,
    notes: 'Puede chocar con otra misión no cerrada del mismo nombre (índice missions_org_name_open_uq).' },
  { id: 'listMissionHistory', method: 'GET', path: '/missions/{missionId}/history', tag: 'Misiones', summary: 'Historial de cambios de la misión', roles: STAFF,
    params: p.mission, query: PageQuery, response: { status: 200, schema: M.MissionHistoryPage }, delivery: 1 },
  { id: 'listAttendanceCandidates', method: 'GET', path: '/missions/{missionId}/attendance-candidates', tag: 'Misiones', summary: 'Aceptados para el diálogo «¿Quién participó?»', roles: MISSION_WRITERS,
    params: p.mission, response: { status: 200, schema: PA.AttendanceCandidates }, delivery: 1 },

  // ================= Puntos =================
  { id: 'createMissionPoint', method: 'POST', path: '/missions/{missionId}/points', tag: 'Puntos', summary: 'Añadir origen, punto intermedio o de reunión', roles: MISSION_WRITERS,
    params: p.mission, body: M.PointInput, response: { status: 201, schema: M.MissionPoint }, errors: ['MISSION_CLOSED', 'OUTSIDE_COVERAGE'], delivery: 1, audited: true },
  { id: 'importMissionPoints', method: 'POST', path: '/missions/{missionId}/points/import', tag: 'Puntos', summary: 'Importar puntos desde un GPX/KML ya subido', roles: MISSION_WRITERS,
    params: p.mission, body: M.ImportPointsRequest, response: { status: 201, schema: Items(M.MissionPoint) }, errors: ['MISSION_CLOSED', 'INVALID_FILE_CONTENT'], delivery: 1, audited: true },
  { id: 'updateMissionPoint', method: 'PATCH', path: '/missions/{missionId}/points/{pointId}', tag: 'Puntos', summary: 'Editar un punto', roles: MISSION_WRITERS,
    params: p.missionPoint, body: M.UpdatePointRequest, response: { status: 200, schema: M.MissionPoint }, errors: ['MISSION_CLOSED', 'OUTSIDE_COVERAGE'], delivery: 1, audited: true,
    notes: 'Si cambian lat o lon, el servidor recalcula la altitud.' },
  { id: 'deleteMissionPoint', method: 'DELETE', path: '/missions/{missionId}/points/{pointId}', tag: 'Puntos', summary: 'Borrar un punto (no si una ruta de la misión sale de él)', roles: MISSION_WRITERS,
    params: p.missionPoint, response: { status: 204 }, errors: ['MISSION_CLOSED'], delivery: 1, audited: true,
    notes: 'Si una ruta de la misión sale de ese origen: 400 `VALIDATION_FAILED` con `issues[0]` = {path: "pointId", code: "point_in_use"}; hay que quitar antes la ruta de la misión o cambiar su origen.' },

  // ================= Equipos de la misión =================
  { id: 'addMissionTeams', method: 'POST', path: '/missions/{missionId}/teams', tag: 'Participantes', summary: 'Asignar equipos: sus miembros entran como Aceptados', roles: MISSION_WRITERS,
    params: p.mission, body: PA.AddMissionTeamsRequest, response: { status: 200, schema: PA.AddParticipantsResponse }, errors: ['MISSION_CLOSED'], delivery: 1, audited: true },
  { id: 'removeMissionTeam', method: 'DELETE', path: '/missions/{missionId}/teams/{teamId}', tag: 'Participantes', summary: 'Quitar la asignación de un equipo (no quita a sus miembros ya aceptados)', roles: MISSION_WRITERS,
    params: p.missionTeam, response: { status: 204 }, errors: ['MISSION_CLOSED'], delivery: 1, audited: true },

  // ================= Voluntarios y participantes =================
  { id: 'listParticipations', method: 'GET', path: '/missions/{missionId}/participations', tag: 'Participantes', summary: 'Bandeja de voluntarios y participantes (solo nombre, equipo y localidad)', roles: STAFF,
    params: p.mission, query: PA.ListParticipationsQuery, response: { status: 200, schema: PA.ParticipationsPage }, delivery: 1,
    notes: 'RN-21: esta respuesta no lleva teléfono, correo, documento, dirección ni historial. Una prueba de contrato lo garantiza.' },
  { id: 'getParticipationCard', method: 'GET', path: '/missions/{missionId}/participations/{participationId}', tag: 'Participantes', summary: 'Ficha del voluntario', roles: STAFF,
    params: p.participation, response: { status: 200, schema: PA.VolunteerCard }, delivery: 1,
    notes: 'contact es null salvo que la participación esté Pendiente o Aceptada (INV-28). Nunca documento, dirección ni historial.' },
  { id: 'addParticipants', method: 'POST', path: '/missions/{missionId}/participations', tag: 'Participantes', summary: 'Añadir rescatistas sueltos como Aceptados', roles: MISSION_WRITERS,
    params: p.mission, body: PA.AddParticipantsRequest, response: { status: 200, schema: PA.AddParticipantsResponse }, errors: ['MISSION_CLOSED'], delivery: 1, audited: true },
  { id: 'bulkParticipations', method: 'POST', path: '/missions/{missionId}/participations/bulk', tag: 'Participantes', summary: 'Aceptar, rechazar, reconsiderar o quitar en bloque', roles: MISSION_WRITERS,
    params: p.mission, body: PA.BulkParticipationRequest, response: { status: 200, schema: PA.BulkParticipationResponse }, errors: ['MISSION_CLOSED', 'STALE_RESOURCE'], delivery: 1, audited: true,
    notes: 'Con selection.mode = filter se aplica a los resultados filtrados (no a toda la misión) menos exceptIds. Las filas que ya no admiten la transición se devuelven en skipped.' },

  // ================= Certificados =================
  { id: 'getCertificateLink', method: 'POST', path: '/skills/{skillId}/certificate-link', tag: 'Perfil', summary: 'Enlace firmado de corta vida para abrir un certificado', roles: ALL,
    params: p.skill, response: { status: 200, schema: F.SignedLink }, delivery: 1, audited: true,
    notes: 'El rescatista, solo el suyo (sin auditoría). Coordinador: solo de quien tiene participación Pendiente o Aceptada en sus misiones. Administrador: de su organización. Toda apertura ajena queda en audit_log (`certificate_opened`, INV-26, RN-24), escrita al firmar el enlace; la propia no. 404 si no corresponde, también para quien no tiene relación. El enlace caduca a los 5 minutos y solo vale para quien lo pidió; se abre con `openCertificate`.' },
  { id: 'openCertificate', method: 'GET', path: '/certificates/{token}', tag: 'Perfil', summary: 'Abrir un certificado con su enlace firmado', roles: ALL,
    params: p.certificateToken, response: { status: 200, file: 'application/pdf | image/jpeg | image/png' }, delivery: 1,
    notes: 'El enlace es de quien lo pidió y caduca a los 5 minutos; si no es válido, ha caducado, es de otra persona o el certificado ya no existe, 404 `NOT_FOUND`. Se entrega `inline`, con `nosniff` y sin caché. No audita: el registro se escribe al firmar el enlace con `getCertificateLink`.' },

  // ================= Archivos =================
  { id: 'uploadFile', method: 'POST', path: '/files', tag: 'Archivos', summary: 'Subir un certificado (PDF/JPG/PNG) o un GPX/KML', roles: ALL,
    multipart: F.UploadFileFields, response: { status: 201, schema: F.FileRef }, errors: ['FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE', 'INVALID_FILE_CONTENT'], delivery: 1,
    notes: 'purpose = certificate: solo rescatista (el coordinador y el administrador reciben FORBIDDEN); el archivo queda a nombre de quien lo sube y no se puede ver más que con `getCertificateLink`. purpose = route_import: quien puede crear rutas o puntos. Máx. 10 MB; el tipo se comprueba por contenido.' },

  // ================= Equipos =================
  { id: 'listTeams', method: 'GET', path: '/teams', tag: 'Equipos', summary: 'Equipos de la organización', roles: STAFF,
    query: T.ListTeamsQuery, response: { status: 200, schema: T.TeamsPage }, delivery: 1 },
  { id: 'createTeam', method: 'POST', path: '/teams', tag: 'Equipos', summary: 'Crear equipo (nombre y localidad obligatorios)', roles: TEAM_MANAGERS,
    body: T.CreateTeamRequest, response: { status: 201, schema: T.TeamDetail }, errors: ['DUPLICATE_NAME'], delivery: 1, audited: true,
    notes: 'Nombre, localidad y código (tres caracteres, único en la organización) obligatorios (INV-23). `DUPLICATE_NAME` lleva `details.field`: `name` o `code`. La auditoría lleva ids, nunca nombres.' },
  { id: 'getTeam', method: 'GET', path: '/teams/{teamId}', tag: 'Equipos', summary: 'Detalle de equipo con sus miembros (solo nombres)', roles: STAFF,
    params: p.team, response: { status: 200, schema: T.TeamDetail }, delivery: 1 },
  { id: 'updateTeam', method: 'PATCH', path: '/teams/{teamId}', tag: 'Equipos', summary: 'Editar o archivar un equipo', roles: TEAM_MANAGERS,
    params: p.team, body: T.UpdateTeamRequest, response: { status: 200, schema: T.TeamDetail }, errors: ['DUPLICATE_NAME'], delivery: 1, audited: true,
    notes: '`status` archiva o reactiva (los miembros se conservan). Cambiar `code` no toca los alias ya fijados (D-E6). `DUPLICATE_NAME` lleva `details.field`: `name` o `code`.' },
  { id: 'addTeamMembers', method: 'POST', path: '/teams/{teamId}/members', tag: 'Equipos', summary: 'Añadir miembros', roles: TEAM_MANAGERS,
    params: p.team, body: T.AddTeamMembersRequest, response: { status: 200, schema: T.TeamDetail }, errors: ['INVALID_STATE_TRANSITION'], delivery: 1, audited: true,
    notes: 'Los miembros son personas activas de la organización, de cualquier rol (D-E4); un `userId` ajeno o desactivado da `VALIDATION_FAILED` con `path = userIds`. Los equipos archivados no admiten miembros nuevos (`INVALID_STATE_TRANSITION`, D-E5). Quien ya es miembro se deja como está. Al entrar en su primer equipo, la persona recibe el código del equipo en su alias (Q-36), una sola vez.' },
  { id: 'removeTeamMember', method: 'DELETE', path: '/teams/{teamId}/members/{userId}', tag: 'Equipos', summary: 'Quitar un miembro', roles: TEAM_MANAGERS,
    params: p.teamMember, response: { status: 204 }, delivery: 1, audited: true,
    notes: 'Quien no es miembro da `NOT_FOUND`. El alias de la persona no cambia (Q-36: es fijo).' },
  { id: 'listRescuers', method: 'GET', path: '/rescuers', tag: 'Equipos', summary: 'Selector de rescatistas con perfil completo', roles: STAFF,
    query: T.ListRescuersQuery, response: { status: 200, schema: T.RescuersPage }, delivery: 1,
    notes: 'Solo nombre y equipos activos. Sin contacto: el contacto solo existe en la ficha de un voluntario. Por defecto, solo rescatistas activos con el perfil completo (`profileComplete=false` los ofrece todos). Adelantada de H6 a H5: es el selector de miembros del equipo.' },

  // ================= Biblioteca de rutas =================
  { id: 'listRoutes', method: 'GET', path: '/routes', tag: 'Rutas', summary: 'Biblioteca: rutas del área visible, con filtros', roles: STAFF,
    query: R.ListRoutesQuery, response: { status: 200, schema: R.RoutesPage }, delivery: 1 },
  { id: 'createRoute', method: 'POST', path: '/routes', tag: 'Rutas', summary: 'Crear ruta importada o dibujada (versión 1 en Borrador)', roles: MISSION_WRITERS,
    body: R.CreateRouteRequest, response: { status: 201, schema: R.CreatedRoute }, errors: ['INVALID_FILE_CONTENT', 'MISSION_HAS_NO_ORIGIN', 'MISSION_CLOSED', 'OUTSIDE_COVERAGE', 'NO_ROUTE_POSSIBLE', 'ROUTING_UNAVAILABLE'], delivery: 1, audited: true,
    notes: 'El servidor recalcula altitudes, métricas y tramos (RN-10); lo que el cliente envíe de eso se ignora. addToMission llega en H4: hasta entonces, si viene, responde VALIDATION_FAILED. Con `snapToPaths` (solo dibujada, de 2 a 50 puntos) el servidor une los puntos siguiendo los caminos antes de medir: NO_ROUTE_POSSIBLE, OUTSIDE_COVERAGE o ROUTING_UNAVAILABLE como en snapRoute.' },
  { id: 'snapRoute', method: 'POST', path: '/routes/snap', tag: 'Rutas', summary: 'Unir puntos siguiendo caminos (vista previa, no guarda)', roles: STAFF,
    body: R.SnapRequest, response: { status: 200, schema: R.CandidateRoute }, errors: ['NO_ROUTE_POSSIBLE', 'OUTSIDE_COVERAGE', 'ROUTING_UNAVAILABLE'], delivery: 1 },
  { id: 'previewRouteImport', method: 'POST', path: '/routes/import/preview', tag: 'Rutas', summary: 'Vista previa de un GPX/KML subido (no guarda)', roles: STAFF,
    body: R.ImportPreviewRequest, response: { status: 200, schema: R.ImportPreview }, errors: ['INVALID_FILE_CONTENT', 'OUTSIDE_COVERAGE'], delivery: 1 },
  { id: 'generateRoutes', method: 'POST', path: '/routes/generate', tag: 'Rutas', summary: 'Generar alternativas en segundo plano', roles: MISSION_WRITERS,
    body: R.GenerateRoutesRequest, response: { status: 202, schema: R.JobAccepted }, errors: ['MISSION_HAS_NO_ORIGIN', 'MISSION_CLOSED', 'ROUTING_UNAVAILABLE', 'NOT_FOUND'], delivery: 1, audited: true,
    notes: 'namePrefix es obligatorio: cada alternativa se llama «<namePrefix> <n>». Cada alternativa queda como ruta nueva en Borrador, versión 1; con `addToMission` también en la misión, con esa versión fijada. Se sigue con GET /jobs/{jobId}. `NOT_FOUND`: misión, punto de origen, equipo o zona que no son de la organización. Si el motor no responde al pedirlo: 503 `ROUTING_UNAVAILABLE` y no se crea trabajo. Si el trabajo falla: errorCode NO_ROUTE_POSSIBLE | OUTSIDE_COVERAGE | ROUTING_UNAVAILABLE | INTERNAL.' },
  { id: 'listNearRoutes', method: 'GET', path: '/routes/near', tag: 'Rutas', summary: 'Rutas que pasan cerca de un punto', roles: STAFF,
    query: R.NearRoutesQuery, response: { status: 200, schema: R.NearRoutesResponse }, delivery: 2, notes: 'RF-514.' },
  { id: 'exportRoutes', method: 'GET', path: '/routes/export', tag: 'Rutas', summary: 'Exportar varias rutas de la biblioteca en un solo GPX/KML', roles: STAFF,
    query: R.ExportRoutesQuery, response: { status: 200, file: 'application/gpx+xml | application/vnd.google-earth.kml+xml' }, delivery: 1,
    notes: 'Una <trk> por ruta, con su versión más reciente (o la última validada con validatedOnly=true). Las rutas de otra organización no existen: se ignoran como si no estuvieran.' },
  { id: 'getRoute', method: 'GET', path: '/routes/{routeId}', tag: 'Rutas', summary: 'Detalle de ruta: versiones, derivadas, uso', roles: STAFF,
    params: p.route, response: { status: 200, schema: R.RouteDetail }, delivery: 1 },
  { id: 'archiveRoute', method: 'POST', path: '/routes/{routeId}/archive', tag: 'Rutas', summary: 'Archivar ruta (no si está en una misión no cerrada)', roles: MISSION_WRITERS,
    params: p.route, response: { status: 200, schema: R.RouteDetail }, errors: ['ROUTE_IN_USE', 'INVALID_STATE_TRANSITION'], delivery: 1, audited: true,
    notes: 'Archivar una ruta ya archivada responde INVALID_STATE_TRANSITION. Para borrarla del todo, véase deleteRoute.' },
  { id: 'updateRoute', method: 'PATCH', path: '/routes/{routeId}', tag: 'Rutas', summary: 'Cambiar el nombre de una ruta', roles: MISSION_WRITERS,
    params: p.route, body: R.UpdateRouteRequest, response: { status: 200, schema: R.RouteDetail }, errors: ['INVALID_STATE_TRANSITION'], delivery: 1, audited: true,
    notes: 'Solo cambia el nombre de la ruta; las versiones no cambian (RN-12) y lo ven igual las misiones que la usan. Con la ruta archivada, INVALID_STATE_TRANSITION. Con el mismo nombre responde 200 y no deja auditoría.' },
  { id: 'deleteRoute', method: 'DELETE', path: '/routes/{routeId}', tag: 'Rutas', summary: 'Eliminar definitivamente una ruta archivada y sin misión', roles: MISSION_WRITERS,
    params: p.route, response: { status: 204 }, errors: ['ROUTE_IN_USE', 'INVALID_STATE_TRANSITION'], delivery: 1, audited: true,
    notes: 'Irreversible (issue #17, RN-14). Solo una ruta archivada (si no, INVALID_STATE_TRANSITION) que no figure en ninguna misión, tampoco cerrada (si no, ROUTE_IN_USE con las misiones). Se llevan sus versiones, validadas incluidas, y sus tramos; las rutas derivadas de ella siguen existiendo sin el vínculo «deriva de». La auditoría anota el nombre y el número de versiones.' },
  { id: 'getRouteVersion', method: 'GET', path: '/routes/{routeId}/versions/{versionId}', tag: 'Rutas', summary: 'Versión con trazado, tramos y perfil de elevación', roles: STAFF,
    params: p.version, response: { status: 200, schema: R.RouteVersionDetail }, delivery: 1 },
  { id: 'createRouteVersion', method: 'POST', path: '/routes/{routeId}/versions', tag: 'Rutas', summary: 'Editar: crea una versión nueva en Borrador', roles: MISSION_WRITERS,
    params: p.route, body: R.CreateVersionRequest, response: { status: 201, schema: R.CreatedRoute }, errors: ['MISSION_CLOSED', 'OUTSIDE_COVERAGE', 'INVALID_STATE_TRANSITION'], delivery: 1, audited: true,
    notes: 'Una ruta archivada es de solo lectura (INVALID_STATE_TRANSITION). calculationJobId llega en H9: hasta entonces, si viene, responde VALIDATION_FAILED. Con `continueFrom` (en lugar de `geometry`) el servidor conserva la versión base desde el inicio hasta el punto de corte, llevado al vértice más cercano (a más de 200 m de la ruta o en su inicio, VALIDATION_FAILED), con sus tipos de vía, y une en línea recta los puntos a mano, que cuentan como sin camino (offtrail).' },
  { id: 'deriveRoute', method: 'POST', path: '/routes/{routeId}/derive', tag: 'Rutas', summary: 'Guardar como nueva ruta derivada', roles: MISSION_WRITERS,
    params: p.route, body: R.DeriveRouteRequest, response: { status: 201, schema: R.CreatedRoute }, errors: ['OUTSIDE_COVERAGE'], delivery: 1, audited: true,
    notes: 'Se puede derivar de una ruta archivada. addToMission (H4) y calculationJobId (H9): hasta entonces, si vienen, responde VALIDATION_FAILED.' },
  { id: 'validateRouteVersion', method: 'POST', path: '/routes/{routeId}/versions/{versionId}/validate', tag: 'Rutas', summary: 'Validar una versión (la hace inmutable y visible a rescatistas)', roles: MISSION_WRITERS,
    params: p.version, body: R.ValidateVersionRequest, response: { status: 200, schema: R.RouteVersion }, errors: ['VERSION_IMMUTABLE', 'INVALID_STATE_TRANSITION'], delivery: 1, audited: true,
    notes: 'Validar una versión ya validada responde VERSION_IMMUTABLE; validar una versión de una ruta archivada, INVALID_STATE_TRANSITION.' },
  { id: 'adaptRoute', method: 'POST', path: '/routes/{routeId}/adapt', tag: 'Rutas', summary: 'Adaptar: conservar hasta un corte y recalcular el resto', roles: MISSION_WRITERS,
    params: p.route, body: R.AdaptRouteRequest, response: { status: 202, schema: R.JobAccepted }, delivery: 2, audited: true, notes: 'RF-515. El resultado es un candidato; se guarda con createRouteVersion o deriveRoute pasando calculationJobId.' },
  { id: 'exportRoute', method: 'GET', path: '/routes/{routeId}/export', tag: 'Rutas', summary: 'Descargar una versión como GPX o KML', roles: STAFF,
    params: p.route, query: R.ExportRouteQuery, response: { status: 200, file: 'application/gpx+xml | application/vnd.google-earth.kml+xml' }, delivery: 1,
    notes: 'Sin versionId se exporta la versión más reciente (borrador o validada).' },

  // ================= Cálculo =================
  { id: 'getJob', method: 'GET', path: '/jobs/{jobId}', tag: 'Rutas', summary: 'Progreso y resultado de un cálculo', roles: STAFF,
    params: p.job, response: { status: 200, schema: R.Job }, delivery: 1, notes: 'Sondeo cada 1–2 s. Solo quien lo pidió o un coordinador de la misma organización.' },
  { id: 'listAvoidZones', method: 'GET', path: '/avoid-zones', tag: 'Rutas', summary: 'Zonas a evitar de la organización o de una misión', roles: STAFF,
    query: R.ListAvoidZonesQuery, response: { status: 200, schema: Items(R.AvoidZone) }, delivery: 1,
    notes: 'Sin `missionId`: las zonas de la organización (las que no son de ninguna misión). Con `missionId`: esas y las de la misión (404 si no es de la organización). Las ven y escriben el personal; el rescatista no.' },
  { id: 'createAvoidZone', method: 'POST', path: '/avoid-zones', tag: 'Rutas', summary: 'Dibujar una zona a evitar', roles: MISSION_WRITERS,
    body: R.CreateAvoidZoneRequest, response: { status: 201, schema: R.AvoidZone }, errors: ['MISSION_CLOSED'], delivery: 1, audited: true,
    notes: 'El polígono no puede cortarse a sí mismo ni tener más de 200 vértices (`VALIDATION_FAILED`). Con `missionId`, la misión debe ser de la organización (404) y no estar cerrada.' },
  { id: 'deleteAvoidZone', method: 'DELETE', path: '/avoid-zones/{zoneId}', tag: 'Rutas', summary: 'Borrar una zona a evitar', roles: MISSION_WRITERS,
    params: p.zone, response: { status: 204 }, errors: ['MISSION_CLOSED'], delivery: 1, audited: true,
    notes: 'Borrar es real (no hay historial que proteger; la auditoría lo anota). Una zona de una misión cerrada no se borra.' },

  // ================= Rutas de la misión =================
  { id: 'listMissionRoutes', method: 'GET', path: '/missions/{missionId}/routes', tag: 'Rutas de la misión', summary: 'Tabla comparativa de rutas de la misión', roles: STAFF,
    params: p.mission, response: { status: 200, schema: R.MissionRoutesStaff }, delivery: 1 },
  { id: 'addMissionRoutes', method: 'POST', path: '/missions/{missionId}/routes', tag: 'Rutas de la misión', summary: 'Añadir rutas de la biblioteca fijando versión', roles: MISSION_WRITERS,
    params: p.mission, body: R.AddMissionRoutesRequest, response: { status: 201, schema: R.MissionRoutesStaff }, errors: ['MISSION_CLOSED', 'ROUTE_ALREADY_IN_MISSION', 'INVALID_STATE_TRANSITION'], delivery: 1, audited: true,
    notes: 'Atómico: si una falla, no se añade ninguna. La respuesta lista solo las añadidas. Una ruta archivada no se añade (INVALID_STATE_TRANSITION); una ruta, versión, origen o equipo de otra organización o de otra ruta es NOT_FOUND.' },
  { id: 'updateMissionRoute', method: 'PATCH', path: '/missions/{missionId}/routes/{missionRouteId}', tag: 'Rutas de la misión', summary: 'Cambiar versión fijada, marcar no disponible, origen, equipo o nota', roles: MISSION_WRITERS,
    params: p.missionRoute, body: R.UpdateMissionRouteRequest, response: { status: 200, schema: R.MissionRouteStaff }, errors: ['MISSION_CLOSED', 'INVALID_STATE_TRANSITION'], delivery: 1, audited: true,
    notes: 'Nunca se actualiza sola la versión (RF-518): solo cuando el coordinador envía pinnedVersionId, que debe ser una versión de esa ruta (otra, NOT_FOUND). Con la ruta archivada, INVALID_STATE_TRANSITION.' },
  { id: 'removeMissionRoute', method: 'DELETE', path: '/missions/{missionId}/routes/{missionRouteId}', tag: 'Rutas de la misión', summary: 'Quitar una ruta de la misión (la ruta sigue en la biblioteca)', roles: MISSION_WRITERS,
    params: p.missionRoute, response: { status: 204 }, errors: ['MISSION_CLOSED'], delivery: 1, audited: true },
  { id: 'getMissionRouteGeometry', method: 'GET', path: '/missions/{missionId}/routes/{missionRouteId}/geometry', tag: 'Rutas de la misión', summary: 'Trazado, tramos y perfil de la versión fijada', roles: STAFF,
    params: p.missionRoute, response: { status: 200, schema: R.MissionRouteGeometry }, delivery: 1 },
  { id: 'exportMissionRoutes', method: 'GET', path: '/missions/{missionId}/routes/export', tag: 'Rutas de la misión', summary: 'Exportar las rutas de la misión en un solo GPX/KML', roles: STAFF,
    params: p.mission, query: R.ExportMissionRoutesQuery, response: { status: 200, file: 'application/gpx+xml | application/vnd.google-earth.kml+xml' }, delivery: 1,
    notes: 'Una `<trk>` por ruta, en la versión **fijada** (borradores incluidos). Sin `ids`: todas menos las marcadas como no disponibles; con `ids` (ids de fila de la misión), esas, también las no disponibles. Sin nada que exportar, `NOT_FOUND`. Sin autor ni datos personales. Se puede con la misión cerrada.' },

  // ================= Rescatista: misiones =================
  { id: 'listMyMissions', method: 'GET', path: '/my/missions', tag: 'Rescatista', summary: 'Misiones activas y cerradas, con el estado de mi oferta', roles: ['rescuer'],
    query: M.ListMyMissionsQuery, response: { status: 200, schema: M.MyMissionsPage }, delivery: 1,
    notes: '`coordinatorName` es siempre `null` para el rescatista; ve en su lugar `coordinatorAlias` (Q-36, D-E3), el alias fijo del responsable.' },
  { id: 'getMyMission', method: 'GET', path: '/my/missions/{missionId}', tag: 'Rescatista', summary: 'Detalle de misión en solo lectura', roles: ['rescuer'],
    params: p.mission, response: { status: 200, schema: M.MyMissionDetail }, delivery: 1, notes: 'Una misión en planificación responde 404 (RN-16). `coordinatorName` es `null` para el rescatista; ve `coordinatorAlias` (Q-36).' },
  { id: 'offerToMission', method: 'POST', path: '/my/missions/{missionId}/offer', tag: 'Rescatista', summary: 'Me ofrezco como voluntario', roles: ['rescuer'],
    params: p.mission, response: { status: 201, schema: M.MyParticipation }, errors: ['PROFILE_INCOMPLETE', 'MISSION_NOT_ACTIVE', 'ALREADY_OFFERED'], delivery: 1, audited: true,
    notes: 'Solo a sí mismo (el id sale de la sesión). Tras un rechazo no se puede reofrecer: solo el coordinador reconsidera. Tras retirar, sí.' },
  { id: 'withdrawOffer', method: 'DELETE', path: '/my/missions/{missionId}/offer', tag: 'Rescatista', summary: 'Retirar mi oferta', roles: ['rescuer'],
    params: p.mission, response: { status: 200, schema: M.MyParticipation }, errors: ['MISSION_NOT_ACTIVE', 'INVALID_STATE_TRANSITION'], delivery: 1, audited: true },
  { id: 'listMyMissionRoutes', method: 'GET', path: '/my/missions/{missionId}/routes', tag: 'Rescatista', summary: 'Rutas validadas de la misión', roles: ['rescuer'],
    params: p.mission, response: { status: 200, schema: R.MissionRoutesRescuer }, delivery: 1,
    notes: 'Solo filas cuya versión fijada está validada (INV-05, RN-03): la fijada, no la última. Una misión en planificación u otra organización responde `NOT_FOUND`; una cerrada se lee. Sin nota interna, borrador ni quién validó. La *no disponible* sale señalada (`status`). El equipo (nombre y localidad) aparece siempre que la ruta lo tenga, sea o no miembro la persona (D-34).' },
  { id: 'getMyMissionRouteGeometry', method: 'GET', path: '/my/missions/{missionId}/routes/{missionRouteId}/geometry', tag: 'Rescatista', summary: 'Trazado y perfil de una ruta validada', roles: ['rescuer'],
    params: p.missionRoute, response: { status: 200, schema: R.MissionRouteGeometry }, delivery: 1,
    notes: 'Misma respuesta que la del personal, de la versión fijada. Si esa versión no está validada, la fila no es visible: `NOT_FOUND`.' },
  { id: 'exportMyMissionRoutes', method: 'GET', path: '/my/missions/{missionId}/routes/export', tag: 'Rescatista', summary: 'Exportar rutas validadas (solo de misiones activas)', roles: ['rescuer'],
    params: p.mission, query: R.ExportMissionRoutesQuery, response: { status: 200, file: 'application/gpx+xml | application/vnd.google-earth.kml+xml' }, errors: ['MISSION_NOT_ACTIVE'], delivery: 1,
    notes: 'Solo versiones validadas y fijadas de rutas que no están marcadas como no disponibles (una ruta que se avisa de no usar no se descarga). Misión en planificación u otra organización: `NOT_FOUND`; cerrada: `MISSION_NOT_ACTIVE`. Con `ids`, solo de entre esas filas. Sin nada que exportar, `NOT_FOUND`.' },

  // ================= Rescatista: perfil =================
  { id: 'getMyProfile', method: 'GET', path: '/my/profile', tag: 'Perfil', summary: 'Mi perfil (documento y dirección enmascarados)', roles: ['rescuer'],
    response: { status: 200, schema: P.MyProfile }, delivery: 1,
    notes: 'Contacto y sensibles se leen cada uno de su tabla (INV-32). Enmascarado: el documento deja los dos últimos caracteres (`•••••••8Z`) y la dirección es `•••••, <código postal> <localidad> (<país>)`. `missingFields` dice qué falta para el alta.' },
  { id: 'updateMyProfile', method: 'PATCH', path: '/my/profile', tag: 'Perfil', summary: 'Rellenar el alta o corregir mis datos', roles: ['rescuer'],
    body: P.UpdateMyProfileRequest, response: { status: 200, schema: P.MyProfile }, errors: ['INVALID_DOCUMENT', 'DOCUMENT_ALREADY_REGISTERED'], delivery: 1, audited: true,
    notes: 'Actualización parcial. `document` y `address` van completos y cifrados (AES-256-GCM); el primer documento exige también la dirección y al revés (`VALIDATION_FAILED`). El perfil pasa a `complete` en cuanto no falta nada, y `getMe.nextStep` deja de ser `complete-profile`. La auditoría guarda qué bloques cambiaron, nunca los valores. DOCUMENT_ALREADY_REGISTERED no revela de quién es (INV-24).' },
  { id: 'getMySensitive', method: 'GET', path: '/my/profile/sensitive', tag: 'Perfil', summary: 'Ver mi documento y dirección sin enmascarar', roles: ['rescuer'],
    response: { status: 200, schema: P.MySensitive }, delivery: 1, notes: 'Cache-Control: no-store.' },
  { id: 'deleteMyData', method: 'DELETE', path: '/my/profile', tag: 'Perfil', summary: 'Eliminar mis datos (el historial queda anonimizado)', roles: ['rescuer'],
    body: P.DeleteMyDataRequest, response: { status: 204 }, errors: ['INVALID_CREDENTIALS'], delivery: 1, audited: true,
    notes: 'Irreversible. Cierra la sesión y desactiva la cuenta. Los certificados se borran del almacenamiento por el worker.' },
  { id: 'exportMyData', method: 'GET', path: '/my/data-export', tag: 'Perfil', summary: 'Descargar mis datos (JSON)', roles: ['rescuer'],
    response: { status: 200, file: 'application/json' }, delivery: 1 },
  { id: 'listMySkills', method: 'GET', path: '/my/skills', tag: 'Perfil', summary: 'Mis cursos y habilidades', roles: ['rescuer'],
    response: { status: 200, schema: Items(P.Skill) }, delivery: 1 },
  { id: 'createMySkill', method: 'POST', path: '/my/skills', tag: 'Perfil', summary: 'Añadir curso o habilidad', roles: ['rescuer'],
    body: P.SkillInput, response: { status: 201, schema: P.Skill }, delivery: 1,
    notes: 'El certificado (solo en un curso) debe ser un archivo propio subido con `uploadFile` (purpose = certificate), no borrado y sin adjuntar a otra entrada; si no, VALIDATION_FAILED con details.issues[path = certificateFileId]. Máximo 50 entradas por perfil (VALIDATION_FAILED).' },
  { id: 'updateMySkill', method: 'PATCH', path: '/my/skills/{skillId}', tag: 'Perfil', summary: 'Editar curso o habilidad', roles: ['rescuer'],
    params: p.skill, body: P.SkillFields.partial().extend({ certificateFileId: Id.nullable().optional() }), response: { status: 200, schema: P.Skill }, delivery: 1,
    notes: 'certificateFileId: null quita el certificado (el archivo anterior se retira). Las reglas de SkillInput se comprueban sobre el resultado: una habilidad no lleva certificado y la caducidad no puede ser anterior a la fecha. El certificado nuevo, con las mismas condiciones que en createMySkill.' },
  { id: 'deleteMySkill', method: 'DELETE', path: '/my/skills/{skillId}', tag: 'Perfil', summary: 'Eliminar curso o habilidad', roles: ['rescuer'],
    params: p.skill, response: { status: 204 }, delivery: 1 },
  { id: 'listMyHistory', method: 'GET', path: '/my/history', tag: 'Perfil', summary: 'Mi historial de misiones (solo las confirmadas al cerrar)', roles: ['rescuer'],
    query: PageQuery, response: { status: 200, schema: z.strictObject({ items: z.array(P.MyHistoryItem), page: z.number(), pageSize: z.number(), total: z.number() }) }, delivery: 1 },
  { id: 'listMyAccessLog', method: 'GET', path: '/my/access-log', tag: 'Perfil', summary: 'Quién ha accedido a mis datos sensibles y certificados', roles: ['rescuer'],
    query: PageQuery, response: { status: 200, schema: z.strictObject({ items: z.array(P.MyAccessLogItem), page: z.number(), pageSize: z.number(), total: z.number() }) }, delivery: 1 },

  // ================= Administración =================
  { id: 'listSignupRequests', method: 'GET', path: '/admin/signup-requests', tag: 'Administración', summary: 'Solicitudes de alta (bandeja)', roles: ['admin'],
    query: AD.ListSignupRequestsQuery, response: { status: 200, schema: AD.SignupRequestsPage }, delivery: 1,
    notes: 'Solo las de la organización del administrador. Por defecto las pendientes; `q` busca por correo o nombre. Más recientes primero. Cada fila lleva solo `userId`, correo, nombre, estado y fecha (Q-34): nunca teléfono, documento, dirección ni rol. `Cache-Control: no-store`.' },
  { id: 'decideSignupRequests', method: 'POST', path: '/admin/signup-requests/decide', tag: 'Administración', summary: 'Aprobar (con rol) o rechazar, también en bloque', roles: ['admin'],
    body: AD.DecideSignupRequest, response: { status: 200, schema: AD.DecideSignupResponse }, errors: ['INVALID_STATE_TRANSITION'], delivery: 1, audited: true,
    notes: 'Atómica (D-A4): toda la selección se decide en una sola transacción y, si una persona falla, no cambia ninguna. Un id que no es una solicitud de esta organización (inexistente o de otra) da `NOT_FOUND` y no se decide nada (INV-01); una solicitud que ya no está pendiente da `INVALID_STATE_TRANSITION`. Por eso `skipped` va siempre vacío y `affected` es el número de personas decididas. Con `selection.mode = "filter"` se decide lo que cumple el filtro menos `exceptIds`. Cada persona deja su fila de auditoría (`signup_approved` / `signup_rejected`).' },
  { id: 'listUsers', method: 'GET', path: '/admin/users', tag: 'Administración', summary: 'Usuarios de la organización', roles: ['admin'],
    query: AD.ListUsersQuery, response: { status: 200, schema: AD.UsersPage }, delivery: 1,
    notes: 'Solo personas con membresía en la organización (D-U6): las solicitudes pendientes y rechazadas están en la bandeja. Orden por nombre. `q` busca en nombre y correo. `profileStatus` solo vale para rescatistas; `hasMissionsAsResponsible` cuenta las misiones no cerradas de las que es responsable.' },
  { id: 'getUser', method: 'GET', path: '/admin/users/{userId}', tag: 'Administración', summary: 'Ficha de usuario (contacto y habilidades, sin documento ni dirección)', roles: ['admin'],
    params: p.user, response: { status: 200, schema: AD.AdminUserDetail }, delivery: 1,
    notes: 'Sin documento ni dirección (regla 3; van por `readUserSensitive`). Los certificados se abren con `getCertificateLink`, que deja registro. Una persona de otra organización o inexistente da `NOT_FOUND`.' },
  { id: 'updateUser', method: 'PATCH', path: '/admin/users/{userId}', tag: 'Administración', summary: 'Cambiar rol, desactivar o reactivar', roles: ['admin'],
    params: p.user, body: AD.UpdateUserRequest, response: { status: 200, schema: AD.AdminUserDetail }, errors: ['COORDINATOR_HAS_MISSIONS', 'LAST_ADMIN', 'INVALID_STATE_TRANSITION'], delivery: 1, audited: true,
    notes: 'Cambiar el rol de un coordinador, o desactivarlo, cuando es responsable de misiones no cerradas exige `reassignMissionsTo` (otro coordinador activo; RN-11). Sin él, `COORDINATOR_HAS_MISSIONS` con `details.missionIds`; con un destino no válido, `VALIDATION_FAILED` con `path = reassignMissionsTo`. Las misiones cerradas no cambian (INV-11). `LAST_ADMIN` sale al quitar el rol o desactivar al último administrador activo. Pasar a rescatista crea un perfil incompleto si no lo tenía. Reactivar solo vale para cuentas desactivadas; un cambio que no cambia nada da `INVALID_STATE_TRANSITION`. Cada cambio deja su línea de auditoría (`role_changed`, `account_disabled`, `account_active`).' },
  { id: 'readUserSensitive', method: 'POST', path: '/admin/users/{userId}/sensitive', tag: 'Administración', summary: 'Leer documento y dirección (auditado)', roles: ['admin'],
    params: p.user, response: { status: 200, schema: AD.SensitiveRead }, delivery: 1, audited: true,
    notes: 'POST a propósito: la lectura crea un registro de auditoría en la misma transacción (RF-810). Cache-Control: no-store.' },
  { id: 'listUserHistory', method: 'GET', path: '/admin/users/{userId}/history', tag: 'Administración', summary: 'Historial de misiones de un rescatista', roles: ['admin'],
    params: p.user, query: PageQuery, response: { status: 200, schema: AD.UserHistoryPage }, delivery: 1 },
  { id: 'listAuditLog', method: 'GET', path: '/admin/audit-log', tag: 'Administración', summary: 'Registro de accesos y cambios de cuenta', roles: ['admin'],
    query: AD.ListAuditLogQuery, response: { status: 200, schema: AD.AuditLogPage }, delivery: 1 },
  { id: 'getInviteCode', method: 'GET', path: '/admin/invite-code', tag: 'Administración', summary: 'Ver el código de invitación', roles: ['admin'],
    response: { status: 200, schema: AD.InviteCodeResponse }, delivery: 1,
    notes: 'El código vigente de la organización del administrador (D-A6): ningún otro rol lo ve y no sale en ningún listado ni en el historial. `Cache-Control: no-store`.' },
  { id: 'rotateInviteCode', method: 'POST', path: '/admin/invite-code/rotate', tag: 'Administración', summary: 'Regenerar el código de invitación', roles: ['admin'],
    body: Empty, response: { status: 200, schema: AD.InviteCodeResponse }, delivery: 1, audited: true,
    notes: 'Genera un código nuevo (16 letras y cifras sin caracteres ambiguos, en grupos de 4) que invalida el anterior en el acto (D-A5). Deja la fila de auditoría `invite_code_rotated` sin el código. `Cache-Control: no-store`.' },
] as const satisfies readonly Omit<Endpoint, 'milestone'>[];

export const ENDPOINTS: readonly Endpoint[] = RAW.map((e) => {
  const milestone = MILESTONE_OF[e.id];
  if (!milestone) throw new Error(`Falta el hito del endpoint ${e.id} en milestones.ts`);
  return { ...e, milestone };
});

// ---------- Tipos derivados del registro (los usa el cliente generado) ----------
type RawEndpoint = (typeof RAW)[number];
export type OperationId = RawEndpoint['id'];
type OperationOf<I extends OperationId> = Extract<RawEndpoint, { id: I }>;
type InputOf<S> = S extends z.ZodType ? z.input<S> : never;

/** Entrada de una operación: `params`, `query` y `body` según declare el registro. */
export type OperationInput<I extends OperationId> = (OperationOf<I> extends { params: infer P } ? { params: InputOf<P> } : unknown) &
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- `{}` comprueba que todos los campos de la consulta son opcionales
  (OperationOf<I> extends { query: infer Q } ? ({} extends InputOf<Q> ? { query?: InputOf<Q> } : { query: InputOf<Q> }) : unknown) &
  (OperationOf<I> extends { body: infer B } ? { body: InputOf<B> } : unknown) &
  (OperationOf<I> extends { multipart: z.ZodType } ? { body: FormData } : unknown);

/** Respuesta correcta de una operación: el esquema, un `Blob` si es una descarga o `void` si no hay cuerpo. */
export type OperationOutput<I extends OperationId> =
  OperationOf<I> extends { response: { schema: infer S } } ? (S extends z.ZodType ? z.output<S> : never) : OperationOf<I> extends { response: { file: string } } ? Blob : void;

// ---------- Utilidades ----------
export const endpointKey = (e: Pick<Endpoint, 'method' | 'path'>) => `${e.method} ${e.path}`;

/** Errores que cualquier endpoint puede devolver; no se repiten en cada fila. */
export function implicitErrors(e: Endpoint): ErrorCode[] {
  const out: ErrorCode[] = ['INTERNAL', 'RATE_LIMITED'];
  if (!e.roles.includes('public')) out.push('UNAUTHENTICATED', 'SESSION_EXPIRED', 'FORBIDDEN');
  if (!e.roles.includes('public')) out.push('ACCOUNT_DISABLED');
  if (!e.roles.includes('public') && !e.roles.includes('pending')) out.push('ACCOUNT_PENDING');
  if (e.method !== 'GET') out.push('CSRF_FAILED');
  if (e.body || e.query || e.multipart || e.params) out.push('VALIDATION_FAILED');
  if (e.params) out.push('NOT_FOUND');
  return [...new Set(out)];
}

export const allErrors = (e: Endpoint): ErrorCode[] => [...new Set([...(e.errors ?? []), ...implicitErrors(e)])];
export const ERROR_STATUS = ERROR_HTTP;
