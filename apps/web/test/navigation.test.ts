import { describe, expect, it } from 'vitest';
import { MemberRole } from '@onway/contracts';
import { es } from '@onway/i18n';
import { NAV_ITEMS, PATHS, missionPath, ROUTE_ROLES, canAccess, landingPath, navItemsFor, postLoginPath, routeIdForPath, type RouteId } from '../src/nav/navigation';

const ROLES = MemberRole.options;
const ROUTE_IDS = Object.keys(ROUTE_ROLES) as RouteId[];
const labels = (role: (typeof ROLES)[number]) => navItemsFor(role).map((item) => item.id);

describe('barra de navegación por rol (RF-702, D-H0-20)', () => {
  it('el administrador ve Inicio, Misiones, Rutas, Equipos, Administración y Cuenta, sin Crear misión (Q-14 = no)', () => {
    expect(labels('admin')).toEqual(['home', 'missions', 'routes', 'teams', 'admin', 'account']);
  });

  it('el coordinador ve lo mismo, con Crear misión y sin Administración', () => {
    expect(labels('coordinator')).toEqual(['home', 'missions', 'createMission', 'routes', 'teams', 'account']);
  });

  it('el rescatista ve solo Misiones, Mi perfil y Cuenta', () => {
    expect(labels('rescuer')).toEqual(['missions', 'profile', 'account']);
  });

  it('las tres barras son distintas', () => {
    const bars = ROLES.map((role) => labels(role).join());
    expect(new Set(bars).size).toBe(3);
  });

  it('todos tienen Cuenta; nadie más que el administrador tiene Administración; Mi perfil es del rescatista', () => {
    for (const role of ROLES) expect(labels(role)).toContain('account');
    expect(ROLES.filter((role) => labels(role).includes('admin'))).toEqual(['admin']);
    expect(ROLES.filter((role) => labels(role).includes('profile'))).toEqual(['rescuer']);
  });

  it('cada enlace usa una etiqueta que existe en packages/i18n', () => {
    for (const item of NAV_ITEMS) {
      const [, key] = item.labelKey.split('.') as [string, keyof typeof es.nav];
      expect(es.nav[key], item.labelKey).toBeTruthy();
    }
  });

  it('las rutas son únicas', () => {
    const paths = NAV_ITEMS.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('cada ruta rechaza los roles no permitidos (RF-103 en interfaz)', () => {
  const matrix: Record<RouteId, string[]> = {
    home: ['admin', 'coordinator'],
    missions: ['admin', 'coordinator', 'rescuer'],
    createMission: ['coordinator'],
    routes: ['admin', 'coordinator'],
    createRoute: ['coordinator'],
    teams: ['admin', 'coordinator'],
    admin: ['admin'],
    profile: ['rescuer'],
    account: ['admin', 'coordinator', 'rescuer'],
  };

  it('coincide con la matriz esperada, rol por rol', () => {
    for (const route of ROUTE_IDS) {
      expect(
        ROLES.filter((role) => canAccess(role, route)),
        route,
      ).toEqual(ROLES.filter((role) => matrix[route].includes(role)));
    }
  });

  it('Crear misión es solo del coordinador: el administrador no escribe misiones (Q-14 = no, D-H1-13)', () => {
    expect(ROLES.filter((role) => canAccess(role, 'createMission'))).toEqual(['coordinator']);
    expect(ROLES.filter((role) => labels(role).includes('createMission'))).toEqual(['coordinator']);
  });

  it('el rescatista no puede abrir ninguna ruta de personal', () => {
    for (const route of ['home', 'createMission', 'routes', 'teams', 'admin'] as const) expect(canAccess('rescuer', route), route).toBe(false);
  });

  it('el coordinador no puede abrir Administración ni Mi perfil', () => {
    expect(canAccess('coordinator', 'admin')).toBe(false);
    expect(canAccess('coordinator', 'profile')).toBe(false);
  });

  it('un enlace de la barra siempre es una ruta permitida para ese rol', () => {
    for (const role of ROLES) for (const item of navItemsFor(role)) expect(canAccess(role, item.id)).toBe(true);
  });
});

describe('destinos', () => {
  it('routeIdForPath reconoce las rutas y tolera la barra final', () => {
    expect(routeIdForPath('/admin')).toBe('admin');
    expect(routeIdForPath('/missions/')).toBe('missions');
    expect(routeIdForPath('/missions/new')).toBe('createMission');
    expect(missionPath('abc')).toBe('/missions/abc');
    expect(routeIdForPath('/desconocida')).toBeNull();
    expect(routeIdForPath('/')).toBeNull();
  });

  it('pantalla de entrada: personal a Inicio, rescatista a Misiones o a completar el perfil, pendiente a la espera', () => {
    expect(landingPath({ role: 'admin', nextStep: 'home' })).toBe(PATHS.home);
    expect(landingPath({ role: 'coordinator', nextStep: 'home' })).toBe(PATHS.home);
    expect(landingPath({ role: 'rescuer', nextStep: 'home' })).toBe(PATHS.missions);
    expect(landingPath({ role: 'rescuer', nextStep: 'complete-profile' })).toBe(PATHS.profile);
    expect(landingPath({ role: null, nextStep: 'awaiting-approval' })).toBe(PATHS.waiting);
  });

  it('tras iniciar sesión vuelve a la vista pedida solo si el rol puede abrirla', () => {
    const coordinator = { role: 'coordinator', nextStep: 'home' } as const;
    expect(postLoginPath(coordinator, '/routes')).toBe('/routes');
    expect(postLoginPath(coordinator, '/admin')).toBe(PATHS.home);
    expect(postLoginPath(coordinator, '/desconocida')).toBe(PATHS.home);
    expect(postLoginPath(coordinator, null)).toBe(PATHS.home);
  });

  it('una cuenta pendiente va siempre a la espera, pida lo que pida', () => {
    expect(postLoginPath({ role: null, nextStep: 'awaiting-approval' }, '/home')).toBe(PATHS.waiting);
  });
});
