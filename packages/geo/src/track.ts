// Lectura y escritura de GPX 1.1 y KML 2.2 (RF-510, RF-511, RF-405). Solo se lee el trazado en 2D y los puntos con
// nombre: la altitud y la hora del archivo se ignoran siempre (RN-10, R-07) porque la altitud la pone el servidor.
// El contenido llega de un usuario: se rechaza antes de analizarlo lo que permitiría un ataque con XML (DTD y entidades
// propias, anidamiento enorme, millones de elementos).
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { COORDINATE_DECIMALS, type Position2D, type Position3D } from './geometry.js';

export type TrackFormat = 'gpx' | 'kml';

/** Por qué se rechazó un archivo. `unsupported_root` es «no es GPX ni KML»; el resto es «es de ese tipo, pero no vale». */
export type TrackErrorReason = 'too_large' | 'not_xml' | 'dtd_not_allowed' | 'too_deep' | 'too_many_elements' | 'unsupported_root' | 'no_track' | 'invalid_coordinates';

export class TrackParseError extends Error {
  constructor(readonly reason: TrackErrorReason) {
    super(`track file rejected: ${reason}`);
    this.name = 'TrackParseError';
  }
}

/** Caracteres del archivo (los bytes máximos, 10 MB, los corta antes quien lo recibe). */
export const MAX_XML_CHARS = 12_000_000;
/** Anidamiento máximo de elementos: un GPX real llega a 6 y un KML con carpetas a unos 12. */
export const MAX_XML_DEPTH = 32;
/** Un GPX de 10 MB con altitud y hora en cada punto no pasa de unos 400 000 elementos. */
export const MAX_XML_ELEMENTS = 1_000_000;
const MAX_NAME_CHARS = 200;

export interface Waypoint {
  name: string | null;
  lat: number;
  lon: number;
}

export interface ParsedTrack {
  format: TrackFormat;
  /** Nombre de la pista usada. */
  name: string | null;
  /** Vértices `[lon, lat]` de la primera pista con al menos dos puntos. */
  line: Position2D[];
  /** Pistas con al menos dos puntos (cuenta también las que no se usan). */
  trackCount: number;
  /** Puntos con nombre del archivo (`wpt` de GPX, `Point` de KML), para importar puntos de misión. */
  waypoints: Waypoint[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ['trk', 'trkseg', 'trkpt', 'rte', 'rtept', 'wpt', 'Placemark', 'LineString', 'Point', 'coord', 'Track'].includes(name),
});

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function coordinate(lonText: unknown, latText: unknown): { lon: number; lat: number } {
  if (typeof lonText !== 'string' || typeof latText !== 'string' || !DECIMAL.test(lonText.trim()) || !DECIMAL.test(latText.trim())) throw new TrackParseError('invalid_coordinates');
  const lon = Number(lonText);
  const lat = Number(latText);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new TrackParseError('invalid_coordinates');
  return { lon, lat };
}

/** Texto de un nodo: una cadena, o un objeto con atributos y `#text`. Sin caracteres de control y con tope de longitud. */
function textOf(node: unknown): string | null {
  const raw =
    typeof node === 'string'
      ? node
      : node && typeof node === 'object' && typeof (node as Record<string, unknown>)['#text'] === 'string'
        ? ((node as Record<string, unknown>)['#text'] as string)
        : null;
  if (raw === null) return null;
  const clean = Array.from(raw, (char) => (isControl(char) ? ' ' : char))
    .join('')
    .trim()
    .slice(0, MAX_NAME_CHARS);
  return clean === '' ? null : clean;
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

/** Comprueba tamaño, DTD, anidamiento y número de elementos con un solo recorrido, sin construir nada. */
function guard(xml: string): void {
  if (xml.length > MAX_XML_CHARS) throw new TrackParseError('too_large');
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(xml)) throw new TrackParseError('dtd_not_allowed');
  // Comentarios y CDATA pueden contener «<»: se quitan antes de contar.
  const body = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  let depth = 0;
  let elements = 0;
  for (const match of body.matchAll(/<(\/?)([^\s!?/>][^\s>/]*)[^>]*?(\/?)>/g)) {
    if (match[1] === '/') {
      depth--;
      continue;
    }
    elements++;
    if (elements > MAX_XML_ELEMENTS) throw new TrackParseError('too_many_elements');
    if (match[3] !== '/') {
      depth++;
      if (depth > MAX_XML_DEPTH) throw new TrackParseError('too_deep');
    }
  }
}

function parseGpx(root: Record<string, unknown>): Omit<ParsedTrack, 'format'> {
  const point = (node: unknown): Position2D => {
    const attributes = asRecord(node);
    const { lon, lat } = coordinate(attributes['@_lon'], attributes['@_lat']);
    return [lon, lat];
  };
  const tracks = asArray(root['trk']).map((trk) => ({
    name: textOf(asRecord(trk)['name']),
    line: asArray(asRecord(trk)['trkseg']).flatMap((segment) => asArray(asRecord(segment)['trkpt']).map(point)),
  }));
  // Muchos planificadores exportan una «ruta» (rte) en vez de una pista: se acepta si no hay pistas.
  const candidates = tracks.length > 0 ? tracks : asArray(root['rte']).map((rte) => ({ name: textOf(asRecord(rte)['name']), line: asArray(asRecord(rte)['rtept']).map(point) }));
  const usable = candidates.filter((candidate) => candidate.line.length >= 2);
  const first = usable[0];
  if (!first) throw new TrackParseError('no_track');
  const waypoints = asArray(root['wpt']).map((wpt) => {
    const [lon, lat] = point(wpt);
    return { name: textOf(asRecord(wpt)['name']), lat, lon };
  });
  return { name: first.name, line: first.line, trackCount: usable.length, waypoints };
}

