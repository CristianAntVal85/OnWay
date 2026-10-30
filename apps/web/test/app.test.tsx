import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { es, fr } from '@onway/i18n';
import { admin, apiError, fakeApi, org, pending, renderApp, rescuer, sessionServer, sessionUser } from './support';

const PASSWORD = 'OnWay-demo-ficticia-2026';

const navNames = () =>
  within(screen.getByRole('navigation', { name: es.nav.label }))
    .getAllByRole('link')
    .map((link) => link.textContent);
const path = () => screen.getByTestId('path').textContent;

async function signIn(user: ReturnType<typeof renderApp>['user'], email: string, password = PASSWORD) {
  await user.type(await screen.findByLabelText(es.login.email), email);
  await user.type(screen.getByLabelText(es.login.password), password);
  await user.click(screen.getByRole('button', { name: es.login.submit }));
}

describe('acceso (RF-101)', () => {
  it('sin sesión cualquier dirección lleva al acceso', async () => {
    const { api } = sessionServer();
    renderApp({ route: '/missions', fetch: api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: es.login.title })).toBeTruthy();
    expect(path()).toBe('/login');
    expect(screen.getByText(es.login.demoNotice)).toBeTruthy();
  });

  it('credenciales erróneas dan siempre el mismo mensaje genérico, exista o no la cuenta', async () => {
    const { api, state } = sessionServer();
    state.accounts.set('coordinador@example.org', sessionUser());
    const { user } = renderApp({ fetch: api.fetch });

    await signIn(user, 'coordinador@example.org', 'contraseña-equivocada');
    const wrongPassword = (await screen.findByRole('alert', { name: '' })).textContent;
    expect(wrongPassword).toBe(es.errors.INVALID_CREDENTIALS);

    await user.clear(screen.getByLabelText(es.login.email));
    await user.type(screen.getByLabelText(es.login.email), 'nadie@example.org');
    await user.click(screen.getByRole('button', { name: es.login.submit }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === '/auth/login')).toHaveLength(2));
    expect(screen.getByRole('alert').textContent).toBe(wrongPassword);
    expect(path()).toBe('/login');
  });

  it('cuenta bloqueada: muestra el tiempo restante', async () => {
    const fake = fakeApi({
      'GET /auth/me': () => apiError(401, 'UNAUTHENTICATED'),
      'POST /auth/login': () => apiError(423, 'ACCOUNT_LOCKED', { retryAfterSeconds: 125 }),
    });
    const { user } = renderApp({ fetch: fake.fetch });
    await signIn(user, 'coordinador@example.org');
    const alert = await screen.findByText(/125/);
    expect(alert.textContent).toBe(es.errors.ACCOUNT_LOCKED.replace('{{seconds}}', '125'));
  });

  it('campos vacíos: error asociado al campo, foco en el primero y ninguna petición', async () => {
    const { api } = sessionServer();
    const { user } = renderApp({ fetch: api.fetch });
    await user.click(await screen.findByRole('button', { name: es.login.submit }));
    const email = screen.getByLabelText(es.login.email);
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    const errorId = email.getAttribute('aria-describedby')!;
    expect(document.getElementById(errorId)?.textContent).toBe(es.login.emailRequired);
    expect(api.calls.some((c) => c.path === '/auth/login')).toBe(false);

    await user.type(email, 'a@example.org');
    await user.click(screen.getByRole('button', { name: es.login.submit }));
    expect(document.activeElement).toBe(screen.getByLabelText(es.login.password));
    expect(document.getElementById(screen.getByLabelText(es.login.password).getAttribute('aria-describedby')!)?.textContent).toBe(es.login.passwordRequired);
  });

  it('se entra con Enter desde el teclado', async () => {
    const { api, state } = sessionServer();
    state.accounts.set('coordinador@example.org', sessionUser());
    const { user } = renderApp({ fetch: api.fetch });
    await user.type(await screen.findByLabelText(es.login.email), 'coordinador@example.org');
    await user.tab();
    await user.type(document.activeElement as HTMLElement, `${PASSWORD}{Enter}`);
    expect(await screen.findByRole('heading', { level: 1, name: es.home.title })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('orden de tabulación del acceso: saltar al contenido, correo, contraseña, entrar, idioma', async () => {
    const { api } = sessionServer();
    const { user } = renderApp({ fetch: api.fetch });
    await screen.findByLabelText(es.login.email);
    const order: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      order.push(el.textContent || el.getAttribute('name') || el.id);
    }
    expect(order.slice(0, 4)).toEqual([es.nav.skipToContent, 'email', 'password', es.login.submit]);
    expect((document.activeElement as HTMLInputElement).type).toBe('radio');
  });

  it('sesión caducada: la pantalla de acceso lo avisa (doc 02 §8)', async () => {
    const { api } = sessionServer({ expired: true });
    renderApp({ route: '/home', fetch: api.fetch });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(es.session.expired));
    expect(path()).toBe('/login');
  });

  it('la caducidad en mitad de la sesión lleva al acceso y, al volver a entrar, a la vista en la que estaba', async () => {
    const { api, state } = sessionServer({ user: admin() });
    state.accounts.set('admin@example.org', admin());
    let first = true;
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/org') && first) {
        first = false;
        state.user = null;
        state.expired = true;
        return apiError(401, 'SESSION_EXPIRED');
      }
      return api.fetch(input, init);
    };
    const { user } = renderApp({ route: '/home', fetch: fetchImpl });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(es.session.expired));
    expect(path()).toBe('/login');
    await signIn(user, 'admin@example.org');
    expect(await screen.findByRole('heading', { level: 1, name: es.home.title })).toBeTruthy();
    expect(path()).toBe('/home');
  });

  it('no deja pasar a una cuenta desactivada con la sesión viva: avisa en el acceso', async () => {
    const fake = fakeApi({ 'GET /auth/me': () => apiError(403, 'ACCOUNT_DISABLED') });
    renderApp({ route: '/home', fetch: fake.fetch });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(es.errors.ACCOUNT_DISABLED));
  });
});

