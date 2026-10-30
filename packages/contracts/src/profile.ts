// Perfil del rescatista (documento 02, §3.9). Todo lo de este archivo es del propio rescatista; ningún listado lo reutiliza.
import { z } from 'zod';
import { DateOnly, CountryCode, Id, TeamRef, Timestamp } from './common.js';
import { DocumentType, ProfileStatus, SkillKind } from './enums.js';
import { isValidDocument, PHONE_PATTERN } from './validators.js';

export const Phone = z.string().trim().regex(PHONE_PATTERN, 'Teléfono no válido');

export const DocumentInput = z
  .strictObject({ type: DocumentType, number: z.string().trim().min(3).max(40) })
  .superRefine((d, ctx) => {
    if (!isValidDocument(d.type, d.number)) {
      ctx.addIssue({ code: 'custom', path: ['number'], message: 'INVALID_DOCUMENT' });
    }
  });

export const Address = z.strictObject({
  street: z.string().trim().min(1).max(200),
  number: z.string().trim().min(1).max(20),
  floor: z.string().trim().max(40).optional(),
  postalCode: z.string().trim().min(3).max(12),
  locality: z.string().trim().min(1).max(120),
  province: z.string().trim().min(1).max(120),
  country: CountryCode,
});

// ----- Cursos y habilidades -----
export const SkillFields = z.strictObject({
  name: z.string().trim().min(1).max(160),
  kind: SkillKind,
  issuer: z.string().trim().max(160).optional(),
  issuedOn: DateOnly.optional(),
  expiresOn: DateOnly.optional(),
  certificateFileId: Id.optional(), // solo en cursos (D-29)
});
export const SkillInput = SkillFields.superRefine((s, ctx) => {
  if (s.kind !== 'course' && s.certificateFileId) {
    ctx.addIssue({ code: 'custom', path: ['certificateFileId'], message: 'Solo un curso admite certificado' });
  }
  if (s.issuedOn && s.expiresOn && s.expiresOn < s.issuedOn) {
    ctx.addIssue({ code: 'custom', path: ['expiresOn'], message: 'La caducidad es anterior a la fecha' });
  }
});

/** Habilidad tal como la ven el propio rescatista, coordinadores y administrador. El archivo del certificado nunca va aquí: se pide aparte. */
export const Skill = z.strictObject({
  id: Id,
  name: z.string(),
  kind: SkillKind,
  issuer: z.string().nullable(),
  issuedOn: DateOnly.nullable(),
  expiresOn: DateOnly.nullable(),
  hasCertificate: z.boolean(),
});

// ----- Perfil propio -----
export const MissingField = z.enum(['fullName', 'phone', 'document', 'address']);

export const MyProfile = z.strictObject({
  status: ProfileStatus,
  fullName: z.string(),
  email: z.string(), // es el de acceso, no editable aquí
  phone: z.string().nullable(),
  document: z.strictObject({ type: DocumentType, masked: z.string() }).nullable(),
  addressSummary: z.string().nullable(), // enmascarada: "•••••, 28001 Madrid (ES)"
  skills: z.array(Skill),
  teams: z.array(TeamRef),
  missingFields: z.array(MissingField),
  completedAt: Timestamp.nullable(),
});

/** Actualización parcial. `document` y `address` son bloques: si vienen, vienen completos. El perfil pasa a Completo cuando no falta nada. */
export const UpdateMyProfileRequest = z
  .strictObject({
    fullName: z.string().trim().min(1).max(160).optional(),
    phone: Phone.optional(),
    document: DocumentInput.optional(),
    address: Address.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Indica al menos un campo');

/** Datos sensibles del propio rescatista, a petición suya (se muestran enmascarados por defecto). */
export const MySensitive = z.strictObject({
  document: z.strictObject({ type: DocumentType, number: z.string() }).nullable(),
  address: Address.nullable(),
});

export const MyHistoryItem = z.strictObject({
  missionId: Id,
  missionName: z.string(),
  targetLabel: z.string().nullable(),
  closedAt: Timestamp,
});

/** Quién ha accedido a mis datos sensibles o a mis certificados (propuesto, §3.9). */
export const MyAccessLogItem = z.strictObject({
  occurredAt: Timestamp,
  action: z.enum(['sensitive_data_read', 'certificate_opened']),
  actorDisplayName: z.string().nullable(),
});

export const DeleteMyDataRequest = z.strictObject({
  password: z.string().min(1).max(200),
  confirm: z.literal('ELIMINAR'),
});
