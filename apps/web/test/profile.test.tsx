// Alta obligatoria y Mi perfil del rescatista (H5-perfil T7): RF-101, RF-807, RF-810, INV-24 (en la vista), P1.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { es, fr } from '@onway/i18n';
import { apiError, json, renderApp, rescuer, sessionServer, type Call } from './support';

const P = es.profile;
const ADDRESS = { street: 'Calle Inventada', number: '7', floor: '2º B', postalCode: '22600', locality: 'Sabiñánigo', province: 'Huesca', country: 'ES' };
const incompleteProfile = () => ({
  status: 'incomplete',
  fullName: 'Rescatista Demo',
  email: 'rescatista1@example.org',
  phone: null,
  document: null,
  addressSummary: null,
  skills: [],
  teams: [],
  missingFields: ['phone', 'document', 'address'],
  completedAt: null,
});
const completeProfile = () => ({
  ...incompleteProfile(),
  status: 'complete',
  phone: '+34 600 000 001',
  document: { type: 'dni', masked: '•••••••8Z' },
  addressSummary: '•••••, 22600 Sabiñánigo (ES)',
  teams: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Equipo Ordesa', locality: 'Torla' }],
  missingFields: [],
  completedAt: '2026-11-22T09:00:00.000Z',
});

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;

function setup(options: { route?: string; complete?: boolean; language?: 'es' | 'fr'; extra?: Handlers } = {}) {
  const user = options.complete ? rescuer({ profileStatus: 'complete', nextStep: 'home', locale: options.language ?? 'es' }) : rescuer({ locale: options.language ?? 'es' });
  const server = sessionServer(
    { user },
    {
      'GET /my/profile': () => json(200, options.complete ? completeProfile() : incompleteProfile()),
      'GET /my/missions': () => json(200, { items: [], page: 1, pageSize: 20, total: 0 }),
      'GET /my/profile/sensitive': () => json(200, { document: { type: 'dni', number: '12345678Z' }, address: ADDRESS }),
      ...options.extra,
    },
  );
  const view = renderApp({ route: options.route ?? '/profile', fetch: server.api.fetch, language: options.language ?? 'es' });
  return { ...server, ...view, calls: () => server.api.calls };
}

const path = () => screen.getByTestId('path').textContent;

async function fillSignup(user: ReturnType<typeof setup>['user'], document = '12345678Z') {
  await user.clear(await screen.findByLabelText(P.fields.fullName));
  await user.type(screen.getByLabelText(P.fields.fullName), 'Nombre Ficticio Completo');
  await user.type(screen.getByLabelText(P.fields.documentNumber), document);
  await user.type(screen.getByLabelText(P.fields.phone), '+34 600 000 010');
  await user.type(screen.getByLabelText(P.fields.street), ADDRESS.street);
  await user.type(screen.getByLabelText(P.fields.number), ADDRESS.number);
  await user.type(screen.getByLabelText(P.fields.floor), ADDRESS.floor);
  await user.type(screen.getByLabelText(P.fields.postalCode), ADDRESS.postalCode);
  await user.type(screen.getByLabelText(P.fields.locality), ADDRESS.locality);
  await user.type(screen.getByLabelText(P.fields.province), ADDRESS.province);
}

describe('alta obligatoria (RF-101, P1)', () => {
  it('con el perfil incompleto, cualquier otra vista lleva a «Mi perfil» y la barra solo ofrece Mi perfil y Cuenta', async () => {
    setup({ route: '/missions' });
    expect(await screen.findByRole('heading', { level: 1, name: P.completeTitle })).toBeTruthy();
    expect(path()).toBe('/profile');
    const nav = screen.getByRole('navigation', { name: es.nav.label });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([es.nav.myProfile, es.nav.account]);
  });

  it('Cuenta sigue abierta con el perfil incompleto', async () => {
    setup({ route: '/account' });
    expect(await screen.findByRole('heading', { level: 1, name: es.account.title })).toBeTruthy();
    expect(path()).toBe('/account');
  });

  it('con el perfil completo no se redirige', async () => {
    setup({ route: '/missions', complete: true });
    expect(await screen.findByRole('heading', { level: 1, name: es.myMissions.title })).toBeTruthy();
    expect(path()).toBe('/missions');
  });
});

