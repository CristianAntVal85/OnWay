import type { TFunction } from 'i18next';
import { LIMITS, type FieldProblem } from './validation';

type Field = 'email' | 'displayName' | 'password' | 'passwordConfirm' | 'inviteCode';

/** Texto del error de un campo (`packages/i18n`, sección `fieldError`). Un problema sin texto propio cae en «no válido». */
export function fieldErrorText(t: TFunction, field: Field, problem: FieldProblem): string {
  const max = field === 'displayName' ? LIMITS.displayNameMax : LIMITS.passwordMax;
  return t(`fieldError.${field}.${problem}`, { defaultValue: t(`fieldError.${field}.invalid`), min: LIMITS.passwordMin, max });
}
