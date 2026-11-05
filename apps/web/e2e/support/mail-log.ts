// Lectura del correo que "envía" el adaptador de consola del `api` (apps/api/src/mail/console-mailer.ts): UNA línea JSON por correo en
// su salida, con exactamente estos campos y en este orden:
//
//     {"event":"mail","kind":"password-reset","to":"ana@example.org","locale":"es","link":"http://localhost:8080/reset-password#token=..."}
//
// Este módulo es puro (sin Node ni Playwright) para poder probarlo con Vitest sin pila; la lectura del registro de `docker compose` está
// en `stack.ts`. `docker compose logs` antepone a veces `api-1  | ` (o `api  | `) a cada línea: se busca el JSON dentro de la línea.

export interface ResetMail {
  to: string;
  locale: 'es' | 'fr';
  /** El enlace completo, tal como lo recibiría la persona. */
  link: string;
  /** El token del fragmento del enlace (`#token=…`). */
  token: string;
}

const START = '{"event":"mail"';

/** Los correos de recuperación de contraseña que haya en el texto del registro, en orden de aparición. Ignora cualquier otra línea. */
export function parseResetMails(logText: string): ResetMail[] {
  const found: ResetMail[] = [];
  for (const line of logText.split(/\r?\n/)) {
    const at = line.indexOf(START);
    if (at < 0) continue;
    let data: unknown;
    try {
      data = JSON.parse(line.slice(at));
    } catch {
      continue;
    }
    if (typeof data !== 'object' || data === null) continue;
    const { kind, to, locale, link } = data as Record<string, unknown>;
    if (kind !== 'password-reset' || typeof to !== 'string' || typeof link !== 'string') continue;
    if (locale !== 'es' && locale !== 'fr') continue;
    const token = tokenOf(link);
    if (token) found.push({ to, locale, link, token });
  }
  return found;
}

/** El token del fragmento del enlace; vacío si el enlace no lo lleva. */
export function tokenOf(link: string): string {
  const hash = link.indexOf('#');
  if (hash < 0) return '';
  return new URLSearchParams(link.slice(hash + 1)).get('token') ?? '';
}

/** El ÚLTIMO correo de recuperación enviado a esa dirección (sin distinguir mayúsculas), o `undefined` si no hay ninguno. */
export function lastResetMailTo(logText: string, email: string): ResetMail | undefined {
  const wanted = email.trim().toLowerCase();
  return parseResetMails(logText)
    .filter((mail) => mail.to.toLowerCase() === wanted)
    .at(-1);
}
