import { describe, expect, it } from 'vitest';
import { formatCoordinate, formatDecimal, formatDms, formatUtm, fromUtm, parseCoordinates, toUtm, utmBandOf, utmZoneOf } from '../src/index.js';

const point = (text: string) => {
  const result = parseCoordinates(text);
  if (!result.ok) throw new Error(`«${text}» no se leyó: ${result.error}`);
  return result;
};
const error = (text: string) => {
  const result = parseCoordinates(text);
  return result.ok ? 'ok' : result.error;
};

// 42°38'00.6"N 0°06'07.6"E son 42,6335 y 0,1021111… grados.
const LAT = 42.6335;
const LON = 0.1 + 7.6 / 3600;

describe('lectura: decimal (RF-401)', () => {
  it.each([
    ['42.6335, 0.1021'],
    ['42.6335,0.1021'],
    ['42.6335 0.1021'],
    ['42,6335; 0,1021'],
    ['42,6335 0,1021'],
    ['  42.6335 ,  0.1021 '],
    ['42.6335N 0.1021E'],
    ['42.6335° N, 0.1021° E'],
    ['N 42.6335 E 0.1021'],
    ['0.1021 E 42.6335 N'], // el orden lo dan las letras
    ['+42.6335, +0.1021'],
  ])('«%s»', (text) => {
    const result = point(text);
    expect(result.format).toBe('decimal');
    expect(result.point.lat).toBeCloseTo(42.6335, 9);
    expect(result.point.lon).toBeCloseTo(0.1021, 9);
  });

  it('el signo y las letras S/W/O dan valores negativos', () => {
    expect(point('-42.5, -0.1').point).toEqual({ lat: -42.5, lon: -0.1 });
    expect(point('42.5 S, 0.1 W').point).toEqual({ lat: -42.5, lon: -0.1 });
    expect(point('42.5N 0.1O').point).toEqual({ lat: 42.5, lon: -0.1 }); // «O» de oeste/ouest
    expect(point('−42.5, 0.1').point.lat).toBe(-42.5); // el signo menos tipográfico
  });
});

describe('lectura: grados, minutos y segundos (RF-401)', () => {
  it.each([
    [`42°38'00.6"N 0°06'07.6"E`],
    [`42° 38' 0.6" N, 0° 6' 7.6" E`],
    [`42°38′00.6″N 0°06′07.6″E`],
    [`N42°38'0.6" E0°6'7.6"`],
    [`42 38 0.6 N 0 6 7.6 E`],
    [`42 38 0,6 N; 0 6 7,6 E`],
    [`42°38'0.6'' N 0°6'7.6'' E`],
    [`42 38 0.6, 0 6 7.6`], // sin letras: latitud primero
    [`42 38 0.6 0 6 7.6`],
    [`0°6'7.6"E 42°38'0.6"N`],
  ])('«%s»', (text) => {
    const result = point(text);
    expect(result.format).toBe('dms');
    expect(result.point.lat).toBeCloseTo(LAT, 9);
    expect(result.point.lon).toBeCloseTo(LON, 9);
  });

  it('oeste y sur dan valores negativos', () => {
    expect(point(`42°38'0.6"S 0°6'7.6"W`).point.lat).toBeCloseTo(-LAT, 9);
    expect(point(`42°38'0.6"S 0°6'7.6"W`).point.lon).toBeCloseTo(-LON, 9);
  });

  it('admite grados y minutos decimales', () => {
    const result = point(`42°38.01'N 0°6.1'E`);
    expect(result.format).toBe('dms');
    expect(result.point.lat).toBeCloseTo(42 + 38.01 / 60, 9);
    expect(result.point.lon).toBeCloseTo(0.1 + 0.001 / 0.6, 6);
  });

  it('el mismo punto, escrito en decimal y en GMS, sale igual (mismo objeto, RF-401)', () => {
    const a = point('42.6335, 0.1021111111').point;
    const b = point(`42°38'00.6"N 0°06'07.6"E`).point;
    expect(a.lat).toBeCloseTo(b.lat, 8);
    expect(a.lon).toBeCloseTo(b.lon, 8);
  });
});

