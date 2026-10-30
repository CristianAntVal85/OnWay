// Errores del API. Un único formato. El cliente decide el texto por `code` (packages/i18n); `message` es para registros.
import { z } from 'zod';

/** Código → estado HTTP. Fuente única: el filtro de excepciones de NestJS y la documentación leen de aquí. */
export const ERROR_HTTP = {
  // 400
  VALIDATION_FAILED: 400,
  // 401
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  // 403
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  ACCOUNT_PENDING: 403,
  ACCOUNT_REJECTED: 403,
  ACCOUNT_DISABLED: 403,
  PROFILE_INCOMPLETE: 403,
  // 404 (también cuando el recurso es de otra organización: nunca se revela que existe)
  NOT_FOUND: 404,
  // 409
  MISSION_CLOSED: 409,
  MISSION_NOT_ACTIVE: 409,
  INVALID_STATE_TRANSITION: 409,
  STALE_RESOURCE: 409,
  DUPLICATE_NAME: 409,
  ALREADY_OFFERED: 409,
  VERSION_IMMUTABLE: 409,
  ROUTE_IN_USE: 409,
  ROUTE_ALREADY_IN_MISSION: 409,
  COORDINATOR_HAS_MISSIONS: 409,
  LAST_ADMIN: 409,
  DOCUMENT_ALREADY_REGISTERED: 409,
  CONFIRMATION_REQUIRED: 409,
  // 413 / 415
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  // 422
  REGISTRATION_FAILED: 422,
  INVALID_RESET_TOKEN: 422,
  INVALID_DOCUMENT: 422,
  INVALID_FILE_CONTENT: 422,
  ATTENDANCE_INCOMPLETE: 422,
  MISSION_HAS_NO_ORIGIN: 422,
  OUTSIDE_COVERAGE: 422,
  NO_ROUTE_POSSIBLE: 422,
  // 423 / 429
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  // 5xx
  INTERNAL: 500,
  UPSTREAM_UNAVAILABLE: 502,
  ROUTING_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP;
export const ERROR_CODES = Object.keys(ERROR_HTTP) as [ErrorCode, ...ErrorCode[]];
export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ValidationIssue = z.strictObject({
  path: z.string(), // "origins.0.lat"
  code: z.string(), // código de Zod: too_small, invalid_format…
  message: z.string(),
});

/** Cuerpo de cualquier respuesta de error. `details` depende del código (ver tabla del documento 06). */
export const ErrorResponse = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Códigos con detalles tipados, para que el cliente no tenga que adivinar. */
export const ErrorDetails = {
  VALIDATION_FAILED: z.strictObject({ issues: z.array(ValidationIssue) }),
  ACCOUNT_LOCKED: z.strictObject({ retryAfterSeconds: z.number().int().min(1) }),
  RATE_LIMITED: z.strictObject({ retryAfterSeconds: z.number().int().min(1) }),
  COORDINATOR_HAS_MISSIONS: z.strictObject({ missionIds: z.array(z.uuid()) }),
  ROUTE_IN_USE: z.strictObject({ missions: z.array(z.strictObject({ id: z.uuid(), name: z.string() })) }),
  CONFIRMATION_REQUIRED: z.strictObject({ warning: z.enum(['no_validated_route']) }),
  ATTENDANCE_INCOMPLETE: z.strictObject({ missingParticipationIds: z.array(z.uuid()) }),
  PROFILE_INCOMPLETE: z.strictObject({ missing: z.array(z.enum(['fullName', 'phone', 'document', 'address'])) }),
  STALE_RESOURCE: z.strictObject({ currentUpdatedAt: z.iso.datetime({ offset: true }) }),
} as const;

export const httpStatusOf = (code: ErrorCode): number => ERROR_HTTP[code];
