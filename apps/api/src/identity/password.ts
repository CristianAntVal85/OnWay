import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Argon2id with Node's own implementation (D-H0-10): no native dependency. OWASP minimum profile m=19 MiB, t=2, p=1.
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

const argon2Async = promisify(argon2);
const b64 = (buffer: Buffer) => buffer.toString('base64').replace(/=+$/, '');

async function derive(password: string, salt: Buffer, memory: number, passes: number, parallelism: number, tagLength: number): Promise<Buffer> {
  return argon2Async('argon2id', { message: Buffer.from(password, 'utf8'), nonce: salt, memory, passes, parallelism, tagLength });
}

/** PHC string: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<tag>` (the format stored in `users.password_hash`, doc 05). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, MEMORY_KIB, PASSES, PARALLELISM, TAG_BYTES);
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${b64(salt)}$${b64(tag)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]{11,})\$([A-Za-z0-9+/]{22,})$/;

/**
 * Compares in constant time. Never throws for a stored value it cannot read (an anonymized account holds `!`):
 * it spends the same work on a throwaway hash and answers `false`.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC.exec(stored);
  if (!match) {
    await dummyVerify(password);
    return false;
  }
  const [, m, t, p, salt, tag] = match;
  const expected = Buffer.from(tag!, 'base64');
  const actual = await derive(password, Buffer.from(salt!, 'base64'), Number(m), Number(t), Number(p), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummy: Promise<string> | undefined;

/** A real hash of a random secret, so an unknown email costs the same as a wrong password (RF-101, doc 06 §4.3). */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString('base64url'));
  return dummy;
}

async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(password, await dummyHash());
}
