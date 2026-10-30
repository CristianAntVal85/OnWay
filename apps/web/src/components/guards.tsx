import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { PATHS, canAccess, landingPath, type RouteId } from '../nav/navigation';
import { CurrentUserContext, useCurrentUser, useSession } from '../session/session';
import { ForbiddenPage } from '../pages/forbidden-page';
import { ErrorState, LoadingState } from './states';
import { MAIN_ID } from './skip-link';

function FullPage({ children }: { children: ReactNode }) {
  return (
    <main id={MAIN_ID} tabIndex={-1} className="full-page">
      {children}
    </main>
  );
}

/** Todo lo que no es el acceso exige sesión. Sin ella se va al acceso conservando la vista a la que se iba (doc 02 §8). */
export function RequireSession() {
  const { data, error, isPending, refetch } = useSession();
  const location = useLocation();
  if (isPending)
    return (
      <FullPage>
        <LoadingState />
      </FullPage>
    );
  if (error || !data)
    return (
      <FullPage>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </FullPage>
    );
  if (data.status === 'anonymous') return <Navigate to={PATHS.login} replace state={{ from: `${location.pathname}${location.search}` }} />;
  return (
    <CurrentUserContext.Provider value={data.user}>
      <Outlet />
    </CurrentUserContext.Provider>
  );
}

/** Una cuenta pendiente (INV-25) solo ve la pantalla de espera: cualquier otra vista la devuelve allí. */
export function RequireActive() {
  const user = useCurrentUser();
  if (user.nextStep === 'awaiting-approval' || !user.role) return <Navigate to={PATHS.waiting} replace />;
  return <Outlet />;
}

/** La ruta existe, pero este rol no puede abrirla: se queda en la dirección y se explica (D-H0-20). El servidor la rechazaría igual. */
export function RoleGate({ route, children }: { route: RouteId; children: ReactNode }) {
  const user = useCurrentUser();
  if (!user.role || !canAccess(user.role, route)) return <ForbiddenPage />;
  return <>{children}</>;
}

/** Entrada: `/` lleva a la pantalla de inicio del rol. */
export function RedirectToLanding() {
  const user = useCurrentUser();
  return <Navigate to={landingPath(user)} replace />;
}
