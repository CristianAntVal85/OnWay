import type { OperationOutput } from '@onway/contracts/client';
import type { MapRoute } from '../map';

export type MissionRouteRow = OperationOutput<'listMissionRoutes'>['items'][number];

/**
 * Cómo se pinta una ruta de la misión: lo que la persona debe distinguir de un vistazo. Una ruta no disponible va apagada (punteada); después
 * manda el borrador (el rescatista no lo ve), luego la validación antigua y, si no, la validada. Además del color cambia el trazo (doc 04 §8).
 */
export function toneOf(row: MissionRouteRow): MapRoute['tone'] {
  if (row.status === 'unavailable') return 'archived';
  if (row.pinned.status === 'draft') return 'draft';
  return row.validationIsStale ? 'stale' : 'validated';
}

/** Las líneas de la tabla para el mapa: ya vienen simplificadas del servidor (`previewGeometry`), aquí no se calcula nada. */
export function mapRoutesOf(rows: readonly MissionRouteRow[]): MapRoute[] {
  return rows.map((row) => ({ id: row.id, name: row.name, tone: toneOf(row), line: row.previewGeometry.coordinates }));
}

export type MyMissionRouteRow = OperationOutput<'listMyMissionRoutes'>['items'][number];

/** Lo mismo para el rescatista: una ruta no disponible va apagada, una validación antigua señalada y el resto como validada (no ve borradores, INV-05). */
export function mapRoutesOfRescuer(rows: readonly MyMissionRouteRow[]): MapRoute[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tone: row.status === 'unavailable' ? ('archived' as const) : row.validationIsStale ? ('stale' as const) : ('validated' as const),
    line: row.previewGeometry.coordinates,
  }));
}