describe('marco y barra por rol (RF-702)', () => {
  it('administrador: siete enlaces, con Administración', async () => {
    const { api } = sessionServer({ user: admin() });
    renderApp({ fetch: api.fetch });
    await screen.findByRole('heading', { level: 1, name: es.home.title });
    expect(navNames()).toEqual([es.nav.home, es.nav.missions, es.nav.createMission, es.nav.routes, es.nav.teams, es.nav.administration, es.nav.account]);
    expect(path()).toBe('/home');
  });

  it('coordinador: seis enlaces, sin Administración', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    renderApp({ fetch: api.fetch });
    await screen.findByRole('heading', { level: 1, name: es.home.title });
    expect(navNames()).toEqual([es.nav.home, es.nav.missions, es.nav.createMission, es.nav.routes, es.nav.teams, es.nav.account]);
  });

  it('rescatista con el perfil incompleto: entra por «Completa tu perfil» con Misiones, Mi perfil y Cuenta', async () => {
    const { api } = sessionServer({ user: rescuer() });
    renderApp({ fetch: api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: es.profile.completeTitle })).toBeTruthy();
    expect(screen.getByText(es.profile.completeBody)).toBeTruthy();
    expect(path()).toBe('/profile');
    expect(navNames()).toEqual([es.nav.missions, es.nav.myProfile, es.nav.account]);
  });

  it('rescatista con el perfil completo entra por Misiones', async () => {
    const { api } = sessionServer({ user: rescuer({ profileStatus: 'complete', nextStep: 'home' }) });
    renderApp({ fetch: api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: es.nav.missions })).toBeTruthy();
    expect(path()).toBe('/missions');
  });

  it('el enlace de la vista actual lleva aria-current', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    renderApp({ route: '/routes', fetch: api.fetch });
    await screen.findByRole('heading', { level: 1, name: es.nav.routes });
    const current = within(screen.getByRole('navigation'))
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current.map((l) => l.textContent)).toEqual([es.nav.routes]);
  });

  it('las secciones futuras dicen que llegan en un hito posterior', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    renderApp({ route: '/teams', fetch: api.fetch });
    expect(await screen.findByRole('heading', { level: 2, name: es.later.title })).toBeTruthy();
    expect(screen.getByText(es.later.body)).toBeTruthy();
  });

  it('el rescatista que abre /admin o /home ve «sin acceso» y ningún contenido ajeno', async () => {
    for (const route of ['/admin', '/home', '/missions/new', '/routes', '/teams']) {
      const { api } = sessionServer({ user: rescuer() });
      const view = renderApp({ route, fetch: api.fetch });
      expect(await screen.findByRole('heading', { level: 1, name: es.forbidden.title }), route).toBeTruthy();
      expect(screen.getByText(es.forbidden.body)).toBeTruthy();
      expect(path()).toBe(route);
      expect(screen.queryByText(es.later.title)).toBeNull();
      expect(api.calls.some((c) => c.path === '/org')).toBe(false);
      view.unmount();
    }
  });

  it('el coordinador que abre /admin ve «sin acceso»; el administrador sí entra', async () => {
    const coordinator = sessionServer({ user: sessionUser() });
    const first = renderApp({ route: '/admin', fetch: coordinator.api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: es.forbidden.title })).toBeTruthy();
    first.unmount();

    const adminServer = sessionServer({ user: admin() });
    renderApp({ route: '/admin', fetch: adminServer.api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: es.nav.administration })).toBeTruthy();
  });

  it('una dirección que no existe muestra «página no encontrada» dentro del marco', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    renderApp({ route: '/nada-por-aqui', fetch: api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: es.notFound.title })).toBeTruthy();
    expect(navNames()).toHaveLength(6);
  });

  it('el menú móvil se abre y se cierra con el botón y con Escape, y avisa su estado', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    const { user } = renderApp({ fetch: api.fetch });
    const button = await screen.findByRole('button', { name: es.nav.menu });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe(screen.getByRole('navigation').id);
    await user.click(button);
    expect(screen.getByRole('button', { name: es.nav.closeMenu }).getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: es.nav.menu }).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: es.nav.menu }));
  });

  it('al navegar con el teclado el foco pasa al contenido', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    const { user } = renderApp({ fetch: api.fetch });
    await screen.findByRole('heading', { level: 1, name: es.home.title });
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: es.nav.teams }));
    await screen.findByRole('heading', { level: 1, name: es.nav.teams });
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('«saltar al contenido» apunta al contenido principal', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    renderApp({ fetch: api.fetch });
    await screen.findByRole('heading', { level: 1, name: es.home.title });
    const skip = screen.getByRole('link', { name: es.nav.skipToContent });
    expect(skip.getAttribute('href')).toBe(`#${screen.getByRole('main').id}`);
  });
});

