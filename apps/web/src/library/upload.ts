import type { TFunction } from 'i18next';
import { ApiError, type ApiClient } from '@onway/contracts/client';
import { errorMessage } from '../i18n/error-message';

/** Lo más que acepta el servidor (10 MB): se comprueba antes de subir para no gastar la conexión. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Sube un GPX o KML para importar (`route_import`) y devuelve la referencia del archivo ya guardado. */
export async function uploadRouteFile(api: ApiClient, file: File) {
  const form = new FormData();
  form.set('purpose', 'route_import');
  form.set('file', file, file.name);
  return api.uploadFile({ body: form });
}

/**
 * Texto de un fallo al subir o leer un archivo. El proxy corta lo que pasa de los 12 MB con un 413 que no sigue el formato único
 * de errores: se trata igual que `FILE_TOO_LARGE`.
 */
export function fileFailureMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiError && error.status === 413) return t('errors.FILE_TOO_LARGE');
  return errorMessage(t, error);
}
