// Registro con código de invitación (RF-104, RN-25, doc 02 §3.1): validación en el cliente, mensaje único y «Solicitud recibida».
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { es, fr } from '@onway/i18n';
import { apiError, json, renderApp, sessionServer, type Call } from './support';

type Text = typeof es;
const LANGUAGES = [
  ['es', es],
  ['fr', fr],
] as const;

const INVITE = 'K7QM-X2PD-9WTR-HC4N';
const PASSWORD = 'una-clave-larga-12345';

function setup(language: 'es' | 'fr', register: (call: Call) => Response | Promise<Response> = () => json(202, { status: 'received' })) {
  window.localStorage.setItem('onway.locale', language); // sin sesión, el idioma de la interfaz es el elegido en este navegador
  const { api, state } = sessionServer({}, { 'POST /auth/register': register });
  const view = renderApp({ route: '/register', fetch: api.fetch, language });
  const registerCalls = () => api.calls.filter((call) => call.path === '/auth/register');
  return { ...view, api, state, registerCalls };
}

async function fill(user: ReturnType<typeof renderApp>['user'], text: Text, values: Partial<Record<'email' | 'displayName' | 'password' | 'passwordConfirm' | 'inviteCode', string>>) {
  const labels = {
    email: text.register.email,
    displayName: text.register.displayName,
    password: text.register.password,
    passwordConfirm: text.register.passwordConfirm,
    inviteCode: text.register.inviteCode,
  };
  for (const [field, value] of Object.entries(values) as [keyof typeof labels, string][]) {
    const input = await screen.findByLabelText(labels[field]);
    await user.clear(input);
    if (value) await user.type(input, value);
  }
}

const valid = { email: 'Nueva.Persona@example.org ', displayName: 'Persona Nueva', password: PASSWORD, passwordConfirm: PASSWORD, inviteCode: ` ${INVITE} ` };
const submit = (text: Text) => screen.getByRole('button', { name: text.register.submit });

