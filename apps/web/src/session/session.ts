// Estado de sesión de la web. La cookie es HttpOnly: la web no la toca; solo pregunta a `getMe` quién es.
// El token CSRF lo recuerda el cliente generado a partir de `login` y `getMe`.
import { createContext, useContext } from 'react';
import { QueryCache, MutationCache, QueryClient, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError, type ApiClient, type OperationOutput } from '@onway/contracts/client';
import type { ErrorCode } from '@onway/contracts';
import { useApi } from './api-context';

export type SessionUser = OperationOutput<'getMe'>['user'];

/** Motivo por el que no hay sesión y conviene decírselo a la persona en el acceso. */
export type SessionNotice = Extract<ErrorCode, 'SESSION_EXPIRED' | 'ACCOUNT_DISABLED' | 'ACCOUNT_REJECTED'>;

export type SessionState = { status: 'anonymous'; notice: SessionNotice | null } | { status: 'authenticated'; user: SessionUser };

export const SESSION_KEY: QueryKey = ['session'];

const NOTICES: readonly ErrorCode[] = ['SESSION_EXPIRED', 'ACCOUNT_DISABLED', 'ACCOUNT_REJECTED'];

const authenticated = (user: SessionUser): SessionState => ({ status: 'authenticated', user });
const anonymous = (notice: SessionNotice | null = null): SessionState => ({ status: 'anonymous', notice });

/** ¿Este error significa «ya no hay sesión válida»? */
export function endsSession(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.code === 'UNAUTHENTICATED' || error.code === 'SESSION_EXPIRED');
}

function noticeOf(error: ApiError): SessionNotice | null {
  return NOTICES.includes(error.code) ? (error.code as SessionNotice) : null;
}

/**
 * Cliente de consultas con la regla de «sesión caducada» (doc 02 §8): si cualquier consulta o acción responde que la sesión
 * ya no vale, se vacía la caché y la vista de acceso conserva la dirección a la que se iba.
 */
export function createQueryClient(): QueryClient {
  const onSessionLost = (error: unknown) => {
    if (!endsSession(error)) return;
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
    client.setQueryData(SESSION_KEY, anonymous(error.code === 'SESSION_EXPIRED' ? 'SESSION_EXPIRED' : null));
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: onSessionLost }),
    mutationCache: new MutationCache({ onError: onSessionLost }),
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
  });
  return client;
}

async function loadSession(api: ApiClient, signal: AbortSignal): Promise<SessionState> {
  try {
    const { user } = await api.getMe({ signal });
    return { status: 'authenticated', user };
  } catch (error) {
    if (endsSession(error)) return anonymous(noticeOf(error));
    // Cuenta rechazada o desactivada con la sesión viva: no hay datos que mostrar, solo el motivo en el acceso.
    if (error instanceof ApiError && (error.code === 'ACCOUNT_DISABLED' || error.code === 'ACCOUNT_REJECTED')) return anonymous(noticeOf(error));
    throw error;
  }
}

export function useSession() {
  const api = useApi();
  return useQuery({ queryKey: SESSION_KEY, queryFn: ({ signal }) => loadSession(api, signal), staleTime: Infinity });
}

/**
 * Usuario de la sesión. Lo entrega por contexto `RequireSession`: así ninguna vista se pinta con una sesión ya perdida
 * mientras su guarda aún no ha retirado la vista (varios suscriptores se actualizan por separado).
 */
export const CurrentUserContext = createContext<SessionUser | null>(null);

export function useCurrentUser(): SessionUser {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error('useCurrentUser solo se usa bajo RequireSession');
  return user;
}

export function useLogin() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api.login({ body: input }),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(SESSION_KEY, authenticated(user));
    },
  });
}

export function useLogout() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    // Solo si el servidor confirma el cierre: si falla, la persona sigue dentro y ve el error.
    onSuccess: () => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
      queryClient.setQueryData(SESSION_KEY, anonymous());
    },
  });
}
