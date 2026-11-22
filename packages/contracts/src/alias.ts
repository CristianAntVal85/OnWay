// Alias de personas y código de localidad (Q-36, D-E2). Funciones puras: las usan la API (que asigna el alias) y la
// web (que propone el código al crear un equipo). Sin dependencias.

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** Quita acentos y deja solo letras a-z, en minúscula. */
export function normalizeWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Base del alias: tres letras de cada una de las tres primeras palabras del nombre, en minúscula
 * («Cristian Antón Valdés» → `criantval`). Se saltan las partículas (de, del, la, y…); una palabra corta aporta las
 * letras que tenga. Sin letras, `user`.
 */
export function aliasBase(fullName: string): string {
  const words = fullName
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0 && !PARTICLES.has(w));
  const base = words
    .slice(0, 3)
    .map((w) => w.slice(0, 3))
    .join('');
  return base || 'user';
}

/**
 * Código de localidad de tres caracteres: la primera letra y las consonantes siguientes, en mayúscula (Alicante →
 * `ALC`, Sabiñánigo → `SBN`). Si no llega a tres, se completa con las letras que faltan, en orden (Jaca → `JCA`); si la
 * localidad no tiene tres letras, se rellena con `X`.
 */
export function localityCode(locality: string): string {
  const letters = [...normalizeWord(locality)];
  if (letters.length === 0) return 'XXX';
  const taken: number[] = [0];
  for (let i = 1; i < letters.length && taken.length < 3; i++) {
    if (!VOWELS.has(letters[i]!)) taken.push(i);
  }
  // Las letras de relleno van detrás de las consonantes (Jaca → J, C y la A).
  for (let i = 1; i < letters.length && taken.length < 3; i++) {
    if (!taken.includes(i)) taken.push(i);
  }
  const code = taken
    .map((i) => letters[i]!)
    .join('')
    .toUpperCase();
  return code.padEnd(3, 'X');
}
