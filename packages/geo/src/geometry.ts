// Geometría de trazados (RF-510, RN-10): distancia, depuración y densificado. Todo en 2D y en grados WGS84,
// con posiciones GeoJSON `[lon, lat]`. La altitud no se toca aquí: la pone el servidor con su modelo de elevación.

export type Position2D = [lon: number, lat: number];
export type Position3D = [lon: number, lat: number, elevation: number];

/** Radio medio de la Tierra (IUGG), en metros. */
export const EARTH_RADIUS_M = 6371008.8;

/**
 * Separación mínima entre vértices tras `thin`. Un GPS parado o lento deja decenas de puntos casi iguales (ruido de
 * posición de varios metros): se descartan los que quedan a menos de esto del último conservado (R-07).
 */
export const MIN_SPACING_M = 5;

/**
 * Separación máxima entre vértices tras `densify`: la resolución del modelo de elevación (GLO-30, 30 m). Con más
 * paso, un trazado dibujado a mano con tres puntos no vería el relieve que cruza.
 */
export const MAX_SPACING_M = 30;

/** Decimales de las coordenadas guardadas: 1e-7° son ~1 cm. Es también lo que se escribe en GPX y KML. */
export const COORDINATE_DECIMALS = 7;

/**
 * Margen con el que `densify` decide que un tramo es demasiado largo. Debe ser mayor que lo que cambia la longitud de
 * un tramo al redondear a `COORDINATE_DECIMALS` (~2 cm), para que `densify` sea idempotente tras exportar e importar.
 */
const DENSIFY_TOLERANCE_M = 0.1;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Distancia horizontal en metros entre dos posiciones (fórmula del haversine). */
export function haversineM(a: readonly number[], b: readonly number[]): number {
  const lat1 = toRadians(a[1]!);
  const lat2 = toRadians(b[1]!);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b[0]! - a[0]!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longitud horizontal de la línea, en metros. */
export function lengthM(line: readonly (readonly number[])[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineM(line[i - 1]!, line[i]!);
  return total;
}

const quantizeValue = (value: number): number => {
  const rounded = Number(value.toFixed(COORDINATE_DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Lleva cada coordenada a `COORDINATE_DECIMALS` decimales. Idempotente. */
export function quantize(line: readonly (readonly number[])[]): Position2D[] {
  return line.map((position) => [quantizeValue(position[0]!), quantizeValue(position[1]!)]);
}

/**
 * Descarta los vértices intermedios a menos de `minSpacingM` del último conservado. El primero y el último se
 * conservan siempre (el destino de una ruta no se mueve). Idempotente: lo que queda ya cumple la regla.
 */
export function thin(line: readonly Position2D[], minSpacingM: number = MIN_SPACING_M): Position2D[] {
  if (line.length <= 2) return line.map((position) => [position[0], position[1]]);
  const kept: Position2D[] = [line[0]!];
  for (let i = 1; i < line.length - 1; i++) {
    const position = line[i]!;
    if (haversineM(kept[kept.length - 1]!, position) >= minSpacingM) kept.push(position);
  }
  kept.push(line[line.length - 1]!);
  return kept;
}

/**
 * Inserta vértices, repartidos de forma uniforme, en los tramos más largos que `maxSpacingM`. Idempotente, también
 * tras redondear las coordenadas a `COORDINATE_DECIMALS` (ver `DENSIFY_TOLERANCE_M`). Los vértices que ya había no se
 * mueven. Los nuevos se interpolan en grados, que a estas distancias es indistinguible del círculo máximo.
 */
export function densify(line: readonly Position2D[], maxSpacingM: number = MAX_SPACING_M): Position2D[] {
  if (line.length === 0) return [];
  const out: Position2D[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const from = line[i - 1]!;
    const to = line[i]!;
    const distance = haversineM(from, to);
    if (distance > maxSpacingM + DENSIFY_TOLERANCE_M) {
      const parts = Math.ceil(distance / maxSpacingM);
      for (let k = 1; k < parts; k++) {
        const t = k / parts;
        out.push([quantizeValue(from[0] + (to[0] - from[0]) * t), quantizeValue(from[1] + (to[1] - from[1]) * t)]);
      }
    }
    out.push(to);
  }
  return out;
}

/**
 * Lo que el servidor hace con cualquier trazado antes de medirlo (D-H2-01): redondear, depurar y densificar. Lo que
 * sale es lo que se guarda, se exporta y se vuelve a importar sin cambios.
 */
export function prepareLine(line: readonly (readonly number[])[]): Position2D[] {
  return densify(thin(quantize(line)));
}
