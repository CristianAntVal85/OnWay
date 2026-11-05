// Validación de los formularios públicos (registro y recuperar contraseña). No hay reglas propias: salen de los esquemas del
// contrato (`Email`, `Password`, `RegisterRequest`), que el servidor aplica igual (doc 06 §5). Módulo puro: sin React ni red.
import { ApiError } from '@onway/contracts/client';
import { Email, Password, RegisterRequest } from '@onway/contracts';

export type FieldProblem = 'required' | 'invalid' | 'tooShort' | 'tooLong' | 'mismatch';

export type RegisterField = 'email' | 'displayName' | 'password' | 'passwordConfirm' | 'inviteCode';

export type Problems<F extends string> = Partial<Record<F, FieldProblem>>;

/** Orden en pantalla de los campos del registro: el foco va al primero con error. */
export const REGISTER_FIELDS: readonly RegisterField[] = ['email', 'displayName', 'password', 'passwordConfirm', 'inviteCode'];

/** Límites que muestran los textos («al menos {{min}} caracteres»), leídos del contrato. */
export const LIMITS = {
  passwordMin: Password.minLength ?? 0,
  passwordMax: Password.maxLength ?? 0,
  displayNameMax: RegisterRequest.shape.displayName.maxLength ?? 0,
} as const;

function fromIssueCode(code: string): FieldProblem {
  if (code === 'too_small') return 'tooShort';
  if (code === 'too_big') return 'tooLong';
  return 'invalid';
}

export function emailProblem(raw: string): FieldProblem | null {
  const value = raw.trim();
  if (!value) return 'required';
  return Email.safeParse(value).success ? null : 'invalid';
}

export function displayNameProblem(raw: string): FieldProblem | null {
  if (!raw.trim()) return 'required';
  const result = RegisterRequest.shape.displayName.safeParse(raw);
  return result.success ? null : fromIssueCode(result.error.issues[0]?.code ?? '');
}

/** La contraseña no se recorta: lo que se escribe es lo que se envía. */
export function passwordProblem(value: string): FieldProblem | null {
  if (!value) return 'required';
  const result = Password.safeParse(value);
  return result.success ? null : fromIssueCode(result.error.issues[0]?.code ?? '');
}

export function passwordConfirmProblem(password: string, confirm: string): FieldProblem | null {
  if (!confirm) return 'required';
  return confirm === password ? null : 'mismatch';
}

/** El servidor compara el código exacto: aquí solo se pide que haya algo y que el largo sea el del contrato. */
export function inviteCodeProblem(raw: string): FieldProblem | null {
  if (!raw.trim()) return 'required';
  return RegisterRequest.shape.inviteCode.safeParse(raw).success ? null : 'invalid';
}

function collect<F extends string>(entries: readonly [F, FieldProblem | null][]): Problems<F> {
  const out: Problems<F> = {};
  for (const [field, problem] of entries) if (problem) out[field] = problem;
  return out;
}

export function registerProblems(v: Record<RegisterField, string>): Problems<RegisterField> {
  return collect<RegisterField>([
    ['email', emailProblem(v.email)],
    ['displayName', displayNameProblem(v.displayName)],
    ['password', passwordProblem(v.password)],
    ['passwordConfirm', passwordConfirmProblem(v.password, v.passwordConfirm)],
    ['inviteCode', inviteCodeProblem(v.inviteCode)],
  ]);
}

export function newPasswordProblems(v: { password: string; passwordConfirm: string }): Problems<'password' | 'passwordConfirm'> {
  return collect<'password' | 'passwordConfirm'>([
    ['password', passwordProblem(v.password)],
    ['passwordConfirm', passwordConfirmProblem(v.password, v.passwordConfirm)],
  ]);
}

/**
 * Errores por campo de un `VALIDATION_FAILED` del servidor (`details.issues[].path`). `fields` traduce la primera parte de la ruta
 * del servidor (p. ej. `newPassword`) al campo de la pantalla. Sin ninguno reconocible devuelve `{}` y quien llama enseña el aviso general.
 */
export function serverProblems<F extends string>(error: unknown, fields: Readonly<Record<string, F>>): Problems<F> {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return {};
  const issues = error.details?.['issues'];
  if (!Array.isArray(issues)) return {};
  const out: Problems<F> = {};
  for (const issue of issues as { path?: unknown; code?: unknown }[]) {
    const field = typeof issue.path === 'string' ? fields[issue.path.split('.')[0] ?? ''] : undefined;
    if (field && !out[field]) out[field] = fromIssueCode(typeof issue.code === 'string' ? issue.code : '');
  }
  return out;
}
