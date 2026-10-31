import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_NOMINATIM_CONTACT, userAgentOf } from '../../src/geo/config.js';
import { GeocodingRateLimitedError, GeocodingUnavailableError } from '../../src/geo/geocoding.js';
import { NominatimGeocoder, SEARCH_VIEWBOX } from '../../src/geo/nominatim.js';
import { SpacedGate } from '../../src/geo/spaced-gate.js';
import { FixedClock } from '../support/clock.js';

beforeAll(() => Logger.overrideLogger(false));

// Recorded answers of Nominatim's jsonv2 format (shape only; the places are made up). No test reaches the Internet.
const TORLA = [
  { place_id: 1, lat: '42.6297', lon: '-0.1', display_name: 'Torla (ficticio), Huesca, Aragón, España', address: { village: 'Torla', country: 'España', country_code: 'es' } },
  { place_id: 2, lat: '42.7333', lon: '-0.0167', display_name: 'Gavarnie (ficticio), France', address: { country_code: 'fr' } },
  { place_id: 3, lat: '1.5', lon: '1.5', display_name: 'Sin país', address: {} },
  { place_id: 4, lat: 'no', lon: '1', display_name: 'Roto' },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Seen {
  url: URL;
  headers: Record<string, string>;
  at: number;
}

/**
 * Virtual time for the gate: `sleep` waits for `drain` to move the clock to its moment, so requests that arrive together
 * really queue and the spacing between them is measured exactly, instantly.
 */
function fakeTime() {
  let now = 1_000_000;
  const timers: { at: number; resolve: () => void }[] = [];
  return {
    now: () => now,
    sleep: (ms: number) => new Promise<void>((resolve) => timers.push({ at: now + ms, resolve })),
    advance: (ms: number) => void (now += ms),
    /** Moves the clock from timer to timer until `work` has settled. */
    async drain(work: Promise<unknown>) {
      let done = false;
      void work.then(
        () => (done = true),
        () => (done = true),
      );
      while (!done) {
        await new Promise((resolve) => setImmediate(resolve));
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        if (next) {
          now = Math.max(now, next.at);
          next.resolve();
        }
      }
      await work.catch(() => undefined);
    },
  };
}

function build(responses: (() => Response | Promise<Response>)[], gateOptions: { intervalMs?: number; maxWaitMs?: number } = {}) {
  const time = fakeTime();
  const clock = new FixedClock(new Date('2026-10-30T10:00:00Z'));
  const seen: Seen[] = [];
  let index = 0;
  const fetchImpl = (async (input: URL, init: RequestInit) => {
    seen.push({ url: input, headers: init.headers as Record<string, string>, at: time.now() });
    const respond = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return respond();
  }) as unknown as typeof fetch;
  const geocoder = new NominatimGeocoder({
    baseUrl: 'https://nominatim.invalid/search',
    userAgent: userAgentOf({}),
    clock,
    fetch: fetchImpl,
    gate: new SpacedGate({ intervalMs: 1000, maxWaitMs: 2000, ...gateOptions, now: time.now, sleep: time.sleep }),
  });
  return { geocoder, seen, clock, time };
}

describe('NominatimGeocoder (doc 04 §9: identified, 1 request/s, cached)', () => {
  it('sends an identified request biased to the Pyrenees without limiting to them, and maps the answer', async () => {
    const { geocoder, seen } = build([() => json(TORLA)]);
    const items = await geocoder.search('  Torla ');
    expect(seen).toHaveLength(1);
    const { url, headers } = seen[0]!;
    expect(headers['user-agent']).toBe('OnWay/0.1 (+https://github.com/CristianAntVal85/OnWay)');
    expect(url.searchParams.get('q')).toBe('Torla');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('addressdetails')).toBe('1');
    const { west, north, east, south } = SEARCH_VIEWBOX;
    expect(url.searchParams.get('viewbox')).toBe(`${west},${north},${east},${south}`);
    expect(url.searchParams.get('bounded')).toBe('0');
    // The country comes from `country_code`; a place with no code has none; an unusable one (bad coordinates) is dropped.
    expect(items).toEqual([
      { label: 'Torla (ficticio), Huesca, Aragón, España', lat: 42.6297, lon: -0.1, country: 'ES' },
      { label: 'Gavarnie (ficticio), France', lat: 42.7333, lon: -0.0167, country: 'FR' },
      { label: 'Sin país', lat: 1.5, lon: 1.5, country: null },
    ]);
  });

  it('caches: the same search, however it is typed, does not go upstream again; it does once the cache expires', async () => {
    const { geocoder, seen, clock, time } = build([() => json(TORLA), () => json(TORLA)]);
    await geocoder.search('Torla');
    await geocoder.search('torla');
    await geocoder.search(' TORLA  ');
    expect(seen).toHaveLength(1);
    clock.advance(24 * 3_600_000 + 1);
    time.advance(24 * 3_600_000 + 1);
    await geocoder.search('Torla');
    expect(seen).toHaveLength(2);
  });

  it('hands out copies, so a caller cannot change what the cache holds', async () => {
    const { geocoder } = build([() => json(TORLA)]);
    const first = await geocoder.search('Torla');
    first[0]!.label = 'changed';
    expect((await geocoder.search('Torla'))[0]!.label).toBe('Torla (ficticio), Huesca, Aragón, España');
  });

  it('sends one request for the same search made by several people at once', async () => {
    const { geocoder, seen } = build([() => json(TORLA)]);
    const [a, b, c] = await Promise.all([geocoder.search('Torla'), geocoder.search('torla'), geocoder.search('Torla')]);
    expect(seen).toHaveLength(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('never sends more than one request per second to the source, however many arrive together', async () => {
    const { geocoder, seen, time } = build([() => json([])]);
    await time.drain(Promise.all(['uno', 'dos', 'tres'].map((q) => geocoder.search(`calle ${q}`))));
    expect(seen).toHaveLength(3);
    const gaps = seen.slice(1).map((s, i) => s.at - seen[i]!.at);
    expect(gaps.every((gap) => gap >= 1000)).toBe(true);
  });

  it('refuses with the seconds to wait when the queue would be too long (RATE_LIMITED), and recovers', async () => {
    const { geocoder, seen, time } = build([() => json([])]);
    const work = Promise.allSettled(['a', 'b', 'c', 'd', 'e'].map((q) => geocoder.search(`calle ${q}`)));
    await time.drain(work);
    const results = await work;
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(refused).toHaveLength(2);
    for (const r of refused) {
      expect(r.reason).toBeInstanceOf(GeocodingRateLimitedError);
      expect((r.reason as GeocodingRateLimitedError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
    expect(seen).toHaveLength(3);
    time.advance(5000);
    await geocoder.search('calle f');
    expect(seen).toHaveLength(4);
  });

  it('a cached answer costs no request from the bucket', async () => {
    const { geocoder, seen } = build([() => json(TORLA)]);
    await geocoder.search('Torla');
    await Promise.all(Array.from({ length: 10 }, () => geocoder.search('torla')));
    expect(seen).toHaveLength(1);
  });

  it('an upstream 503 or 429, a network error or a body that is not a list is "unavailable" and is not cached', async () => {
    const { geocoder, seen, time } = build([
      () => json({ error: 'down' }, 503),
      () => json({}, 429),
      () => Promise.reject(new TypeError('fetch failed')),
      () => json({ not: 'a list' }),
      () => json(TORLA),
    ]);
    for (const attempt of [1, 2, 3, 4]) {
      time.advance(1500);
      await expect(geocoder.search('Torla'), `attempt ${attempt}`).rejects.toBeInstanceOf(GeocodingUnavailableError);
    }
    time.advance(1500);
    expect(await geocoder.search('Torla')).toHaveLength(3);
    expect(seen).toHaveLength(5);
  });

  it('an empty answer is a valid answer (no candidates) and is cached', async () => {
    const { geocoder, seen } = build([() => json([])]);
    expect(await geocoder.search('nada')).toEqual([]);
    expect(await geocoder.search('nada')).toEqual([]);
    expect(seen).toHaveLength(1);
  });
});

describe('SpacedGate', () => {
  it('lets the first request through at once and spaces the next ones', async () => {
    const time = fakeTime();
    const gate = new SpacedGate({ intervalMs: 1000, maxWaitMs: 5000, now: time.now, sleep: time.sleep });
    const start = time.now();
    await gate.acquire();
    expect(time.now() - start).toBe(0);
    await time.drain(gate.acquire());
    expect(time.now() - start).toBe(1000);
    time.advance(5000);
    const before = time.now();
    await gate.acquire();
    expect(time.now() - before).toBe(0);
  });
});

describe('how the application identifies itself to the public services', () => {
  it('names the application with the public page of the project, never a made-up contact (Nominatim answered 403 to example.org)', () => {
    expect(DEFAULT_NOMINATIM_CONTACT).toBe('https://github.com/CristianAntVal85/OnWay');
    expect(userAgentOf({})).toBe('OnWay/0.1 (+https://github.com/CristianAntVal85/OnWay)');
    expect(userAgentOf({ NOMINATIM_CONTACT: '' })).toBe(userAgentOf({}));
    expect(userAgentOf({})).not.toMatch(/example\.org/);
  });

  it('uses the contact of whoever runs the deployment when `NOMINATIM_CONTACT` is set', () => {
    expect(userAgentOf({ NOMINATIM_CONTACT: 'https://rescue.invalid/about' })).toBe('OnWay/0.1 (+https://rescue.invalid/about)');
  });
});

describe('what NominatimGeocoder says when the source cannot be reached', () => {
  it("never carries the search in the error it raises or in the log (it can name a person's address)", async () => {
    const logged: string[] = [];
    const collect = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
    Logger.overrideLogger({ log: collect, warn: collect, error: collect, debug: collect, verbose: collect, fatal: collect });
    let raised = '';
    try {
      const failing = (async (input: URL) => {
        throw new TypeError(`fetch failed: ${input.href}`);
      }) as unknown as typeof fetch;
      const time = new FixedClock(new Date('2026-10-30T10:00:00Z'));
      const geocoder = new NominatimGeocoder({ baseUrl: 'https://nominatim.invalid/search', userAgent: 'OnWay/0.1 (test)', clock: time, fetch: failing });
      await geocoder.search('Calle Mayor 12, Torla').catch((error: Error) => void (raised = `${error.name}: ${error.message}`));
    } finally {
      Logger.overrideLogger(false);
    }
    expect(raised).toMatch(/^GeocodingUnavailableError: geocoder unreachable: TypeError$/);
    for (const needle of ['Calle', 'Mayor', 'Torla', 'nominatim.invalid']) {
      expect(raised, needle).not.toContain(needle);
      expect(logged.join('\n'), needle).not.toContain(needle);
    }
  });
});
