// Usuarios de la organización (H5-usuarios, RF-813, doc 02 §3.10, D-U6): la lista de Administración y la ficha de cada persona.
// El servidor decide los permisos; aquí se prueba lo que la web pide, lo que enseña y cómo se maneja.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { es, fr } from '@onway/i18n';
import { formatDateTime } from '../src/missions/format';
import { admin, apiError, json, renderApp, sessionServer, type Call } from './support';

const LANGUAGES = [
  ['es', es],
  ['fr', fr],
] as const;
type Text = typeof es;

const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Person {
  userId: string;
  displayName: string;
  email: string;
  role: 'admin' | 'coordinator' | 'rescuer';
  accountStatus: 'active' | 'disabled';
  lastLoginAt: string | null;
  profileStatus: 'complete' | 'incomplete' | null;
  hasMissionsAsResponsible: number;
}
const person = (n: number, overrides: Partial<Person> = {}): Person => ({
  userId: idOf(n),
  displayName: `Persona Ficticia ${n}`,
  email: `persona${n}@example.org`,
  role: 'rescuer',
  accountStatus: 'active',
  lastLoginAt: n % 2 === 0 ? `2026-11-0${(n % 9) + 1}T18:45:00+01:00` : null,
  profileStatus: 'complete',
  hasMissionsAsResponsible: 0,
  ...overrides,
});
const paged = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 20, total: items.length, ...extra });

interface Options {
  language?: 'es' | 'fr';
  route?: string;
  people?: Person[];
  list?: (call: Call) => Response | Promise<Response>;
}

/** El servidor simulado filtra como el contrato: `q` en nombre y correo, `role` y `accountStatus`. */
function setup(options: Options = {}) {
  const language = options.language ?? 'es';
  const people = options.people ?? [person(1), person(2)];
  const { api } = sessionServer(
    { user: { ...admin(), locale: language } },
    {
      'GET /admin/signup-requests': () =>
        json(200, paged([person(50)].map((p) => ({ userId: p.userId, email: p.email, displayName: p.displayName, status: 'pending', requestedAt: '2026-11-02T09:30:00+01:00' })))),
      'GET /admin/invite-code': () => json(200, { code: 'K7QM-X2PD-9WTR-HC4N', rotatedAt: '2026-10-30T08:00:00+00:00' }),
      'GET /admin/users':
        options.list ??
        (({ query }) => {
          const q = (query.get('q') ?? '').toLowerCase();
          const found = people.filter(
            (p) =>
              (!q || p.email.includes(q) || p.displayName.toLowerCase().includes(q)) &&
              (!query.get('role') || p.role === query.get('role')) &&
              (!query.get('accountStatus') || p.accountStatus === query.get('accountStatus')),
          );
          return json(200, paged(found, { page: Number(query.get('page') ?? 1), total: found.length }));
        }),
    },
  );
  window.localStorage.setItem('onway.locale', language);
  const view = renderApp({ route: options.route ?? '/admin', fetch: api.fetch, language });
  const lists = () => api.calls.filter((call) => call.method === 'GET' && call.path === '/admin/users');
  return { ...view, api, people, lists, lastQuery: () => lists().at(-1)!.query };
}

const section = (name: string) => screen.findByRole('region', { name });