describe('formulario de alta (RF-807)', () => {
  it('enseña el correo de la cuenta sin dejar cambiarlo y el aviso de quién ve qué', async () => {
    setup();
    const email = (await screen.findByLabelText(P.fields.email)) as HTMLInputElement;
    expect(email.value).toBe('rescatista1@example.org');
    expect(email.readOnly).toBe(true);
    expect(screen.getByText(P.whoSees)).toBeTruthy();
  });

  it('valida antes de enviar: obligatorios y la letra del DNI, con el foco en el primero; no se envía nada', async () => {
    const { user, calls } = setup();
    await user.clear(await screen.findByLabelText(P.fields.fullName));
    await user.click(screen.getByRole('button', { name: P.save }));
    expect(document.activeElement).toBe(screen.getByLabelText(P.fields.fullName));
    expect(screen.getAllByText(P.errors.required).length).toBeGreaterThan(3);
    await fillSignup(user, '12345678A');
    await user.click(screen.getByRole('button', { name: P.save }));
    expect(await screen.findByText(P.errors.invalidDocument)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(P.fields.documentNumber));
    expect(calls().some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('envía el cuerpo exacto y, con el alta completa, abre Mis misiones', async () => {
    let body: unknown;
    const { user, state } = setup({
      extra: {
        'PATCH /my/profile': (call) => {
          body = call.body;
          state.user = rescuer({ profileStatus: 'complete', nextStep: 'home' });
          return json(200, completeProfile());
        },
      },
    });
    await fillSignup(user);
    await user.click(screen.getByRole('button', { name: P.save }));
    await waitFor(() => expect(path()).toBe('/missions'));
    expect(body).toEqual({
      fullName: 'Nombre Ficticio Completo',
      phone: '+34 600 000 010',
      document: { type: 'dni', number: '12345678Z' },
      address: ADDRESS,
    });
  });

  it('un documento ya registrado se dice en su campo, sin decir de quién es', async () => {
    const { user } = setup({ extra: { 'PATCH /my/profile': () => apiError(409, 'DOCUMENT_ALREADY_REGISTERED') } });
    await fillSignup(user);
    await user.click(screen.getByRole('button', { name: P.save }));
    expect(await screen.findByText(P.errors.documentTaken)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(P.fields.documentNumber));
    expect(path()).toBe('/profile');
  });

  it('en francés', async () => {
    setup({ language: 'fr' });
    expect(await screen.findByRole('heading', { level: 1, name: fr.profile.completeTitle })).toBeTruthy();
    expect(screen.getByLabelText(fr.profile.fields.documentNumber)).toBeTruthy();
  });
});

describe('Mi perfil (RF-806, RF-810)', () => {
  it('enseña contacto, el documento y la dirección ocultos y los equipos; «Mostrar» pide los datos en claro y «Ocultar» los retira', async () => {
    const { user, calls } = setup({ complete: true });
    expect(await screen.findByRole('heading', { level: 1, name: P.title })).toBeTruthy();
    expect(screen.getByText('+34 600 000 001')).toBeTruthy();
    expect(screen.getByText('•••••••8Z')).toBeTruthy();
    expect(screen.getByText('•••••, 22600 Sabiñánigo (ES)')).toBeTruthy();
    expect(screen.getByText('Equipo Ordesa · Torla')).toBeTruthy();
    expect(calls().some((c) => c.path === '/my/profile/sensitive')).toBe(false);

    await user.click(screen.getByRole('button', { name: P.view.show }));
    expect(await screen.findByText('12345678Z')).toBeTruthy();
    expect(screen.getByText(/Calle Inventada 7, 2º B, 22600 Sabiñánigo, Huesca/)).toBeTruthy();
    expect(screen.getByRole('button', { name: P.view.hide }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: P.view.hide }));
    expect(screen.queryByText('12345678Z')).toBeNull();
    expect(screen.getByText('•••••••8Z')).toBeTruthy();
  });

  it('«Corregir mis datos» parte de lo guardado y solo envía lo que cambió', async () => {
    let body: unknown;
    const { user } = setup({
      complete: true,
      extra: {
        'PATCH /my/profile': (call) => {
          body = call.body;
          return json(200, completeProfile());
        },
      },
    });
    await user.click(await screen.findByRole('button', { name: P.edit }));
    const phone = (await screen.findByLabelText(P.fields.phone)) as HTMLInputElement;
    expect(phone.value).toBe('+34 600 000 001');
    expect((screen.getByLabelText(P.fields.documentNumber) as HTMLInputElement).value).toBe('12345678Z');
    await user.clear(phone);
    await user.type(phone, '+34 600 000 099');
    await user.click(screen.getByRole('button', { name: P.save }));
    expect(await screen.findByText(P.saved)).toBeTruthy();
    expect(body).toEqual({ phone: '+34 600 000 099' });
  });

  it('si el perfil no carga, lo dice y deja reintentar', async () => {
    let attempts = 0;
    const { user } = setup({ complete: true, extra: { 'GET /my/profile': () => (++attempts === 1 ? apiError(500, 'INTERNAL') : json(200, completeProfile())) } });
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: es.state.retry }));
    expect(await screen.findByRole('heading', { level: 1, name: P.title })).toBeTruthy();
  });

  it('sin equipos lo dice', async () => {
    setup({ complete: true, extra: { 'GET /my/profile': () => json(200, { ...completeProfile(), teams: [] }) } });
    expect(await screen.findByText(P.view.noTeams)).toBeTruthy();
  });
});
