/** A place found by an address search, as the port hands it over (no ids, no personal data). */
export interface GeocodingCandidate {
  label: string;
  lat: number;
  lon: number;
  /** ISO 3166-1 alpha-2 in capitals, when the source says it. */
  country: string | null;
}

/** The source is down, slow or answered something we cannot use. The caller answers `UPSTREAM_UNAVAILABLE`. */
export class GeocodingUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'GeocodingUnavailableError';
  }
}

/** The 1 request per second allowed towards the source is used up. The caller answers `RATE_LIMITED`. */
export class GeocodingRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`geocoding is rate limited; retry in ${retryAfterSeconds} s`);
    this.name = 'GeocodingRateLimitedError';
  }
}

/**
 * Port `GeocodingProvider` (doc 04 §5.2): address to coordinates. It is called only when the user presses Search, never
 * while typing (doc 04 §9, D-H1-16). Throws `GeocodingUnavailableError` or `GeocodingRateLimitedError`.
 */
export interface GeocodingProvider {
  search(query: string): Promise<GeocodingCandidate[]>;
}

/** Injection token, as `CLOCK` and `ELEVATION_PROVIDER` are. */
export const GEOCODING_PROVIDER = Symbol('GEOCODING_PROVIDER');

/** Test implementation: a fixed list of places that match by substring, no network. */
export class InMemoryGeocodingProvider implements GeocodingProvider {
  readonly queries: string[] = [];
  constructor(private readonly places: readonly (GeocodingCandidate & { match: string })[] = DEFAULT_PLACES) {}

  async search(query: string): Promise<GeocodingCandidate[]> {
    this.queries.push(query);
    const needle = query.toLowerCase();
    return this.places.filter((p) => p.match.toLowerCase().includes(needle)).map(({ match: _match, ...place }) => place);
  }
}

const DEFAULT_PLACES = [
  { match: 'torla', label: 'Torla-Ordesa, Huesca, Aragón, España', lat: 42.6297, lon: -0.1, country: 'ES' },
  { match: 'gavarnie', label: 'Gavarnie-Gèdre, Hautes-Pyrénées, Occitanie, France', lat: 42.7333, lon: -0.0167, country: 'FR' },
];