describe('lectura: UTM 30T y 31T (RF-401)', () => {
  it('lee zona, banda opcional, este y norte', () => {
    for (const text of ['30T 262345 4721345', '30T 262345E 4721345N', 'UTM 30T 262345 4721345', '30 262345 4721345', '30t, 262345, 4721345', '30T 262345mE 4721345mN']) {
      const result = point(text);
      expect(result.format).toBe('utm');
      expect(result.point.lat).toBeCloseTo(fromUtm({ zone: 30, easting: 262345, northing: 4721345, south: false }).lat, 9);
    }
  });

  it('un punto de 31T cae al este del meridiano 0', () => {
    expect(point('31T 300000 4700000').point.lon).toBeGreaterThan(0);
    expect(point('30T 300000 4700000').point.lon).toBeLessThan(-1);
  });

  it('rechaza zonas, bandas y rangos que no son de la caja de los Pirineos', () => {
    expect(error('29T 400000 4700000')).toBe('utmZone');
    expect(error('32T 400000 4700000')).toBe('utmZone');
    expect(error('30S 400000 4700000')).toBe('utmBand');
    expect(error('30T 50000 4700000')).toBe('utmRange'); // este fuera de 100 000–900 000
    expect(error('30T 400000 9000000')).toBe('utmRange'); // al norte de la banda T
    expect(error('30T 400000 3000000')).toBe('utmRange'); // al sur de la banda T
    expect(error('30T 400000')).toBe('unrecognized');
  });
});

describe('lectura: entradas no válidas', () => {
  it('vacío y texto que no son coordenadas', () => {
    expect(error('')).toBe('empty');
    expect(error('   ')).toBe('empty');
    expect(error('hola')).toBe('unrecognized');
    expect(error('42.6335')).toBe('unrecognized'); // solo una
    expect(error('42.6335, 0.1021, 5')).toBe('unrecognized');
    expect(error('42.6335 N, 0.1021 N')).toBe('unrecognized'); // dos latitudes
    expect(error('-42.5 S, 0.1')).toBe('unrecognized'); // signo y hemisferio a la vez
    expect(error('Torla, Huesca')).toBe('unrecognized');
  });

  it('valida los rangos de latitud y longitud', () => {
    expect(error('90.0001, 0')).toBe('latitudeRange');
    expect(error('-91, 0')).toBe('latitudeRange');
    expect(error('90, 180')).toBe('ok');
    expect(error('42, 180.5')).toBe('longitudeRange');
    expect(error('42, -181')).toBe('longitudeRange');
    expect(error(`91°0'0"N 0°0'0"E`)).toBe('latitudeRange');
    expect(error(`42°0'0"N 181°0'0"E`)).toBe('longitudeRange');
  });

  it('minutos o segundos fuera de rango no son coordenadas', () => {
    expect(error(`42°60'0"N 0°0'0"E`)).toBe('unrecognized');
    expect(error(`42°10'60"N 0°0'0"E`)).toBe('unrecognized');
    expect(error(`42°10.5'30"N 0°0'0"E`)).toBe('unrecognized'); // minutos decimales con segundos
    expect(error(`42.5°10'0"N 0°0'0"E`)).toBe('unrecognized'); // grados decimales con minutos
  });
});

describe('formato (RF-302)', () => {
  it('decimal con signo y cinco decimales, sin cero negativo', () => {
    expect(formatDecimal({ lat: 42.6335, lon: -0.1021 })).toBe('42.63350, -0.10210');
    expect(formatDecimal({ lat: -0.000001, lon: 0 })).toBe('0.00000, 0.00000');
    expect(formatDecimal({ lat: 42.6335, lon: 0.1 }, 2)).toBe('42.63, 0.10');
  });

  it('GMS con hemisferio, minutos de dos cifras y una décima de segundo', () => {
    expect(formatDms({ lat: LAT, lon: LON })).toBe('42°38′00.6″N 0°06′07.6″E');
    expect(formatDms({ lat: -LAT, lon: -LON })).toBe('42°38′00.6″S 0°06′07.6″W');
  });

  it('el redondeo de los segundos no deja 60,0″', () => {
    expect(formatDms({ lat: 42.99999, lon: 0.99999 })).toBe('43°00′00.0″N 1°00′00.0″E');
    expect(formatDms({ lat: 42.999, lon: 0 })).toBe('42°59′56.4″N 0°00′00.0″E');
  });

  it('UTM con zona y banda; metros enteros', () => {
    expect(formatUtm({ lat: 42.6335, lon: -0.1 })).toMatch(/^30T \d{6} \d{7}$/);
    expect(formatUtm({ lat: 42.6335, lon: 0.1 })).toMatch(/^31T \d{6} \d{7}$/);
    expect(formatUtm({ lat: 89, lon: 0 })).toBeNull();
    expect(formatCoordinate({ lat: 89, lon: 0 }, 'utm')).toBe('89.00000, 0.00000');
  });

  it('formatCoordinate elige el formato', () => {
    const p = { lat: LAT, lon: LON };
    expect(formatCoordinate(p)).toBe(formatDecimal(p));
    expect(formatCoordinate(p, 'dms')).toBe(formatDms(p));
    expect(formatCoordinate(p, 'utm')).toBe(formatUtm(p));
  });

  it('lo que se escribe se vuelve a leer (ida y vuelta) en los tres formatos', () => {
    for (const lat of [42.0, 42.6335, 43.1, 43.99]) {
      for (const lon of [-1.9, -0.1021, 0, 0.1021, 1.5, 3.9]) {
        const p = { lat, lon };
        for (const [format, tolerance] of [
          ['decimal', 1e-5],
          ['dms', 2e-5],
          ['utm', 2e-5],
        ] as const) {
          const text = formatCoordinate(p, format);
          const back = parseCoordinates(text);
          // UTM solo lee las zonas 30 y 31: toda la caja de los Pirineos (−2°…4°) cabe.
          expect(back.ok, `${format}: ${text}`).toBe(true);
          if (back.ok) {
            expect(back.format).toBe(format);
            expect(Math.abs(back.point.lat - lat), `${format}: ${text}`).toBeLessThan(tolerance);
            expect(Math.abs(back.point.lon - lon), `${format}: ${text}`).toBeLessThan(tolerance);
          }
        }
      }
    }
  });
});

