// Consultas y acciones de la administración de altas (RF-106, `H5-acceso`). Nada de reglas aquí: las decide el servidor.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OperationInput } from '@onway/contracts/client';
import { useApi } from '../session/api-context';

export const SIGNUPS_PAGE_SIZE = 20;

export type SignupStatus = 'pending' | 'approved' | 'rejected';
export const SIGNUP_STATUSES: readonly SignupStatus[] = ['pending', 'approved', 'rejected'];

const SIGNUPS_KEY = ['admin', 'signups'] as const;
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
