// Métricas de una versión de ruta (RF-502, RN-10, R-07). Entrada: el trazado ya densificado con la altitud que el
// servidor sacó de su modelo de elevación; la altitud de un archivo importado nunca llega aquí. Sin tiempo estimado (D-03).
import { haversineM, type Position3D } from './geometry.js';

/** Paso del remuestreo del perfil, en metros: el mismo que la resolución del modelo de elevación. */
export const PROFILE_STEP_M = 30;

/**
 * Umbral del desnivel, en metros: una variación solo cuenta cuando se aleja al menos esto de la última altitud
 * contabilizada. Las oscilaciones menores (rugosidad del modelo de superficie, posición ruidosa) no suman.
 */
export const ELEVATION_THRESHOLD_M = 3;

/** Ventana de la pendiente máxima, en metros: nunca se mide entre dos muestras vecinas, donde un salto aislado da pendientes absurdas. */
export const SLOPE_WINDOW_M = 60;

/** Máximo de puntos del perfil que se envía a la interfaz. */
export const MAX_PROFILE_POINTS = 500;

export interface RouteMetrics {
  distanceM: number;
  ascentM: number;
  descentM: number;
  minElevationM: number;
  maxElevationM: number;
  maxSlopePct: number;
}

export interface MeasuredRoute {
  metrics: RouteMetrics;
  /** Pares `[distancia acumulada en m, altitud en m]`, de 2 a `MAX_PROFILE_POINTS`. */
  profile: [number, number][];
}

/** Un decimal, como se guardan en la base de datos (`numeric(…, 1)`) y como se muestran. */
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Mediana de tres muestras; los extremos no cambian. Quita los picos de una sola muestra sin aplanar el relieve. */
function median3(values: readonly number[]): number[] {
  return values.map((value, i) => {
    if (i === 0 || i === values.length - 1) return value;
    const a = values[i - 1]!;
    const c = values[i + 1]!;
    return Math.max(Math.min(a, value), Math.min(Math.max(a, value), c));
  });
}

/** Altitud en cada múltiplo de `step` metros a lo largo de la línea (y en el final), interpolada linealmente. */
function resample(distances: readonly number[], elevations: readonly number[], step: number): { at: number[]; z: number[] } {
  const total = distances[distances.length - 1]!;
  const count = Math.max(1, Math.ceil(total / step));
  const at: number[] = [];
  const z: number[] = [];
  let segment = 1;
  for (let k = 0; k <= count; k++) {
    const target = k === count ? total : k * step;
    while (segment < distances.length - 1 && distances[segment]! < target) segment++;
    const d0 = distances[segment - 1]!;
    const d1 = distances[segment]!;
    const e0 = elevations[segment - 1]!;
    const e1 = elevations[segment]!;
    const t = d1 > d0 ? Math.min(1, Math.max(0, (target - d0) / (d1 - d0))) : 0;
    at.push(target);
    z.push(e0 + (e1 - e0) * t);
  }
  return { at, z };
}

/**
 * Calcula las métricas y el perfil de una línea con altitud. Exige al menos dos vértices distintos (longitud mayor
 * que cero); quien llama lo comprueba antes.
 */
export function computeMetrics(line: readonly Position3D[]): MeasuredRoute {
  if (line.length < 2) throw new RangeError('computeMetrics needs at least two vertices');
  const distances: number[] = [0];
  for (let i = 1; i < line.length; i++) distances.push(distances[i - 1]! + haversineM(line[i - 1]!, line[i]!));
  const total = distances[distances.length - 1]!;
  if (!(total > 0)) throw new RangeError('computeMetrics needs a line with length');

  const { at, z: raw } = resample(
    distances,
    line.map((position) => position[2]),
    PROFILE_STEP_M,
  );
  const z = median3(raw);

  let ascent = 0;
  let descent = 0;
  let reference = z[0]!;
  for (const value of z) {
    const delta = value - reference;
    if (delta >= ELEVATION_THRESHOLD_M) {
      ascent += delta;
      reference = value;
    } else if (delta <= -ELEVATION_THRESHOLD_M) {
      descent -= delta;
      reference = value;
    }
  }

  const span = Math.max(1, Math.round(SLOPE_WINDOW_M / PROFILE_STEP_M));
  let maxSlope = 0;
  for (let i = 0; i + 1 < z.length; i++) {
    const j = Math.min(z.length - 1, i + span);
    const run = at[j]! - at[i]!;
    if (run > 0) maxSlope = Math.max(maxSlope, (Math.abs(z[j]! - z[i]!) / run) * 100);
  }

  const profile: [number, number][] = [];
  const points = Math.min(z.length, MAX_PROFILE_POINTS);
  for (let k = 0; k < points; k++) {
    const index = points === z.length ? k : Math.round((k * (z.length - 1)) / (points - 1));
    profile.push([round1(at[index]!), round1(z[index]!)]);
  }

  return {
    metrics: {
      distanceM: round1(total),
      ascentM: round1(ascent),
      descentM: round1(descent),
      minElevationM: round1(Math.min(...z)),
      maxElevationM: round1(Math.max(...z)),
      maxSlopePct: round1(maxSlope),
    },
    profile,
  };
}