describe('inicio provisional: carga, error y datos', () => {
  it('muestra la organización de la sesión', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    renderApp({ fetch: api.fetch });
    expect(await screen.findByText(org().name, { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('España')).toBeTruthy();
  });

  it('mientras carga lo anuncia, y si falla ofrece reintentar', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    let attempts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/org')) {
        attempts += 1;
        if (attempts === 1) return apiError(500, 'INTERNAL');
      }
      return api.fetch(input, init);
    };
    const { user } = renderApp({ fetch: fetchImpl });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(es.state.errorTitle)).toBeTruthy();
    expect(within(alert).getByText(es.errors.INTERNAL)).toBeTruthy();
    await user.click(within(alert).getByRole('button', { name: es.state.retry }));
    expect(await screen.findByText(org().name, { selector: 'dd' })).toBeTruthy();
  });

  it('sin conexión dice que hace falta conexión', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/org')) throw new TypeError('Failed to fetch');
      return api.fetch(input, init);
    };
    renderApp({ fetch: fetchImpl });
    expect(await screen.findByText(es.state.offline)).toBeTruthy();
  });
});

describe('cuenta pendiente (INV-25 en interfaz)', () => {
  it('al entrar solo ve la espera, sin barra ni datos, y puede cerrar sesión', async () => {
    const { api, state } = sessionServer();
    state.accounts.set('pendiente@example.org', pending());
    const { user } = renderApp({ fetch: api.fetch });
    await signIn(user, 'pendiente@example.org');
    expect(await screen.findByRole('heading', { level: 1, name: es.waiting.title })).toBeTruthy();
    expect(path()).toBe('/waiting');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(api.calls.some((c) => c.path === '/org')).toBe(false);

    await user.click(screen.getByRole('button', { name: es.waiting.logout }));
    expect(await screen.findByRole('heading', { level: 1, name: es.login.title })).toBeTruthy();
    expect(api.calls.find((c) => c.path === '/auth/logout')?.headers.get('X-CSRF-Token')).toBe('csrf-token-1');
  });

  it('cualquier otra dirección la devuelve a la espera', async () => {
    for (const route of ['/home', '/missions', '/account', '/admin', '/nada']) {
      const { api } = sessionServer({ user: pending() });
      const view = renderApp({ route, fetch: api.fetch });
      expect(await screen.findByRole('heading', { level: 1, name: es.waiting.title }), route).toBeTruthy();
      expect(path()).toBe('/waiting');
      expect(api.calls.some((c) => c.path === '/org')).toBe(false);
      view.unmount();
    }
  });

  it('una cuenta activa que abre /waiting va a su pantalla de entrada', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    renderApp({ route: '/waiting', fetch: api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: es.home.title })).toBeTruthy();
    expect(path()).toBe('/home');
  });
});

