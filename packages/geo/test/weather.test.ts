import { describe, expect, it } from 'vitest';
import { dayPartSymbols, weatherSymbol, type ClockTime, type DayPartHour } from '../src/index.js';

// Issue #18: el símbolo del tiempo y los tres tramos del día se derivan aquí, en `packages/geo` (regla 9), de los datos que ya trae el proveedor.

const base = { cloudCoverPct: 0, precipitationMm: 0, snowfallCm: 0 as number | null, temperatureC: 12, isNight: false };

describe('weatherSymbol (D-W1, D-W7)', () => {
  it('nubosidad: despejado por debajo del 20 %, nube con sol hasta el 65 % y nube desde ahí', () => {
    expect(weatherSymbol({ ...base, cloudCoverPct: 0 }).name).toBe('clear');
    expect(weatherSymbol({ ...base, cloudCoverPct: 19.9 }).name).toBe('clear');
    expect(weatherSymbol({ ...base, cloudCoverPct: 20 }).name).toBe('partly');
    expect(weatherSymbol({ ...base, cloudCoverPct: 64.9 }).name).toBe('partly');
    expect(weatherSymbol({ ...base, cloudCoverPct: 65 }).name).toBe('cloudy');
    expect(weatherSymbol({ ...base, cloudCoverPct: 100 }).name).toBe('cloudy');
  });

  it('lluvia desde 1 mm y lluvia fuerte desde 10 mm, aunque haya pocas nubes', () => {
    expect(weatherSymbol({ ...base, cloudCoverPct: 40, precipitationMm: 0.9 }).name).toBe('partly');
    expect(weatherSymbol({ ...base, cloudCoverPct: 40, precipitationMm: 1 }).name).toBe('rain');
    expect(weatherSymbol({ ...base, cloudCoverPct: 90, precipitationMm: 9.9 }).name).toBe('rain');
    expect(weatherSymbol({ ...base, cloudCoverPct: 90, precipitationMm: 10 }).name).toBe('heavy-rain');
  });

  it('nieve: desde 0,5 cm de nieve, o precipitación de 1 mm con temperatura de 0 °C o menos', () => {
    expect(weatherSymbol({ ...base, snowfallCm: 0.4 }).name).toBe('clear');
    expect(weatherSymbol({ ...base, snowfallCm: 0.5 }).name).toBe('snow');
    expect(weatherSymbol({ ...base, precipitationMm: 2, temperatureC: 0 }).name).toBe('snow');
    expect(weatherSymbol({ ...base, precipitationMm: 2, temperatureC: 0.1 }).name).toBe('rain');
    expect(weatherSymbol({ ...base, precipitationMm: 0.5, temperatureC: -5 }).name).toBe('clear');
    expect(weatherSymbol({ ...base, snowfallCm: 3, precipitationMm: 30, temperatureC: 4 }).name).toBe('snow');
  });

  it('sin dato de nieve (null) se trata como sin nieve', () => {
    expect(weatherSymbol({ ...base, snowfallCm: null, cloudCoverPct: 80 }).name).toBe('cloudy');
  });

  it('la noche solo cambia el sol por la luna: despejado y nube con sol; nube, lluvia y nieve no cambian', () => {
    expect(weatherSymbol({ ...base, isNight: true })).toEqual({ name: 'clear', night: true });
    expect(weatherSymbol({ ...base, cloudCoverPct: 40, isNight: true })).toEqual({ name: 'partly', night: true });
    expect(weatherSymbol({ ...base, cloudCoverPct: 90, isNight: true })).toEqual({ name: 'cloudy', night: false });
    expect(weatherSymbol({ ...base, precipitationMm: 3, isNight: true })).toEqual({ name: 'rain', night: false });
    expect(weatherSymbol({ ...base, snowfallCm: 2, isNight: true })).toEqual({ name: 'snow', night: false });
    expect(weatherSymbol({ ...base, isNight: false })).toEqual({ name: 'clear', night: false });
  });

  it('nunca inventa tormenta ni niebla: el conjunto de símbolos es cerrado', () => {
    const names = new Set<string>();
    for (const cloud of [0, 30, 80])
      for (const rain of [0, 2, 20]) for (const snow of [0, 3]) names.add(weatherSymbol({ ...base, cloudCoverPct: cloud, precipitationMm: rain, snowfallCm: snow }).name);
    expect([...names].sort()).toEqual(['clear', 'cloudy', 'heavy-rain', 'partly', 'rain', 'snow']);
  });
});

// Reloj de quien mira, inyectado: aquí UTC+2 (horario de verano de los Pirineos) y, en otra prueba, el cambio de hora.
const clockAt =
  (offsetHours: number) =>
  (iso: string): ClockTime => {
    const local = new Date(Date.parse(iso) + offsetHours * 3_600_000);
    return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours(), minute: local.getUTCMinutes() };
  };
const CEST = clockAt(2);

