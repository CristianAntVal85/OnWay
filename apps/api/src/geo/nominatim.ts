import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Clock } from '../clock/clock.js';
import { GeocodingUnavailableError, type GeocodingCandidate, type GeocodingProvider } from './geocoding.js';
import { SpacedGate } from './spaced-gate.js';

/** The box the Pyrenees demo works in, used to bias (not to limit) the search: west, north, east, south. */
export const SEARCH_VIEWBOX = { west: -2, north: 44, east: 4, south: 42 } as const;

const Place = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  display_name: z.string().min(1),
  address: z.object({ country_code: z.string().optional() }).optional(),
});
const Answer = z.array(z.unknown());

export interface NominatimOptions {
  /** `https://nominatim.openstreetmap.org/search` by default. */
  baseUrl: string;
  /** Required by the usage policy: it names the application and a way to contact it. */
  userAgent: string;
  clock: Clock;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** How long a result is kept (the policy asks for caching). */
  cacheTtlMs?: number;
  cacheSize?: number;
  gate?: SpacedGate;
}

interface Cached {
  items: GeocodingCandidate[];
  expiresAt: number;
}

const normalize = (query: string) => query.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * `GeocodingProvider` over the public Nominatim (doc 04 §9): identified `User-Agent`, at most one request per second for the
 * whole API (`SpacedGate`), cache with expiry, one request in flight per query, bias towards the Pyrenees without
 * restricting to them, `country` from `country_code`. Errors are never cached.
 */
export class NominatimGeocoder implements GeocodingProvider {
  private readonly logger = new Logger(NominatimGeocoder.name);
  private readonly cache = new Map<string, Cached>();
  private readonly inFlight = new Map<string, Promise<GeocodingCandidate[]>>();
  private readonly gate: SpacedGate;

  constructor(private readonly options: NominatimOptions) {
    this.gate = options.gate ?? new SpacedGate({ intervalMs: 1000, maxWaitMs: 2000 });
  }

  async search(query: string): Promise<GeocodingCandidate[]> {
    const key = normalize(query);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.options.clock.now().getTime()) return cached.items.map((item) => ({ ...item }));
    this.cache.delete(key);

    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.request(query.trim(), key).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return (await pending).map((item) => ({ ...item }));
  }

  private async request(query: string, key: string): Promise<GeocodingCandidate[]> {
    await this.gate.acquire();
    const { west, north, east, south } = SEARCH_VIEWBOX;
    const url = new URL(this.options.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '5');
    url.searchParams.set('viewbox', `${west},${north},${east},${south}`);
    url.searchParams.set('bounded', '0');

    let body: unknown;
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        headers: { 'user-agent': this.options.userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8000),
      });
      if (!response.ok) {
        // The status only, never the query (it can name a person's address). A 403 here usually means the service rejected our User-Agent (a made-up contact was): see DEFAULT_NOMINATIM_CONTACT.
        this.logger.warn(`geocoder answered ${response.status}`);
        throw new GeocodingUnavailableError(`geocoder answered ${response.status}`);
      }
      body = await response.json();
    } catch (error) {
      if (error instanceof GeocodingUnavailableError) throw error;
      // The error's name only: its message can carry the URL, and the URL carries the search (it can name a person's address).
      throw new GeocodingUnavailableError(`geocoder unreachable: ${error instanceof Error ? error.name : 'error'}`);
    }

    const list = Answer.safeParse(body);
    if (!list.success) throw new GeocodingUnavailableError('geocoder answered something that is not a list');
    const items: GeocodingCandidate[] = [];
    for (const raw of list.data) {
      const place = Place.safeParse(raw);
      if (!place.success) continue;
      const code = place.data.address?.country_code?.toUpperCase();
      items.push({ label: place.data.display_name, lat: place.data.lat, lon: place.data.lon, country: code && /^[A-Z]{2}$/.test(code) ? code : null });
    }

    this.remember(key, items);
    return items;
  }

  private remember(key: string, items: GeocodingCandidate[]): void {
    this.cache.set(key, { items, expiresAt: this.options.clock.now().getTime() + (this.options.cacheTtlMs ?? 24 * 3_600_000) });
    if (this.cache.size > (this.options.cacheSize ?? 500)) this.cache.delete(this.cache.keys().next().value as string);
  }
}