describe.each(LANGUAGES)('administración: lista de usuarios (%s)', (language, text: Text) => {
  const U = text.admin.users;
  const opts = (extra: Options = {}) => ({ language, ...extra });

  it('se pide sin filtros, con nombre, correo, rol, estado y último acceso, entre la bandeja y el código de invitación', async () => {
    const { lists } = setup(opts({ people: [person(1), person(2, { role: 'coordinator', accountStatus: 'disabled' })] }));
    const users = await section(U.title);
    const first = (await within(users).findByText('Persona Ficticia 1')).closest('li') as HTMLElement;
    expect(within(first).getByText('persona1@example.org')).toBeTruthy();
    expect(within(first).getByText(text.account.roleRescuer)).toBeTruthy();
    expect(within(first).getByText(U.status.active)).toBeTruthy();
    expect(within(first).getByText(U.neverLoggedIn)).toBeTruthy();
    const second = within(users).getByText('Persona Ficticia 2').closest('li') as HTMLElement;
    expect(within(second).getByText(text.account.roleCoordinator)).toBeTruthy();
    expect(within(second).getByText(U.status.disabled)).toBeTruthy();
    expect(within(second).getByText(U.lastLogin.replace('{{date}}', formatDateTime('2026-11-03T18:45:00+01:00', language)))).toBeTruthy();
    expect(within(users).getByText(U.summary.replace('{{total}}', '2'))).toBeTruthy();
    const query = lists()[0]!.query;
    expect([query.get('page'), query.get('pageSize'), query.has('q'), query.has('role'), query.has('accountStatus')]).toEqual(['1', '20', false, false, false]);

    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles.indexOf(U.title)).toBeGreaterThan(titles.indexOf(text.admin.signups.title));
    expect(titles.indexOf(U.title)).toBeLessThan(titles.indexOf(text.admin.inviteCode.title));
  });

  it('cada nombre es un enlace a su ficha', async () => {
    const { user } = setup(opts());
    const users = await section(U.title);
    const link = await within(users).findByRole('link', { name: 'Persona Ficticia 2' });
    expect(link.getAttribute('href')).toBe(`/admin/users/${idOf(2)}`);
    await user.click(link);
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe(`/admin/users/${idOf(2)}`));
  });

  it('la búsqueda y los filtros se piden al servidor y viven en la dirección', async () => {
    const { user, lastQuery } = setup(opts({ people: [person(1), person(2, { role: 'coordinator' }), person(3, { accountStatus: 'disabled' })] }));
    const users = await section(U.title);
    await within(users).findByText('Persona Ficticia 3');

    await user.type(within(users).getByRole('searchbox', { name: U.searchLabel }), 'persona2');
    await waitFor(() => expect(lastQuery().get('q')).toBe('persona2'));
    expect(await within(users).findByText('Persona Ficticia 2')).toBeTruthy();
    expect(within(users).queryByText('Persona Ficticia 1')).toBeNull();
    await user.clear(within(users).getByRole('searchbox', { name: U.searchLabel }));
    await waitFor(() => expect(lastQuery().has('q')).toBe(false));

    await user.selectOptions(within(users).getByLabelText(U.roleFilter), 'coordinator');
    await waitFor(() => expect(lastQuery().get('role')).toBe('coordinator'));
    expect(await within(users).findByText(U.summary.replace('{{total}}', '1'))).toBeTruthy();
    await user.selectOptions(within(users).getByLabelText(U.roleFilter), '');
    await user.selectOptions(within(users).getByLabelText(U.statusFilter), 'disabled');
    await waitFor(() => expect(lastQuery().get('accountStatus')).toBe('disabled'));
    expect(await within(users).findByText('Persona Ficticia 3')).toBeTruthy();
    expect(lastQuery().has('role')).toBe(false);
  });

  it('una dirección con filtros los aplica al abrir, sin tocar los de la bandeja', async () => {
    const { lists } = setup(opts({ route: '/admin?users.q=persona&users.role=coordinator&users.status=active&users.page=2' }));
    await section(U.title);
    const query = lists()[0]!.query;
    expect([query.get('q'), query.get('role'), query.get('accountStatus'), query.get('page')]).toEqual(['persona', 'coordinator', 'active', '2']);
    const signups = screen.getByRole('region', { name: text.admin.signups.title });
    expect(within(signups).queryByRole('searchbox', { name: U.searchLabel })).toBeNull();
  });

  it('la paginación pide la página siguiente', async () => {
    const { user, lists } = setup(opts({ list: ({ query }) => json(200, paged([person(Number(query.get('page') ?? 1))], { page: Number(query.get('page') ?? 1), total: 45 })) }));
    const users = await section(U.title);
    await within(users).findByText('Persona Ficticia 1');
    await user.click(within(users).getByRole('button', { name: text.missions.pagination.next }));
    expect(await within(users).findByText('Persona Ficticia 2')).toBeTruthy();
    expect(lists().at(-1)!.query.get('page')).toBe('2');
  });

  it('muestra la carga, el vacío (con y sin filtros) y el error con reintento', async () => {
    let release: (response: Response) => void = () => undefined;
    const first = setup(opts({ list: () => new Promise<Response>((resolve) => (release = resolve)) }));
    const users = await section(U.title);
    expect(within(users).getByText(text.state.loading)).toBeTruthy();
    release(json(200, paged([])));
    expect(await within(users).findByText(U.empty)).toBeTruthy();
    first.unmount();

    const filtered = setup(opts({ route: '/admin?users.q=nadie', people: [] }));
    const again = await section(U.title);
    expect(await within(again).findByText(U.emptyFiltered)).toBeTruthy();
    await filtered.user.click(within(again).getByRole('button', { name: U.clearFilters }));
    expect(await within(again).findByText(U.empty)).toBeTruthy();
    filtered.unmount();

    let fail = true;
    const view = setup(opts({ list: () => (fail ? apiError(500, 'INTERNAL') : json(200, paged([person(1)]))) }));
    const failed = await section(U.title);
    const alert = await within(failed).findByRole('alert');
    expect(within(alert).getByText(text.errors.INTERNAL)).toBeTruthy();
    fail = false;
    await view.user.click(within(alert).getByRole('button', { name: text.state.retry }));
    expect(await within(failed).findByText('Persona Ficticia 1')).toBeTruthy();
  });
});
