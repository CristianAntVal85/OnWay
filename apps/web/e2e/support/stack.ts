// Apoyo solo de pruebas: crea la organización B contra la base de la pila real. La demostración lleva UNA organización
// (D-H0-18); la B no está en `demo.json` ni en la imagen. Se crea aquí, como `onway_owner`, entrando en el contenedor
// `db` (la base no publica ningún puerto) y se retira al terminar. Todo es ficticio (R-10).
import { spawn } from 'node:child_process';
import { argon2, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { lastResetMailTo, type ResetMail } from './mail-log';

export const ROOT = path.resolve(import.meta.dirname, '../../../..');

interface DemoFile {
  demoPassword: string;
  organization: { name: string };
  members: { email: string; displayName: string; role: string }[];
  applicants: { email: string; displayName: string }[];
  teams: { name: string; locality: string }[];
}

/** Lo que ya existe en la demostración (la organización A), para comprobar que la B nunca lo ve. */
export const demo = JSON.parse(readFileSync(path.join(ROOT, 'data/seed/demo.json'), 'utf8')) as DemoFile;

export const DEMO_PASSWORD = demo.demoPassword;
export const ORG_A_NAME = demo.organization.name;

export const ORG_B = {
  name: 'Organización B (solo pruebas E2E)',
  country: 'FR',
  adminEmail: 'admin-b@example.org',
  adminName: 'Administrador B ficticio',
  // Contraseña ficticia solo de la prueba; no abre nada fuera de la organización B efímera.
  password: 'e2e-ficticia-org-b-2026',
} as const;

/** Todo lo visible de la organización A que no debe aparecer jamás en la sesión de B. */
export const ORG_A_STRINGS: string[] = [
  demo.organization.name,
  ...demo.members.flatMap((m) => [m.displayName, m.email]),
  ...demo.applicants.flatMap((a) => [a.displayName, a.email]),
  ...demo.teams.flatMap((t) => [t.name, t.locality]),
];

const argon2Async = promisify(argon2);
const b64 = (buffer: Buffer) => buffer.toString('base64').replace(/=+$/, '');

/** Argon2id con los mismos parámetros que el API (PHC, m=19456, t=2, p=1). El inicio de sesión de la prueba demuestra que valen. */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const tag = await argon2Async('argon2id', { message: Buffer.from(password, 'utf8'), nonce: salt, memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 });
  return `$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}$${b64(tag)}`;
}

/** Ejecuta SQL como `onway_owner` dentro del contenedor `db`, por la red interna del contenedor (la contraseña no sale de él). */
function psqlAsOwner(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['compose', 'exec', '-T', 'db', 'sh', '-c', 'PGPASSWORD="$(cat /run/onway/owner/password)" exec psql -h 127.0.0.1 -U onway_owner -d onway -v ON_ERROR_STOP=1 -q -At'],
      { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`psql failed (${code}): ${err}`))));
    child.stdin.end(sql);
  });
}

const REMOVE_ORG_B = `
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = '${ORG_B.adminEmail}');
DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email = '${ORG_B.adminEmail}');
DELETE FROM users WHERE email = '${ORG_B.adminEmail}';
DELETE FROM organizations WHERE name = '${ORG_B.name}';
`;

/** Crea la organización B con su administrador (vuelve a empezar si quedó de una ejecución anterior). */
export async function createOrganizationB(): Promise<void> {
  const hash = await hashPassword(ORG_B.password);
  await psqlAsOwner(`
BEGIN;
${REMOVE_ORG_B}
WITH org AS (
  INSERT INTO organizations (name, country, invite_code) VALUES ('${ORG_B.name}', '${ORG_B.country}', 'E2E-${randomBytes(8).toString('hex')}') RETURNING id
), usr AS (
  INSERT INTO users (email, password_hash, display_name, account_status) VALUES ('${ORG_B.adminEmail}', '${hash}', '${ORG_B.adminName}', 'active') RETURNING id
)
INSERT INTO memberships (organization_id, user_id, role, status) SELECT org.id, usr.id, 'admin', 'active' FROM org, usr;
COMMIT;
`);
}

export async function removeOrganizationB(): Promise<void> {
  await psqlAsOwner(`BEGIN;\n${REMOVE_ORG_B}\nCOMMIT;`);
}

/**
 * Las misiones que crea la demostración de H1 se llaman «E2E …» y acaban cerradas. Si una ejecución falla a medias puede dejar una
 * activa o en planificación; esto la cierra para que la pila quede como estaba (las filas de `audit_log` no se pueden borrar: solo
 * de añadir). Solo toca misiones cuyo nombre empieza por «E2E » y que siguen abiertas.
 */