function kmlLine(text: unknown): Position2D[] {
  const raw = typeof text === 'string' ? text : (textOf(text) ?? '');
  const tokens = raw
    .trim()
    .replace(/\s*,\s*/g, ',')
    .split(/\s+/)
    .filter(Boolean);
  return tokens.map((token) => {
    const parts = token.split(',');
    const { lon, lat } = coordinate(parts[0], parts[1]);
    return [lon, lat];
  });
}

function parseKml(root: Record<string, unknown>): Omit<ParsedTrack, 'format'> {
  const lines: { name: string | null; line: Position2D[] }[] = [];
  const waypoints: Waypoint[] = [];

  const placemark = (node: unknown): void => {
    const data = asRecord(node);
    const name = textOf(data['name']);
    const geometries = [data, ...asArray(data['MultiGeometry']).map(asRecord)];
    for (const geometry of geometries) {
      for (const lineString of asArray(geometry['LineString'])) lines.push({ name, line: kmlLine(asRecord(lineString)['coordinates']) });
      // Google Earth exporta `gx:Track`: una `gx:coord` por punto, «lon lat alt» separados por espacios.
      for (const track of asArray(geometry['Track']))
        lines.push({
          name,
          line: asArray(asRecord(track)['coord']).map((coord) => {
            const parts = (textOf(coord) ?? '').split(/\s+/);
            const { lon, lat } = coordinate(parts[0], parts[1]);
            return [lon, lat] as Position2D;
          }),
        });
      for (const pointNode of asArray(geometry['Point'])) {
        const [first] = kmlLine(asRecord(pointNode)['coordinates']);
        if (first) waypoints.push({ name, lat: first[1], lon: first[0] });
      }
    }
  };
  const walk = (node: unknown): void => {
    const data = asRecord(node);
    for (const item of asArray(data['Placemark'])) placemark(item);
    for (const key of ['Document', 'Folder']) for (const child of asArray(data[key])) walk(child);
  };
  walk(root);

  const usable = lines.filter((candidate) => candidate.line.length >= 2);
  const first = usable[0];
  if (!first) throw new TrackParseError('no_track');
  return { name: first.name, line: first.line, trackCount: usable.length, waypoints };
}

/**
 * Lee un GPX o un KML. Lanza `TrackParseError` con el motivo si no es de esos tipos o no sirve. Devuelve la primera
 * pista con al menos dos puntos (sin altitud) y los puntos con nombre.
 */
export function parseTrack(xml: string): ParsedTrack {
  const text = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  guard(text);
  if (!text.trimStart().startsWith('<') || XMLValidator.validate(text) !== true) throw new TrackParseError('not_xml');
  const document = asRecord(parser.parse(text));
  const rootName = Object.keys(document).find((key) => !key.startsWith('?') && !key.startsWith('#'));
  if (rootName === 'gpx') return { format: 'gpx', ...parseGpx(asRecord(document['gpx'])) };
  if (rootName === 'kml') return { format: 'kml', ...parseKml(asRecord(document['kml'])) };
  throw new TrackParseError('unsupported_root');
}

// ---------- Escritura ----------

export interface ExportTrack {
  name: string;
  description?: string;
  /** `[lon, lat, altitud]`. Se escribe con 7 decimales (~1 cm) y la altitud con 1. */
  coordinates: readonly Position3D[];
}

/** Caracteres de control (los 0x00-0x1F y 0x7F-0x9F). */
const isControl = (char: string): boolean => {
  const code = char.codePointAt(0)!;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

/** XML 1.0 solo admite de los caracteres de control el tabulador, el salto de línea y el retorno; tampoco U+FFFE ni U+FFFF. */
const isXmlSafe = (char: string): boolean => {
  const code = char.codePointAt(0)!;
  return (code >= 0x20 && code !== 0xfffe && code !== 0xffff) || code === 0x09 || code === 0x0a || code === 0x0d;
};

const escapeXml = (value: string): string =>
  Array.from(value).filter(isXmlSafe).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const fixed = (value: number): string => value.toFixed(COORDINATE_DECIMALS);
const elevation = (value: number): string => value.toFixed(1);

/** GPX 1.1 con una `<trk>` por ruta. Sin autor ni correo: el archivo no lleva datos personales. */
export function buildGpx(tracks: readonly ExportTrack[]): string {
  const body = tracks
    .map((track) => {
      const points = track.coordinates.map((c) => `<trkpt lat="${fixed(c[1])}" lon="${fixed(c[0])}"><ele>${elevation(c[2])}</ele></trkpt>`).join('');
      const description = track.description ? `<desc>${escapeXml(track.description)}</desc>` : '';
      return `<trk><name>${escapeXml(track.name)}</name>${description}<trkseg>${points}</trkseg></trk>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="OnWay" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>\n`;
}

/** KML 2.2 con un `<Placemark>` de `<LineString>` por ruta. */
export function buildKml(tracks: readonly ExportTrack[]): string {
  const body = tracks
    .map((track) => {
      const points = track.coordinates.map((c) => `${fixed(c[0])},${fixed(c[1])},${elevation(c[2])}`).join(' ');
      const description = track.description ? `<description>${escapeXml(track.description)}</description>` : '';
      return `<Placemark><name>${escapeXml(track.name)}</name>${description}<LineString><tessellate>1</tessellate><coordinates>${points}</coordinates></LineString></Placemark>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>\n`;
}
