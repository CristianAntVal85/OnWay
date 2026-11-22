// Consultas y acciones de la administración: altas (RF-106, `H5-acceso`) y usuarios (RF-813, `H5-usuarios`). Nada de reglas aquí: las decide el servidor.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OperationInput } from '@onway/contracts/client';
import { useApi } from '../session/api-context';

export const SIGNUPS_PAGE_SIZE = 20;
export const USERS_PAGE_SIZE = 20;

export type SignupStatus = 'pending' | 'approved' | 'rejected';
export const SIGNUP_STATUSES: readonly SignupStatus[] = ['pending', 'approved', 'rejected'];

const SIGNUPS_KEY = ['admin', 'signups'] as const;
const USERS_KEY = ['admin', 'users'] as const;
const INVITE_KEY = ['admin', 'invite-code'] as const;

export function useSignupRequests(query: { status: SignupStatus; q: string; page: number }) {
  const api = useApi();
  return useQuery({
    queryKey: [...SIGNUPS_KEY, 'list', query],
    queryFn: ({ signal }) => api.listSignupRequests({ query: { status: query.status, ...(query.q ? { q: query.q } : {}), page: query.page, pageSize: SIGNUPS_PAGE_SIZE } }, { signal }),
    placeholderData: keepPreviousData,
  });
}

/** Aprobar o rechazar en bloque. Pase lo que pase (también un 409 o un 404 por una decisión ajena) la bandeja se vuelve a leer. */
export function useDecideSignups() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OperationInput<'decideSignupRequests'>['body']) => api.decideSignupRequests({ body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SIGNUPS_KEY }),
  });
}

export function useInviteCode() {
  const api = useApi();
  return useQuery({ queryKey: INVITE_KEY, queryFn: ({ signal }) => api.getInviteCode({ signal }) });
}

export function useRotateInviteCode() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.rotateInviteCode({ body: {} }),
    onSuccess: (next) => queryClient.setQueryData(INVITE_KEY, next),
  });
}

export interface UsersQuery {
  q: string;
  role: 'admin' | 'coordinator' | 'rescuer' | '';
  accountStatus: 'active' | 'disabled' | '';
  page: number;
}

export function useUsers(query: UsersQuery) {
  const api = useApi();
  return useQuery({
    queryKey: [...USERS_KEY, 'list', query],
    queryFn: ({ signal }) =>
      api.listUsers(
        {
          query: {
            ...(query.q ? { q: query.q } : {}),
            ...(query.role ? { role: query.role } : {}),
            ...(query.accountStatus ? { accountStatus: query.accountStatus } : {}),
            page: query.page,
            pageSize: USERS_PAGE_SIZE,
          },
        },
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
}

export function useUser(userId: string) {
  const api = useApi();
  return useQuery({ queryKey: [...USERS_KEY, 'detail', userId], queryFn: ({ signal }) => api.getUser({ params: { userId } }, { signal }), retry: false });
}

/** Cambiar el rol, desactivar o reactivar (RN-11, INV-29). Solo se envía lo que cambia: el servidor rechaza un campo igual al actual. */
export function useUpdateUser(userId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OperationInput<'updateUser'>['body']) => api.updateUser({ params: { userId }, body }),
    onSuccess: (next) => queryClient.setQueryData([...USERS_KEY, 'detail', userId], next),
    // Pase lo que pase (también un 409) la lista y la ficha se vuelven a leer.
    onSettled: () => queryClient.invalidateQueries({ queryKey: USERS_KEY }),
  });
}

/** Coordinadores activos, el selector del nuevo responsable (la misma consulta que usan las misiones). */
export function useCoordinators() {
  const api = useApi();
  return useQuery({ queryKey: ['coordinators'], queryFn: ({ signal }) => api.listCoordinators({ signal }) });
}
