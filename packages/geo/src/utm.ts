// UTM sobre WGS84 por la serie de Krüger (Karney 2011, hasta n^4: error de milímetros dentro de la zona).
// Solo la conversión; la lectura y el formato de texto viven en `coordinates.ts`.
import type { LatLon } from './cell.js';

const A = 6378137; // semieje mayor WGS84, m
const F = 1 / 298.257223563;
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING_SOUTH = 10000000;

const N = F / (2 - F);
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;
const RECTIFYING = (A / (1 + N)) * (1 + N2 / 4 + N4 / 64);

const ALPHA = [N / 2 - (2 / 3) * N2 + (5 / 16) * N3 + (41 / 180) * N4, (13 / 48) * N2 - (3 / 5) * N3 + (557 / 1440) * N4, (61 / 240) * N3 - (103 / 140) * N4, (49561 / 161280) * N4] as const;
const BETA = [N / 2 - (2 / 3) * N2 + (37 / 96) * N3 - (1 / 360) * N4, (1 / 48) * N2 + (1 / 15) * N3 - (437 / 1440) * N4, (17 / 480) * N3 - (37 / 840) * N4, (4397 / 161280) * N4] as const;
const DELTA = [2 * N - (2 / 3) * N2 - 2 * N3 + (116 / 45) * N4, (7 / 3) * N2 - (8 / 5) * N3 - (227 / 45) * N4, (56 / 15) * N3 - (136 / 35) * N4, (4279 / 630) * N4] as const;

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const toRad = (degrees: number) => (degrees * Math.PI) / 180;
const toDeg = (radians: number) => (radians * 180) / Math.PI;

export interface Utm {
  zone: number;
  /** Letra de banda de latitud (C–X, sin I ni O). */
  band: string;
  /** Metros hacia el este desde el falso origen de la zona (500 000 en el meridiano central). */
  easting: number;
  /** Metros hacia el norte desde el ecuador (con el falso origen de 10 000 000 al sur). */
  northing: number;
}

/** Límites de la proyección: UTM no se define en los polos. */
export const UTM_MIN_LAT = -80;
export const UTM_MAX_LAT = 84;

export function utmZoneOf(lon: number): number {
  const zone = Math.floor((lon + 180) / 6) + 1;
  return Math.min(60, Math.max(1, zone));
}

export function utmBandOf(lat: number): string {
  const index = Math.floor((lat + 80) / 8);
  return BANDS[Math.min(BANDS.length - 1, Math.max(0, index))]!;
}

const centralMeridian = (zone: number) => (zone - 1) * 6 - 180 + 3;

/** WGS84 a UTM en la zona estándar del punto, o `null` fuera de −80°…84° de latitud. */
export function toUtm(point: LatLon, zone: number = utmZoneOf(point.lon)): Utm | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || point.lat < UTM_MIN_LAT || point.lat > UTM_MAX_LAT) return null;
  const phi = toRad(point.lat);
  const lambda = toRad(point.lon - centralMeridian(zone));
  const k = (2 * Math.sqrt(N)) / (1 + N);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - k * Math.atanh(k * Math.sin(phi)));
  const xiP = Math.atan2(t, Math.cos(lambda));
  const etaP = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  ALPHA.forEach((alpha, index) => {
    const j = 2 * (index + 1);
    xi += alpha * Math.sin(j * xiP) * Math.cosh(j * etaP);
    eta += alpha * Math.cos(j * xiP) * Math.sinh(j * etaP);
  });
  const northing = K0 * RECTIFYING * xi + (point.lat < 0 ? FALSE_NORTHING_SOUTH : 0);
  return { zone, band: utmBandOf(point.lat), easting: FALSE_EASTING + K0 * RECTIFYING * eta, northing };
}

/** UTM a WGS84. `south` indica el hemisferio sur (falso origen de 10 000 000 m); la banda lo decide si se omite. */
export function fromUtm(utm: { zone: number; easting: number; northing: number; band?: string; south?: boolean }): LatLon {
  const south = utm.south ?? (utm.band !== undefined && utm.band.toUpperCase() < 'N');
  const xi = (utm.northing - (south ? FALSE_NORTHING_SOUTH : 0)) / (K0 * RECTIFYING);
  const eta = (utm.easting - FALSE_EASTING) / (K0 * RECTIFYING);
  let xiP = xi;
  let etaP = eta;
  BETA.forEach((beta, index) => {
    const j = 2 * (index + 1);
    xiP -= beta * Math.sin(j * xi) * Math.cosh(j * eta);
    etaP -= beta * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  DELTA.forEach((delta, index) => {
    phi += delta * Math.sin(2 * (index + 1) * chi);
  });
  const lambda = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return { lat: toDeg(phi), lon: centralMeridian(utm.zone) + toDeg(lambda) };
}
