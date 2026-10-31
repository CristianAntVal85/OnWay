// Celda de ~1 km para lo que no debe quedar a más precisión que eso: la ubicación del dispositivo (RF-708, INV-30)
// y la clave de la caché del tiempo (doc 05: celda de 0,01° y banda de altitud de 100 m).

export interface LatLon {
  lat: number;
  lon: number;
}

/** Lado de la celda en grados: 0,01° son ~1,1 km en latitud y ~0,8 km en longitud en los Pirineos. */
export const CELL_DEGREES = 0.01;

/** Alto de la banda de altitud de la caché del tiempo, en metros. */
export const ELEVATION_BAND_M = 100;

const round = (value: number): number => {
  const rounded = Math.round(value / CELL_DEGREES) * CELL_DEGREES;
  // `n * 0.01` arrastra ruido de coma flotante (42.63 saldría 42.629999…): se vuelve al decimal más cercano de dos cifras.
  const clean = Number(rounded.toFixed(2));
  return Object.is(clean, -0) ? 0 : clean;
};

/**
 * Redondea un punto a la celda de ~1 km. Es idempotente: redondear lo ya redondeado no cambia nada, así que el cliente
 * redondea antes de enviar y el servidor vuelve a redondear sin que importe cuál de los dos lo hace primero (D-H1-10).
 */
export function roundToCell(point: LatLon): LatLon {
  return { lat: round(point.lat), lon: round(point.lon) };
}

/** Banda de altitud (múltiplo de 100 m) a la que pertenece una altitud en metros. */
export function elevationBand(elevationM: number): number {
  const band = Math.round(elevationM / ELEVATION_BAND_M) * ELEVATION_BAND_M;
  return Object.is(band, -0) ? 0 : band;
}
