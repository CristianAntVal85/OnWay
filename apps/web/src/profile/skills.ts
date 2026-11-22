// Cursos y habilidades del rescatista (H5-habilidades, RF-808). Las reglas las decide el servidor; aquí solo se leen y se envían.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../session/api-context';
import type { ApiClient, OperationInput } from '@onway/contracts/client';
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

export type SkillCreate = OperationInput<'createMySkill'>['body'];
export type SkillChanges = OperationInput<'updateMySkill'>['body'];

/** Sube el certificado (PDF, JPG o PNG: el servidor decide el tipo por su contenido) y devuelve la referencia del archivo guardado. */
export async function uploadCertificate(api: ApiClient, file: File) {
  const form = new FormData();
  form.set('purpose', 'certificate');
  form.set('file', file, file.name);
  return api.uploadFile({ body: form });
}

export function useCreateSkill() {
  const api = useApi();
  const invalidate = useInvalidateSkills();
  return useMutation({ mutationFn: (body: SkillCreate) => api.createMySkill({ body }), onSuccess: invalidate });
}

export function useUpdateSkill() {
  const api = useApi();
  const invalidate = useInvalidateSkills();
  return useMutation({ mutationFn: (input: { skillId: string; body: SkillChanges }) => api.updateMySkill({ params: { skillId: input.skillId }, body: input.body }), onSuccess: invalidate });
}

/**
 * Abre el certificado en una pestaña nueva (D-S3). La pestaña se abre vacía en el mismo gesto del clic (si no, el navegador la bloquea),
 * después se pide el enlace firmado y la pestaña navega a él sin acceso a esta ventana. Si algo falla, la pestaña se cierra y se lanza el error.
 */
export function useOpenCertificate() {
  const api = useApi();
  return useMutation({
    mutationFn: async (skillId: string) => {
      const tab = window.open('', '_blank');
      if (!tab) throw new PopupBlockedError();
      try {
        tab.opener = null;
        const link = await api.getCertificateLink({ params: { skillId } });
        tab.location.href = link.url;
      } catch (error) {
        tab.close();
        throw error;
      }
    },
  });
}

export class PopupBlockedError extends Error {}
