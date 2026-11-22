// Perfil propio del rescatista (H5-perfil). Las reglas las decide el servidor; aquí solo se leen y se envían.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OperationInput } from '@onway/contracts/client';
import { useApi } from '../session/api-context';
import { SESSION_KEY } from '../session/session';

export const PROFILE_KEY = ['my-profile'] as const;
const SENSITIVE_KEY = ['my-profile', 'sensitive'] as const;

export function useMyProfile() {
  const api = useApi();
  return useQuery({ queryKey: PROFILE_KEY, queryFn: ({ signal }) => api.getMyProfile({ signal }) });
}

/**
 * Documento y dirección sin ocultar, solo cuando la persona los pide (doc 02 §3.9). No se guardan en la caché más allá de la vista que
 * los pidió: `gcTime: 0` los retira al dejar de mostrarse.
 */
export function useMySensitive(enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: SENSITIVE_KEY, queryFn: ({ signal }) => api.getMySensitive({ signal }), enabled, gcTime: 0, staleTime: 0 });
}

/** Al guardar se vuelve a leer la sesión: si el alta quedó completa, `nextStep` deja de pedirla y se abre el resto de la app. */
export function useUpdateMyProfile() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OperationInput<'updateMyProfile'>['body']) => api.updateMyProfile({ body }),
    onSuccess: async (profile) => {
      queryClient.setQueryData(PROFILE_KEY, profile);
      queryClient.removeQueries({ queryKey: SENSITIVE_KEY });
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
  });
}
