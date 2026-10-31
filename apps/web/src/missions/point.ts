import type { OperationInput } from '@onway/contracts/client';

/** Tipo de un punto de la misión: origen, intermedio obligatorio o de reunión. */
export type PointKind = OperationInput<'createMissionPoint'>['body']['kind'];

/** Un punto ya elegido, sea cual sea la forma de entrada (RF-401): mismas coordenadas, mismo objeto. */
export interface PickedPoint {
  lat: number;
  lon: number;
  source: 'coordinates' | 'map' | 'address';
  /** Solo con dirección: el texto elegido en la lista de candidatos. */
  label?: string;
  country?: string;
}

/** `target` de `createMission`: las coordenadas ya resueltas; la altitud la pone el servidor (RN-07). */
export function toTarget(point: PickedPoint): OperationInput<'createMission'>['body']['target'] {
  return {
    source: point.source,
    lat: point.lat,
    lon: point.lon,
    ...(point.label ? { label: point.label } : {}),
    ...(point.country ? { country: point.country } : {}),
  };
}
