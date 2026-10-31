import { describe, expect, it } from 'vitest';
import { MAX_SPACING_M, MIN_SPACING_M, densify, haversineM, lengthM, prepareLine, quantize, thin, type Position2D } from '../src/index.js';

/** Metros por grado de latitud con el radio medio de la Tierra de la biblioteca (6371,0088 km): 111 195,08 m. */
const METERS_PER_DEGREE = 111195.08;

/** Línea recta hacia el norte con un vértice cada `stepM` metros. */
const meridian = (lon: number, lat0: number, totalM: number, stepM: number): Position2D[] => {
  const count = Math.round(totalM / stepM);
  return Array.from({ length: count + 1 }, (_, i) => [lon, lat0 + (i * stepM) / METERS_PER_DEGREE]);
};

describe('haversineM y lengthM (INV-17: metros)', () => {
  it('un grado de latitud son 111 195,08 m', () => {
    expect(haversineM([0, 42], [0, 43])).toBeCloseTo(METERS_PER_DEGREE, 1);
  });

  it('un grado de longitud a 42,5° de latitud son 111 195 m por el coseno (el círculo máximo es algo más corto)', () => {
    const parallel = METERS_PER_DEGREE * Math.cos((42.5 * Math.PI) / 180);
    const measured = haversineM([0, 42.5], [1, 42.5]);
    expect(Math.abs(measured - parallel)).toBeLessThan(1);
  });

  it('la distancia es simétrica y la de un punto a sí mismo es cero', () => {
    expect(haversineM([0.5, 42.5], [0.6, 42.7])).toBeCloseTo(haversineM([0.6, 42.7], [0.5, 42.5]), 6);
    expect(haversineM([0.5, 42.5], [0.5, 42.5])).toBe(0);
  });

  it('la longitud de una línea es la suma de sus tramos; con menos de dos vértices es cero', () => {
    expect(lengthM(meridian(0, 42, 3000, 1000))).toBeCloseTo(3000, 1);
    expect(lengthM([[0, 42]])).toBe(0);
    expect(lengthM([])).toBe(0);
  });
});

describe('quantize', () => {
  it('lleva las coordenadas a 7 decimales, sin cero negativo, y es idempotente', () => {
    const once = quantize([
      [-0.00000001, 42.123456789],
      [0.1000000049, 42.1],
    ]);
    expect(once).toEqual([
      [0, 42.1234568],
      [0.1, 42.1],
    ]);
    expect(Object.is(once[0]![0], -0)).toBe(false);
    expect(quantize(once)).toEqual(once);
  });
});

describe('thin (R-07: un GPS parado deja decenas de puntos casi iguales)', () => {
  it('descarta los intermedios a menos de 5 m del último conservado y conserva los extremos', () => {
    const dense = meridian(0.5, 42, 100, 1); // un vértice por metro
    const result = thin(dense);
    expect(result[0]).toEqual(dense[0]);
    expect(result[result.length - 1]).toEqual(dense[dense.length - 1]);
    for (let i = 1; i < result.length - 1; i++) expect(haversineM(result[i - 1]!, result[i]!)).toBeGreaterThanOrEqual(MIN_SPACING_M);
    expect(result.length).toBeLessThan(25);
    expect(result.length).toBeGreaterThan(15);
  });

  it('es idempotente, también cuando el último tramo es corto', () => {
    for (const total of [100, 103, 97.5]) {
      const once = thin(quantize(meridian(0.5, 42, total, 1)));
      expect(thin(once)).toEqual(once);
    }
  });

  it('un trazado de dos vértices, aunque estén juntos, no cambia', () => {
    const two: Position2D[] = [
      [0, 42],
      [0, 42.000001],
    ];
    expect(thin(two)).toEqual(two);
  });

  it('un GPS parado (cien puntos en 3 m) queda en dos vértices', () => {
    const parked: Position2D[] = Array.from({ length: 100 }, (_, i) => [0.5, 42 + (i % 3) * 0.00001]);
    expect(thin(parked)).toHaveLength(2);
  });
});

describe('densify (la resolución del modelo de elevación es de 30 m)', () => {
  it('inserta vértices uniformes en los tramos largos y no mueve los que había', () => {
    const line: Position2D[] = [
      [0.5, 42],
      [0.5, 42.009], // ~1000 m
      [0.5, 42.0091], // ~11 m
    ];
    const result = densify(line);
    expect(result[0]).toEqual(line[0]);
    expect(result).toContainEqual(line[1]);
    expect(result[result.length - 1]).toEqual(line[2]);
    for (let i = 1; i < result.length; i++) expect(haversineM(result[i - 1]!, result[i]!)).toBeLessThanOrEqual(MAX_SPACING_M + 0.1);
    expect(lengthM(result)).toBeCloseTo(lengthM(line), 0);
  });

  it('un trazado ya corto no cambia', () => {
    const line = meridian(0.5, 42, 90, 30);
    expect(densify(line)).toEqual(line);
  });

  it('es idempotente, también tras redondear las coordenadas como al exportar e importar', () => {
    for (const total of [1000, 1234.5, 30.2, 61]) {
      const once = densify(quantize(meridian(0.5123456, 42.1234567, total, total)));
      expect(densify(once)).toEqual(once);
      expect(densify(quantize(once))).toEqual(once);
    }
  });

  it('una línea vacía da una línea vacía', () => {
    expect(densify([])).toEqual([]);
  });
});

describe('prepareLine (D-H2-01)', () => {
  it('es idempotente: lo que sale se guarda, se exporta y se vuelve a importar igual', () => {
    const raw: Position2D[] = [
      [0.5000000049, 42.00000001],
      [0.5000001, 42.000001],
      [0.5, 42.009],
      [0.5001, 42.0095],
      [0.5001001, 42.0095001],
      [0.51, 42.02],
    ];
    const once = prepareLine(raw);
    expect(prepareLine(once)).toEqual(once);
    for (let i = 1; i < once.length; i++) expect(haversineM(once[i - 1]!, once[i]!)).toBeLessThanOrEqual(MAX_SPACING_M + 0.1);
  });
});
