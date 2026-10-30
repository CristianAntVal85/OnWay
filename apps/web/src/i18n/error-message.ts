import type { TFunction } from 'i18next';
import { ApiError } from '@onway/contracts/client';
import { errorKey } from '@onway/i18n';

/** Texto para la persona de cualquier error: se elige por `code` (doc 06 AC-05), nunca por el `message` del servidor. */
export function errorMessage(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) return t(errorKey('INTERNAL'));
  if (error.status === 0) return t('state.offline'); // la petición ni siquiera salió: sin conexión
  const seconds = error.details?.['retryAfterSeconds'];
  return t(errorKey(error.code), { seconds: typeof seconds === 'number' ? seconds : 0 });
}
