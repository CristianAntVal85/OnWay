// Consultas y acciones de los equipos (RF-801, `H5-equipos`). Nada de reglas aquí: las decide el servidor.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OperationInput } from '@onway/contracts/client';
import { useApi } from '../session/api-context';

export const TEAMS_PAGE_SIZE = 20;

export type TeamStatus = 'active' | 'archived';
export const TEAM_STATUSES: readonly TeamStatus[] = ['active', 'archived'];

const TEAMS_KEY = ['teams'] as const;

export function useTeams(query: { status: TeamStatus; q: string; page: number }) {
  const api = useApi();
  return useQuery({
    queryKey: [...TEAMS_KEY, 'list', query],
    queryFn: ({ signal }) => api.listTeams({ query: { status: query.status, ...(query.q ? { q: query.q } : {}), page: query.page, pageSize: TEAMS_PAGE_SIZE } }, { signal }),
    placeholderData: keepPreviousData,
  });
}

/** Crear: la lista (y el selector de equipo de las rutas) se vuelven a leer al terminar. */
export function useCreateTeam() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OperationInput<'createTeam'>['body']) => api.createTeam({ body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEAMS_KEY }),
  });
}

export function useUpdateTeam(teamId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OperationInput<'updateTeam'>['body']) => api.updateTeam({ params: { teamId }, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEAMS_KEY }),
  });
}
