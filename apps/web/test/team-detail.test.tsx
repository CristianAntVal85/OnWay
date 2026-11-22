// Detalle del equipo (H5-equipos T7, RF-801, RN-21, D-E5): miembros sin contacto, selector de rescatistas, quitar, archivar y reactivar, el 404 y el teclado.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { es, fr } from '@onway/i18n';
import { apiError, json, renderApp, sessionServer, sessionUser, type Call } from './support';

const LANGUAGES = [
  ['es', es],
  ['fr', fr],
] as const;
type Text = typeof es;

const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TEAM = idOf(1);
const person = (n: number, name: string) => ({ id: idOf(100 + n), displayName: name });
const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [k, v]) => text.replace(`{{${k}}}`, String(v)), template);

interface Options {
  language: 'es' | 'fr';
  status?: 'active' | 'archived';
  members?: ReturnType<typeof person>[];
  add?: (call: Call) => Response | Promise<Response>;
  get?: (call: Call) => Response | Promise<Response>;
}

/** Servidor con estado: añadir, quitar y archivar cambian lo que devuelve `getTeam`. */
function setup(options: Options) {
  const state = { status: options.status ?? 'active', members: [...(options.members ?? [person(1, 'Ana Ficticia'), person(2, 'Bruno Ficticio')])] };
  const rescuers = [person(1, 'Ana Ficticia'), person(2, 'Bruno Ficticio'), person(3, 'Carla Ficticia'), person(4, 'Diego Ficticio')];
  const detail = () => ({
    id: TEAM,
    name: 'Equipo Ficticio',
    locality: 'Biescas',
    code: 'BSC',
    status: state.status,
    memberCount: state.members.length,
    members: state.members,
    createdAt: '2026-11-22T10:00:00+01:00',
  });
  const { api } = sessionServer(
    { user: { ...sessionUser(), locale: options.language } },
    {
      [`GET /teams/${TEAM}`]: options.get ?? (() => json(200, detail())),
      [`PATCH /teams/${TEAM}`]: ({ body }) => {
        state.status = (body as { status: 'active' | 'archived' }).status;
        return json(200, detail());
      },
      [`POST /teams/${TEAM}/members`]:
        options.add ??
        (({ body }) => {
          for (const id of (body as { userIds: string[] }).userIds) {
            const found = rescuers.find((r) => r.id === id);
            if (found && !state.members.some((m) => m.id === id)) state.members.push(found);
          }
          return json(200, detail());
        }),
      [`DELETE /teams/${TEAM}/members/${idOf(102)}`]: () => {
        state.members = state.members.filter((m) => m.id !== idOf(102));
        return json(204, null);
      },
      'GET /rescuers': ({ query }) => {
        const q = (query.get('q') ?? '').toLowerCase();
        const items = rescuers
          .filter((r) => !q || r.displayName.toLowerCase().includes(q))
          .map((r) => ({ userId: r.id, displayName: r.displayName, teams: r.id === idOf(103) ? [{ id: idOf(2), name: 'Otro Equipo', locality: 'Torla' }] : [] }));
        return json(200, { items, page: 1, pageSize: 10, total: items.length });
      },
    },
  );
  window.localStorage.setItem('onway.locale', options.language);
  const view = renderApp({ route: `/teams/${TEAM}`, fetch: api.fetch, language: options.language });
  return { ...view, api, state, writes: () => api.calls.filter((c) => c.method !== 'GET') };
}

