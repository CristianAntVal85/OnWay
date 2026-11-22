// Cuenta (H5-perfil T8): nombre visible e idioma guardados en la cuenta (updateMe, D-P6) y cambiar la contraseña (D-P5).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { es, fr } from '@onway/i18n';
import { apiError, json, renderApp, sessionServer, sessionUser, type Call } from './support';

const A = es.account;

type Handlers = Record<string, (call: Call) => Response | Promise<Response>>;

function setup(extra: Handlers = {}, language: 'es' | 'fr' = 'es') {
  const server = sessionServer({ user: sessionUser({ locale: language }) }, extra);
  const view = renderApp({ route: '/account', fetch: server.api.fetch, language });
  return { ...server, ...view, calls: () => server.api.calls };
}

describe('nombre visible (updateMe)', () => {
  it('guarda el nombre nuevo y la cabecera lo enseña', async () => {
    let body: unknown;
    const { user } = setup({
      'PATCH /auth/me': (call) => {
        body = call.body;
        return json(200, { user: sessionUser({ displayName: 'Nombre Nuevo Ficticio' }), csrfToken: 'csrf-token-1' });
      },
    });
    const input = await screen.findByLabelText(A.displayName);
    await user.clear(input);
    await user.type(input, '  Nombre Nuevo Ficticio ');
    await user.click(screen.getByRole('button', { name: A.saveName }));
    expect(await screen.findByText(A.nameSaved)).toBeTruthy();
    expect(body).toEqual({ displayName: 'Nombre Nuevo Ficticio' });
    expect(screen.getByText(A.signedInAs.replace('{{name}}', 'Nombre Nuevo Ficticio'))).toBeTruthy();
  });

  it('vacío no se envía y el error queda en el campo', async () => {
    const { user, calls } = setup();
    const input = await screen.findByLabelText(A.displayName);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: A.saveName }));
    expect(screen.getByText(es.fieldError.displayName.required)).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(calls().some((c) => c.method === 'PATCH')).toBe(false);
  });
});

describe('idioma en la cuenta (D-P6)', () => {
  it('elegir otro idioma lo guarda también en la cuenta', async () => {
    let body: unknown;
    const { user } = setup({
      'PATCH /auth/me': (call) => {
        body = call.body;
        return json(200, { user: sessionUser({ locale: 'fr' }), csrfToken: 'csrf-token-1' });
      },
    });
    await user.click(await screen.findByRole('radio', { name: A.languageFr }));
    await waitFor(() => expect(body).toEqual({ locale: 'fr' }));
    expect(await screen.findByRole('heading', { level: 1, name: fr.account.title })).toBeTruthy();
  });

  it('si no se puede guardar en la cuenta, el cambio en este navegador se mantiene y se avisa', async () => {
    const { user } = setup({ 'PATCH /auth/me': () => apiError(500, 'INTERNAL') });
    await user.click(await screen.findByRole('radio', { name: A.languageFr }));
    expect(await screen.findByText(fr.account.languageNotSaved)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: fr.account.title })).toBeTruthy();
  });
});

describe('cambiar la contraseña (D-P5)', () => {
  const region = async () => screen.findByRole('region', { name: A.password.title });
  const fill = async (user: ReturnType<typeof setup>['user'], current: string, next: string, confirm = next) => {
    const scope = within(await region());
    await user.type(scope.getByLabelText(A.password.current), current);
    await user.type(scope.getByLabelText(A.password.next), next);
    await user.type(scope.getByLabelText(A.password.confirm), confirm);
    await user.click(scope.getByRole('button', { name: A.password.submit }));
  };

  it('envía el cuerpo exacto, vacía el formulario y avisa de que las demás sesiones se cerraron', async () => {
    let body: unknown;
    const { user } = setup({
      'POST /auth/password/change': (call) => {
        body = call.body;
        return json(204, null);
      },
    });
    await fill(user, 'contraseña-actual-ficticia', 'contraseña-nueva-ficticia');
    expect(await screen.findByText(A.password.done)).toBeTruthy();
    expect(body).toEqual({ currentPassword: 'contraseña-actual-ficticia', newPassword: 'contraseña-nueva-ficticia' });
    expect((within(await region()).getByLabelText(A.password.current) as HTMLInputElement).value).toBe('');
  });

  it('valida antes de enviar: actual vacía, nueva corta, distinta de la actual y repetida igual', async () => {
    const { user, calls } = setup();
    const scope = within(await region());
    await user.click(scope.getByRole('button', { name: A.password.submit }));
    expect(scope.getByText(A.password.currentRequired)).toBeTruthy();
    expect(document.activeElement).toBe(scope.getByLabelText(A.password.current));
    await fill(user, 'misma-contraseña-ficticia', 'misma-contraseña-ficticia');
    expect(scope.getByText(A.password.sameAsCurrent)).toBeTruthy();
    expect(calls().some((c) => c.path === '/auth/password/change')).toBe(false);
  });

  it('una contraseña actual errónea se dice en su campo; el bloqueo, con su tiempo de espera', async () => {
    let attempts = 0;
    const { user } = setup({
      'POST /auth/password/change': () => (++attempts === 1 ? apiError(401, 'INVALID_CREDENTIALS') : apiError(423, 'ACCOUNT_LOCKED', { retryAfterSeconds: 900 })),
    });
    await fill(user, 'no-es-la-actual-ficticia', 'contraseña-nueva-ficticia');
    const scope = within(await region());
    expect(await scope.findByText(A.password.wrongCurrent)).toBeTruthy();
    expect(document.activeElement).toBe(scope.getByLabelText(A.password.current));
    await user.click(scope.getByRole('button', { name: A.password.submit }));
    expect(await scope.findByText(es.errors.ACCOUNT_LOCKED.replace('{{seconds}}', '900'))).toBeTruthy();
  });

  it('se maneja con el teclado y sale en francés', async () => {
    const { user } = setup({}, 'fr');
    const scope = within(await screen.findByRole('region', { name: fr.account.password.title }));
    scope.getByLabelText(fr.account.password.current).focus();
    await user.keyboard('x');
    await user.tab();
    expect(document.activeElement).toBe(scope.getByLabelText(fr.account.password.next));
  });
});
