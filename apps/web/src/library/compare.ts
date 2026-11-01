// Diferencias entre las métricas de dos versiones, para la tabla de comparar. Puro.
import type { OperationOutput } from '@onway/contracts/client';

export type Metrics = OperationOutput<'getRouteVersion'>['metrics'];
export type MetricKey = keyof Metrics;

export const METRIC_KEYS: readonly MetricKey[] = ['distanceM', 'ascentM', 'descentM', 'minElevationM', 'maxElevationM', 'maxSlopePct'];

/** Diferencia B − A redondeada a un decimal (como se guardan las métricas), sin −0. */
export function difference(a: Metrics, b: Metrics, key: MetricKey): number {
  const value = Math.round((b[key] - a[key]) * 10) / 10;
  return value === 0 ? 0 : value;
}
