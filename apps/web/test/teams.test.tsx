// Equipos (H5-equipos T6, RF-801, doc 02 §3.8, INV-23, D-E2): la lista, crear y editar. El servidor decide los permisos y los choques;
// aquí se prueba lo que la web pide, lo que enseña y cómo se maneja.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { es, fr } from '@onway/i18n';
import { admin, apiError, json, renderApp, rescuer, sessionServer, sessionUser, type Call } from './support';

const LANGUAGES = [
  ['es', es],
  ['fr', fr],
] as const;
type Text = typeof es;

const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Team {
  id: string;
  name: string;
  locality: string;
  code: string;
  status: 'active' | 'archived';
  memberCount: number;
}
const team = (n: number, overrides: Partial<Team> = {}): Team => ({
  id: idOf(n),
  name: `Equipo Ficticio ${n}`,
  locality: `Localidad ${n}`,
  code: `L0${n}`,
  status: 'active',
  memberCount: n,
  ...overrides,
});
const paged = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 20, total: items.length, ...extra });
const detailOf = (t: Team) => ({ ...t, members: [], createdAt: '2026-11-22T10:00:00+01:00' });

interface Options {
  language?: 'es' | 'fr';
  teams?: Team[];
  list?: (call: Call) => Response | Promise<Response>;
  create?: (call: Call) => Response | Promise<Response>;
  update?: (call: Call) => Response | Promise<Response>;
  user?: ReturnType<typeof sessionUser>;
}

/** El servidor simulado filtra como el contrato: `status` y `q` en nombre y localidad. */
function setup(options: Options = {}) {
  const language = options.language ?? 'es';
  const teams = options.teams ?? [team(1), team(2)];
  const { api, state } = sessionServer(
    { user: { ...(options.user ?? sessionUser()), locale: language } },
    {
      'GET /teams':
        options.list ??
        (({ query }) => {
          const q = (query.get('q') ?? '').toLowerCase();
          const found = teams.filter((x) => (!query.get('status') || x.status === query.get('status')) && (!q || x.name.toLowerCase().includes(q) || x.locality.toLowerCase().includes(q)));
          return json(200, paged(found, { page: Number(query.get('page') ?? 1) }));
        }),
      'POST /teams': options.create ?? (({ body }) => json(201, detailOf({ ...team(9), ...(body as object) } as Team))),
      [`PATCH /teams/${idOf(1)}`]: options.update ?? (({ body }) => json(200, detailOf({ ...team(1), ...(body as object) } as Team))),
    },
  );
  window.localStorage.setItem('onway.locale', language);
  const view = renderApp({ route: '/teams', fetch: api.fetch, language });
  const lists = () => api.calls.filter((call) => call.method === 'GET' && call.path === '/teams');
  const writes = () => api.calls.filter((call) => call.method !== 'GET' && call.path.startsWith('/teams'));
  return { ...view, api, state, lists, writes, lastQuery: () => lists().at(-1)!.query };
}

