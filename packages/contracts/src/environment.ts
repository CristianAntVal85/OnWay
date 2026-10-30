// Geocodificación, altitud, y entorno (tiempo, luz, luna). Documento 02, §3.2 y doc 04 (límites de proveedores externos).
import { z } from 'zod';
import { CountryCode, Elevation, GeoPoint, Id, Lat, LatLon, Lon, QueryLat, QueryLon, Timestamp } from './common.js';

// ---------- Búsqueda de dirección: solo al pulsar buscar, nunca al teclear ----------
export const GeocodeQuery = z.strictObject({ q: z.string().trim().min(3).max(200) });
export const GeocodeCandidate = z.strictObject({
  label: z.string(),
  lat: Lat,
  lon: Lon,
  country: CountryCode.nullable(),
});
export const GeocodeResponse = z.strictObject({ items: z.array(GeocodeCandidate).max(10) });

export const ElevationQuery = z.strictObject({ lat: QueryLat, lon: QueryLon });
export const ElevationResponse = GeoPoint;

// ---------- Entorno ----------
/**
 * La posición del dispositivo no se guarda (RN-26): el servidor la redondea a ~1 km, la usa para esta consulta y no la registra.
 * `missionId` sustituye a lat/lon: el entorno del objetivo de esa misión.
 */
export const EnvironmentQuery = z
  .strictObject({
    lat: QueryLat.optional(),
    lon: QueryLon.optional(),
    missionId: Id.optional(),
    days: z.coerce.number().int().min(1).max(7).default(3),
  })
  .refine((q) => !!q.missionId !== (q.lat !== undefined && q.lon !== undefined), 'Indica missionId o lat y lon, no ambos');

export const WeatherPoint = z.strictObject({
  time: Timestamp,
  temperatureC: z.number(),
  windSpeedKmh: z.number().min(0),
  windGustKmh: z.number().min(0).nullable(),
  precipitationMm: z.number().min(0),
  snowfallCm: z.number().min(0).nullable(),
  cloudCoverPct: z.number().min(0).max(100),
  freezingLevelM: z.number().nullable(), // isoterma de 0 °C si hay dato
});
export const WeatherDay = z.strictObject({
  date: z.iso.date(),
  minC: z.number(),
  maxC: z.number(),
  maxWindGustKmh: z.number().min(0).nullable(),
  precipitationMm: z.number().min(0),
  snowfallCm: z.number().min(0).nullable(),
});
/** `stale` = último dato guardado con su hora; `unavailable` = sin dato. El resto del inicio sigue funcionando. */
export const WeatherBlock = z.strictObject({
  status: z.enum(['ok', 'stale', 'unavailable']),
  provider: z.string().nullable(),
  fetchedAt: Timestamp.nullable(),
  current: WeatherPoint.nullable(),
  hourly: z.array(WeatherPoint).max(24 * 7),
  daily: z.array(WeatherDay).max(7),
});

const Instant = Timestamp.nullable(); // null en latitudes donde el hecho no ocurre ese día
export const SunBlock = z.strictObject({
  date: z.iso.date(),
  sunrise: Instant,
  sunset: Instant,
  civilDawn: Instant,
  civilDusk: Instant,
  nauticalDawn: Instant,
  nauticalDusk: Instant,
});
export const MoonBlock = z.strictObject({
  phaseName: z.enum(['new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous', 'full', 'waning_gibbous', 'last_quarter', 'waning_crescent']),
  illuminationPct: z.number().min(0).max(100),
  moonrise: Instant,
  moonset: Instant,
});
export const Bulletin = z.strictObject({
  provider: z.enum(['aemet', 'meteofrance']),
  kind: z.enum(['mountain_forecast', 'avalanche']),
  title: z.string(),
  url: z.url(),
});

export const EnvironmentResponse = z.strictObject({
  /** Qué ubicación se ha usado: la del dispositivo o el objetivo de una misión. */
  basis: z.enum(['device', 'mission']),
  missionId: Id.nullable(),
  location: z.strictObject({ lat: LatLon.shape.lat, lon: LatLon.shape.lon, elevationM: Elevation, country: CountryCode.nullable() }),
  weather: WeatherBlock,
  sun: SunBlock,
  moon: MoonBlock,
  bulletins: z.array(Bulletin),
});
