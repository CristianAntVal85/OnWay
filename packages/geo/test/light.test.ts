import { describe, expect, it } from 'vitest';
import { moonLight, moonPhaseName, sunLight, type Instant } from '../src/index.js';

// Valores de referencia obtenidos el 2026-10-31 del US Naval Observatory (aa.usno.navy.mil/api/rstt/oneday, minutos, tz=0)
// y de sunrise-sunset.org (crepúsculo náutico, que el USNO no da). Tolerancias anotadas:
//  - sol y crepúsculos: ±3 min (SunCalc 2 se desvía ~1 min; la referencia viene redondeada al minuto);
//  - salida y puesta de la luna: ±5 min (modelo lunar simplificado de Meeus);
//  - iluminación: ±2 puntos porcentuales (la referencia es un entero y no dice a qué hora del día);
//  - los instantes de luna nueva y llena de 2026 (12 ago 17:37 UTC y 3 mar 11:38 UTC) son de los eclipses de ese año.
const SUN_TOLERANCE_MIN = 3;
const MOON_TOLERANCE_MIN = 5;
const ILLUMINATION_TOLERANCE = 2;

const minutesBetween = (instant: Instant, expected: string): number => {
  expect(instant, `se esperaba ${expected}`).not.toBeNull();
  return Math.abs(new Date(instant!).getTime() - new Date(expected).getTime()) / 60_000;
};
const expectNear = (instant: Instant, expected: string, toleranceMin: number) => expect(minutesBetween(instant, expected), `${instant} frente a ${expected}`).toBeLessThanOrEqual(toleranceMin);

const TORLA = { lat: 42.63, lon: -0.1 };
const ANDORRA = { lat: 42.5, lon: 1.52 };
const IRATI = { lat: 43.0, lon: -1.0 };

