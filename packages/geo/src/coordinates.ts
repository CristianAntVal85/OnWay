// Lectura y formato de coordenadas (RF-401, RF-302): decimal, grados-minutos-segundos y UTM 30T/31T.
// Es lo único de este paquete que las páginas de la web pueden importar (regla de límites del mapa, `eslint.config.js`).
import type { LatLon } from './cell.js';
import { UTM_MAX_LAT, UTM_MIN_LAT, fromUtm, toUtm } from './utm.js';

export type CoordinateFormat = 'decimal' | 'dms' | 'utm';

/** Por qué un texto no es una coordenada válida; la web lo traduce por clave (`packages/i18n`). */
export type CoordinateError = 'empty' | 'unrecognized' | 'latitudeRange' | 'longitudeRange' | 'utmZone' | 'utmBand' | 'utmRange';

export type ParsedCoordinates = { ok: true; point: LatLon; format: CoordinateFormat } | { ok: false; error: CoordinateError };

const fail = (error: CoordinateError): ParsedCoordinates => ({ ok: false, error });

/** Zonas UTM que admite la lectura: la caja de los Pirineos cae en 30T (−6°…0°) y 31T (0°…6°). */
const UTM_ZONES: readonly number[] = [30, 31];

// ---------- Lectura ----------
type Atom = { k: 'num'; v: number } | { k: 'hemi'; v: 'N' | 'S' | 'E' | 'W' } | { k: 'sign'; v: 1 | -1 } | { k: 'unit'; v: 'deg' | 'min' | 'sec' } | { k: 'sep' };