export async function closeLeftoverE2eMissions(like = 'E2E %'): Promise<void> {
  // El disparador solo admite planificación → activa → cerrada: primero se activan las que siguen en planificación.
  // `like` acota a lo de una ejecución (con 2 trabajadores, otra demostración puede tener sus misiones abiertas a la vez).
  assertSafeLike(like);
  await psqlAsOwner(`
UPDATE missions SET status = 'active', activated_at = COALESCE(activated_at, now()) WHERE name LIKE '${like}' AND status = 'planning';
UPDATE missions SET status = 'closed', closed_at = COALESCE(closed_at, now()) WHERE name LIKE '${like}' AND status <> 'closed';`);
}

/** Los patrones son texto fijo del propio E2E (letras, cifras, espacios y %): nunca llevan comillas. */
function assertSafeLike(like: string): void {
  if (!/^E2E [A-Za-z0-9 %]*$/.test(like)) throw new Error(`unsafe LIKE pattern for the E2E cleanup: ${like}`);
}

/**
 * Las rutas que crea la demostración de H2 se llaman «E2E …» y las deja archivadas (no se borran: RN-14). Si una ejecución se
 * interrumpe, esto archiva las que sigan activas para que la biblioteca de demostración quede como estaba.
 */
export async function archiveLeftoverE2eRoutes(like = 'E2E %'): Promise<void> {
  assertSafeLike(like);
  await psqlAsOwner(`UPDATE routes SET status = 'archived' WHERE name LIKE '${like}' AND status <> 'archived' AND NOT EXISTS (
    SELECT 1 FROM mission_routes mr JOIN missions m ON m.id = mr.mission_id WHERE mr.route_id = routes.id AND m.status <> 'closed');`);
}

/**
 * Las cuentas que crea la demostración de `H5-acceso` tienen el correo `e2e-…@example.org` y el nombre «E2E …». No se pueden borrar
 * (la auditoría es de solo añadir y las filas la referencian), así que se dejan inocuas: las pendientes, RECHAZADAS (sin sesión ni
 * acceso) y las aprobadas, DESACTIVADAS (cuenta y membresía) y sin sesiones. Solo toca cuentas con ese correo y ese nombre; `emailLike`
 * acota a lo de una ejecución. Idempotente: lo ya rechazado o desactivado no cambia.
 */
export async function retireE2eAccounts(emailLike = 'e2e-%@example.org'): Promise<void> {
  if (!/^e2e-[a-z0-9%-]*@example\.org$/.test(emailLike)) throw new Error(`unsafe LIKE pattern for the E2E account cleanup: ${emailLike}`);
  const mine = `SELECT id FROM users WHERE email LIKE '${emailLike}' AND display_name LIKE 'E2E %'`;
  await psqlAsOwner(`
BEGIN;
UPDATE signup_requests SET status = 'rejected', decided_at = now() WHERE status = 'pending' AND user_id IN (${mine});
UPDATE users SET account_status = 'rejected' WHERE account_status = 'pending' AND id IN (${mine});
UPDATE users SET account_status = 'disabled' WHERE account_status = 'active' AND id IN (${mine});
UPDATE memberships SET status = 'disabled' WHERE status = 'active' AND user_id IN (${mine});
DELETE FROM sessions WHERE user_id IN (${mine});
COMMIT;`);
}

/**
 * Una cuenta de rescatista recién aprobada, con el perfil incompleto, como la deja `admin_decide_signup` (H5-perfil). La demostración de
 * `H5-acceso` ya registra y aprueba por la web; esta no repite el registro porque el código de invitación es de toda la organización y
 * aquella lo regenera en paralelo, y el registro tiene límite por IP. Correo `e2e-…@example.org` y nombre «E2E …»: `retireE2eAccounts`
 * la desactiva al terminar.
 */
export async function createApprovedRescuer(email: string, displayName: string, password: string): Promise<void> {
  if (!/^e2e-[a-z0-9-]+@example\.org$/.test(email) || !/^E2E [A-Za-z0-9 ]+$/.test(displayName)) throw new Error('unsafe E2E account');
  const hash = await hashPassword(password);
  const admin = demo.members.find((m) => m.role === 'admin')!.email;
  await psqlAsOwner(`
BEGIN;
WITH org AS (SELECT id FROM organizations WHERE name = '${ORG_A_NAME.replace(/'/g, "''")}'),
usr AS (
  INSERT INTO users (email, password_hash, display_name, locale, account_status) VALUES ('${email}', '${hash}', '${displayName}', 'es', 'active') RETURNING id
), mem AS (
  INSERT INTO memberships (organization_id, user_id, role, status) SELECT org.id, usr.id, 'rescuer', 'active' FROM org, usr RETURNING organization_id, user_id
), req AS (
  INSERT INTO signup_requests (organization_id, user_id, status, decided_by, decided_at, granted_role)
  SELECT mem.organization_id, mem.user_id, 'approved', (SELECT id FROM users WHERE email = '${admin}'), now(), 'rescuer' FROM mem RETURNING user_id
)
INSERT INTO rescuer_profiles (organization_id, user_id, full_name) SELECT mem.organization_id, mem.user_id, '${displayName}' FROM mem;
COMMIT;`);
}

