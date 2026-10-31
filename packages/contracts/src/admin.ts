// Administración de la organización (documento 02, §3.10). Solo rol admin.
// Aquí SÍ aparecen correo y teléfono (RN-23). Documento y dirección solo salen de /admin/users/{id}/sensitive, y cada lectura se audita (RF-810).
import { z } from 'zod';
import { Address } from './profile.js';
import { Skill } from './profile.js';
import { BulkResult, Id, PageQuery, Paged, PersonRef, QueryBool, Selection, TeamRef, Timestamp } from './common.js';
import { AccountStatus, DocumentType, MemberRole, ProfileStatus, RequestStatus } from './enums.js';

// ----- Solicitudes de alta -----
/**
 * Decisión (Q-34, resuelta): la solicitud NO tiene "equipo indicado" ni "datos completos". El registro solo recoge correo, nombre,
 * contraseña y código; el perfil se crea al aprobar (admin_decide_signup) y lo rellena la persona en su primer acceso.
 */
export const SignupRequestItem = z.strictObject({
  userId: Id,
  email: z.string(),
  displayName: z.string(),
  status: RequestStatus,
  requestedAt: Timestamp,
});
export const SignupFilter = z.strictObject({
  status: RequestStatus.default('pending'),
  q: z.string().trim().max(120).optional(),
});
export const ListSignupRequestsQuery = PageQuery.extend(SignupFilter.shape);
export const SignupRequestsPage = Paged(SignupRequestItem);

/** Aprobar exige rol (RN-25: solo el administrador concede coordinador). Rechazar no lleva rol. */
export const DecideSignupRequest = z
  .strictObject({
    action: z.enum(['approve', 'reject']),
    role: z.enum(['rescuer', 'coordinator']).optional(),
    selection: Selection(SignupFilter),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'approve' && !v.role) ctx.addIssue({ code: 'custom', path: ['role'], message: 'Al aprobar hay que elegir un rol' });
    if (v.action === 'reject' && v.role) ctx.addIssue({ code: 'custom', path: ['role'], message: 'Rechazar no lleva rol' });
  });
export const DecideSignupResponse = BulkResult;

// ----- Usuarios -----
export const AdminUserItem = z.strictObject({
  userId: Id,
  displayName: z.string(),
  email: z.string(),
  role: MemberRole,
  accountStatus: AccountStatus,
  lastLoginAt: Timestamp.nullable(),
  profileStatus: ProfileStatus.nullable(), // solo rescatistas
  hasMissionsAsResponsible: z.number().int().min(0), // misiones no cerradas de las que es responsable
});
export const ListUsersQuery = PageQuery.extend({
  q: z.string().trim().max(120).optional(),
  role: MemberRole.optional(),
  accountStatus: AccountStatus.optional(),
});
export const UsersPage = Paged(AdminUserItem);

export const AdminUserDetail = AdminUserItem.extend({
  phone: z.string().nullable(),
  skills: z.array(Skill),
  teams: z.array(TeamRef),
  createdAt: Timestamp,
});

/** Cambiar rol y/o activar/desactivar. Desactivar a un responsable de misiones exige `reassignMissionsTo` (RN-11). */
export const UpdateUserRequest = z
  .strictObject({
    role: MemberRole.optional(),
    accountStatus: z.enum(['active', 'disabled']).optional(),
    reassignMissionsTo: Id.optional(),
  })
  .refine((v) => v.role !== undefined || v.accountStatus !== undefined, 'Indica rol o estado');

/** Lectura auditada de datos sensibles. Documento descifrado completo: solo en esta respuesta, nunca en listas. */
export const SensitiveRead = z.strictObject({
  userId: Id,
  document: z.strictObject({ type: DocumentType, number: z.string() }).nullable(),
  address: Address.nullable(),
});

// ----- Historial de un rescatista (el administrador sí lo ve; el coordinador no) -----
export const UserHistoryItem = z.strictObject({ missionId: Id, missionName: z.string(), closedAt: Timestamp });
export const UserHistoryPage = Paged(UserHistoryItem);

// ----- Registro de accesos -----
export const AuditAction = z.enum([
  'sensitive_data_read',
  'certificate_opened',
  'personal_data_deleted',
  'signup_requested',
  'signup_approved',
  'signup_rejected',
  'account_active',
  'account_disabled',
  'role_changed',
  'invite_code_rotated',
  'password_reset',
]);
export const AuditLogItem = z.strictObject({
  id: z.number().int(),
  occurredAt: Timestamp,
  action: AuditAction,
  actor: PersonRef.nullable(),
  subject: PersonRef.nullable(),
});
export const ListAuditLogQuery = PageQuery.extend({
  userId: Id.optional(), // sujeto de los datos
  action: AuditAction.optional(),
  from: Timestamp.optional(),
  to: Timestamp.optional(),
  onlyAccessToPersonalData: QueryBool.default(false),
});
export const AuditLogPage = Paged(AuditLogItem);

// ----- Código de invitación (propuesto) -----
export const InviteCodeResponse = z.strictObject({ code: z.string().min(10), rotatedAt: Timestamp });

// ----- Organización -----
export const OrgInfo = z.strictObject({
  id: Id,
  name: z.string(),
  country: z.string().length(2),
  config: z.strictObject({
    validationMaxAgeDays: z.number().int().min(1), // N de RF-519
    maxUploadBytes: z.number().int().positive(),
  }),
});
