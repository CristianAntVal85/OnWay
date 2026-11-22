// «Cursos y habilidades» en Mi perfil (H5-habilidades T6): RF-808 (ver y eliminar), doc 02 §3.9 (columna del certificado).
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    // El curso sin certificado ofrece «Adjuntar» y no lleva la marca; la habilidad no admite certificado y no ofrece nada.
    expect(within(items[1]!).getByRole('button', { name: S.attachFor.replace('{{name}}', bare.name) })).toBeTruthy();
    expect(within(items[1]!).queryByText(S.attached, { exact: false })).toBeNull();
    expect(within(items[2]!).getByText(S.kind.skill)).toBeTruthy();
    expect(within(items[2]!).queryByRole('button', { name: /Adjuntar/ })).toBeNull();
    expect(within(items[2]!).queryByRole('button', { name: S.openCertificate })).toBeNull();
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

// ---------- T7: añadir, editar y abrir el certificado ----------

const FILE = '66666666-6666-4666-8666-666666666661';
const fileRef = (contentType: string) => ({ id: FILE, purpose: 'certificate', contentType, sizeBytes: 5, createdAt: '2026-11-22T09:00:00.000Z' });
const pdf = () => new File(['%PDF-'], 'certificado.pdf', { type: 'application/pdf' });
const png = () => new File(['PNG'], 'certificado.png', { type: 'image/png' });
const saved = (body: object) => ({ id: ids.other, issuer: null, issuedOn: null, expiresOn: null, hasCertificate: 'certificateFileId' in body, ...body });

afterEach(() => vi.restoreAllMocks());

