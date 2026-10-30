// Luz del sol y de la luna de un punto (RF-705, D-H1-11): cálculo local con SunCalc, sin proveedor ni conexión, así que sirve
// igual en el servidor y, más adelante, en la app móvil sin red. Funciones puras: el instante lo pone quien llama.
import { getMoonIllumination, getMoonTimes, getTimes } from 'suncalc';
import type { LatLon } from './cell.js';

/** Instantes en ISO 8601 con milisegundos y `Z`, o `null` si el hecho no ocurre ese día (latitudes extremas). */
export type Instant = string | null;

export interface SunLight {
  /** Día solar local del punto (AAAA-MM-DD), el que cubren los instantes de abajo. */
  date: string;
  sunrise: Instant;
  sunset: Instant;
  civilDawn: Instant;
  civilDusk: Instant;
  nauticalDawn: Instant;
  nauticalDusk: Instant;
}

export type MoonPhaseName = 'new' | 'waxing_crescent' | 'first_quarter' | 'waxing_gibbous' | 'full' | 'waning_gibbous' | 'last_quarter' | 'waning_crescent';

export interface MoonLight {
  phaseName: MoonPhaseName;
  /** Porcentaje iluminado del disco, 0–100 con un decimal. */
  illuminationPct: number;
  moonrise: Instant;
  moonset: Instant;
}

const HOUR_MS = 3_600_000;
const iso = (date: Date | null | undefined): Instant => (date && !Number.isNaN(date.getTime()) ? date.toISOString() : null);

/**
 * Amanecer, atardecer y crepúsculos del día solar local que contiene `at`. El día solar va de una medianoche solar a la
 * siguiente (la longitud decide el desfase respecto a UTC), no de una zona horaria: así no hace falta saber en qué zona
 * está el punto. Crepúsculo civil = sol a −6°, náutico = −12°.
 */
export function sunLight(at: Date, point: LatLon): SunLight {
  const times = getTimes(at, point.lat, point.lon);
  // El día se rotula con la fecha que marca el reloj solar a mediodía solar (UTC + longitud / 15 horas).
  const date = new Date(times.solarNoon.getTime() + (point.lon / 15) * HOUR_MS).toISOString().slice(0, 10);
  return {
    date,
    sunrise: iso(times.sunrise),
    sunset: iso(times.sunset),
    civilDawn: iso(times.dawn),
    civilDusk: iso(times.dusk),
    nauticalDawn: iso(times.nauticalDawn),
    nauticalDusk: iso(times.nauticalDusk),
  };
}

/** Mitad de la ventana de las cuatro fases principales, en ciclos: 0,03 ≈ 0,9 días a cada lado del instante exacto. */
const MAIN_PHASE_HALF_WINDOW = 0.03;

/**
 * Nombre de la fase a partir de su ciclo (0 nueva, 0,25 primer cuarto, 0,5 llena, 0,75 último cuarto). Las cuatro
 * principales ocupan unas 1,8 jornadas centradas en su instante; entre ellas, creciente/menguante y gibosa.
 */
export function moonPhaseName(phase: number): MoonPhaseName {
  const p = ((phase % 1) + 1) % 1;
  const near = (center: number) => Math.abs(p - center) < MAIN_PHASE_HALF_WINDOW;
  if (p < MAIN_PHASE_HALF_WINDOW || p >= 1 - MAIN_PHASE_HALF_WINDOW) return 'new';
  if (near(0.25)) return 'first_quarter';
  if (near(0.5)) return 'full';
  if (near(0.75)) return 'last_quarter';
  if (p < 0.25) return 'waxing_crescent';
  if (p < 0.5) return 'waxing_gibbous';
  if (p < 0.75) return 'waning_gibbous';
  return 'waning_crescent';
}

/**
 * Fase, iluminación en `at` y salida y puesta de la luna del mismo día solar local que `sunLight`. Un día sin salida
 * o sin puesta (ocurre una vez al mes) devuelve `null` en ese campo.
 */
export function moonLight(at: Date, point: LatLon): MoonLight {
  const illumination = getMoonIllumination(at);
  const times = getMoonTimes(at, point.lat, point.lon);
  return {
    phaseName: moonPhaseName(illumination.phase),
    illuminationPct: Math.round(illumination.fraction * 1000) / 10,
    moonrise: iso(times.rise),
    moonset: iso(times.set),
  };
}
