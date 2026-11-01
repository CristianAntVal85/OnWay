import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_XML_CHARS,
  MAX_XML_DEPTH,
  MAX_XML_ELEMENTS,
  TrackParseError,
  buildGpx,
  buildKml,
  haversineM,
  lengthM,
  parseTrack,
  prepareLine,
  type ExportTrack,
  type Position2D,
  type Position3D,
  type TrackErrorReason,
} from '../src/index.js';

const fixture = (name: string): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8');

function reasonOf(xml: string): TrackErrorReason {
  try {
    parseTrack(xml);
  } catch (error) {
    if (error instanceof TrackParseError) return error.reason;
    throw error;
  }
  throw new Error('parseTrack did not throw');
}

describe('parseTrack · GPX (RF-510)', () => {
  it('lee la primera pista con todos sus segmentos, en 2D, e ignora la altitud y la hora del archivo (RN-10)', () => {
    const track = parseTrack(fixture('ficticio-sendero.gpx'));
    expect(track.format).toBe('gpx');
    expect(track.name).toBe('Sendero ficticio');
    expect(track.trackCount).toBe(1);
    expect(track.line).toEqual([
      [-0.1, 42.63],
      [-0.1005, 42.631],
      [-0.1012, 42.6325],
      [-0.103, 42.634],
      [-0.106, 42.636],
      [-0.11, 42.64],
    ]);
    expect(JSON.stringify(track)).not.toContain('999');
  });

  it('devuelve los puntos con nombre, con las entidades predefinidas decodificadas', () => {
    const { waypoints } = parseTrack(fixture('ficticio-sendero.gpx'));
    expect(waypoints).toEqual([
      { name: 'Refugio & ficticio', lat: 42.63, lon: -0.1 },
      { name: 'Collado inventado', lat: 42.64, lon: -0.11 },
    ]);
  });

  it('con varias pistas usa la primera con dos puntos o más y cuenta las útiles', () => {
    const track = parseTrack(fixture('dos-pistas.gpx'));
    expect(track.name).toBe('Primera útil');
    expect(track.trackCount).toBe(2);
    expect(track.line[0]).toEqual([0, 42]);
  });

  it('acepta una ruta planificada (rte) cuando no hay pistas', () => {
    const track = parseTrack(fixture('solo-ruta.gpx'));
    expect(track.name).toBe('Ruta planificada ficticia');
    expect(track.line).toHaveLength(3);
  });

  it('un archivo sin pista con dos puntos no sirve', () => {
    expect(reasonOf(fixture('sin-pista.gpx'))).toBe('no_track');
  });

  it('coordenadas fuera de rango o que no son números: archivo inválido', () => {
    expect(reasonOf(fixture('fuera-de-rango.gpx'))).toBe('invalid_coordinates');
    expect(reasonOf(fixture('numero-roto.gpx'))).toBe('invalid_coordinates');
    const infinite = '<gpx><trk><trkseg><trkpt lat="1e400" lon="0"/><trkpt lat="1" lon="1"/></trkseg></trk></gpx>';
    expect(reasonOf(infinite)).toBe('invalid_coordinates');
  });

  it('acepta un BOM al principio', () => {
    expect(parseTrack(String.fromCharCode(0xfeff) + fixture('solo-ruta.gpx')).line).toHaveLength(3);
  });
});

describe('parseTrack · KML (RF-510, RF-405)', () => {
  it('lee una LineString (con espacios tras las comas y sin altitud en algún punto) y los puntos', () => {
    const track = parseTrack(fixture('linestring.kml'));
    expect(track.format).toBe('kml');
    expect(track.name).toBe('Sendero ficticio KML');
    expect(track.line).toEqual([
      [-0.1, 42.63],
      [-0.1005, 42.631],
      [-0.1012, 42.6325],
      [-0.11, 42.64],
    ]);
    expect(track.waypoints).toEqual([{ name: 'Refugio ficticio', lat: 42.63, lon: -0.1 }]);
  });

  it('lee una pista gx:Track de Google Earth', () => {
    const track = parseTrack(fixture('gx-track.kml'));
    expect(track.name).toBe('Pista gx ficticia');
    expect(track.line).toEqual([
      [0.5, 42.5],
      [0.51, 42.51],
      [0.52, 42.52],
    ]);
  });

  it('recorre carpetas anidadas y MultiGeometry', () => {
    const track = parseTrack(fixture('carpetas.kml'));
    expect(track.trackCount).toBe(2);
    expect(track.line[0]).toEqual([1, 42]);
    expect(track.waypoints).toEqual([{ name: 'Punto A', lat: 42, lon: 1 }]);
  });
});

