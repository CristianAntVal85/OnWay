// Apoyo solo de pruebas: crea la organización B contra la base de la pila real. La demostración lleva UNA organización
// (D-H0-18); la B no está en `demo.json` ni en la imagen. Se crea aquí, como `onway_owner`, entrando en el contenedor
// `db` (la base no publica ningún puerto) y se retira al terminar. Todo es ficticio (R-10).
import { spawn } from 'node:child_process';
import { argon2, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

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