describe('sunLight (RF-705, D-H1-11)', () => {
  it('Torla en el solsticio de verano', () => {
    const sun = sunLight(new Date('2026-06-21T12:00:00Z'), TORLA);
    expect(sun.date).toBe('2026-06-21');
    expectNear(sun.nauticalDawn, '2026-06-21T03:02:00Z', SUN_TOLERANCE_MIN);
    expectNear(sun.civilDawn, '2026-06-21T03:48:00Z', SUN_TOLERANCE_MIN);
    expectNear(sun.sunrise, '2026-06-21T04:23:00Z', SUN_TOLERANCE_MIN);
    expectNear(sun.sunset, '2026-06-21T19:42:00Z', SUN_TOLERANCE_MIN);
    expectNear(sun.civilDusk, '2026-06-21T20:17:00Z', SUN_TOLERANCE_MIN);
    expectNear(sun.nauticalDusk, '2026-06-21T21:02:00Z', SUN_TOLERANCE_MIN);
  });

  it('Torla en el solsticio de invierno', () => {
    const sun = sunLight(new Date('2026-12-21T12:00:00Z'), TORLA);
    expect(sun.date).toBe('2026-12-21');
    expectNear(sun.nauticalDawn, '2026-12-21T06:19:00Z', SUN_TOLERANCE_MIN);
    expectNear(sun.civilDawn, '2026-12-21T06:55:00Z', SUN_TOLERANCE_MIN);
    expectNear(sun.sunrise, '2026-12-21T07:27:00Z', SUN_TOLERANCE_MIN);
    expectNear(sun.sunset, '2026-12-21T16:30:00Z', SUN_TOLERANCE_MIN);
    expectNear(sun.civilDusk, '2026-12-21T17:02:00Z', SUN_TOLERANCE_MIN);
    expectNear(sun.nauticalDusk, '2026-12-21T17:37:00Z', SUN_TOLERANCE_MIN);
  });

  it('Andorra en el equinoccio y el Pirineo navarro el último día de octubre', () => {
    const equinox = sunLight(new Date('2026-03-20T12:00:00Z'), ANDORRA);
    expectNear(equinox.sunrise, '2026-03-20T05:57:00Z', SUN_TOLERANCE_MIN);
    expectNear(equinox.sunset, '2026-03-20T18:06:00Z', SUN_TOLERANCE_MIN);
    const autumn = sunLight(new Date('2026-10-31T12:00:00Z'), IRATI);
    expectNear(autumn.civilDawn, '2026-10-31T06:08:00Z', SUN_TOLERANCE_MIN);
    expectNear(autumn.sunrise, '2026-10-31T06:37:00Z', SUN_TOLERANCE_MIN);
    expectNear(autumn.sunset, '2026-10-31T16:58:00Z', SUN_TOLERANCE_MIN);
    expectNear(autumn.civilDusk, '2026-10-31T17:27:00Z', SUN_TOLERANCE_MIN);
  });

  it('da el mismo día solar a cualquier hora de ese día y el siguiente a partir de la medianoche solar', () => {
    const noon = sunLight(new Date('2026-06-21T12:00:00Z'), TORLA);
    expect(sunLight(new Date('2026-06-21T00:30:00Z'), TORLA)).toEqual(noon);
    expect(sunLight(new Date('2026-06-21T23:30:00Z'), TORLA)).toEqual(noon);
    expect(sunLight(new Date('2026-06-22T00:30:00Z'), TORLA).date).toBe('2026-06-22');
  });

  it('el orden del día es coherente: amanecer náutico < civil < salida < puesta < civil < náutico', () => {
    const s = sunLight(new Date('2026-09-10T12:00:00Z'), TORLA);
    const order = [s.nauticalDawn, s.civilDawn, s.sunrise, s.sunset, s.civilDusk, s.nauticalDusk].map((i) => new Date(i!).getTime());
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('devuelve null, no una fecha inválida, cuando el sol no sale (noche polar)', () => {
    const polar = sunLight(new Date('2026-12-21T12:00:00Z'), { lat: 80, lon: 0 });
    expect(polar.sunrise).toBeNull();
    expect(polar.sunset).toBeNull();
  });
});

describe('moonLight (RF-705, D-H1-11)', () => {
  it('Torla el 21 de junio: creciente casi en primer cuarto, 46 %', () => {
    const moon = moonLight(new Date('2026-06-21T12:00:00Z'), TORLA);
    expect(moon.phaseName).toBe('first_quarter');
    expect(Math.abs(moon.illuminationPct - 46)).toBeLessThanOrEqual(ILLUMINATION_TOLERANCE);
    expectNear(moon.moonrise, '2026-06-21T11:40:00Z', MOON_TOLERANCE_MIN);
    expectNear(moon.moonset, '2026-06-21T23:50:00Z', MOON_TOLERANCE_MIN);
  });

  it('Torla el 21 de diciembre: gibosa creciente, 90 %, con la puesta antes que la salida', () => {
    const moon = moonLight(new Date('2026-12-21T12:00:00Z'), TORLA);
    expect(moon.phaseName).toBe('waxing_gibbous');
    expect(Math.abs(moon.illuminationPct - 90)).toBeLessThanOrEqual(ILLUMINATION_TOLERANCE);
    expectNear(moon.moonset, '2026-12-21T04:29:00Z', MOON_TOLERANCE_MIN);
    expectNear(moon.moonrise, '2026-12-21T13:49:00Z', MOON_TOLERANCE_MIN);
  });

  it('Andorra el 20 de marzo: creciente fina, 3 %', () => {
    const moon = moonLight(new Date('2026-03-20T12:00:00Z'), ANDORRA);
    expect(moon.phaseName).toBe('waxing_crescent');
    expect(Math.abs(moon.illuminationPct - 3)).toBeLessThanOrEqual(ILLUMINATION_TOLERANCE);
    expectNear(moon.moonrise, '2026-03-20T06:22:00Z', MOON_TOLERANCE_MIN);
    expectNear(moon.moonset, '2026-03-20T20:09:00Z', MOON_TOLERANCE_MIN);
  });

  it('Pirineo navarro el 31 de octubre: gibosa menguante, 65 %', () => {
    const moon = moonLight(new Date('2026-10-31T12:00:00Z'), IRATI);
    expect(moon.phaseName).toBe('waning_gibbous');
    expect(Math.abs(moon.illuminationPct - 65)).toBeLessThanOrEqual(ILLUMINATION_TOLERANCE);
    expectNear(moon.moonset, '2026-10-31T12:37:00Z', MOON_TOLERANCE_MIN);
    expectNear(moon.moonrise, '2026-10-31T21:43:00Z', MOON_TOLERANCE_MIN);
  });

  it('luna nueva y luna llena en los instantes de los eclipses de 2026', () => {
    const newMoon = moonLight(new Date('2026-08-12T17:37:00Z'), TORLA);
    expect(newMoon.phaseName).toBe('new');
    expect(newMoon.illuminationPct).toBeLessThanOrEqual(ILLUMINATION_TOLERANCE);
    const fullMoon = moonLight(new Date('2026-03-03T11:38:00Z'), TORLA);
    expect(fullMoon.phaseName).toBe('full');
    expect(fullMoon.illuminationPct).toBeGreaterThanOrEqual(100 - ILLUMINATION_TOLERANCE);
    expectNear(fullMoon.moonset, '2026-03-03T06:30:00Z', MOON_TOLERANCE_MIN);
    expectNear(fullMoon.moonrise, '2026-03-03T18:07:00Z', MOON_TOLERANCE_MIN);
  });

  it('un día sin puesta de luna da null en ese campo (ocurre una vez al mes)', () => {
    // 2026-12-21 en Torla ya tiene salida y puesta; se busca un día del mes con una sola.
    const days = Array.from({ length: 31 }, (_, d) => moonLight(new Date(Date.UTC(2026, 11, 1 + d, 12)), TORLA));
    expect(days.some((m) => m.moonrise === null || m.moonset === null)).toBe(true);
  });
});

describe('moonPhaseName', () => {
  it('recorre los ocho nombres en un ciclo', () => {
    const names = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9].map(moonPhaseName);
    expect(names).toEqual(['new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous', 'full', 'waning_gibbous', 'last_quarter', 'waning_crescent']);
  });

  it('cierra el ciclo: 0,99 y 1 son luna nueva; los negativos se normalizan', () => {
    expect(moonPhaseName(0.99)).toBe('new');
    expect(moonPhaseName(1)).toBe('new');
    expect(moonPhaseName(-0.25)).toBe('last_quarter');
  });
});
