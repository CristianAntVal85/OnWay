// Recuperar contraseña (Q-33): pedir el enlace (misma respuesta siempre) y elegir una contraseña nueva con el token del fragmento.
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { es, fr } from '@onway/i18n';
import { SESSION_KEY } from '../src/session/session';
import { apiError, json, renderApp, sessionServer, type Call } from './support';

type Text = typeof es;
const LANGUAGES = [
  ['es', es],
  ['fr', fr],
] as const;

const TOKEN = 'dG9rZW4tZGUtcHJ1ZWJhLXVuLXNvbG8tdXNvLTEyMzQ1Njc4OQ';
const PASSWORD = 'otra-clave-larga-67890';

type Handler = (call: Call) => Response | Promise<Response>;

function setup(language: 'es' | 'fr', route: string, handlers: Record<string, Handler> = {}) {
  window.localStorage.setItem('onway.locale', language); // sin sesión, el idioma de la interfaz es el elegido en este navegador
  const { api, state } = sessionServer({}, handlers);
  const view = renderApp({ route, fetch: api.fetch, language });
  const callsTo = (path: string) => api.calls.filter((call) => call.path === path);
  return { ...view, api, state, callsTo };
}

describe.each(LANGUAGES)('pedir el enlace (%s)', (language, text) => {
  const forgot = (handler: Handler = () => json(202, { status: 'ok' })) => setup(language, '/forgot-password', { 'POST /auth/password/forgot': handler });
  const send = (text: Text) => screen.getByRole('button', { name: text.recovery.forgotSubmit });

  it('es una vista pública con un campo de correo y el enlace de vuelta al acceso', async () => {
    forgot();
    expect(await screen.findByRole('heading', { level: 1, name: text.recovery.forgotTitle })).toBeTruthy();
    expect(screen.getByTestId('path').textContent).toBe('/forgot-password');
    expect(document.title).toBe(`${text.recovery.forgotTitle} · OnWay`);
    const email = screen.getByLabelText(text.recovery.email);
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(screen.getByRole('link', { name: text.recovery.backToLogin }).getAttribute('href')).toBe('/login');
  });

  it('valida el correo antes de enviar y lleva el foco al campo', async () => {
    const { user, callsTo } = forgot();
    await user.click(await screen.findByRole('button', { name: text.recovery.forgotSubmit }));
    expect(screen.getByText(text.fieldError.email.required)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(text.recovery.email));
    await user.type(screen.getByLabelText(text.recovery.email), 'sin-arroba');
    await user.click(send(text));
    expect(screen.getByText(text.fieldError.email.invalid)).toBeTruthy();
    expect(callsTo('/auth/password/forgot')).toHaveLength(0);
  });

  it('da la misma confirmación exista o no la cuenta, y envía solo el correo', async () => {
    const shown: string[] = [];
    for (const email of ['existe@example.org', 'nadie@example.org']) {
      const { user, callsTo, unmount } = forgot(() => json(202, { status: 'ok' }));
      await user.type(await screen.findByLabelText(text.recovery.email), email);
      await user.click(send(text));
      const heading = await screen.findByRole('heading', { level: 1, name: text.recovery.forgotTitle });
      shown.push((await screen.findByRole('status')).textContent!);
      expect(callsTo('/auth/password/forgot')[0]!.body).toEqual({ email });
      expect(document.activeElement).toBe(heading);
      expect(screen.getByRole('link', { name: text.recovery.backToLogin }).getAttribute('href')).toBe('/login');
      unmount();
    }
    expect(shown).toEqual([text.recovery.forgotSent, text.recovery.forgotSent]);
    expect(text.recovery.forgotSent).not.toContain('@');
  });

  it('RATE_LIMITED avisa del tiempo de espera y no confirma nada', async () => {
    const { user } = forgot(() => apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 30 }));
    await user.type(await screen.findByLabelText(text.recovery.email), 'alguien@example.org');
    await user.click(send(text));
    const message = await screen.findByText(text.errors.RATE_LIMITED.replace('{{seconds}}', '30'));
    expect(message.closest('[role="alert"]')).toBeTruthy();
    expect(screen.queryByText(text.recovery.forgotSent)).toBeNull();
  });

  it('VALIDATION_FAILED del servidor por el formato del correo se muestra en el campo', async () => {
    const { user } = forgot(() => apiError(422, 'VALIDATION_FAILED', { issues: [{ path: 'email', code: 'invalid_format', message: 'Invalid email' }] }));
    await user.type(await screen.findByLabelText(text.recovery.email), 'a@b');
    await user.click(send(text));
    expect(await screen.findByText(text.fieldError.email.invalid)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(text.recovery.email));
  });

  it('un error de red no se disfraza de confirmación', async () => {
    const { user } = forgot(() => {
      throw new TypeError('network down');
    });
    await user.type(await screen.findByLabelText(text.recovery.email), 'alguien@example.org');
    await user.click(send(text));
    expect(await screen.findByText(text.state.offline)).toBeTruthy();
    expect(screen.queryByText(text.recovery.forgotSent)).toBeNull();
  });
});

