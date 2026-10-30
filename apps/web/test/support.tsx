import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { createApiClient } from '@onway/contracts/client';
import type { ErrorCode } from '@onway/contracts';
import { AppProviders } from '../src/app/providers';
import { AppRoutes } from '../src/app/routes';
import { createI18n } from '../src/i18n';
import { createQueryClient, type SessionUser } from '../src/session/session';

export interface Call {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

export const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-test' } });

export const apiError = (status: number, code: ErrorCode, details?: Record<string, unknown>) =>
  json(status, { error: { code, message: `server text for ${code}`, requestId: 'req-test', ...(details ? { details } : {}) } });

/** API simulada a nivel de `fetch`: pasa por el cliente generado real, con su cabecera CSRF y su conversión a `ApiError`. */
export function fakeApi(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const call: Call = {
      method,
      path: url.pathname.replace(/^\/api\/v1/, ''),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const handler = handlers[`${method} ${call.path}`];
    if (!handler) return apiError(404, 'NOT_FOUND');
    return handler(call);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export function sessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'coordinador@example.org',
    displayName: 'Coordinador Demo',
    locale: 'es',
    accountStatus: 'active',
    organization: { id: '22222222-2222-4222-8222-222222222222', name: 'Servicio de Rescate Valle Demo' },
    role: 'coordinator',
    profileStatus: null,
    nextStep: 'home',
    ...overrides,
  };
}

export const admin = () => sessionUser({ email: 'admin@example.org', displayName: 'Admin Demo', role: 'admin' });
export const rescuer = (overrides: Partial<SessionUser> = {}) =>
  sessionUser({ email: 'rescatista1@example.org', displayName: 'Rescatista Demo', role: 'rescuer', profileStatus: 'incomplete', nextStep: 'complete-profile', ...overrides });
export const pending = () => sessionUser({ email: 'pendiente@example.org', displayName: 'Cuenta Pendiente', accountStatus: 'pending', organization: null, role: null, nextStep: 'awaiting-approval' });

export const org = () => ({ id: '22222222-2222-4222-8222-222222222222', name: 'Servicio de Rescate Valle Demo', country: 'ES', config: { validationMaxAgeDays: 90, maxUploadBytes: 10_485_760 } });

/** Servidor simulado con una sesión que las pruebas pueden cambiar: `state.user` = quién está dentro; `state.expired` = cookie caducada. */
export function sessionServer(initial: { user?: SessionUser | null; expired?: boolean } = {}) {
  const state = { user: initial.user ?? null, expired: initial.expired ?? false, password: 'OnWay-demo-ficticia-2026', accounts: new Map<string, SessionUser>() };
  const api = fakeApi({
    'GET /auth/me': () => {
      if (state.expired) return apiError(401, 'SESSION_EXPIRED');
      if (!state.user) return apiError(401, 'UNAUTHENTICATED');
      return json(200, { user: state.user, csrfToken: 'csrf-token-1' });
    },
    'POST /auth/login': ({ body }) => {
      const { email, password } = body as { email: string; password: string };
      const account = state.accounts.get(email);
      if (!account || password !== state.password) return apiError(401, 'INVALID_CREDENTIALS');
      state.user = account;
      state.expired = false;
      return json(200, { user: account, csrfToken: 'csrf-token-1' });
    },
    'POST /auth/logout': ({ headers }) => {
      if (headers.get('X-CSRF-Token') !== 'csrf-token-1') return apiError(403, 'CSRF_FAILED');
      state.user = null;
      return json(204, null);
    },
    'GET /org': () => (state.user?.role ? json(200, org()) : apiError(403, 'ACCOUNT_PENDING')),
  });
  return { state, api };
}

function PathProbe() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

export function renderApp(options: { route?: string; fetch: typeof fetch; language?: 'es' | 'fr' }) {
  const queryClient = createQueryClient();
  const i18n = createI18n(options.language ?? 'es');
  const user = userEvent.setup();
  const view = render(
    <AppProviders api={createApiClient({ fetch: options.fetch })} queryClient={queryClient} i18n={i18n}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>
        <AppRoutes />
        <PathProbe />
      </MemoryRouter>
    </AppProviders>,
  );
  return { user, i18n, queryClient, ...view };
}