describe.each(LANGUAGES)('equipos: la lista (%s)', (language, text: Text) => {
  const T = text.teams;
  const opts = (extra: Options = {}) => ({ language, ...extra });

  it('se pide activos y sin búsqueda; cada fila lleva nombre, localidad, código y miembros, y nada de personas', async () => {
    const { lists, api } = setup(opts({ teams: [team(1, { code: 'BSC', locality: 'Biescas', memberCount: 3 }), team(2)] }));
    const first = (await screen.findByText('Equipo Ficticio 1')).closest('li') as HTMLElement;
    expect(within(first).getByText(T.row.locality.replace('{{locality}}', 'Biescas').replace('{{code}}', 'BSC'))).toBeTruthy();
    expect(within(first).getByText(T.row.members.replace('{{count}}', '3'))).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: T.title })).toBeTruthy();
    expect(screen.getByText(T.summary.replace('{{total}}', '2'))).toBeTruthy();
    const query = lists()[0]!.query;
    expect([query.get('status'), query.get('page'), query.get('pageSize'), query.has('q')]).toEqual(['active', '1', '20', false]);
    expect(document.title).toContain(T.title);
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('el nombre de cada equipo es un enlace a su detalle', async () => {
    setup(opts());
    const link = await screen.findByRole('link', { name: 'Equipo Ficticio 1' });
    expect(link.getAttribute('href')).toBe(`/teams/${idOf(1)}`);
  });

  it('muestra «cargando» mientras espera, el vacío de cada pestaña y un error con «reintentar»', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let failing = true;
    const { user } = setup(
      opts({
        list: async ({ query }) => {
          await gate;
          if (query.get('status') === 'archived') return json(200, paged([]));
          if (failing) return apiError(500, 'INTERNAL');
          return json(200, paged([]));
        },
      }),
    );
    expect(await screen.findByRole('status')).toBeTruthy();
    release();
    expect(await screen.findByRole('alert')).toBeTruthy();
    failing = false;
    await user.click(screen.getByRole('button', { name: text.state.retry }));
    expect(await screen.findByText(T.empty.active)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: T.tabs.archived }));
    expect(await screen.findByText(T.empty.archived)).toBeTruthy();
  });

  it('las pestañas Activos y Archivados y la búsqueda se piden al servidor; la búsqueda vacía se puede quitar', async () => {
    const { user, lastQuery } = setup(opts({ teams: [team(1), team(2, { status: 'archived', name: 'Grupo Antiguo' })] }));
    await screen.findByText('Equipo Ficticio 1');
    expect(screen.getByRole('tab', { name: T.tabs.active }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('tab', { name: T.tabs.archived }));
    expect(await screen.findByText('Grupo Antiguo')).toBeTruthy();
    expect(lastQuery().get('status')).toBe('archived');
    expect(screen.queryByText('Equipo Ficticio 1')).toBeNull();

    await user.type(screen.getByRole('searchbox', { name: T.searchLabel }), 'zzz');
    await waitFor(() => expect(lastQuery().get('q')).toBe('zzz'));
    expect(await screen.findByText(T.emptySearch.replace('{{query}}', 'zzz'))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: T.clearSearch }));
    await waitFor(() => expect(lastQuery().has('q')).toBe(false));
    expect(await screen.findByText('Grupo Antiguo')).toBeTruthy();
  });

  it('crear: propone el código de la localidad, deja corregirlo y envía nombre, localidad y código', async () => {
    const { user, writes } = setup(opts());
    await screen.findByText('Equipo Ficticio 1');
    await user.click(screen.getByRole('button', { name: T.createCta, hidden: false }));
    const dialog = await screen.findByRole('dialog', { name: T.form.createTitle });
    const field = (label: string) => within(dialog).getByLabelText(label);
    expect(document.activeElement).toBe(field(T.form.name));

    await user.type(field(T.form.name), 'E2E Equipo Alicante');
    await user.type(field(T.form.locality), 'Alicante');
    expect((field(T.form.code) as HTMLInputElement).value).toBe('ALC'); // D-E2: propuesto
    await user.clear(field(T.form.code));
    await user.type(field(T.form.code), 'zzz');
    expect((field(T.form.code) as HTMLInputElement).value).toBe('ZZZ'); // se corrige, en mayúscula
    await user.type(field(T.form.locality), 'x'); // ya no se pisa lo corregido
    expect((field(T.form.code) as HTMLInputElement).value).toBe('ZZZ');
    await user.clear(field(T.form.code));
    await user.type(field(T.form.code), 'alc');
    await user.type(field(T.form.locality), '{Backspace}');

    await user.click(within(dialog).getByRole('button', { name: T.form.saveCreate }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', path: '/teams', body: { name: 'E2E Equipo Alicante', locality: 'Alicante', code: 'ALC' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: T.createCta }));
  });

  it('crear con campos vacíos o un código incorrecto avisa en su campo y no envía nada', async () => {
    const { user, writes } = setup(opts());
    await screen.findByText('Equipo Ficticio 1');
    await user.click(screen.getByRole('button', { name: T.createCta }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: T.form.saveCreate }));
    expect(within(dialog).getByText(T.form.nameRequired)).toBeTruthy();
    expect(within(dialog).getByText(T.form.localityRequired)).toBeTruthy();
    expect(within(dialog).getByText(T.form.codeInvalid)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByLabelText(T.form.name));
    expect(writes()).toEqual([]);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('DUPLICATE_NAME sale en el campo que dice el servidor, el del nombre o el del código', async () => {
    let field: 'name' | 'code' = 'name';
    const { user, writes } = setup(opts({ create: () => apiError(409, 'DUPLICATE_NAME', { field }) }));
    await screen.findByText('Equipo Ficticio 1');
    await user.click(screen.getByRole('button', { name: T.createCta }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(T.form.name), 'Equipo Ficticio 1');
    await user.type(within(dialog).getByLabelText(T.form.locality), 'Biescas');
    await user.click(within(dialog).getByRole('button', { name: T.form.saveCreate }));
    const nameInput = within(dialog).getByLabelText(T.form.name);
    expect(await within(dialog).findByText(T.form.duplicateName)).toBeTruthy();
    expect(nameInput.getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).queryByText(T.form.duplicateCode)).toBeNull();

    field = 'code';
    await user.click(within(dialog).getByRole('button', { name: T.form.saveCreate }));
    expect(await within(dialog).findByText(T.form.duplicateCode)).toBeTruthy();
    expect(within(dialog).getByLabelText(T.form.code).getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).queryByText(T.form.duplicateName)).toBeNull();
    expect(writes()).toHaveLength(2);
    expect(screen.queryByRole('dialog')).not.toBeNull(); // sigue abierto para corregir
  });

  it('otro fallo del servidor sale como aviso del diálogo', async () => {
    const { user } = setup(opts({ create: () => apiError(500, 'INTERNAL') }));
    await screen.findByText('Equipo Ficticio 1');
    await user.click(screen.getByRole('button', { name: T.createCta }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(T.form.name), 'Otro');
    await user.type(within(dialog).getByLabelText(T.form.locality), 'Torla');
    await user.click(within(dialog).getByRole('button', { name: T.form.saveCreate }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
  });

  it('editar: abre con los datos del equipo y envía solo lo que cambió, sin tocar el código que ya tiene', async () => {
    const { user, writes } = setup(opts());
    await screen.findByText('Equipo Ficticio 1');
    await user.click(screen.getByRole('button', { name: T.row.editLabel.replace('{{name}}', 'Equipo Ficticio 1') }));
    const dialog = await screen.findByRole('dialog', { name: T.form.editTitle.replace('{{name}}', 'Equipo Ficticio 1') });
    expect((within(dialog).getByLabelText(T.form.code) as HTMLInputElement).value).toBe('L01');
    await user.clear(within(dialog).getByLabelText(T.form.locality));
    await user.type(within(dialog).getByLabelText(T.form.locality), 'Benasque');
    expect((within(dialog).getByLabelText(T.form.code) as HTMLInputElement).value).toBe('L01'); // al editar no se propone otro
    await user.click(within(dialog).getByRole('button', { name: T.form.saveEdit }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', path: `/teams/${idOf(1)}`, body: { locality: 'Benasque' } });
    expect(Object.keys(writes()[0]!.body as object)).toEqual(['locality']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('el administrador también gestiona los equipos', async () => {
    const { user, writes } = setup(opts({ user: admin() }));
    await screen.findByText('Equipo Ficticio 1');
    await user.click(screen.getByRole('button', { name: T.createCta }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(T.form.name), 'Equipo Admin');
    await user.type(within(dialog).getByLabelText(T.form.locality), 'Sabiñánigo');
    expect((within(dialog).getByLabelText(T.form.code) as HTMLInputElement).value).toBe('SBN');
    await user.click(within(dialog).getByRole('button', { name: T.form.saveCreate }));
    await waitFor(() => expect(writes()).toHaveLength(1));
  });
});

describe('equipos: el rescatista no llega', () => {
  it('abre /teams con la sesión de un rescatista y ve «sin acceso», sin pedir ningún equipo', async () => {
    const { api } = sessionServer({ user: rescuer({ profileStatus: 'complete', nextStep: 'home' }) });
    renderApp({ route: '/teams', fetch: api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: es.forbidden.title })).toBeTruthy();
    expect(api.calls.some((c) => c.path.startsWith('/teams'))).toBe(false);
  });
});
