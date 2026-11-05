// Administración (H5-acceso T7, RF-106, RN-25, INV-29): bandeja de solicitudes de alta con selección en bloque y código de invitación.
// El servidor decide los permisos y la atomicidad; aquí se prueba lo que la web envía, lo que enseña y cómo se maneja.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { es, fr } from '@onway/i18n';
import { formatDateTime } from '../src/missions/format';
import { admin, apiError, json, renderApp, rescuer, sessionServer, sessionUser, type Call } from './support';

const LANGUAGES = [
  ['es', es],
  ['fr', fr],
] as const;
type Text = typeof es;

const INVITE = 'K7QM-X2PD-9WTR-HC4N';
const NEXT_INVITE = 'M3HF-72KD-QX9A-W8TN';
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Person {
  userId: string;
  email: string;
  displayName: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
}
const person = (n: number, overrides: Partial<Person> = {}): Person => ({
  userId: idOf(n),
  email: `persona${n}@example.org`,
  displayName: `Persona Ficticia ${n}`,
  status: 'pending',
  requestedAt: `2026-11-0${(n % 9) + 1}T09:30:00+01:00`,
  ...overrides,
});
const paged = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 20, total: items.length, ...extra });

interface Options {
  language?: 'es' | 'fr';
  user?: ReturnType<typeof admin>;
  people?: Person[];
  list?: (call: Call) => Response | Promise<Response>;
  decide?: (call: Call) => Response | Promise<Response>;
  invite?: (call: Call) => Response | Promise<Response>;
  rotate?: (call: Call) => Response | Promise<Response>;
}

/** El servidor simulado guarda las solicitudes: el filtro por estado y `q` son los del contrato; decidir cambia la fila. */
function setup(options: Options = {}) {
  const language = options.language ?? 'es';
  const people = options.people ?? [person(1), person(2), person(3)];
  let code = { code: INVITE, rotatedAt: '2026-10-30T08:00:00+00:00' };
  const { api, state } = sessionServer(
    { user: options.user ?? { ...admin(), locale: language } },
    {
      'GET /admin/signup-requests':
        options.list ??
        (({ query }) => {
          const status = query.get('status') ?? 'pending';
          const q = (query.get('q') ?? '').toLowerCase();
          const found = people.filter((p) => p.status === status && (!q || p.email.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q)));
          return json(200, paged(found, { page: Number(query.get('page') ?? 1), total: found.length }));
        }),
      'POST /admin/signup-requests/decide':
        options.decide ??
        (({ body }) => {
          const { action, selection } = body as { action: 'approve' | 'reject'; selection: { ids: string[] } };
          for (const p of people) if (selection.ids.includes(p.userId)) p.status = action === 'approve' ? 'approved' : 'rejected';
          return json(200, { affected: selection.ids.length, skipped: [] });
        }),
      'GET /admin/invite-code': options.invite ?? (() => json(200, code)),
      'POST /admin/invite-code/rotate':
        options.rotate ??
        (() => {
          code = { code: NEXT_INVITE, rotatedAt: '2026-11-05T10:00:00+00:00' };
          return json(200, code);
        }),
    },
  );
  window.localStorage.setItem('onway.locale', language);
  const view = renderApp({ route: '/admin', fetch: api.fetch, language });
  const calls = (method: string, path: string) => api.calls.filter((call) => call.method === method && call.path === path);
  return { ...view, api, state, people, calls, lists: () => calls('GET', '/admin/signup-requests'), decides: () => calls('POST', '/admin/signup-requests/decide') };
}

const row = async (name: string) => (await screen.findByRole('checkbox', { name })).closest('li') as HTMLElement;
const dialog = () => screen.getByRole('dialog');

