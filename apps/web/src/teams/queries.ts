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

export function useTeam(teamId: string, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: [...TEAMS_KEY, 'detail', teamId], queryFn: ({ signal }) => api.getTeam({ params: { teamId } }, { signal }), retry: false, enabled });
}

/** Añadir miembros: el equipo, las listas y el selector (que enseña los equipos de cada persona) se vuelven a leer. */
export function useAddMembers(teamId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) => api.addTeamMembers({ params: { teamId }, body: { userIds } }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: TEAMS_KEY }), queryClient.invalidateQueries({ queryKey: RESCUERS_KEY })]),
  });
}

export function useRemoveMember(teamId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeTeamMember({ params: { teamId, userId } }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: TEAMS_KEY }), queryClient.invalidateQueries({ queryKey: RESCUERS_KEY })]),
  });
}

export const RESCUERS_PAGE_SIZE = 10;
const RESCUERS_KEY = ['rescuers'] as const;

/** El selector de rescatistas (RN-21: solo nombre y equipos, sin contacto); solo perfiles completos, que es lo que el servidor ofrece por defecto. */
export function useRescuers(query: { q: string; page: number }) {
  const api = useApi();
  return useQuery({
    queryKey: [...RESCUERS_KEY, query],
    queryFn: ({ signal }) => api.listRescuers({ query: { ...(query.q ? { q: query.q } : {}), page: query.page, pageSize: RESCUERS_PAGE_SIZE } }, { signal }),
    placeholderData: keepPreviousData,
  });
}

/** Los equipos activos para elegir (selector de equipo de la ruta de la misión, RF-805): una sola página, el servidor admite hasta 200. */
export function useActiveTeams(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...TEAMS_KEY, 'list', 'options'],
    queryFn: ({ signal }) => api.listTeams({ query: { status: 'active', page: 1, pageSize: 200 } }, { signal }),
    enabled,
  });
}