describe.each(LANGUAGES)('equipo: el detalle (%s)', (language, text: Text) => {
  const T = text.teams;
  const D = T.detail;

  it('enseña el nombre, la localidad y el código, y los miembros solo con su nombre', async () => {
    const { api } = setup({ language });
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipo Ficticio' })).toBeTruthy();
    expect(screen.getByText(fill(T.row.locality, { locality: 'Biescas', code: 'BSC' }))).toBeTruthy();
    const items = within(screen.getByRole('heading', { level: 2, name: D.members }).closest('section')!).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.replace(D.remove, ''))).toEqual(['Ana Ficticia', 'Bruno Ficticio']);
    expect(document.body.textContent).not.toMatch(/@|\+\d{6}/);
    expect(document.title).toContain('Equipo Ficticio');
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('un equipo sin miembros lo dice', async () => {
    setup({ language, members: [] });
    expect(await screen.findByText(D.noMembers)).toBeTruthy();
  });

  it('el selector busca, marca a los que ya son miembros y envía los userIds elegidos', async () => {
    const { user, writes, api } = setup({ language });
    await user.click(await screen.findByRole('button', { name: D.addMembers }));
    const dialog = await screen.findByRole('dialog', { name: fill(T.add.title, { name: 'Equipo Ficticio' }) });
    expect(document.activeElement).toBe(within(dialog).getByRole('searchbox', { name: T.add.searchLabel }));
    const ana = await within(dialog).findByRole('checkbox', { name: /Ana Ficticia/ });
    expect((ana as HTMLInputElement).checked).toBe(true);
    expect((ana as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getAllByText(T.add.alreadyMember)).toHaveLength(2);
    expect(within(dialog).getByText('Otro Equipo')).toBeTruthy();

    await user.type(within(dialog).getByRole('searchbox'), 'carla{Enter}');
    await waitFor(() => expect(within(dialog).queryByRole('checkbox', { name: /Diego/ })).toBeNull());
    await user.click(await within(dialog).findByRole('checkbox', { name: /Carla Ficticia/ }));
    await user.clear(within(dialog).getByRole('searchbox'));
    await user.keyboard('{Enter}');
    await user.click(await within(dialog).findByRole('checkbox', { name: /Diego Ficticio/ })); // la elección sobrevive a la búsqueda
    expect(within(dialog).getByText(fill(T.add.selectionCount, { count: 2 }))).toBeTruthy();
    expect(api.calls.some((c) => c.path === '/rescuers' && c.query.get('q') === 'carla')).toBe(true);

    await user.click(within(dialog).getByRole('button', { name: fill(T.add.confirm, { count: 2 }) }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'POST', path: `/teams/${TEAM}/members`, body: { userIds: [idOf(103), idOf(104)] } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Carla Ficticia')).toBeTruthy();
    expect(screen.getByText(fill(D.done.added, { count: 2 }))).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: D.addMembers })); // el foco vuelve a quien abrió
  });

  it('sin elegir a nadie no se puede añadir, y un fallo del servidor sale como aviso del diálogo', async () => {
    const { user } = setup({ language, add: () => apiError(422, 'VALIDATION_FAILED', { path: 'userIds' }) });
    await user.click(await screen.findByRole('button', { name: D.addMembers }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: fill(T.add.confirm, { count: 0 }) });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.click(await within(dialog).findByRole('checkbox', { name: /Carla/ }));
    await user.click(within(dialog).getByRole('button', { name: fill(T.add.confirm, { count: 1 }) }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
  });

  it('quitar pide confirmación (el foco empieza en cancelar), cancelar no quita y confirmar quita y lleva el foco al título de los miembros', async () => {
    const { user, writes } = setup({ language });
    const open = await screen.findByRole('button', { name: fill(D.removeLabel, { name: 'Bruno Ficticio' }) });
    await user.click(open);
    let dialog = await screen.findByRole('dialog', { name: fill(D.removeDialog.title, { name: 'Bruno Ficticio' }) });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: D.cancel }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(open);
    expect(writes()).toEqual([]);

    await user.click(open);
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: D.removeDialog.confirm }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE', path: `/teams/${TEAM}/members/${idOf(102)}` });
    await waitFor(() => expect(screen.queryByText('Bruno Ficticio')).toBeNull());
    expect(screen.getByText(fill(D.done.removed, { name: 'Bruno Ficticio' }))).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: D.members })));
  });

  it('archivar pide confirmación; el equipo archivado ya no deja añadir y se puede reactivar', async () => {
    const { user, writes } = setup({ language });
    await user.click(await screen.findByRole('button', { name: D.archive }));
    const dialog = await screen.findByRole('dialog', { name: fill(D.archiveDialog.title, { name: 'Equipo Ficticio' }) });
    await user.click(within(dialog).getByRole('button', { name: D.archiveDialog.confirm }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PATCH', path: `/teams/${TEAM}`, body: { status: 'archived' } });
    expect(await screen.findByText(D.archivedNote)).toBeTruthy();
    expect(screen.queryByRole('button', { name: D.addMembers })).toBeNull();
    expect(screen.getByText('Ana Ficticia')).toBeTruthy(); // conserva sus miembros
    expect(document.activeElement).toBe(screen.getByRole('button', { name: D.reactivate }));

    await user.click(screen.getByRole('button', { name: D.reactivate }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: D.reactivateDialog.confirm }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ body: { status: 'active' } });
    expect(await screen.findByRole('button', { name: D.addMembers })).toBeTruthy();
  });

  it('un equipo que no existe da «no existe»; un fallo del servidor, error con reintento', async () => {
    const view = setup({ language, get: () => apiError(404, 'NOT_FOUND') });
    expect(await screen.findByText(D.notFound)).toBeTruthy();
    view.unmount();
    setup({ language, get: () => apiError(500, 'INTERNAL') });
    expect(await screen.findByRole('button', { name: text.state.retry })).toBeTruthy();
  });
});
