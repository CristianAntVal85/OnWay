import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@onway/contracts/client';
import type { ElevationLookup } from '../map';
import { useApi } from '../session/api-context';

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * Altitud de un punto por `getElevation` (solo el personal; el rescatista no tiene la operación). Se pide a la celda de ~11 m y
 * se guarda en la caché de consultas por celda (D-H1-09): volver a pasar por el mismo sitio no repite la petición. Sin dato
 * (`OUTSIDE_COVERAGE`) devuelve `null` y también se recuerda; cualquier otro fallo (p. ej. el límite por usuario) se propaga y no se guarda.
 */
export function useElevationLookup(): ElevationLookup {
  const api = useApi();
  const queryClient = useQueryClient();
  return useCallback<ElevationLookup>(
    async (point) => {
      const lat = round4(point.lat);
      const lon = round4(point.lon);
      return queryClient.fetchQuery({
        queryKey: ['elevation', lat, lon],
        staleTime: Infinity,
        queryFn: async ({ signal }) => {
          try {
            return (await api.getElevation({ query: { lat, lon } }, { signal })).elevationM;
          } catch (error) {
            if (error instanceof ApiError && error.code === 'OUTSIDE_COVERAGE') return null;
            throw error;
          }
        },
      });
    },
    [api, queryClient],
  );
}