/** Una hora por instante local `fromLocal` (hora de reloj local de 2026-07-01 + n días) durante `count` horas. */
function hours(startLocalIso: string, count: number, make: (hourOfDay: number, index: number) => Partial<DayPartHour> = () => ({}), offset = 2): DayPartHour[] {
  const start = Date.parse(`${startLocalIso}:00Z`) - offset * 3_600_000;
  return Array.from({ length: count }, (_, index) => {
    const time = new Date(start + index * 3_600_000).toISOString();
    return { time, temperatureC: 15, precipitationMm: 0, snowfallCm: 0, cloudCoverPct: 5, ...make(new Date(Date.parse(time) + offset * 3_600_000).getUTCHours(), index) };
  });
}
const SUN = { sunrise: '2026-07-01T04:30:00.000Z', sunset: '2026-07-01T19:30:00.000Z' }; // 06:30 y 21:30 de reloj local

describe('dayPartSymbols (D-W8, D-W9)', () => {
  it('por la mañana salen Mañana, Tarde y Noche de hoy, en ese orden y con su horario', () => {
    const forecast = hours('2026-07-01T07:00', 40);
    const parts = dayPartSymbols(forecast, new Date('2026-07-01T05:10:00Z'), CEST, SUN);
    expect(parts.map((p) => [p.part, p.startHour, p.endHour, p.day])).toEqual([
      ['morning', 6, 12, 'today'],
      ['afternoon', 12, 18, 'today'],
      ['night', 18, 24, 'today'],
    ]);
    expect(parts.every((p) => p.symbol !== null)).toBe(true);
  });

  it('si ya estamos en la tarde, empieza por la Tarde y la Mañana pasa al final, con el día de mañana', () => {
    const forecast = hours('2026-07-01T15:00', 40);
    const parts = dayPartSymbols(forecast, new Date('2026-07-01T13:20:00Z'), CEST, SUN);
    expect(parts.map((p) => [p.part, p.day])).toEqual([
      ['afternoon', 'today'],
      ['night', 'today'],
      ['morning', 'tomorrow'],
    ]);
    expect(parts.map((p) => `${p.startHour}-${p.endHour}`)).toEqual(['12-18', '18-24', '6-12']);
  });

  it('si estamos en la noche salen Noche, Mañana y Tarde (las dos últimas de mañana)', () => {
    const forecast = hours('2026-07-01T22:00', 40);
    const parts = dayPartSymbols(forecast, new Date('2026-07-01T20:30:00Z'), CEST, SUN);
    expect(parts.map((p) => [p.part, p.day])).toEqual([
      ['night', 'today'],
      ['morning', 'tomorrow'],
      ['afternoon', 'tomorrow'],
    ]);
  });

  it('de 00 a 06 h el primero es la Mañana de hoy', () => {
    const forecast = hours('2026-07-01T03:00', 40);
    const parts = dayPartSymbols(forecast, new Date('2026-07-01T01:15:00Z'), CEST, SUN);
    expect(parts.map((p) => [p.part, p.day])).toEqual([
      ['morning', 'today'],
      ['afternoon', 'today'],
      ['night', 'today'],
    ]);
  });

  it('el tramo en curso usa solo las horas que le quedan, y el pasado no entra', () => {
    // Son las 16:20 (14:20 UTC): quedan 16, 17 y las de mañana. A las 16 h llueve; antes no había datos.
    const forecast = hours('2026-07-01T16:00', 40, (hour, index) => (index < 2 ? { precipitationMm: 3, cloudCoverPct: 90 } : {}));
    const [afternoon] = dayPartSymbols(forecast, new Date('2026-07-01T14:20:00Z'), CEST, SUN);
    expect(afternoon!.part).toBe('afternoon');
    expect(afternoon!.hours).toBe(2);
    expect(afternoon!.symbol).toEqual({ name: 'rain', night: false });
  });

  it('la lluvia de un tramo sale de lo que suma en el tramo, no de una sola hora', () => {
    const wet = (millimeters: number) => hours('2026-07-01T07:00', 40, (hour) => (hour === 14 ? { precipitationMm: millimeters, cloudCoverPct: 60 } : { cloudCoverPct: 60 }));
    const afternoonOf = (forecast: DayPartHour[]) => dayPartSymbols(forecast, new Date('2026-07-01T05:10:00Z'), CEST, SUN)[1]!.symbol!.name;
    expect(afternoonOf(wet(0.4))).toBe('partly');
    expect(afternoonOf(wet(1))).toBe('rain');
    expect(afternoonOf(wet(10))).toBe('heavy-rain');
  });

  it('nubosidad media del tramo y mismo tramo en días distintos no se mezclan', () => {
    const forecast = hours('2026-07-01T07:00', 60, (hour, index) => ({ cloudCoverPct: index < 24 ? 0 : 100 }));
    const parts = dayPartSymbols(forecast, new Date('2026-07-01T05:10:00Z'), CEST, SUN);
    expect(parts.map((p) => p.symbol!.name)).toEqual(['clear', 'clear', 'clear']);
  });

  it('el icono de noche solo sale si la mayoría de las horas del tramo son de noche', () => {
    // Verano: anochece a las 21:30, así que de las 6 horas de la Noche (18–24 h) cuatro empiezan de día y dos de noche: gana el día.
    const forecast = hours('2026-07-01T07:00', 40);
    const parts = dayPartSymbols(forecast, new Date('2026-07-01T05:10:00Z'), CEST, SUN);
    expect(parts[0]!.symbol!.night).toBe(false);
    expect(parts[2]!.symbol).toEqual({ name: 'clear', night: false });
    // Invierno: anochece a las 17:30 y la Noche es de noche entera.
    const winter = { sunrise: '2026-12-01T07:30:00.000Z', sunset: '2026-12-01T16:30:00.000Z' };
    const winterHours = hours('2026-12-01T07:00', 40, () => ({}), 1);
    const [first, second, third] = dayPartSymbols(winterHours, new Date('2026-12-01T06:10:00Z'), clockAt(1), winter);
    expect([first!.symbol!.night, second!.symbol!.night, third!.symbol!.night]).toEqual([false, false, true]);
  });

  it('sin salida ni puesta del sol (sol de medianoche o noche polar) se trata como de día', () => {
    const forecast = hours('2026-07-01T07:00', 40);
    const parts = dayPartSymbols(forecast, new Date('2026-07-01T05:10:00Z'), CEST, { sunrise: null, sunset: null });
    expect(parts.every((p) => p.symbol!.night === false)).toBe(true);
  });

  it('un tramo sin ninguna hora prevista no inventa símbolo', () => {
    const forecast = hours('2026-07-01T07:00', 3); // solo 07, 08 y 09 h
    const parts = dayPartSymbols(forecast, new Date('2026-07-01T05:10:00Z'), CEST, SUN);
    expect(parts[0]!.symbol).not.toBeNull();
    expect(parts[1]!.symbol).toBeNull();
    expect(parts[2]!.symbol).toBeNull();
  });

  it('sin ninguna hora devuelve los tres tramos vacíos', () => {
    const parts = dayPartSymbols([], new Date('2026-07-01T05:10:00Z'), CEST, SUN);
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.symbol === null && p.hours === 0)).toBe(true);
  });

  it('los límites de los tramos son 06, 12 y 18 h de reloj: las 12:00 son Tarde y las 11:59 son Mañana', () => {
    const at = (iso: string) => dayPartSymbols(hours('2026-07-01T05:00', 40), new Date(iso), CEST, SUN)[0]!.part;
    expect(at('2026-07-01T09:59:00Z')).toBe('morning'); // 11:59
    expect(at('2026-07-01T10:00:00Z')).toBe('afternoon'); // 12:00
    expect(at('2026-07-01T15:59:00Z')).toBe('afternoon'); // 17:59
    expect(at('2026-07-01T16:00:00Z')).toBe('night'); // 18:00
    expect(at('2026-07-01T03:59:00Z')).toBe('morning'); // 05:59: aún antes de las 06
    expect(at('2026-07-01T04:00:00Z')).toBe('morning'); // 06:00
  });

  it('con el cambio de hora (26 de octubre de 2026, de UTC+2 a UTC+1) cada tramo sigue en su hora de reloj', () => {
    // El reloj de quien mira cambia de desfase a las 01:00 UTC; el tramo de la Mañana sigue siendo 06–12 de reloj.
    const clock = (iso: string): ClockTime => {
      const offset = Date.parse(iso) >= Date.parse('2026-10-25T01:00:00Z') ? 1 : 2;
      const local = new Date(Date.parse(iso) + offset * 3_600_000);
      return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours(), minute: local.getUTCMinutes() };
    };
    const forecast: DayPartHour[] = Array.from({ length: 48 }, (_, index) => ({
      time: new Date(Date.parse('2026-10-24T22:00:00Z') + index * 3_600_000).toISOString(),
      temperatureC: 8,
      precipitationMm: 0,
      snowfallCm: 0,
      // Nublado de 06 a 12 h de reloj del día 25, que tras el cambio de hora son las 05:00–11:00 UTC.
      cloudCoverPct: (() => {
        const local = clock(new Date(Date.parse('2026-10-24T22:00:00Z') + index * 3_600_000).toISOString());
        return local.date === '2026-10-25' && local.hour >= 6 && local.hour < 12 ? 100 : 0;
      })(),
    }));
    const parts = dayPartSymbols(forecast, new Date('2026-10-24T22:30:00Z'), clock, { sunrise: '2026-10-25T05:50:00.000Z', sunset: '2026-10-25T16:20:00.000Z' });
    // Son las 00:30 del 25 de octubre: la primera es la Mañana de hoy y está nublada; la Tarde, despejada.
    expect(parts[0]!.part).toBe('morning');
    expect(parts[0]!.symbol!.name).toBe('cloudy');
    expect(parts[1]!.symbol!.name).toBe('clear');
  });
});
