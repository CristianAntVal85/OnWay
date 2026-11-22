// Cursos y habilidades del rescatista (H5-habilidades, RF-808). Las reglas las decide el servidor; aquí solo se leen y se envían.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../session/api-context';
import { PROFILE_KEY } from './queries';

export const SKILLS_KEY = ['my-skills'] as const;

export function useMySkills() {
  const api = useApi();
  return useQuery({ queryKey: SKILLS_KEY, queryFn: ({ signal }) => api.listMySkills({ signal }) });
}

/** Cada cambio vuelve a leer la lista y el perfil (que lleva las mismas entradas en `skills`). */
export function useInvalidateSkills() {
  const queryClient = useQueryClient();
  return () => Promise.all([queryClient.invalidateQueries({ queryKey: SKILLS_KEY }), queryClient.invalidateQueries({ queryKey: PROFILE_KEY, exact: true })]);
}

export function useDeleteSkill() {
  const api = useApi();
  const invalidate = useInvalidateSkills();
  return useMutation({ mutationFn: (skillId: string) => api.deleteMySkill({ params: { skillId } }), onSuccess: invalidate });
}
