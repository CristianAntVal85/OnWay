import type { Clock } from '../clock/clock.js';
import { CompositeElevationProvider } from './composite-elevation.js';
import { DemElevationProvider } from './dem-elevation.js';
import type { ElevationProvider } from './elevation.js';
import type { GeocodingProvider } from './geocoding.js';
import { NominatimGeocoder } from './nominatim.js';
import { OpenMeteoElevationProvider } from './open-meteo-elevation.js';

type Env = Record<string, string | undefined>;

/** Where the sources are. Every URL comes from the configuration (D-H1-15): the end-to-end stack points them at `providers-stub`. */
export const DEFAULT_OPEN_METEO_ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
export const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
/** A made-up contact on `example.org` (R-10). Whoever runs a real deployment sets `NOMINATIM_CONTACT` to their own. */
export const DEFAULT_NOMINATIM_CONTACT = 'onway-demo@example.org';

const userAgentOf = (env: Env) => `OnWay/0.1 (portfolio demo; contact: ${env.NOMINATIM_CONTACT || DEFAULT_NOMINATIM_CONTACT})`;

export interface ElevationEnvOptions {
  /** `false` for jobs that must not reach the Internet (the seed): only the local DEM answers. */
  remote?: boolean;
}

/**
 * The real `ElevationProvider` (P1-A): the Copernicus GLO-30 tiles in `ELEVATION_DEM_DIR` and, outside them, Open-Meteo's
 * elevation API at `OPEN_METEO_ELEVATION_URL`. With neither configured the result is an empty composite: every point is `null`.
 */
export function createElevationProvider(env: Env = process.env, options: ElevationEnvOptions = {}): ElevationProvider {
  const sources: ElevationProvider[] = [];
  if (env.ELEVATION_DEM_DIR) sources.push(new DemElevationProvider(env.ELEVATION_DEM_DIR));
  if (options.remote !== false) sources.push(new OpenMeteoElevationProvider({ baseUrl: env.OPEN_METEO_ELEVATION_URL || DEFAULT_OPEN_METEO_ELEVATION_URL, userAgent: userAgentOf(env) }));
  return new CompositeElevationProvider(sources);
}

/** The real `GeocodingProvider`: Nominatim at `NOMINATIM_URL`, identified with `NOMINATIM_CONTACT`. */
export function createGeocodingProvider(clock: Clock, env: Env = process.env): GeocodingProvider {
  return new NominatimGeocoder({ baseUrl: env.NOMINATIM_URL || DEFAULT_NOMINATIM_URL, userAgent: userAgentOf(env), clock });
}
