// Cortar una ruta para continuarla a mano (issue-pintar-ruta, D-P7). El corte cae siempre en un vértice de la línea: la línea que
// guarda el servidor está densificada a `MAX_SPACING_M` (30 m), así que el vértice más cercano está a 15 m como mucho del punto
// exacto, y la parte conservada es un trozo de la versión guardada, con sus tramos intactos.
import { haversineM } from './geometry.js';

/** Dónde cae un punto sobre una línea: el vértice más cercano, su distancia desde el inicio y lo lejos que queda el punto. */
export interface LineCut {
  /** Índice del vértice de la línea más cercano al punto. */
  index: number;
  /** Ese vértice, `[lon, lat]`. */
  point: [lon: number, lat: number];
  /** Metros recorridos por la línea desde el inicio hasta el vértice. */
  distanceM: number;
  /** Metros en línea recta entre el punto pedido y el vértice. */
  offsetM: number;
}

/** Distancia acumulada en metros en cada vértice de la línea (la del primero es 0). */
export function cumulativeM(line: readonly (readonly number[])[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) total += haversineM(line[i - 1]!, line[i]!);
    out.push(total);
  }
  return out;
}

const cutOf = (line: readonly (readonly number[])[], along: readonly number[], index: number, offsetM: number): LineCut => ({
  index,
  point: [line[index]![0]!, line[index]![1]!],
  distanceM: along[index]!,
  offsetM,
});

/** El vértice de la línea más cercano a `point`. Con empate, el primero. La línea necesita al menos un vértice. */
export function projectOnLine(line: readonly (readonly number[])[], point: readonly number[]): LineCut {
  if (line.length === 0) throw new RangeError('projectOnLine needs a line with at least one vertex');
  let best = 0;
  let bestM = Infinity;
  for (let i = 0; i < line.length; i++) {
    const metres = haversineM(line[i]!, point);
    if (metres < bestM) {
      best = i;
      bestM = metres;
    }
  }
  return cutOf(line, cumulativeM(line), best, bestM);
}

/**
 * El vértice cuya distancia desde el inicio está más cerca de `distanceM` (el campo «Conservar los primeros N km»). Por debajo de 0
 * da el inicio y por encima de la longitud, el final.
 */
export function pointAtDistance(line: readonly (readonly number[])[], distanceM: number): LineCut {
  if (line.length === 0) throw new RangeError('pointAtDistance needs a line with at least one vertex');
  const along = cumulativeM(line);
  let best = 0;
  for (let i = 1; i < along.length; i++) if (Math.abs(along[i]! - distanceM) < Math.abs(along[best]! - distanceM)) best = i;
  return cutOf(line, along, best, 0);
}

/** Los vértices de la línea desde el inicio hasta `index`, incluido. */
export function cutAt<T>(line: readonly T[], index: number): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= line.length) throw new RangeError(`cutAt index ${index} is outside the line`);
  return line.slice(0, index + 1);
}
