import { describe, expect, it } from 'vitest';
import { MAX_PROFILE_POINTS, computeMetrics, lengthM, type Position3D } from '../src/index.js';

const METERS_PER_DEGREE = 111195.08;

/** Generador determinista (LCG) para que el «ruido» de las pruebas sea siempre el mismo. */
function noise(seed: number): (amplitude: number) => number {
  let state = seed >>> 0;
  return (amplitude) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 2 ** 32) * 2 * amplitude - amplitude;
  };
}

/** Línea hacia el norte con un vértice cada 30 m cuya altitud la da `elevation(índice)`. */
const climb = (count: number, elevation: (index: number) => number): Position3D[] => Array.from({ length: count }, (_, i) => [0.5, 42 + (i * 30) / METERS_PER_DEGREE, elevation(i)]);

describe('computeMetrics (RF-502, RN-10)', () => {
  it('terreno llano: distancia exacta, sin desnivel y sin pendiente', () => {
    const { metrics, profile } = computeMetrics(climb(101, () => 1500));
    expect(metrics).toEqual({ distanceM: 3000, ascentM: 0, descentM: 0, minElevationM: 1500, maxElevationM: 1500, maxSlopePct: 0 });
    expect(profile[0]).toEqual([0, 1500]);
    expect(profile[profile.length - 1]).toEqual([3000, 1500]);
  });

  it('escalera: cinco escalones de 30 m dan exactamente 150 m de desnivel positivo y ninguno negativo', () => {
    // 20 muestras llanas, un salto de 30 m, otra vez 20 llanas…
    const { metrics } = computeMetrics(climb(101, (i) => 1000 + Math.floor(i / 20) * 30));
    expect(metrics.ascentM).toBe(150);
    expect(metrics.descentM).toBe(0);
    expect(metrics.minElevationM).toBe(1000);
    expect(metrics.maxElevationM).toBe(1150);
  });

  it('subir y bajar suma a cada lado', () => {
    const { metrics } = computeMetrics(climb(101, (i) => 1000 + (i <= 50 ? i : 100 - i) * 3));
    expect(metrics.ascentM).toBeGreaterThan(144);
    expect(metrics.ascentM).toBeLessThanOrEqual(150);
    expect(metrics.descentM).toBeGreaterThan(144);
    expect(metrics.descentM).toBeLessThanOrEqual(150);
  });

  it('pendiente conocida del 10 % con ruido de ±5 m: el desnivel queda dentro del 5 % del real (R-07)', () => {
    const random = noise(1);
    const real = 3 * 199; // 3 m cada 30 m durante 199 tramos
    const { metrics } = computeMetrics(climb(200, (i) => 1000 + i * 3 + random(5)));
    expect(Math.abs(metrics.ascentM - real) / real).toBeLessThan(0.05);
    expect(metrics.descentM).toBeLessThan(real * 0.05);
  });

  it('colina de 300 m con ruido de ±3 m: dentro del 3 % del real', () => {
    const random = noise(7);
    const { metrics } = computeMetrics(climb(400, (i) => 1000 + 300 * Math.sin((Math.PI * i) / 399) + random(3)));
    expect(Math.abs(metrics.ascentM - 300) / 300).toBeLessThan(0.03);
    expect(Math.abs(metrics.descentM - 300) / 300).toBeLessThan(0.03);
  });

  it('terreno llano con ruido de ±2 m: ni un metro de desnivel inventado', () => {
    const random = noise(3);
    const { metrics } = computeMetrics(climb(200, () => 1000 + random(2)));
    expect(metrics.ascentM).toBe(0);
    expect(metrics.descentM).toBe(0);
  });

  it('un pico aislado de una sola muestra (error de lectura) no cuenta ni como desnivel ni como pendiente', () => {
    const { metrics } = computeMetrics(climb(60, (i) => (i === 30 ? 1500 : 1000)));
    expect(metrics.ascentM).toBe(0);
    expect(metrics.maxSlopePct).toBe(0);
    expect(metrics.maxElevationM).toBe(1000);
  });

  it('pendiente máxima: una rampa del 10 % da el 10 %, medida sobre una ventana y no entre muestras vecinas', () => {
    const { metrics } = computeMetrics(climb(100, (i) => 1000 + i * 3));
    expect(metrics.maxSlopePct).toBeCloseTo(10, 0);
  });

  it('la altitud máxima y la mínima salen del perfil, con un decimal', () => {
    const { metrics } = computeMetrics(climb(50, (i) => 1000.123 + i));
    expect(metrics.minElevationM).toBe(1000.1);
    expect(metrics.maxElevationM).toBe(1049.1);
  });

  it('el perfil tiene como mucho 500 puntos, conserva el principio y el final, y crece en distancia', () => {
    const { metrics, profile } = computeMetrics(climb(1500, (i) => 1000 + (i % 100)));
    expect(profile).toHaveLength(MAX_PROFILE_POINTS);
    expect(profile[0]![0]).toBe(0);
    expect(profile[profile.length - 1]![0]).toBe(metrics.distanceM);
    for (let i = 1; i < profile.length; i++) expect(profile[i]![0]).toBeGreaterThan(profile[i - 1]![0]);
  });

  it('un trazado muy corto tiene al menos dos puntos de perfil', () => {
    const { profile } = computeMetrics([
      [0.5, 42, 1000],
      [0.5, 42.0001, 1002],
    ]);
    expect(profile.length).toBeGreaterThanOrEqual(2);
  });

  it('la distancia de las métricas es la de la línea', () => {
    const line = climb(77, (i) => 1000 + i);
    expect(computeMetrics(line).metrics.distanceM).toBeCloseTo(lengthM(line), 0);
  });

  it('exige dos vértices y longitud mayor que cero', () => {
    expect(() => computeMetrics([[0, 42, 1000]])).toThrow(RangeError);
    expect(() =>
      computeMetrics([
        [0, 42, 1000],
        [0, 42, 1000],
      ]),
    ).toThrow(RangeError);
  });
});