describe('añadir y editar (RF-808, D-29)', () => {
  it('crea un curso con certificado: primero sube el archivo y después guarda la entrada con su id', async () => {
    const order: string[] = [];
    const { user, calls } = setup({
      items: [],
      extra: {
        'POST /files': () => (order.push('upload'), json(201, fileRef('application/pdf'))),
        'POST /my/skills': (call) => (order.push('create'), json(201, saved({ ...(call.body as object), kind: 'course' }))),
      },
    });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.add }));
    const dialog = within(await screen.findByRole('dialog', { name: S.addTitle }));
    await user.type(dialog.getByLabelText(S.fields.name), 'Primeros auxilios en montaña');
    await user.type(dialog.getByLabelText(S.fields.issuer), 'Entidad Ficticia');
    await user.type(dialog.getByLabelText(S.fields.issuedOn), '2026-03-01');
    await user.type(dialog.getByLabelText(S.fields.expiresOn), '2028-03-01');
    await user.upload(dialog.getByLabelText(S.fields.certificate), pdf());
    await user.click(dialog.getByRole('button', { name: S.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(order).toEqual(['upload', 'create']);
    const upload = calls().find((c) => c.path === '/files')!;
    expect(upload.form?.get('purpose')).toBe('certificate');
    expect((upload.form?.get('file') as File).name).toBe('certificado.pdf');
    expect(calls().find((c) => c.path === '/my/skills' && c.method === 'POST')!.body).toEqual({
      name: 'Primeros auxilios en montaña',
      kind: 'course',
      issuer: 'Entidad Ficticia',
      issuedOn: '2026-03-01',
      expiresOn: '2028-03-01',
      certificateFileId: FILE,
    });
    expect(await region.findByText(S.saved)).toBeTruthy();
  });

  it('un tipo de archivo no admitido sale en el campo del archivo y la entrada no se guarda', async () => {
    const { user, calls } = setup({ items: [], extra: { 'POST /files': () => apiError(415, 'UNSUPPORTED_FILE_TYPE') } });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.add }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(S.fields.name), 'Curso');
    const input = dialog.getByLabelText(S.fields.certificate);
    await user.upload(input, new File(['hola'], 'nota.pdf', { type: 'application/pdf' }));
    await user.click(dialog.getByRole('button', { name: S.save }));
    expect(await dialog.findByText(es.errors.UNSUPPORTED_FILE_TYPE)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(calls().some((c) => c.path === '/my/skills' && c.method === 'POST')).toBe(false);
  });

  it('valida en el cliente con SkillInput: nombre vacío y caducidad anterior a la fecha, sin llamar al servidor', async () => {
    const { user, calls } = setup({ items: [] });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.add }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(S.fields.issuedOn), '2026-03-01');
    await user.type(dialog.getByLabelText(S.fields.expiresOn), '2026-01-01');
    await user.click(dialog.getByRole('button', { name: S.save }));
    expect(await dialog.findByText(S.errors.name)).toBeTruthy();
    expect(dialog.getByText(S.errors.expiresBeforeIssued)).toBeTruthy();
    expect(document.activeElement).toBe(dialog.getByLabelText(S.fields.name));
    expect(calls().some((c) => c.method === 'POST')).toBe(false);
  });

  it('una habilidad no ofrece el archivo, y al volver a curso sí', async () => {
    const { user } = setup({ items: [] });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.add }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText(S.fields.certificate)).toBeTruthy();
    await user.selectOptions(dialog.getByLabelText(S.fields.kind), 'skill');
    expect(dialog.queryByLabelText(S.fields.certificate)).toBeNull();
    await user.selectOptions(dialog.getByLabelText(S.fields.kind), 'course');
    expect(dialog.getByLabelText(S.fields.certificate)).toBeTruthy();
  });

  it('crea una habilidad sin archivo y no sube nada', async () => {
    const { user, calls } = setup({ items: [], extra: { 'POST /my/skills': (call) => json(201, saved(call.body as object)) } });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.add }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(S.fields.name), 'Conducción 4x4');
    await user.selectOptions(dialog.getByLabelText(S.fields.kind), 'skill');
    await user.click(dialog.getByRole('button', { name: S.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls().some((c) => c.path === '/files')).toBe(false);
    expect(calls().find((c) => c.method === 'POST' && c.path === '/my/skills')!.body).toEqual({ name: 'Conducción 4x4', kind: 'skill' });
  });

  it('edita un curso: envía solo lo que cambió y el foco vuelve a «Editar»', async () => {
    const { user, calls } = setup({ extra: { [`PATCH /my/skills/${ids.course}`]: (call) => json(200, { ...course, ...(call.body as object) }) } });
    const region = await section();
    const opener = await region.findByRole('button', { name: S.editFor.replace('{{name}}', course.name) });
    await user.click(opener);
    const dialog = within(await screen.findByRole('dialog', { name: S.editTitle }));
    expect((dialog.getByLabelText(S.fields.name) as HTMLInputElement).value).toBe(course.name);
    expect((dialog.getByLabelText(S.fields.kind) as HTMLSelectElement).disabled).toBe(true);
    await user.clear(dialog.getByLabelText(S.fields.name));
    await user.type(dialog.getByLabelText(S.fields.name), 'Primeros auxilios 2');
    await user.click(dialog.getByRole('button', { name: S.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls().find((c) => c.method === 'PATCH')!.body).toEqual({ name: 'Primeros auxilios 2' });
    expect(document.activeElement).toBe(opener);
  });

  it('edita y cambia el certificado: sube el archivo nuevo y lo envía en el PATCH', async () => {
    const { user, calls } = setup({
      extra: { 'POST /files': () => json(201, fileRef('image/png')), [`PATCH /my/skills/${ids.course}`]: (call) => json(200, { ...course, ...(call.body as object) }) },
    });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.editFor.replace('{{name}}', course.name) }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.upload(dialog.getByLabelText(S.fields.certificateReplace), png());
    await user.click(dialog.getByRole('button', { name: S.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls().find((c) => c.method === 'PATCH')!.body).toEqual({ certificateFileId: FILE });
  });

  it('«Quitar certificado» envía certificateFileId: null y se puede deshacer antes de guardar', async () => {
    const { user, calls } = setup({ extra: { [`PATCH /my/skills/${ids.course}`]: (call) => json(200, { ...course, ...(call.body as object), hasCertificate: false }) } });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.editFor.replace('{{name}}', course.name) }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: S.removeCertificate }));
    // El cambio se anuncia: la nota es una región de estado (lector de pantalla).
    expect(dialog.getByRole('status').textContent).toBe(S.certificateWillRemove);
    await user.click(dialog.getByRole('button', { name: S.keepCertificate }));
    expect(dialog.getByText(S.certificateCurrent)).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: S.removeCertificate }));
    await user.click(dialog.getByRole('button', { name: S.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls().find((c) => c.method === 'PATCH')!.body).toEqual({ certificateFileId: null });
  });

  it('«Adjuntar» abre el diálogo con el foco en el archivo; al guardar, el foco pasa a la sección', async () => {
    const { user } = setup({
      extra: {
        'POST /files': () => json(201, fileRef('application/pdf')),
        [`PATCH /my/skills/${ids.other}`]: (call) => json(200, { ...bare, ...(call.body as object), hasCertificate: true }),
        'GET /my/skills': () => json(200, { items: [course, bare, skill] }),
      },
    });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.attachFor.replace('{{name}}', bare.name) }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(document.activeElement).toBe(dialog.getByLabelText(S.fields.certificate));
    await user.upload(dialog.getByLabelText(S.fields.certificate), pdf());
    await user.click(dialog.getByRole('button', { name: S.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement?.className).toContain('skills-section'));
  });

  it('se maneja con teclado: Escape cierra y Tab no sale del diálogo', async () => {
    const { user } = setup({ items: [] });
    const region = await section();
    const opener = await region.findByRole('button', { name: S.add });
    opener.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: S.addTitle });
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('un error del servidor sin campo se ve en el diálogo y no lo cierra', async () => {
    const { user } = setup({ items: [], extra: { 'POST /my/skills': () => apiError(500, 'INTERNAL') } });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.add }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(S.fields.name), 'Curso');
    await user.click(dialog.getByRole('button', { name: S.save }));
    expect(await dialog.findByText(es.errors.INTERNAL)).toBeTruthy();
  });

  it('en francés el diálogo usa los textos de fr', async () => {
    const { user } = setup({ items: [], language: 'fr' });
    const region = within(await screen.findByRole('region', { name: fr.profile.skills.title }));
    await user.click(await region.findByRole('button', { name: fr.profile.skills.add }));
    const dialog = within(await screen.findByRole('dialog', { name: fr.profile.skills.addTitle }));
    expect(dialog.getByLabelText(fr.profile.skills.fields.issuer)).toBeTruthy();
  });
});

