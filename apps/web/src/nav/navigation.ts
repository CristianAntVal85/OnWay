// Navegación por rol (RF-702, doc 02 §2, D-H0-20). Módulo puro: sin React, sin red.
// Es una ayuda de interfaz: quien decide los permisos es el servidor (RF-103).
import type { MemberRole } from '@onway/contracts';

export type RouteId = 'home' | 'missions' | 'createMission' | 'routes' | 'createRoute' | 'generateRoutes' | 'teams' | 'admin' | 'profile' | 'account' | 'weather';

export type NextStep = 'home' | 'complete-profile' | 'awaiting-approval';

/** Dirección del detalle de una misión. */
export const missionPath = (missionId: string) => `${'/missions'}/${missionId}`;

/** Dirección de la vista de detalle del tiempo (issue #18): con `mission` para el objetivo de una misión; sin ella, la ubicación del dispositivo. */
export const weatherPath = (missionId?: string | null) => (missionId ? `${'/weather'}?mission=${encodeURIComponent(missionId)}` : '/weather');

/** Dirección del detalle de una ruta de la biblioteca. */
export const routePath = (routeId: string) => `${'/routes'}/${routeId}`;

export const PATHS = {
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  waiting: '/waiting',
  home: '/home',
  missions: '/missions',
  createMission: '/missions/new',
  routes: '/routes',
  createRoute: '/routes/draw',
  generateRoutes: '/routes/generate',
  routeImport: '/routes/import',
  teams: '/teams',
  admin: '/admin',
  profile: '/profile',
  account: '/account',
  weather: '/weather',
} as const satisfies Record<'login' | 'register' | 'forgotPassword' | 'resetPassword' | 'waiting' | 'routeImport' | RouteId, string>;

const STAFF: readonly MemberRole[] = ['admin', 'coordinator'];
/** Quien escribe sobre misiones: Q-14 = no, el administrador las lee pero no las crea ni las edita (D-H1-13). */
const MISSION_WRITERS: readonly MemberRole[] = ['coordinator'];
const EVERYONE: readonly MemberRole[] = ['admin', 'coordinator', 'rescuer'];

/** Roles que pueden abrir cada ruta. Una ruta fuera de esta lista muestra «sin acceso». */
export const ROUTE_ROLES: Readonly<Record<RouteId, readonly MemberRole[]>> = {
  home: STAFF,
  missions: EVERYONE,
  createMission: MISSION_WRITERS,
  routes: STAFF,
  createRoute: MISSION_WRITERS,
  generateRoutes: MISSION_WRITERS,
  teams: STAFF,
  admin: ['admin'],
  profile: ['rescuer'],
  account: EVERYONE,
  weather: EVERYONE,
};

/** Claves de `packages/i18n` de la etiqueta de cada enlace. */
export type NavLabelKey = `nav.${'home' | 'missions' | 'createMission' | 'routes' | 'teams' | 'administration' | 'myProfile' | 'account'}`;

export interface NavItem {
  readonly id: RouteId;
  readonly path: string;
  readonly labelKey: NavLabelKey;
}

/** Orden de la barra. La barra de un rol es este orden filtrado por `ROUTE_ROLES`. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', path: PATHS.home, labelKey: 'nav.home' },
  { id: 'missions', path: PATHS.missions, labelKey: 'nav.missions' },
  { id: 'createMission', path: PATHS.createMission, labelKey: 'nav.createMission' },
  { id: 'routes', path: PATHS.routes, labelKey: 'nav.routes' },
  { id: 'teams', path: PATHS.teams, labelKey: 'nav.teams' },
  { id: 'admin', path: PATHS.admin, labelKey: 'nav.administration' },
  { id: 'profile', path: PATHS.profile, labelKey: 'nav.myProfile' },
  { id: 'account', path: PATHS.account, labelKey: 'nav.account' },
];

export function canAccess(role: MemberRole, route: RouteId): boolean {
  return ROUTE_ROLES[route].includes(role);
}

export function navItemsFor(role: MemberRole): NavItem[] {
  return NAV_ITEMS.filter((item) => canAccess(role, item.id));
}

/** Ruta a la que pertenece una dirección, o `null` si no es ninguna de la barra. */
export function routeIdForPath(path: string): RouteId | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return NAV_ITEMS.find((item) => item.path === clean)?.id ?? null;
}

interface Landing {
  role: MemberRole | null;
  nextStep: NextStep;
}

/** Primera pantalla tras entrar. El rescatista no tiene «Inicio» en su barra (RF-702): entra por su perfil o por Misiones. */
export function landingPath({ role, nextStep }: Landing): string {
  if (nextStep === 'awaiting-approval') return PATHS.waiting;
  if (role === 'rescuer') return nextStep === 'complete-profile' ? PATHS.profile : PATHS.missions;
  return PATHS.home;
}

/** Destino tras iniciar sesión: la vista a la que se iba si el rol puede abrirla; si no, la pantalla de entrada del rol. */
export function postLoginPath(user: Landing, from?: string | null): string {
  if (user.nextStep === 'awaiting-approval' || !user.role) return PATHS.waiting;
  const id = from ? routeIdForPath(from) : null;
  if (from && id && canAccess(user.role, id)) return from;
  return landingPath(user);
}

/** Clave de i18n del nombre de cada rol. */
export const ROLE_LABEL_KEYS = {
  admin: 'account.roleAdmin',
  coordinator: 'account.roleCoordinator',
  rescuer: 'account.roleRescuer',
} as const satisfies Record<MemberRole, string>;