describe('parseTrack · lo que no es un GPX o un KML válido', () => {
  it('un SVG es XML, pero no es de los nuestros', () => {
    expect(reasonOf(fixture('no-es-gpx.svg'))).toBe('unsupported_root');
  });

  it('texto que no es XML, vacío o con las etiquetas sin cerrar', () => {
    expect(reasonOf(fixture('no-es-xml.txt'))).toBe('not_xml');
    expect(reasonOf('')).toBe('not_xml');
    expect(reasonOf(fixture('mal-formado.gpx'))).toBe('not_xml');
  });
});

describe('parseTrack · XML hostil (D-H2-05)', () => {
  it('rechaza cualquier DTD o entidad propia: entidad externa y «mil millones de risas»', { timeout: 2000 }, () => {
    expect(reasonOf(fixture('entidad-externa.gpx'))).toBe('dtd_not_allowed');
    expect(reasonOf(fixture('mil-millones-de-risas.gpx'))).toBe('dtd_not_allowed');
    expect(reasonOf('<!doctype gpx><gpx/>')).toBe('dtd_not_allowed');
  });

  it(`rechaza un anidamiento de más de ${MAX_XML_DEPTH} niveles sin desbordar la pila`, { timeout: 2000 }, () => {
    const deep = `<gpx>${'<a>'.repeat(MAX_XML_DEPTH + 1)}${'</a>'.repeat(MAX_XML_DEPTH + 1)}</gpx>`;
    expect(reasonOf(deep)).toBe('too_deep');
    const veryDeep = `<gpx>${'<a>'.repeat(200_000)}${'</a>'.repeat(200_000)}</gpx>`;
    expect(reasonOf(veryDeep)).toBe('too_deep');
  });

  it(`rechaza más de ${MAX_XML_ELEMENTS} elementos`, { timeout: 5000 }, () => {
    expect(reasonOf(`<gpx>${'<a/>'.repeat(MAX_XML_ELEMENTS + 1)}</gpx>`)).toBe('too_many_elements');
  });

  it('rechaza un texto de más de 12 millones de caracteres antes de analizarlo', { timeout: 2000 }, () => {
    expect(reasonOf(`<gpx>${' '.repeat(MAX_XML_CHARS)}</gpx>`)).toBe('too_large');
  });

  it('los comentarios y CDATA con «<» no cuentan como elementos ni engañan al contador', () => {
    const xml = `<gpx><!-- ${'<a>'.repeat(100)} --><trk><name><![CDATA[${'<b>'.repeat(100)}]]></name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.001" lon="1.001"/></trkseg></trk></gpx>`;
    expect(parseTrack(xml).line).toHaveLength(2);
  });

  it('el nombre se limpia: sin caracteres de control y con tope de longitud', () => {
    const name = `Ruta\u0000con\u0007control ${'x'.repeat(500)}`;
    const track = parseTrack(`<gpx><trk><name>${name}</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.001" lon="1.001"/></trkseg></trk></gpx>`);
    expect(track.name).not.toMatch(/\p{Cc}/u);
    expect(track.name!.length).toBeLessThanOrEqual(200);
  });

  it('un archivo grande y legítimo (100 000 puntos, ~6 MB) se lee en un tiempo razonable', { timeout: 10_000 }, () => {
    const points = Array.from({ length: 100_000 }, (_, i) => `<trkpt lat="${(42 + i * 0.00001).toFixed(6)}" lon="0.500000"><ele>1000</ele><time>2026-01-01T08:00:00Z</time></trkpt>`).join('');
    const started = performance.now();
    const track = parseTrack(`<gpx><trk><trkseg>${points}</trkseg></trk></gpx>`);
    expect(track.line).toHaveLength(100_000);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe('buildGpx y buildKml (RF-511)', () => {
  const tracks: ExportTrack[] = [
    {
      name: 'Ruta <uno> & "dos"',
      description: 'Propuesta validada; no sustituye el criterio del equipo',
      coordinates: [
        [0.5, 42, 1200.04],
        [0.5001234, 42.0005678, 1210.57],
        [0.5002, 42.001, 1222],
      ],
    },
    {
      name: 'Otra',
      coordinates: [
        [1, 43, 100],
        [1.001, 43.001, 110],
      ],
    },
  ];

  it('el GPX lleva grados, metros, una pista por ruta, el nombre escapado y ningún dato personal', () => {
    const gpx = buildGpx(tracks);
    expect(gpx).toContain('<gpx version="1.1" creator="OnWay"');
    expect(gpx).toContain('<trk><name>Ruta &lt;uno&gt; &amp; &quot;dos&quot;</name>');
    expect(gpx).toContain('<trkpt lat="42.0005678" lon="0.5001234"><ele>1210.6</ele></trkpt>');
    expect(gpx.match(/<trk>/g)).toHaveLength(2);
    expect(gpx).not.toMatch(/<author|<email|<link/);
    expect(parseTrack(gpx).line).toHaveLength(3);
  });

  it('el KML lleva «lon,lat,altitud» y una marca por ruta', () => {
    const kml = buildKml(tracks);
    expect(kml).toContain('<coordinates>0.5000000,42.0000000,1200.0 0.5001234,42.0005678,1210.6 0.5002000,42.0010000,1222.0</coordinates>');
    expect(kml.match(/<Placemark>/g)).toHaveLength(2);
    expect(parseTrack(kml).line).toHaveLength(3);
  });

  it('quita los caracteres que XML 1.0 no admite', () => {
    const gpx = buildGpx([{ name: 'a\u0000b\u000bc', coordinates: tracks[1]!.coordinates }]);
    expect(gpx).toContain('<name>abc</name>');
    expect(() => parseTrack(gpx)).not.toThrow();
  });

  it('ida y vuelta: preparar, exportar e importar de nuevo da los mismos vértices 2D, en GPX y en KML (INV-15, doc 07)', () => {
    const imported = parseTrack(fixture('ficticio-sendero.gpx'));
    const prepared = prepareLine(imported.line);
    expect(prepared.length).toBeGreaterThan(imported.line.length);
    const withElevation = prepared.map((position): Position3D => [position[0], position[1], 1000]);

    for (const build of [buildGpx, buildKml]) {
      const back = prepareLine(parseTrack(build([{ name: 'Ida y vuelta', coordinates: withElevation }])).line);
      expect(back).toEqual(prepared);
    }
  });

  it('ida y vuelta de un trazado dibujado a mano con pocos puntos y de uno muy denso', () => {
    const drawn: Position2D[] = [
      [0.5, 42],
      [0.52, 42.01],
      [0.55, 42.02],
    ];
    const dense: Position2D[] = Array.from({ length: 3000 }, (_, i) => [0.5 + i * 0.000012, 42 + Math.sin(i / 50) * 0.0002]);
    for (const line of [drawn, dense]) {
      const prepared = prepareLine(line);
      const coordinates = prepared.map((position): Position3D => [position[0], position[1], 900]);
      const back = prepareLine(parseTrack(buildGpx([{ name: 'x', coordinates }])).line);
      expect(back).toEqual(prepared);
      expect(lengthM(back)).toBeCloseTo(lengthM(prepared), 6);
    }
  });

  it('la distancia no cambia por exportar: sigue siendo la del trazado guardado', () => {
    const prepared = prepareLine(parseTrack(fixture('linestring.kml')).line);
    const back = parseTrack(buildKml([{ name: 'x', coordinates: prepared.map((p): Position3D => [p[0], p[1], 0]) }])).line;
    expect(haversineM(back[0]!, back[back.length - 1]!)).toBeCloseTo(haversineM(prepared[0]!, prepared[prepared.length - 1]!), 6);
  });
});
