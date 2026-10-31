// Validaciones de datos personales. Se ejecutan en la web (aviso inmediato) y en la API (la que manda).

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** Quita espacios, guiones y puntos y pasa a mayúsculas. Es la forma que se cifra y de la que sale el hash (INV-24). */
export function normalizeDocument(raw: string): string {
  return raw.replace(/[\s.-]/g, '').toUpperCase();
}

/** DNI: 8 cifras + letra de control. */
export function isValidDni(raw: string): boolean {
  const v = normalizeDocument(raw);
  const m = /^(\d{8})([A-Z])$/.exec(v);
  if (!m) return false;
  return DNI_LETTERS[Number(m[1]) % 23] === m[2];
}

/** NIE: X/Y/Z + 7 cifras + letra de control (X→0, Y→1, Z→2). */
export function isValidNie(raw: string): boolean {
  const v = normalizeDocument(raw);
  const m = /^([XYZ])(\d{7})([A-Z])$/.exec(v);
  if (!m) return false;
  const n = Number(String('XYZ'.indexOf(m[1]!)) + m[2]);
  return DNI_LETTERS[n % 23] === m[3];
}

export type DocumentTypeValue = 'dni' | 'nie' | 'passport' | 'other';

/** Pasaporte y "otro": formato libre, pero solo letras, cifras y separadores corrientes. */
export function isValidDocument(type: DocumentTypeValue, raw: string): boolean {
  const v = normalizeDocument(raw);
  if (v.length < 3 || v.length > 30) return false;
  if (type === 'dni') return isValidDni(raw);
  if (type === 'nie') return isValidNie(raw);
  return /^[A-Z0-9]+$/.test(v);
}

/** Enmascara para mostrar: deja los dos últimos caracteres. "12345678Z" → "•••••••8Z". */
export function maskDocument(raw: string): string {
  const v = normalizeDocument(raw);
  return '•'.repeat(Math.max(0, v.length - 2)) + v.slice(-2);
}

export const PHONE_PATTERN = /^\+?[0-9 ().-]{6,20}$/; // igual que el CHECK de rescuer_contact.phone
export const PASSWORD_MIN = 12;
