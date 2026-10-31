import { useQuery } from '@tanstack/react-query';
import { useApi } from '../session/api-context';

/** De dónde sale el punto: la celda ya redondeada del dispositivo o el objetivo de una misión (RF-704). */
export type EnvironmentSource = { type: 'device'; lat: number; lon: number } | { type: 'mission'; missionId: string };

/** El servidor guarda 3 h el pronóstico de cada celda; la pantalla no necesita preguntar más a menudo (R-09). */
const STALE_MS = 10 * 60_000;

/**
 * Tiempo, luz y luna de un punto (`getEnvironment`). Una consulta por celda o por misión elegida: no se refresca sola ni al
 * teclear, y la caché de consultas la comparte quien vuelva a pedir el mismo punto. La clave de una misión cuelga de `missions`
 * para que cambiar su objetivo la marque como caducada.
 */
export function useEnvironment(source: EnvironmentSource | null) {
  const api = useApi();
  return useQuery({
    queryKey: source?.type === 'mission' ? ['missions', 'environment', source.missionId] : ['environment', 'device', source?.lat ?? null, source?.lon ?? null],
    enabled: source !== null,
    staleTime: STALE_MS,
    queryFn: ({ signal }) => api.getEnvironment({ query: source?.type === 'mission' ? { missionId: source.missionId } : { lat: source?.lat as number, lon: source?.lon as number } }, { signal }),
  });
}