/**
 * Las filas de `audit_log` de una acción sobre los datos de una persona (`subject_user_id`), de la más antigua a la más reciente: quién la hizo
 * (correo), el tipo de entidad y el detalle. La auditoría es de solo añadir: la demostración solo lee. Sirve a `h5-habilidades-demo`
 * para comprobar INV-26 (una apertura ajena deja fila, la propia no).
 */
export async function auditRowsAbout(subjectEmail: string, action: string): Promise<{ actor: string | null; entityType: string; detail: Record<string, unknown> }[]> {
  if (!/^[a-z0-9@.-]+$/.test(subjectEmail) || !/^[a-z_]+$/.test(action)) throw new Error('unsafe audit query');
  const out = await psqlAsOwner(`SELECT coalesce(a.email, ''), l.entity_type, l.detail::text FROM audit_log l
  LEFT JOIN users a ON a.id = l.actor_user_id
  WHERE l.action = '${action}' AND l.subject_user_id = (SELECT id FROM users WHERE email = '${subjectEmail}') ORDER BY l.id;`);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [actor, entityType, ...rest] = line.split('|');
      return { actor: actor || null, entityType: entityType!, detail: JSON.parse(rest.join('|')) as Record<string, unknown> };
    });
}

function compose(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`docker compose ${args.join(' ')} failed (${code}): ${err}`))));
  });
}

/** Para el motor de rutas (la prueba de «con el motor parado el resto de la aplicación sigue», H3). */
export const stopRoutingEngine = () => compose(['stop', 'routing']);

/** Lo vuelve a arrancar y espera a que responda (el grafo ya está construido: tarda unos segundos). */
export async function startRoutingEngine(): Promise<void> {
  await compose(['start', 'routing']);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const health = (await compose(['ps', '--format', '{{.Health}}', 'routing']).catch(() => '')).trim();
    if (health === 'healthy') return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('the routing engine did not come back');
}

/**
 * El ÚLTIMO enlace de recuperación de contraseña que el `api` ha "enviado" a un correo (el adaptador de consola lo escribe en su registro,
 * `docker compose logs api`; formato en `mail-log.ts`). Espera con reintentos acotados a que aparezca. Con `since` solo cuenta lo escrito
 * desde ese instante, para no confundir el enlace nuevo con uno anterior del mismo correo. Necesita `COMPOSE_PROJECT_NAME` como el resto.
 */
export async function lastPasswordResetMail(email: string, options: { since?: Date; timeoutMs?: number } = {}): Promise<ResetMail> {
  const { since, timeoutMs = 20_000 } = options;
  const args = ['logs', '--no-color', '--no-log-prefix', ...(since ? ['--since', since.toISOString()] : []), 'api'];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mail = lastResetMailTo(await compose(args), email);
    if (mail) return mail;
    if (Date.now() >= deadline) throw new Error(`no password-reset mail for ${email} appeared in the api log within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** El código de invitación vigente de la organización de la demostración (lo que el administrador ve en Administración), leído de la base. */
export async function currentInviteCode(): Promise<string> {
  const out = await psqlAsOwner(`SELECT invite_code FROM organizations WHERE name = '${ORG_A_NAME.replaceAll("'", "''")}';`);
  const code = out.trim();
  if (code.length < 10) throw new Error('the invite code of the demo organization was not found');
  return code;
}

/**
 * Reinicia el servicio `api` y espera a que responda. Los endpoints públicos (registro y recuperación de contraseña) tienen un
 * limitador por IP EN MEMORIA y todas las pruebas salen de la misma IP: reiniciar vacía los contadores, de modo que una ejecución
 * empieza siempre limpia (las repeticiones seguidas en la misma pila no se acumulan). No toca la base ni las sesiones.
 */
export async function restartApi(healthUrl: string): Promise<void> {
  await compose(['restart', 'api']);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const ok = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) }).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the api did not come back at ${healthUrl}`);
}