// Valores de referencia independientes: la serie clásica de Snyder (1987, ec. 8-9 a 8-25) escrita aquí aparte de la
// serie de Krüger que usa el paquete, y el arco de meridiano del elipsoide WGS84 hasta los 45° (4 984 944,378 m).
function snyderUtm(latDeg: number, lonDeg: number, zone: number) {
  const a = 6378137;
  const e2 = 0.0066943799901413165;
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const phi = (latDeg * Math.PI) / 180;
  const lam = ((lonDeg - ((zone - 1) * 6 - 180 + 3)) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = lam * Math.cos(phi);
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M =
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));
  const easting = 500000 + k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const northing = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return { easting, northing, meridianArc: M };
}

describe('UTM (WGS84)', () => {
  it('el meridiano central da 500 000 m de este y el arco de meridiano conocido hacia el norte', () => {
    const utm = toUtm({ lat: 45, lon: -3 })!;
    expect(utm.zone).toBe(30);
    expect(utm.easting).toBeCloseTo(500000, 6);
    // 0,9996 × 4 984 944,378 m
    expect(utm.northing).toBeCloseTo(0.9996 * 4984944.378, 1);
    expect(snyderUtm(45, -3, 30).meridianArc).toBeCloseTo(4984944.378, 2);
  });

  it('coincide con la serie clásica de Snyder a menos de un milímetro en la caja de los Pirineos', () => {
    for (const lat of [42, 42.6335, 43.25, 44]) {
      for (const lon of [-1.9, -1, -0.1, 0.1, 1.5, 3.9]) {
        const zone = utmZoneOf(lon);
        const ours = toUtm({ lat, lon })!;
        const reference = snyderUtm(lat, lon, zone);
        expect(Math.abs(ours.easting - reference.easting), `E ${lat},${lon}`).toBeLessThan(0.001);
        expect(Math.abs(ours.northing - reference.northing), `N ${lat},${lon}`).toBeLessThan(0.001);
      }
    }
  });

  it('la ida y vuelta pierde menos de un milímetro y respeta la zona pedida', () => {
    for (const [lat, lon] of [
      [42.6335, -0.1],
      [43.5, 2.5],
      [42, -1.9],
      [-33.9, 18.4],
    ] as const) {
      const utm = toUtm({ lat, lon })!;
      const back = fromUtm(utm);
      expect(Math.abs(back.lat - lat)).toBeLessThan(1e-8);
      expect(Math.abs(back.lon - lon)).toBeLessThan(1e-8);
    }
    // El mismo punto en la zona vecina: este a un lado y a otro del meridiano que separa 30 y 31.
    const west = toUtm({ lat: 42.6, lon: 0.001 }, 30)!;
    const east = toUtm({ lat: 42.6, lon: 0.001 })!;
    expect(west.zone).toBe(30);
    expect(east.zone).toBe(31);
    expect(west.easting).toBeGreaterThan(east.easting + 100000);
  });

  it('zona y banda estándar', () => {
    expect(utmZoneOf(-0.1)).toBe(30);
    expect(utmZoneOf(0)).toBe(31);
    expect(utmZoneOf(-6)).toBe(30);
    expect(utmZoneOf(180)).toBe(60);
    expect(utmBandOf(42.6)).toBe('T');
    expect(utmBandOf(-33.9)).toBe('H');
    expect(utmBandOf(48.1)).toBe('U');
  });

  it('en el sur usa el falso norte de 10 000 000 m y vuelve', () => {
    const utm = toUtm({ lat: -33.9, lon: 18.4 })!;
    expect(utm.northing).toBeGreaterThan(6000000);
    expect(utm.band).toBe('H');
    const back = fromUtm(utm);
    expect(back.lat).toBeCloseTo(-33.9, 8);
  });
});