describe('cuenta e idioma (D-H0-21)', () => {
  it('cerrar sesión envía el token CSRF, vacía la sesión y vuelve al acceso', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    const { user } = renderApp({ route: '/account', fetch: api.fetch });
    await user.click(await screen.findByRole('button', { name: es.account.logout }));
    expect(await screen.findByRole('heading', { level: 1, name: es.login.title })).toBeTruthy();
    expect(api.calls.find((c) => c.path === '/auth/logout')?.headers.get('X-CSRF-Token')).toBe('csrf-token-1');
    expect(path()).toBe('/login');
  });

  it('si el servidor no confirma el cierre, la persona sigue dentro y ve el error', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    const fetchImpl: typeof fetch = async (input, init) => (String(input).endsWith('/auth/logout') ? apiError(500, 'INTERNAL') : api.fetch(input, init));
    const { user } = renderApp({ route: '/account', fetch: fetchImpl });
    await user.click(await screen.findByRole('button', { name: es.account.logout }));
    expect((await screen.findByRole('alert')).textContent).toContain(es.errors.INTERNAL);
    expect(path()).toBe('/account');
  });

  it('el cambio de idioma traduce la interfaz, se recuerda en el navegador y marca <html lang>', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    const { user } = renderApp({ route: '/account', fetch: api.fetch });
    await user.click(await screen.findByRole('radio', { name: fr.account.languageFr }));
    expect(await screen.findByRole('heading', { level: 1, name: fr.account.title })).toBeTruthy();
    expect(
      within(screen.getByRole('navigation'))
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toContain(fr.nav.createMission);
    expect(window.localStorage.getItem('onway.locale')).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
  });

  it('sin elección guardada se usa el idioma del perfil', async () => {
    const { api } = sessionServer({ user: sessionUser({ locale: 'fr', displayName: 'Coordinatrice Démo' }) });
    renderApp({ fetch: api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: fr.home.title })).toBeTruthy();
  });

  it('con una elección guardada, el idioma del perfil no la pisa', async () => {
    window.localStorage.setItem('onway.locale', 'es');
    const { api } = sessionServer({ user: sessionUser({ locale: 'fr' }) });
    renderApp({ fetch: api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: es.home.title })).toBeTruthy();
  });

  it('el acceso se puede cambiar de idioma antes de entrar', async () => {
    const { api } = sessionServer();
    const { user } = renderApp({ fetch: api.fetch });
    await user.click(await screen.findByRole('radio', { name: fr.account.languageFr }));
    expect(await screen.findByRole('heading', { level: 1, name: fr.login.title })).toBeTruthy();
  });

  it('muestra los datos de la cuenta', async () => {
    const { api } = sessionServer({ user: rescuer() });
    renderApp({ route: '/account', fetch: api.fetch });
    expect(await screen.findByText('rescatista1@example.org')).toBeTruthy();
    expect(screen.getByText(es.account.roleRescuer, { selector: 'dd' })).toBeTruthy();
  });
});
