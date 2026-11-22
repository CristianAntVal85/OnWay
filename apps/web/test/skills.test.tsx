// «Cursos y habilidades» en Mi perfil (H5-habilidades T6): RF-808 (ver y eliminar), doc 02 §3.9 (columna del certificado).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { es, fr } from '@onway/i18n';
import { apiError, json, renderApp, rescuer, sessionServer, type Call } from './support';

const S = es.profile.skills;
const ids = { course: '55555555-5555-4555-8555-555555555551', other: '55555555-5555-4555-8555-555555555552', skill: '55555555-5555-4555-8555-555555555553' };
const course = { id: ids.course, name: 'Primeros auxilios en montaña', kind: 'course', issuer: 'Entidad Ficticia', issuedOn: '2026-03-01', expiresOn: '2028-03-01', hasCertificate: true };
const bare = { id: ids.other, name: 'Técnico de rescate', kind: 'course', issuer: null, issuedOn: null, expiresOn: null, hasCertificate: false };
const skill = { id: ids.skill, name: 'Conducción 4x4', kind: 'skill', issuer: null, issuedOn: null, expiresOn: null, hasCertificate: false };

const profile = () => ({
  status: 'complete',
  fullName: 'Rescatista Demo',
  email: 'rescatista1@example.org',
  phone: '+34 600 000 001',
  document: { type: 'dni', masked: '•••••••8Z' },
  addressSummary: '•••••, 22600 Sabiñánigo (ES)',
  skills: [],
  teams: [],
  missingFields: [],
  completedAt: '2026-11-22T09:00:00.000Z',
});

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;

function setup(options: { items?: unknown[]; language?: 'es' | 'fr'; extra?: Handlers; incomplete?: boolean } = {}) {
  let items = options.items ?? [course, bare, skill];
  const language = options.language ?? 'es';
  const user = options.incomplete ? rescuer({ locale: language }) : rescuer({ profileStatus: 'complete', nextStep: 'home', locale: language });
  const server = sessionServer(
    { user },
    {
      'GET /my/profile': () =>
        json(200, options.incomplete ? { ...profile(), status: 'incomplete', phone: null, document: null, addressSummary: null, missingFields: ['phone', 'document', 'address'] } : profile()),
      'GET /my/skills': () => json(200, { items }),
      [`DELETE /my/skills/${ids.course}`]: () => {
        items = items.filter((item) => (item as { id: string }).id !== ids.course);
        return json(204, null);
      },
      ...options.extra,
    },
  );
  const view = renderApp({ route: '/profile', fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}

const section = async () => within(await screen.findByRole('region', { name: S.title }));

describe('cursos y habilidades en Mi perfil (RF-808)', () => {
  it('mientras carga, lo dice sin mover el foco', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    setup({ extra: { 'GET /my/skills': async () => (await gate, json(200, { items: [skill] })) } });
    const region = await section();
    expect(await region.findByText(es.state.loading)).toBeTruthy();
    release();
    expect(await region.findByText(skill.name)).toBeTruthy();
  });

  it('muestra la lista: nombre, tipo, entidad, fecha y caducidad, con «adjunto» solo en el curso con certificado', async () => {
    setup();
    const region = await section();
    expect(await region.findByText(course.name)).toBeTruthy();
    const items = region.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    const first = within(items[0]!);
    expect(first.getByText(course.name)).toBeTruthy();
    expect(first.getByText(S.kind.course)).toBeTruthy();
    expect(first.getByText('Expedido por Entidad Ficticia')).toBeTruthy();
    expect(first.getByText(/Fecha: .*2026/)).toBeTruthy();
    expect(first.getByText(/Caduca: .*2028/)).toBeTruthy();
    expect(first.getByText(S.attached, { exact: false })).toBeTruthy();
    // El curso sin certificado lo dice y no lleva la marca; la habilidad no admite certificado y no dice nada.
    expect(within(items[1]!).getByText(S.noCertificate)).toBeTruthy();
    expect(within(items[1]!).queryByText(S.attached, { exact: false })).toBeNull();
    expect(within(items[2]!).getByText(S.kind.skill)).toBeTruthy();
    expect(within(items[2]!).queryByText(S.noCertificate)).toBeNull();
    expect(within(items[2]!).queryByText(S.attached, { exact: false })).toBeNull();
  });

  it('con la lista vacía dice «Aún no has añadido cursos ni habilidades»', async () => {
    setup({ items: [] });
    const region = await section();
    expect(await region.findByText('Aún no has añadido cursos ni habilidades')).toBeTruthy();
    expect(region.queryByRole('list')).toBeNull();
  });

  it('si falla la carga muestra el error del servidor y reintentar vuelve a pedirla', async () => {
    let fail = true;
    const server = setup({ extra: { 'GET /my/skills': () => (fail ? apiError(500, 'INTERNAL') : json(200, { items: [skill] })) } });
    const region = await section();
    expect(await region.findByRole('alert')).toBeTruthy();
    fail = false;
    await server.user.click(region.getByRole('button', { name: es.state.retry }));
    expect(await region.findByText(skill.name)).toBeTruthy();
  });

  it('eliminar pide confirmación: cancelar no borra, confirmar llama a deleteMySkill, quita la entrada, lo anuncia y lleva el foco a la sección', async () => {
    const { user, calls } = setup();
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.removeFor.replace('{{name}}', course.name) }));
    const dialog = await screen.findByRole('dialog', { name: S.removeTitle.replace('{{name}}', course.name) });
    expect(within(dialog).getByText(S.removeWithCertificate)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: S.removeCancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls().some((c) => c.method === 'DELETE')).toBe(false);

    await user.click(region.getByRole('button', { name: S.removeFor.replace('{{name}}', course.name) }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: S.removeConfirm }));
    await waitFor(() => expect(region.queryByText(course.name)).toBeNull());
    expect(
      calls()
        .filter((c) => c.method === 'DELETE')
        .map((c) => c.path),
    ).toEqual([`/my/skills/${ids.course}`]);
    expect(await region.findByText(S.removed)).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.className).toContain('skills-section'));
  });

  it('un error al eliminar se ve en el diálogo y la entrada sigue', async () => {
    const { user } = setup({ extra: { [`DELETE /my/skills/${ids.course}`]: () => apiError(500, 'INTERNAL') } });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.removeFor.replace('{{name}}', course.name) }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: S.removeConfirm }));
    expect(await within(await screen.findByRole('dialog')).findByRole('alert')).toBeTruthy();
    expect(region.getByText(course.name)).toBeTruthy();
  });

  it('en el alta con el perfil incompleto, la sección también está bajo el formulario', async () => {
    setup({ incomplete: true });
    expect(await screen.findByRole('heading', { level: 1, name: es.profile.completeTitle })).toBeTruthy();
    const region = await section();
    expect(await region.findByText(course.name)).toBeTruthy();
  });

  it('en francés usa los textos de fr', async () => {
    setup({ language: 'fr', items: [course] });
    const region = within(await screen.findByRole('region', { name: fr.profile.skills.title }));
    expect(await region.findByText(course.name)).toBeTruthy();
    expect(region.getByText(fr.profile.skills.kind.course)).toBeTruthy();
    expect(region.getByText('Délivrée par Entidad Ficticia')).toBeTruthy();
  });
});
