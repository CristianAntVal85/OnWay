import type { TFunction } from 'i18next';
import { ApiError } from '@onway/contracts/client';
import { errorMessage } from '../i18n/error-message';

/**
 * Texto de un fallo al escribir en una misión: los que tienen un mensaje propio del detalle (cierre y edición simultáneas,
 * fuera de cobertura) y, para el resto, el del código de error.
 */
export function writeFailureMessage(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'MISSION_CLOSED') return t('missionDetail.closedMeanwhile');
    if (error.code === 'STALE_RESOURCE') return t('missionDetail.edit.stale');
    if (error.code === 'OUTSIDE_COVERAGE') return t('createMission.outsideCoverage');
  }
  return errorMessage(t, error);
}

/** ¿Ha cambiado la misión por debajo (cerrada, borrada o modificada por otra persona)? Entonces conviene volver a leerla. */
export function missionChangedMeanwhile(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'MISSION_CLOSED' || error.code === 'NOT_FOUND' || error.code === 'STALE_RESOURCE');
}