describe.each(LANGUAGES)('registro (%s)', (language, text) => {
  it('se abre sin sesión, con sus campos, autocompletado y título', async () => {
    setup(language);
    expect(await screen.findByRole('heading', { level: 1, name: text.register.title })).toBeTruthy();
    expect(screen.getByTestId('path').textContent).toBe('/register');
    expect(document.title).toBe(`${text.register.title} · OnWay`);
    expect(screen.getByLabelText(text.register.email).getAttribute('autocomplete')).toBe('email');
    expect(screen.getByLabelText(text.register.displayName).getAttribute('autocomplete')).toBe('name');
    expect(screen.getByLabelText(text.register.password).getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText(text.register.passwordConfirm).getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText(text.register.inviteCode).getAttribute('autocomplete')).toBe('off');
    expect(screen.getByRole('link', { name: text.register.haveAccount }).getAttribute('href')).toBe('/login');
  });

  it('valida cada campo antes de enviar y lleva el foco al primero con error', async () => {
    const { user, registerCalls } = setup(language);
    await user.click(await screen.findByRole('button', { name: text.register.submit }));
    const messages = [
      text.fieldError.email.required,
      text.fieldError.displayName.required,
      text.fieldError.password.required,
      text.fieldError.passwordConfirm.required,
      text.fieldError.inviteCode.required,
    ];
    for (const message of messages) expect(screen.getByText(message)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(text.register.email));
    expect(screen.getByLabelText(text.register.email).getAttribute('aria-invalid')).toBe('true');
    expect(registerCalls()).toHaveLength(0);

    // Cada error está asociado a su campo.
    const email = screen.getByLabelText(text.register.email);
    expect(document.getElementById(email.getAttribute('aria-describedby')!)?.textContent).toBe(text.fieldError.email.required);
  });

  it('formato de correo, contraseña corta y larga (las reglas del contrato), coincidencia y código', async () => {
    const { user, registerCalls } = setup(language);
    await fill(user, text, { email: 'sin-arroba', displayName: 'x'.repeat(121), password: 'corta', passwordConfirm: 'otra', inviteCode: 'x' });
    await user.click(submit(text));
    expect(screen.getByText(text.fieldError.email.invalid)).toBeTruthy();
    expect(screen.getByText(text.fieldError.displayName.tooLong.replace('{{max}}', '120'))).toBeTruthy();
    expect(screen.getByText(text.fieldError.password.tooShort.replace('{{min}}', '12'))).toBeTruthy();
    expect(screen.getByText(text.fieldError.passwordConfirm.mismatch)).toBeTruthy();
    expect(screen.getByText(text.fieldError.inviteCode.invalid)).toBeTruthy();

    await fill(user, text, { ...valid, password: 'x'.repeat(201), passwordConfirm: 'x'.repeat(201) });
    await user.click(submit(text));
    expect(screen.getByText(text.fieldError.password.tooLong.replace('{{max}}', '200'))).toBeTruthy();
    expect(registerCalls()).toHaveLength(0);

    await fill(user, text, { password: PASSWORD, passwordConfirm: PASSWORD + '!' });
    await user.click(submit(text));
    expect(screen.getByText(text.fieldError.passwordConfirm.mismatch)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(text.register.passwordConfirm));
    expect(registerCalls()).toHaveLength(0);
  });

  it('envía el cuerpo exacto (con el idioma de la interfaz) y muestra «Solicitud recibida» sin abrir sesión', async () => {
    const { user, registerCalls, api } = setup(language);
    await fill(user, text, valid);
    await user.click(submit(text));
    const heading = await screen.findByRole('heading', { level: 1, name: text.register.receivedTitle });
    expect(registerCalls()).toHaveLength(1);
    expect(registerCalls()[0]!.body).toEqual({
      email: 'Nueva.Persona@example.org',
      displayName: 'Persona Nueva',
      password: PASSWORD,
      passwordConfirm: PASSWORD,
      inviteCode: INVITE, // solo se recortan los espacios: mayúsculas y guiones intactos
      locale: language,
    });
    expect(screen.getByText(text.register.receivedBody)).toBeTruthy();
    expect(document.activeElement).toBe(heading);
    expect(document.title).toBe(`${text.register.receivedTitle} · OnWay`);
    expect(screen.getByRole('link', { name: text.register.toLogin }).getAttribute('href')).toBe('/login');
    // No hay formulario ni sesión: la persona sigue sin iniciar sesión.
    expect(screen.queryByLabelText(text.register.password)).toBeNull();
    expect(api.calls.some((call) => call.path === '/auth/login')).toBe(false);
  });

  it('el código se envía tal cual: no se cambian mayúsculas ni guiones', async () => {
    const { user, registerCalls } = setup(language);
    await fill(user, text, { ...valid, inviteCode: 'k7qm x2pd-9WTR' });
    await user.click(submit(text));
    await waitFor(() => expect(registerCalls()).toHaveLength(1));
    expect((registerCalls()[0]!.body as { inviteCode: string }).inviteCode).toBe('k7qm x2pd-9WTR');
  });

  it('REGISTRATION_FAILED da un único mensaje, el mismo para código inválido y para correo repetido, y no pierde lo escrito', async () => {
    const shown: string[] = [];
    for (const inviteCode of ['AAAA-BBBB-CCCC-DDDD', INVITE]) {
      const { user, unmount } = setup(language, () => apiError(422, 'REGISTRATION_FAILED'));
      await fill(user, text, { ...valid, inviteCode });
      await user.click(submit(text));
      const alert = await screen.findByText(text.register.failed);
      shown.push(alert.textContent!);
      expect(alert.closest('[role="alert"]')).toBeTruthy();
      expect(document.activeElement).toBe(alert.closest('[role="alert"]'));
      expect((screen.getByLabelText(text.register.email) as HTMLInputElement).value).toBe(valid.email.trim());
      expect(screen.queryByRole('heading', { name: text.register.receivedTitle })).toBeNull();
      unmount();
    }
    expect(shown[0]).toBe(shown[1]);
    expect(shown[0]).not.toMatch(/duplic|ya existe|déjà|existe/i);
  });

  it('RATE_LIMITED avisa del tiempo de espera', async () => {
    const { user } = setup(language, () => apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 42 }));
    await fill(user, text, valid);
    await user.click(submit(text));
    const message = await screen.findByText(text.errors.RATE_LIMITED.replace('{{seconds}}', '42'));
    expect(message.closest('[role="alert"]')).toBeTruthy();
    expect(screen.getByLabelText(text.register.email)).toBeTruthy();
  });

  it('VALIDATION_FAILED del servidor se muestra en el campo que señala', async () => {
    const { user } = setup(language, () => apiError(422, 'VALIDATION_FAILED', { issues: [{ path: 'password', code: 'too_small', message: 'Too small: expected string to have >=12 characters' }] }));
    await fill(user, text, valid);
    await user.click(submit(text));
    expect(await screen.findByText(text.fieldError.password.tooShort.replace('{{min}}', '12'))).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(text.register.password));
    expect(screen.getByLabelText(text.register.password).getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByLabelText(text.register.inviteCode) as HTMLInputElement).value).toBe(valid.inviteCode);
  });

  it('un error de red se explica y se puede reintentar', async () => {
    let attempts = 0;
    const { user, registerCalls } = setup(language, () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('network down');
      return json(202, { status: 'received' });
    });
    await fill(user, text, valid);
    await user.click(submit(text));
    expect(await screen.findByText(text.state.offline)).toBeTruthy();
    await user.click(submit(text));
    expect(await screen.findByRole('heading', { level: 1, name: text.register.receivedTitle })).toBeTruthy();
    expect(registerCalls()).toHaveLength(2);
  });

  it('mientras se envía, el botón queda deshabilitado y no se envía dos veces', async () => {
    let release: (() => void) | undefined;
    const { user, registerCalls } = setup(
      language,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(202, { status: 'received' }));
        }),
    );
    await fill(user, text, valid);
    await user.click(submit(text));
    const busy = await screen.findByRole('button', { name: text.register.submitting });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    await user.click(busy);
    expect(registerCalls()).toHaveLength(1);
    release!();
    expect(await screen.findByRole('heading', { level: 1, name: text.register.receivedTitle })).toBeTruthy();
  });
});
