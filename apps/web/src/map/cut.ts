// Corte de una ruta para continuarla a mano (issue-pintar-ruta, D-P7): la vista previa de lo que se conserva. La geometría viene de
// `@onway/geo` (regla 9), la misma que usa el servidor; lo que vale es lo que el servidor guarda.
import { cumulativeM, pointAtDistance, projectOnLine } from '@onway/geo';
import type { Vertex } from './edit.js';

/** Lo más lejos de la ruta que puede caer el corte; el servidor aplica el mismo límite. */
export const MAX_CUT_OFFSET_M = 200;

/** Metros desde el inicio en cada vértice. */
export const alongRoute = (line: readonly Vertex[]): number[] => cumulativeM(line);

/** El vértice donde corta un toque en el mapa, o `null` si cae lejos de la ruta o en su inicio (no conservaría nada). */
export function cutAtPoint(line: readonly Vertex[], point: { lat: number; lon: number }): number | null {
  if (line.length === 0) return null;
  const cut = projectOnLine(line, [point.lon, point.lat]);
  return cut.offsetM > MAX_CUT_OFFSET_M || cut.index === 0 ? null : cut.index;
}

/** El vértice que conserva unos `distanceM` metros desde el inicio, o `null` si no conservaría nada. */
export function cutAtDistance(line: readonly Vertex[], distanceM: number): number | null {
  if (line.length === 0) return null;
  const cut = pointAtDistance(line, distanceM);
  return cut.index === 0 ? null : cut.index;
}