describe('abrir el certificado (D-S3)', () => {
  const fakeTab = () => {
    const tab = { opener: 'window', location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    return tab;
  };

  it('abre la pestaña en el gesto, pide el enlace y la navega a él sin opener', async () => {
    const tab = fakeTab();
    const { user, calls } = setup({ extra: { [`POST /skills/${ids.course}/certificate-link`]: () => json(200, { url: '/api/v1/certificates/abc.def', expiresAt: '2026-11-22T09:05:00.000Z' }) } });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.openFor.replace('{{name}}', course.name) }));
    await waitFor(() => expect(tab.location.href).toBe('/api/v1/certificates/abc.def'));
    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(calls().filter((c) => c.path.endsWith('/certificate-link'))).toHaveLength(1);
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('si el enlace falla, cierra la pestaña y lo avisa', async () => {
    const tab = fakeTab();
    const { user } = setup({ extra: { [`POST /skills/${ids.course}/certificate-link`]: () => apiError(404, 'NOT_FOUND') } });
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.openFor.replace('{{name}}', course.name) }));
    expect(await region.findByText(S.openFailed)).toBeTruthy();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
  });

  it('si el navegador bloquea la pestaña, lo dice y no pide el enlace', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { user, calls } = setup();
    const region = await section();
    await user.click(await region.findByRole('button', { name: S.openFor.replace('{{name}}', course.name) }));
    expect(await region.findByText(S.popupBlocked)).toBeTruthy();
    expect(calls().some((c) => c.path.endsWith('/certificate-link'))).toBe(false);
  });
});