const TOKEN = /\s*(?:(\d+(?:[.,]\d+)?)|([NSEWOnsewo])|([+-])|([°º])|(')|(")|([,;]))/y;

function normalize(text: string): string {
  // Sin NFKC: descompondría ″ en dos ′. Las comillas tipográficas se llevan a ' (minutos) y " (segundos).
  return text
    .replace(/[−–—]/g, '-')
    .replace(/[′’ʹ]/g, "'")
    .replace(/[″”“ʺ]/g, '"')
    .replace(/''/g, '"')
    .trim();
}

function tokenize(text: string): Atom[] | null {
  const atoms: Atom[] = [];
  TOKEN.lastIndex = 0;
  let consumed = 0;
  for (;;) {
    const match = TOKEN.exec(text);
    if (!match) break;
    consumed = TOKEN.lastIndex;
    const [, num, hemi, sign, deg, min, sec, sep] = match;
    if (num !== undefined) atoms.push({ k: 'num', v: Number(num.replace(',', '.')) });
    else if (hemi !== undefined) {
      const letter = hemi.toUpperCase();
      atoms.push({ k: 'hemi', v: letter === 'O' ? 'W' : (letter as 'N' | 'S' | 'E' | 'W') });
    } else if (sign !== undefined) atoms.push({ k: 'sign', v: sign === '-' ? -1 : 1 });
    else if (deg !== undefined) atoms.push({ k: 'unit', v: 'deg' });
    else if (min !== undefined) atoms.push({ k: 'unit', v: 'min' });
    else if (sec !== undefined) atoms.push({ k: 'unit', v: 'sec' });
    else if (sep !== undefined) atoms.push({ k: 'sep' });
  }
  return text.slice(consumed).trim() === '' && atoms.length > 0 ? atoms : null;
}

/** Parte el texto en las dos coordenadas (latitud y longitud, en el orden que traiga). */
function splitHalves(atoms: Atom[]): [Atom[], Atom[]] | null {
  const seps = atoms.flatMap((atom, index) => (atom.k === 'sep' ? [index] : []));
  if (seps.length > 1) return null;
  if (seps.length === 1) {
    const at = seps[0]!;
    return [atoms.slice(0, at), atoms.slice(at + 1)];
  }

  const hemis = atoms.flatMap((atom, index) => (atom.k === 'hemi' ? [index] : []));
  if (hemis.length >= 2) {
    // «N 42° … E 0° …» (letra delante) o «42° … N 0° … E» (letra detrás).
    const at = atoms[0]!.k === 'hemi' ? hemis[1]! : hemis[0]! + 1;
    return [atoms.slice(0, at), atoms.slice(at)];
  }

  const nums = atoms.flatMap((atom, index) => (atom.k === 'num' ? [index] : []));
  const degrees = atoms.flatMap((atom, index) => (atom.k === 'unit' && atom.v === 'deg' ? [index] : []));
  let firstOfSecond: number | undefined;
  if (degrees.length >= 2) firstOfSecond = degrees[1]! - 1;
  else if (nums.length === 2 || nums.length === 4 || nums.length === 6) firstOfSecond = nums[nums.length / 2];
  if (firstOfSecond === undefined || atoms[firstOfSecond]?.k !== 'num') return null;
  let at = firstOfSecond;
  while (at > 0 && atoms[at - 1]!.k === 'sign') at -= 1;
  return [atoms.slice(0, at), atoms.slice(at)];
}

interface Half {
  /** Valor con su signo. */
  value: number;
  axis: 'lat' | 'lon' | null;
  /** ¿Se escribió con minutos o segundos? */
  sexagesimal: boolean;
}

function parseHalf(atoms: Atom[]): Half | null {
  const hemispheres = atoms.filter((a) => a.k === 'hemi');
  const signs = atoms.filter((a) => a.k === 'sign');
  if (hemispheres.length > 1 || signs.length > 1) return null;
  const hemisphere = hemispheres[0]?.v ?? null;
  const sign = signs[0]?.v ?? 1;
  if (hemisphere && sign === -1) return null; // «-42 S» es ambiguo

  const parts: { value: number; unit?: 'deg' | 'min' | 'sec' }[] = [];
  const body = atoms.filter((a) => a.k === 'num' || a.k === 'unit');
  for (let index = 0; index < body.length; index += 1) {
    const atom = body[index]!;
    if (atom.k !== 'num') return null;
    const next = body[index + 1];
    if (next?.k === 'unit') {
      parts.push({ value: atom.v, unit: next.v });
      index += 1;
    } else parts.push({ value: atom.v });
  }
  if (parts.length < 1 || parts.length > 3) return null;
  const roles = ['deg', 'min', 'sec'] as const;
  if (parts.some((part, index) => part.unit !== undefined && part.unit !== roles[index])) return null;

  const [degrees, minutes, seconds] = parts.map((p) => p.value) as [number, number | undefined, number | undefined];
  if (parts.length > 1 && !Number.isInteger(degrees)) return null;
  if (minutes !== undefined && minutes >= 60) return null;
  if (seconds !== undefined && (seconds >= 60 || !Number.isInteger(minutes))) return null;
  const magnitude = degrees + (minutes ?? 0) / 60 + (seconds ?? 0) / 3600;
  const negative = sign === -1 || hemisphere === 'S' || hemisphere === 'W';
  return {
    value: negative ? -magnitude : magnitude,
    axis: hemisphere === null ? null : hemisphere === 'N' || hemisphere === 'S' ? 'lat' : 'lon',
    sexagesimal: parts.length > 1 || parts.some((p) => p.unit === 'min' || p.unit === 'sec'),
  };
}

function parseAngles(text: string): ParsedCoordinates {
  const atoms = tokenize(text);
  const halves = atoms && splitHalves(atoms);
  if (!halves) return fail('unrecognized');
  const first = parseHalf(halves[0]);
  const second = parseHalf(halves[1]);
  if (!first || !second) return fail('unrecognized');

  let lat: Half;
  let lon: Half;
  if (first.axis === null && second.axis === null) [lat, lon] = [first, second];
  else if (first.axis === 'lat' && second.axis !== 'lat') [lat, lon] = [first, second];
  else if (first.axis === 'lon' && second.axis !== 'lon') [lat, lon] = [second, first];
  else if (second.axis === 'lat' && first.axis !== 'lat') [lat, lon] = [second, first];
  else if (second.axis === 'lon' && first.axis !== 'lon') [lat, lon] = [first, second];
  else return fail('unrecognized'); // dos latitudes o dos longitudes

  if (Math.abs(lat.value) > 90) return fail('latitudeRange');
  if (Math.abs(lon.value) > 180) return fail('longitudeRange');
  return { ok: true, point: { lat: lat.value, lon: lon.value }, format: first.sexagesimal || second.sexagesimal ? 'dms' : 'decimal' };
}

const UTM_TEXT = /^(?:utm\s*)?(\d{1,2})\s*([A-Za-z])?[\s,;]+(\d{5,7}(?:[.,]\d+)?)\s*(?:m\s*)?E?[\s,;]+(\d{6,8}(?:[.,]\d+)?)\s*(?:m\s*)?N?$/i;
const LOOKS_LIKE_UTM = /^(?:utm\s*)?\d{1,2}\s*[A-Za-z]?[\s,;]+\d{5,}/i;

function parseUtm(text: string): ParsedCoordinates {
  const match = UTM_TEXT.exec(text);
  if (!match) return fail('unrecognized');
  const zone = Number(match[1]);
  const band = match[2]?.toUpperCase();
  const easting = Number(match[3]!.replace(',', '.'));
  const northing = Number(match[4]!.replace(',', '.'));
  if (!UTM_ZONES.includes(zone)) return fail('utmZone');
  if (band !== undefined && band !== 'T') return fail('utmBand');
  if (easting < 100000 || easting > 900000) return fail('utmRange');
  const point = fromUtm({ zone, easting, northing, south: false });
  // La banda T cubre de 40° a 48° de latitud: fuera de ella el par no es de la zona que se dijo.
  if (!(point.lat >= 40 && point.lat <= 48)) return fail('utmRange');
  return { ok: true, point, format: 'utm' };
}

/**
 * Lee unas coordenadas escritas por una persona: decimal («42.6335, 0.1021», «42,6335; 0,1021», «42.6335 N 0.1021 E»),
 * grados-minutos-segundos («42°38′00.6″N 0°06′07.6″E», «42 38 0.6 N, 0 6 7.6 E») o UTM 30T/31T («30T 262345 4721345»).
 * Valida los rangos; el resultado es el mismo objeto sea cual sea la forma de entrada.
 */
export function parseCoordinates(input: string): ParsedCoordinates {
  const text = normalize(input);
  if (text === '') return fail('empty');
  if (LOOKS_LIKE_UTM.test(text)) return parseUtm(text);
  return parseAngles(text);
}

// ---------- Formato ----------
const clean = (value: number, digits: number): string => {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
};

/** «42.63350, 0.10210»: grados decimales con signo, 5 decimales (~1 m). */
export function formatDecimal(point: LatLon, digits = 5): string {
  return `${clean(point.lat, digits)}, ${clean(point.lon, digits)}`;
}

function dmsOf(value: number, positive: string, negative: string): string {
  const tenths = Math.round(Math.abs(value) * 36000); // décimas de segundo, para que el redondeo no deje 60,0″
  const degrees = Math.floor(tenths / 36000);
  const minutes = Math.floor((tenths % 36000) / 600);
  const seconds = (tenths % 600) / 10;
  const hemisphere = value < 0 && tenths > 0 ? negative : positive;
  return `${degrees}°${String(minutes).padStart(2, '0')}′${seconds.toFixed(1).padStart(4, '0')}″${hemisphere}`;
}

/** «42°38′00.6″N 0°06′07.6″E». */
export function formatDms(point: LatLon): string {
  return `${dmsOf(point.lat, 'N', 'S')} ${dmsOf(point.lon, 'E', 'W')}`;
}

/** «30T 262345 4721345» (metros enteros), o `null` si el punto está fuera de la proyección (polos). */
export function formatUtm(point: LatLon): string | null {
  if (point.lat < UTM_MIN_LAT || point.lat > UTM_MAX_LAT) return null;
  const utm = toUtm(point);
  return utm ? `${utm.zone}${utm.band} ${Math.round(utm.easting)} ${Math.round(utm.northing)}` : null;
}

/** El formato pedido; UTM fuera de su rango cae al decimal. */
export function formatCoordinate(point: LatLon, format: CoordinateFormat = 'decimal'): string {
  if (format === 'dms') return formatDms(point);
  if (format === 'utm') return formatUtm(point) ?? formatDecimal(point);
  return formatDecimal(point);
}