describe.each(LANGUAGES)('administración: solicitudes de alta (%s)', (language, text: Text) => {
  const S = text.admin.signups;
  const opts = (extra: Options = {}) => ({ language, ...extra });

  it('la ruta /admin es «Administración» con sus dos secciones y nada más (ni usuarios ni datos sensibles)', async () => {
    setup(opts());
    expect(await screen.findByRole('heading', { level: 1, name: text.nav.administration })).toBeTruthy();
    expect(document.title).toBe(`${text.nav.administration} · OnWay`);
    expect(screen.getByRole('heading', { level: 2, name: S.title })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: text.admin.inviteCode.title })).toBeTruthy();
    expect(screen.queryByText(text.later.title)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
  });

  it('pide las pendientes por defecto y enseña nombre, correo y fecha local de cada una, con una casilla', async () => {
    const { lists } = setup(opts({ people: [person(1), person(2)] }));
    const first = await row('Persona Ficticia 1');
    expect(within(first).getByText('persona1@example.org')).toBeTruthy();
    expect(within(first).getByText(S.requestedOn.replace('{{date}}', formatDateTime('2026-11-02T09:30:00+01:00', language)))).toBeTruthy();
    expect(screen.getByText(S.summary.replace('{{total}}', '2'))).toBeTruthy();
    const query = lists()[0]!.query;
    expect(query.get('status')).toBe('pending');
    expect(query.get('page')).toBe('1');
    expect(query.get('pageSize')).toBe('20');
    expect(query.has('q')).toBe(false);
    // Sin nada seleccionado no hay acciones, solo la pista.
    expect(screen.getByText(S.selectionHint)).toBeTruthy();
    expect(screen.queryByRole('button', { name: S.approve })).toBeNull();
    expect(screen.queryByRole('button', { name: S.reject })).toBeNull();
  });

  it('muestra el estado de carga, el vacío (sin pendientes) y el error con reintento', async () => {
    let release: (response: Response) => void = () => undefined;
    const first = setup(opts({ list: () => new Promise<Response>((resolve) => (release = resolve)) }));
    await waitFor(() => expect(first.lists()).toHaveLength(1));
    expect(within(screen.getByRole('region', { name: S.title })).getByText(text.state.loading)).toBeTruthy();
    release(json(200, paged([])));
    expect(await screen.findByText(S.empty.pending)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    first.unmount();

    let fail = true;
    const view = setup(opts({ list: () => (fail ? apiError(500, 'INTERNAL') : json(200, paged([person(1)]))) }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(text.errors.INTERNAL)).toBeTruthy();
    fail = false;
    await view.user.click(within(alert).getByRole('button', { name: text.state.retry }));
    expect(await screen.findByRole('checkbox', { name: 'Persona Ficticia 1' })).toBeTruthy();
  });

  it('el filtro por estado pide aprobadas o rechazadas; esas filas no ofrecen casilla ni acciones', async () => {
    const { user, lists } = setup(opts({ people: [person(1), person(2, { status: 'approved' }), person(3, { status: 'rejected' })] }));
    await row('Persona Ficticia 1');
    await user.click(screen.getByRole('tab', { name: S.tabs.approved }));
    expect(await screen.findByText('Persona Ficticia 2')).toBeTruthy();
    expect(lists().at(-1)!.query.get('status')).toBe('approved');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: S.approve })).toBeNull();
    expect(screen.getByText(S.status.approved)).toBeTruthy();
    expect(screen.getByText(S.decidedNote)).toBeTruthy();
    expect(screen.queryByText('Persona Ficticia 1')).toBeNull();

    await user.click(screen.getByRole('tab', { name: S.tabs.rejected }));
    expect(await screen.findByText('Persona Ficticia 3')).toBeTruthy();
    expect(lists().at(-1)!.query.get('status')).toBe('rejected');
    expect(screen.getByText(S.status.rejected)).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
  });

  it('el vacío de cada estado dice cuál es', async () => {
    const { user } = setup(opts({ people: [] }));
    expect(await screen.findByText(S.empty.pending)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: S.tabs.approved }));
    expect(await screen.findByText(S.empty.approved)).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: S.tabs.rejected }));
    expect(await screen.findByText(S.empty.rejected)).toBeTruthy();
  });

  it('buscar envía q, vuelve a la página 1 y, sin resultados, ofrece quitar la búsqueda', async () => {
    const { user, lists } = setup(opts());
    await row('Persona Ficticia 1');
    await user.type(screen.getByLabelText(S.searchLabel), 'persona2');
    await user.click(screen.getByRole('button', { name: S.searchSubmit }));
    await waitFor(() => expect(lists().at(-1)!.query.get('q')).toBe('persona2'));
    expect(lists().at(-1)!.query.get('page')).toBe('1');
    expect(await screen.findByRole('checkbox', { name: 'Persona Ficticia 2' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Persona Ficticia 1' })).toBeNull();

    await user.clear(screen.getByLabelText(S.searchLabel));
    await user.type(screen.getByLabelText(S.searchLabel), 'nadie');
    await user.click(screen.getByRole('button', { name: S.searchSubmit }));
    expect(await screen.findByText(S.emptySearch.replace('{{query}}', 'nadie'))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: S.clearSearch }));
    await waitFor(() => expect(lists().at(-1)!.query.has('q')).toBe(false));
    expect(await screen.findByRole('checkbox', { name: 'Persona Ficticia 1' })).toBeTruthy();
  });

  it('pagina: «siguiente» pide la página 2 y vacía la selección', async () => {
    const { user, lists } = setup(opts({ list: ({ query }) => json(200, paged([person(Number(query.get('page') ?? 1))], { page: Number(query.get('page') ?? 1), total: 45 })) }));
    await user.click(await screen.findByRole('checkbox', { name: 'Persona Ficticia 1' }));
    expect(screen.getByText(S.selectionCount.replace('{{count}}', '1'), { selector: 'p' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: text.missions.pagination.next }));
    expect(await screen.findByRole('checkbox', { name: 'Persona Ficticia 2' })).toBeTruthy();
    expect(lists().at(-1)!.query.get('page')).toBe('2');
    expect((screen.getByRole('checkbox', { name: 'Persona Ficticia 2' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('button', { name: S.approve })).toBeNull();
  });

  it('selecciona una a una y «seleccionar las de la página» (con estado mixto) y las quita', async () => {
    const { user } = setup(opts());
    const all = (await screen.findByLabelText(S.selectPage)) as HTMLInputElement;
    await screen.findByRole('checkbox', { name: 'Persona Ficticia 1' });
    expect(all.checked).toBe(false);

    await user.click(screen.getByRole('checkbox', { name: 'Persona Ficticia 1' }));
    expect(all.indeterminate).toBe(true);
    expect(screen.getByRole('group', { name: S.selectionCount.replace('{{count}}', '1') })).toBeTruthy();

    await user.click(all);
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    for (const n of [1, 2, 3]) expect((screen.getByRole('checkbox', { name: `Persona Ficticia ${n}` }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('group', { name: S.selectionCount.replace('{{count}}', '3') })).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'Persona Ficticia 2' }));
    expect(screen.getByRole('group', { name: S.selectionCount.replace('{{count}}', '2') })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: S.clearSelection }));
    expect(screen.queryByRole('group', { name: /\d/ })).toBeNull();
    expect(all.checked).toBe(false);
    // La casilla de «seleccionar página» desmarca todas si ya estaban todas.
    await user.click(all);
    await user.click(all);
    expect((screen.getByRole('checkbox', { name: 'Persona Ficticia 1' }) as HTMLInputElement).checked).toBe(false);
  });

  it('cada casilla se llama como la persona y se describe con su correo', async () => {
    setup(opts({ people: [person(1)] }));
    const box = await screen.findByRole('checkbox', { name: 'Persona Ficticia 1' });
    expect(
      box
        .getAttribute('aria-describedby')
        ?.split(' ')
        .map((id) => document.getElementById(id)?.textContent)[0],
    ).toBe('persona1@example.org');
  });

  it('aprobar como rescatista: el rol se elige a propósito, el cuerpo es exacto, se refresca y se anuncia', async () => {
    const { user, decides, lists } = setup(opts());
    await user.click(await screen.findByRole('checkbox', { name: 'Persona Ficticia 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Persona Ficticia 3' }));
    const opener = screen.getByRole('button', { name: S.approve });
    await user.click(opener);

    const modal = dialog();
    expect(within(modal).getByRole('heading', { name: S.approveDialog.title })).toBeTruthy();
    expect(within(modal).getByText(S.people.replace('{{count}}', '2'))).toBeTruthy();
    expect(within(modal).getByText('Persona Ficticia 1')).toBeTruthy();
    expect(within(modal).getByText('Persona Ficticia 3')).toBeTruthy();
    // Sin rol por defecto: ninguno marcado.
    const rescuerRadio = within(modal).getByRole('radio', { name: new RegExp(text.account.roleRescuer) }) as HTMLInputElement;
    const coordinatorRadio = within(modal).getByRole('radio', { name: new RegExp(text.account.roleCoordinator) }) as HTMLInputElement;
    expect(rescuerRadio.checked).toBe(false);
    expect(coordinatorRadio.checked).toBe(false);
    expect(within(modal).queryByText(S.approveDialog.coordinatorWarning)).toBeNull();

    const listsBefore = lists().length;
    await user.click(rescuerRadio);
    await user.click(within(modal).getByRole('button', { name: S.approveDialog.confirm }));

    await waitFor(() => expect(decides()).toHaveLength(1));
    expect(decides()[0]!.body).toEqual({ action: 'approve', role: 'rescuer', selection: { mode: 'ids', ids: [idOf(1), idOf(3)] } });
    expect(decides()[0]!.headers.get('X-CSRF-Token')).toBe('csrf-token-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Resultado anunciado, bandeja refrescada, selección vacía y el foco no se pierde.
    const status = (await screen.findAllByRole('status')).find((el) => el.textContent?.includes(S.approved.replace('{{role}}', text.account.roleRescuer.toLowerCase()).replace('{{count}}', '2')));
    expect(status).toBeTruthy();
    await waitFor(() => expect(lists().length).toBeGreaterThan(listsBefore));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Persona Ficticia 1' })).toBeNull());
    expect(screen.getByRole('checkbox', { name: 'Persona Ficticia 2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: S.approve })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: S.title }));
  });

  it('elegir coordinador enseña el aviso de que concede permisos de edición, y se envía role=coordinator', async () => {
    const { user, decides } = setup(opts());
    await user.click(await screen.findByRole('checkbox', { name: 'Persona Ficticia 2' }));
    await user.click(screen.getByRole('button', { name: S.approve }));
    const modal = dialog();
    await user.click(within(modal).getByRole('radio', { name: new RegExp(text.account.roleCoordinator) }));
    expect(within(modal).getByText(S.approveDialog.coordinatorWarning)).toBeTruthy();
    expect(within(modal).getByText(S.approveDialog.summary.replace('{{role}}', text.account.roleCoordinator))).toBeTruthy();
    // Volver a rescatista quita el aviso.
    await user.click(within(modal).getByRole('radio', { name: new RegExp(text.account.roleRescuer) }));
    expect(within(modal).queryByText(S.approveDialog.coordinatorWarning)).toBeNull();
    await user.click(within(modal).getByRole('radio', { name: new RegExp(text.account.roleCoordinator) }));
    await user.click(within(modal).getByRole('button', { name: S.approveDialog.confirm }));
    await waitFor(() => expect(decides()).toHaveLength(1));
    expect(decides()[0]!.body).toEqual({ action: 'approve', role: 'coordinator', selection: { mode: 'ids', ids: [idOf(2)] } });
  });

  it('aprobar sin elegir rol no llama al servidor y lo pide', async () => {
    const { user, decides } = setup(opts());
    await user.click(await screen.findByRole('checkbox', { name: 'Persona Ficticia 1' }));
    await user.click(screen.getByRole('button', { name: S.approve }));
    await user.click(within(dialog()).getByRole('button', { name: S.approveDialog.confirm }));
    expect(within(dialog()).getByText(S.approveDialog.roleRequired)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog()).getAllByRole('radio')[0]);
    expect(decides()).toHaveLength(0);
  });

  it('rechazar no envía rol', async () => {
    const { user, decides } = setup(opts());
    await user.click(await screen.findByLabelText(S.selectPage));
    await user.click(screen.getByRole('button', { name: S.reject }));
    const modal = dialog();
    expect(within(modal).getByRole('heading', { name: S.rejectDialog.title })).toBeTruthy();
    expect(within(modal).queryByRole('radio')).toBeNull();
    expect(within(modal).getByText(S.people.replace('{{count}}', '3'))).toBeTruthy();
    await user.click(within(modal).getByRole('button', { name: S.rejectDialog.confirm }));
    await waitFor(() => expect(decides()).toHaveLength(1));
    expect(decides()[0]!.body).toEqual({ action: 'reject', selection: { mode: 'ids', ids: [idOf(1), idOf(2), idOf(3)] } });
    expect(await screen.findByText(S.rejected.replace('{{count}}', '3'))).toBeTruthy();
    expect(await screen.findByText(S.empty.pending)).toBeTruthy();
  });

  it('cancelar o pulsar Escape no llama al servidor, conserva la selección y devuelve el foco al botón', async () => {
    const { user, decides } = setup(opts());
    await user.click(await screen.findByRole('checkbox', { name: 'Persona Ficticia 1' }));
    const opener = screen.getByRole('button', { name: S.approve });
    await user.click(opener);
    expect(dialog().contains(document.activeElement)).toBe(true);
    await user.click(within(dialog()).getByRole('button', { name: S.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);

    await user.click(screen.getByRole('button', { name: S.reject }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: S.reject }));
    expect(decides()).toHaveLength(0);
    expect((screen.getByRole('checkbox', { name: 'Persona Ficticia 1' }) as HTMLInputElement).checked).toBe(true);
  });

  it.each(['INVALID_STATE_TRANSITION', 'NOT_FOUND'] as const)('%s: dice que alguien ya decidió, recarga la bandeja y vacía la selección', async (code) => {
    const people = [person(1), person(2)];
    const { user, lists } = setup(
      opts({
        people,
        decide: () => {
          people[0]!.status = 'approved'; // otra persona la decidió mientras tanto
          return apiError(code === 'NOT_FOUND' ? 404 : 409, code);
        },
      }),
    );
    await user.click(await screen.findByLabelText(S.selectPage));
    const before = lists().length;
    await user.click(screen.getByRole('button', { name: S.approve }));
    await user.click(within(dialog()).getByRole('radio', { name: new RegExp(text.account.roleRescuer) }));
    await user.click(within(dialog()).getByRole('button', { name: S.approveDialog.confirm }));
    expect(await screen.findByText(S.stale)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(S.stale);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(lists().length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Persona Ficticia 1' })).toBeNull());
    expect((screen.getByRole('checkbox', { name: 'Persona Ficticia 2' }) as HTMLInputElement).checked).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: S.title }));
  });

  it('RATE_LIMITED y la falta de red dejan el diálogo abierto con el motivo y la selección, para reintentar', async () => {
    let attempt = 0;
    const { user, decides } = setup(
      opts({
        decide: () => {
          attempt += 1;
          if (attempt === 1) return apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 12 });
          if (attempt === 2) throw new TypeError('Failed to fetch');
          return json(200, { affected: 1, skipped: [] });
        },
      }),
    );
    await user.click(await screen.findByRole('checkbox', { name: 'Persona Ficticia 1' }));
    await user.click(screen.getByRole('button', { name: S.reject }));
    await user.click(within(dialog()).getByRole('button', { name: S.rejectDialog.confirm }));
    expect(await within(dialog()).findByText(text.errors.RATE_LIMITED.replace('{{seconds}}', '12'))).toBeTruthy();

    await user.click(within(dialog()).getByRole('button', { name: S.rejectDialog.confirm }));
    expect(await within(dialog()).findByText(text.state.offline)).toBeTruthy();

    await user.click(within(dialog()).getByRole('button', { name: S.rejectDialog.confirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(decides()).toHaveLength(3);
    expect(decides().every((call) => (call.body as { selection: { ids: string[] } }).selection.ids[0] === idOf(1))).toBe(true);
  });
});

describe.each(LANGUAGES)('administración: código de invitación (%s)', (language, text: Text) => {
  const C = text.admin.inviteCode;
  const opts = (extra: Options = {}) => ({ language, ...extra });
  const section = async () => screen.findByRole('region', { name: C.title });

  it('lo pide al abrir la vista y lo muestra tal cual, en fuente monoespaciada y con la fecha', async () => {
    const { calls } = setup(opts());
    const region = await section();
    const code = await within(region).findByText(INVITE);
    expect(code.tagName).toBe('CODE');
    expect(code.textContent).toBe(INVITE);
    expect(calls('GET', '/admin/invite-code')).toHaveLength(1);
    expect(within(region).getByText(C.rotatedAt.replace('{{date}}', formatDateTime('2026-10-30T08:00:00+00:00', language)))).toBeTruthy();
  });

  it('un código de otro formato (el de la semilla) se muestra igual, sin transformarlo', async () => {
    setup(opts({ invite: () => json(200, { code: 'DEMO-a1b2c3d4e5f6', rotatedAt: '2026-10-30T08:00:00+00:00' }) }));
    expect((await within(await section()).findByText('DEMO-a1b2c3d4e5f6')).textContent).toBe('DEMO-a1b2c3d4e5f6');
  });

  it('muestra el estado de carga y el error con reintento', async () => {
    let release: (response: Response) => void = () => undefined;
    const first = setup(opts({ invite: () => new Promise<Response>((resolve) => (release = resolve)) }));
    await waitFor(() => expect(first.calls('GET', '/admin/invite-code')).toHaveLength(1));
    expect(within(await section()).getByText(text.state.loading)).toBeTruthy();
    release(json(200, { code: INVITE, rotatedAt: '2026-10-30T08:00:00+00:00' }));
    expect(await within(await section()).findByText(INVITE)).toBeTruthy();
    first.unmount();

    let fail = true;
    const view = setup(opts({ invite: () => (fail ? apiError(500, 'INTERNAL') : json(200, { code: INVITE, rotatedAt: '2026-10-30T08:00:00+00:00' })) }));
    const region = await section();
    const alert = await within(region).findByRole('alert');
    expect(within(alert).getByText(text.errors.INTERNAL)).toBeTruthy();
    fail = false;
    await view.user.click(within(alert).getByRole('button', { name: text.state.retry }));
    expect(await within(region).findByText(INVITE)).toBeTruthy();
  });

  it('copiar lo deja en el portapapeles y lo anuncia', async () => {
    const { user } = setup(opts());
    const region = await section();
    await within(region).findByText(INVITE);
    await user.click(within(region).getByRole('button', { name: C.copy }));
    expect(await within(region).findByText(C.copied)).toBeTruthy();
    expect(await navigator.clipboard.readText()).toBe(INVITE);
  });

  it('sin portapapeles (conexión no segura) avisa de copiarlo a mano y el código sigue a la vista', async () => {
    const { user } = setup(opts());
    const region = await section();
    await within(region).findByText(INVITE);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(within(region).getByRole('button', { name: C.copy }));
    expect(await within(region).findByText(C.copyFailed)).toBeTruthy();
    expect(within(region).getByText(INVITE)).toBeTruthy();
    expect(within(region).queryByText(C.copied)).toBeNull();

    // Y sin `navigator.clipboard` en absoluto.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await user.click(within(region).getByRole('button', { name: C.copy }));
    expect(await within(region).findByText(C.copyFailed)).toBeTruthy();
  });

  it('regenerar pide confirmación, avisa de que el anterior deja de valer, y muestra el código nuevo', async () => {
    const { user, calls } = setup(opts());
    const region = await section();
    await within(region).findByText(INVITE);
    const opener = within(region).getByRole('button', { name: C.rotate });
    await user.click(opener);

    const modal = dialog();
    expect(within(modal).getByRole('heading', { name: C.rotateTitle })).toBeTruthy();
    expect(within(modal).getByText(C.rotateDescription)).toBeTruthy();
    expect(calls('POST', '/admin/invite-code/rotate')).toHaveLength(0);
    // El foco empieza en lo seguro: cancelar.
    expect(document.activeElement).toBe(within(modal).getByRole('button', { name: C.rotateCancel }));

    await user.click(within(modal).getByRole('button', { name: C.rotateConfirm }));
    expect(await within(region).findByText(NEXT_INVITE)).toBeTruthy();
    expect(within(region).queryByText(INVITE)).toBeNull();
    expect(calls('POST', '/admin/invite-code/rotate')).toHaveLength(1);
    expect(calls('POST', '/admin/invite-code/rotate')[0]!.body).toEqual({});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(region).getByText(C.rotated)).toBeTruthy();
    expect(document.activeElement).toBe(opener);
    // Copiar copia el nuevo.
    await user.click(within(region).getByRole('button', { name: C.copy }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(NEXT_INVITE));
  });

  it('cancelar la regeneración (botón o Escape) no llama al servidor y devuelve el foco', async () => {
    const { user, calls } = setup(opts());
    const region = await section();
    await within(region).findByText(INVITE);
    const opener = within(region).getByRole('button', { name: C.rotate });
    await user.click(opener);
    await user.click(within(dialog()).getByRole('button', { name: C.rotateCancel }));
    expect(document.activeElement).toBe(opener);
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(calls('POST', '/admin/invite-code/rotate')).toHaveLength(0);
    expect(within(region).getByText(INVITE)).toBeTruthy();
  });

  it('si regenerar falla, el diálogo sigue abierto con el motivo y el código anterior no cambia', async () => {
    const { user } = setup(opts({ rotate: () => apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 7 }) }));
    const region = await section();
    await within(region).findByText(INVITE);
    await user.click(within(region).getByRole('button', { name: C.rotate }));
    await user.click(within(dialog()).getByRole('button', { name: C.rotateConfirm }));
    expect(await within(dialog()).findByText(text.errors.RATE_LIMITED.replace('{{seconds}}', '7'))).toBeTruthy();
    expect(within(region).getByText(INVITE)).toBeTruthy();
  });
});

describe('administración: solo para el administrador', () => {
  it.each([
    ['coordinador', () => sessionUser()],
    ['rescatista', () => rescuer()],
  ])('el %s no ve la sección ni el enlace, y la web no pide nada de administración', async (_name, make) => {
    const { api } = sessionServer({ user: make() });
    renderApp({ route: '/admin', fetch: api.fetch });
    expect(await screen.findByRole('heading', { level: 1, name: es.forbidden.title })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: es.admin.signups.title })).toBeNull();
    expect(screen.queryByRole('heading', { name: es.admin.inviteCode.title })).toBeNull();
    expect(screen.queryByRole('link', { name: es.nav.administration })).toBeNull();
    expect(api.calls.filter((call) => call.path.startsWith('/admin'))).toHaveLength(0);
  });

  it('el administrador sí tiene el enlace «Administración» y llega a la bandeja desde él', async () => {
    const { api } = sessionServer(
      { user: admin() },
      { 'GET /admin/signup-requests': () => json(200, paged([])), 'GET /admin/invite-code': () => json(200, { code: INVITE, rotatedAt: '2026-10-30T08:00:00+00:00' }) },
    );
    const { user } = renderApp({ route: '/home', fetch: api.fetch });
    await user.click(await screen.findByRole('link', { name: es.nav.administration }));
    expect(await screen.findByRole('heading', { level: 2, name: es.admin.signups.title })).toBeTruthy();
    expect(screen.getByTestId('path').textContent).toBe('/admin');
  });
});