describe.each(LANGUAGES)('nueva contraseña (%s)', (language, text) => {
  const reset = (route = `/reset-password#token=${TOKEN}`, handler: Handler = () => json(204, null)) => setup(language, route, { 'POST /auth/password/reset': handler });
  const fill = async (user: ReturnType<typeof renderApp>['user'], password: string, confirm = password) => {
    const first = await screen.findByLabelText(text.recovery.newPassword);
    await user.clear(first);
    if (password) await user.type(first, password);
    const second = screen.getByLabelText(text.recovery.newPasswordConfirm);
    await user.clear(second);
    if (confirm) await user.type(second, confirm);
  };
  const save = () => screen.getByRole('button', { name: text.recovery.resetSubmit });

  it('lee el token del fragmento, lo quita de la dirección y no lo manda al servidor hasta enviar', async () => {
    const { callsTo, api } = reset();
    expect(await screen.findByRole('heading', { level: 1, name: text.recovery.resetTitle })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('hash').textContent).toBe(''));
    expect(screen.getByTestId('path').textContent).toBe('/reset-password');
    expect(callsTo('/auth/password/reset')).toHaveLength(0);
    // El token no va en ninguna dirección pedida.
    expect(api.calls.some((call) => JSON.stringify(call).includes(TOKEN))).toBe(false);
    expect(screen.getByLabelText(text.recovery.newPassword).getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText(text.recovery.newPasswordConfirm).getAttribute('autocomplete')).toBe('new-password');
  });

  it('el token del fragmento sobrevive a la limpieza de la dirección: se envía con la contraseña nueva', async () => {
    const { user, callsTo } = reset();
    await fill(user, PASSWORD);
    await waitFor(() => expect(screen.getByTestId('hash').textContent).toBe(''));
    await user.click(save());
    const heading = await screen.findByRole('heading', { level: 1, name: text.recovery.resetDoneTitle });
    expect(callsTo('/auth/password/reset')).toHaveLength(1);
    expect(callsTo('/auth/password/reset')[0]!.body).toEqual({ token: TOKEN, newPassword: PASSWORD });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(text.recovery.resetDoneBody)).toBeTruthy();
    expect(screen.getByRole('link', { name: text.recovery.toLogin }).getAttribute('href')).toBe('/login');
  });

  it('no lee el token de la query', async () => {
    reset(`/reset-password?token=${TOKEN}`);
    expect(await screen.findByRole('heading', { level: 1, name: text.recovery.invalidLinkTitle })).toBeTruthy();
  });

  it('valida la contraseña (reglas del contrato) y la coincidencia sin perder lo escrito', async () => {
    const { user, callsTo } = reset();
    await fill(user, '');
    await user.click(save());
    expect(screen.getByText(text.fieldError.password.required)).toBeTruthy();
    expect(screen.getByText(text.fieldError.passwordConfirm.required)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(text.recovery.newPassword));

    await fill(user, 'corta', 'corta');
    await user.click(save());
    expect(screen.getByText(text.fieldError.password.tooShort.replace('{{min}}', '12'))).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(text.recovery.newPassword));

    await fill(user, PASSWORD, PASSWORD + 'x');
    await user.click(save());
    expect(screen.getByText(text.fieldError.passwordConfirm.mismatch)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(text.recovery.newPasswordConfirm));
    expect((screen.getByLabelText(text.recovery.newPassword) as HTMLInputElement).value).toBe(PASSWORD);
    expect(callsTo('/auth/password/reset')).toHaveLength(0);
  });

  it('una contraseña débil para el servidor deja el error en el campo y conserva el formulario', async () => {
    const { user, callsTo } = reset(`/reset-password#token=${TOKEN}`, () => apiError(422, 'VALIDATION_FAILED', { issues: [{ path: 'newPassword', code: 'too_small', message: 'Too small' }] }));
    await fill(user, PASSWORD);
    await user.click(save());
    expect(await screen.findByText(text.fieldError.password.tooShort.replace('{{min}}', '12'))).toBeTruthy();
    expect(screen.getByLabelText(text.recovery.newPassword).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText(text.recovery.newPassword));
    expect((screen.getByLabelText(text.recovery.newPassword) as HTMLInputElement).value).toBe(PASSWORD);
    expect(screen.queryByRole('heading', { name: text.recovery.invalidLinkTitle })).toBeNull();
    // Se puede volver a enviar: el token sigue en la página.
    await user.click(save());
    await waitFor(() => expect(callsTo('/auth/password/reset')).toHaveLength(2));
    expect((callsTo('/auth/password/reset')[1]!.body as { token: string }).token).toBe(TOKEN);
  });

  it('INVALID_RESET_TOKEN y la ausencia de token dan el mismo mensaje, con enlace para pedir otro', async () => {
    const withoutToken = reset('/reset-password');
    const first = await screen.findByRole('heading', { level: 1, name: text.recovery.invalidLinkTitle });
    const missingBody = screen.getByRole('alert').textContent;
    expect(document.activeElement).toBe(first);
    expect(screen.getByRole('link', { name: text.recovery.requestAnother }).getAttribute('href')).toBe('/forgot-password');
    expect(withoutToken.callsTo('/auth/password/reset')).toHaveLength(0);
    withoutToken.unmount();

    const { user, callsTo } = reset(`/reset-password#token=${TOKEN}`, () => apiError(422, 'INVALID_RESET_TOKEN'));
    await fill(user, PASSWORD);
    await user.click(save());
    const heading = await screen.findByRole('heading', { level: 1, name: text.recovery.invalidLinkTitle });
    expect(callsTo('/auth/password/reset')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toBe(missingBody);
    expect(missingBody).toBe(text.errors.INVALID_RESET_TOKEN);
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('link', { name: text.recovery.requestAnother }).getAttribute('href')).toBe('/forgot-password');
    expect(screen.getByRole('link', { name: text.recovery.backToLogin }).getAttribute('href')).toBe('/login');
    expect(screen.queryByLabelText(text.recovery.newPassword)).toBeNull();
  });

  it('un fallo inesperado se explica y deja reintentar', async () => {
    let attempts = 0;
    const { user, callsTo } = reset(`/reset-password#token=${TOKEN}`, () => {
      attempts += 1;
      return attempts === 1 ? apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 9 }) : json(204, null);
    });
    await fill(user, PASSWORD);
    await user.click(save());
    expect(await screen.findByText(text.errors.RATE_LIMITED.replace('{{seconds}}', '9'))).toBeTruthy();
    await user.click(save());
    expect(await screen.findByRole('heading', { level: 1, name: text.recovery.resetDoneTitle })).toBeTruthy();
    expect(callsTo('/auth/password/reset')).toHaveLength(2);
  });

  it('al terminar no queda ninguna sesión local en la caché de la web', async () => {
    const { user, queryClient } = reset();
    await fill(user, PASSWORD);
    queryClient.setQueryData(['missions'], ['dato de una sesión anterior']);
    await user.click(save());
    await screen.findByRole('heading', { level: 1, name: text.recovery.resetDoneTitle });
    expect(queryClient.getQueryData(SESSION_KEY)).toEqual({ status: 'anonymous', notice: null });
    expect(queryClient.getQueryData(['missions'])).toBeUndefined();
  });
});
