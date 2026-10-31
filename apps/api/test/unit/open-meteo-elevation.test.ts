import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { CompositeElevationProvider } from '../../src/geo/composite-elevation.js';
import type { ElevationProvider } from '../../src/geo/elevation.js';
import { OpenMeteoElevationProvider } from '../../src/geo/open-meteo-elevation.js';

beforeAll(() => Logger.overrideLogger(false));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const BASE = 'https://elevation.invalid/v1/elevation';

describe('OpenMeteoElevationProvider (outside the downloaded box, P1-A)', () => {
  it('asks for latitude and longitude and returns the altitude rounded to a decimetre', async () => {
    const calls: URL[] = [];
    const agents: unknown[] = [];
    const provider = new OpenMeteoElevationProvider({
      baseUrl: BASE,
      userAgent: 'OnWay/0.1 (test)',
      fetch: (async (input: URL, init: RequestInit) => (
        calls.push(input),
        agents.push((init.headers as Record<string, string>)['user-agent']),
        json({ elevation: [345.04] })
      )) as unknown as typeof fetch,
    });
    expect(await provider.elevationAt({ lat: 45.12, lon: 3.5 })).toBe(345);
    expect(calls).toHaveLength(1);
    expect(agents).toEqual(['OnWay/0.1 (test)']);
    expect(calls[0]!.origin + calls[0]!.pathname).toBe(BASE);
    expect(calls[0]!.searchParams.get('latitude')).toBe('45.12');
    expect(calls[0]!.searchParams.get('longitude')).toBe('3.5');
  });

  it('keeps the answer for points a few metres apart, so a moving cursor does not spend the daily quota (R-09)', async () => {
    const fetchSpy = vi.fn(async () => json({ elevation: [812.3] }));
    const provider = new OpenMeteoElevationProvider({ baseUrl: BASE, fetch: fetchSpy as unknown as typeof fetch });
    expect(await provider.elevationAt({ lat: 45.1234, lon: 3.5 })).toBe(812.3);
    expect(await provider.elevationAt({ lat: 45.12342, lon: 3.500001 })).toBe(812.3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await provider.elevationAt({ lat: 45.2, lon: 3.5 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('is null, never a guess, when the source fails: a 503, a network error, no value or something else', async () => {
    const attempt = (fetchImpl: unknown) => new OpenMeteoElevationProvider({ baseUrl: BASE, fetch: fetchImpl as typeof fetch }).elevationAt({ lat: 45, lon: 3 });
    expect(await attempt(async () => json({ reason: 'down' }, 503))).toBeNull();
    expect(await attempt(async () => Promise.reject(new TypeError('fetch failed')))).toBeNull();
    expect(await attempt(async () => json({ elevation: [null] }))).toBeNull();
    expect(await attempt(async () => json({ elevation: [] }))).toBeNull();
    expect(await attempt(async () => json({ other: 1 }))).toBeNull();
    expect(await attempt(async () => new Response('<html>', { status: 200 }))).toBeNull();
  });
});

describe('CompositeElevationProvider', () => {
  const answering = (metres: number | null): ElevationProvider & { calls: number } => ({
    calls: 0,
    async elevationAt() {
      this.calls += 1;
      return metres;
    },
    async elevationsAt(points) {
      this.calls += 1;
      return points.map(() => metres);
    },
  });

  it('answers with the first source that has the point and does not ask the rest', async () => {
    const local = answering(1200);
    const remote = answering(900);
    expect(await new CompositeElevationProvider([local, remote]).elevationAt({ lat: 1, lon: 1 })).toBe(1200);
    expect(remote.calls).toBe(0);
  });

  it('falls back to the next source, and is null only when none has the point (OUTSIDE_COVERAGE)', async () => {
    expect(await new CompositeElevationProvider([answering(null), answering(900)]).elevationAt({ lat: 1, lon: 1 })).toBe(900);
    expect(await new CompositeElevationProvider([answering(null), answering(null)]).elevationAt({ lat: 1, lon: 1 })).toBeNull();
    expect(await new CompositeElevationProvider([]).elevationAt({ lat: 1, lon: 1 })).toBeNull();
  });
});

describe('what OpenMeteoElevationProvider writes to the log', () => {
  it('never carries the point asked for when the source cannot be reached', async () => {
    const logged: string[] = [];
    const collect = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
    Logger.overrideLogger({ log: collect, warn: collect, error: collect, debug: collect, verbose: collect, fatal: collect });
    try {
      // The kind of error a network failure raises: its message names the URL, and the URL names the point.
      const failing = (async (input: URL) => {
        throw new TypeError(`fetch failed: ${input.href}`);
      }) as unknown as typeof fetch;
      const provider = new OpenMeteoElevationProvider({ baseUrl: BASE, fetch: failing });
      expect(await provider.elevationAt({ lat: 42.123456, lon: -0.654321 })).toBeNull();
    } finally {
      Logger.overrideLogger(false);
    }
    const text = logged.join('\n');
    expect(text).toMatch(/elevation source unreachable: TypeError/); // the capture works and the warning is there
    for (const needle of ['42.123456', '-0.654321', 'latitude', 'longitude', 'elevation.invalid']) expect(text, needle).not.toContain(needle);
  });
});

describe('OpenMeteoElevationProvider.elevationsAt: batches (H2-T4)', () => {
  const answerFor = (url: URL) => {
    const lats = url.searchParams.get('latitude')!.split(',');
    return Response.json({ elevation: lats.map((lat) => Math.round(Number(lat) * 10) / 10) });
  };

  it('asks 100 points per request, keeps the order and does not repeat the points it already has', async () => {
    const urls: URL[] = [];
    const fetchImpl = async (url: URL) => {
      urls.push(new URL(url));
      return answerFor(new URL(url));
    };
    const provider = new OpenMeteoElevationProvider({ baseUrl: BASE, fetch: fetchImpl as unknown as typeof fetch });
    const points = Array.from({ length: 250 }, (_, i) => ({ lat: 40 + i * 0.01, lon: 3 }));
    const first = await provider.elevationsAt(points);
    expect(urls).toHaveLength(3);
    expect(urls.map((u) => u.searchParams.get('latitude')!.split(',').length)).toEqual([100, 100, 50]);
    expect(first).toEqual(points.map((p) => Math.round(p.lat * 10) / 10));
    await provider.elevationsAt(points.slice(0, 40));
    expect(urls).toHaveLength(3);
  });

  it('asks once for points that repeat', async () => {
    let asked = 0;
    const provider = new OpenMeteoElevationProvider({
      baseUrl: BASE,
      fetch: (async (url: URL) => {
        asked += new URL(url).searchParams.get('latitude')!.split(',').length;
        return answerFor(new URL(url));
      }) as unknown as typeof fetch,
    });
    await provider.elevationsAt([
      { lat: 41, lon: 2 },
      { lat: 41, lon: 2 },
      { lat: 41.00001, lon: 2 },
    ]);
    expect(asked).toBe(1);
  });

  it('sends nothing and answers null when the request is over the limit of remote points', async () => {
    let calls = 0;
    const provider = new OpenMeteoElevationProvider({ baseUrl: BASE, maxBatchPoints: 50, fetch: (async () => (calls++, answerFor(new URL(BASE)))) as unknown as typeof fetch });
    const points = Array.from({ length: 51 }, (_, i) => ({ lat: 40 + i * 0.01, lon: 3 }));
    expect(await provider.elevationsAt(points)).toEqual(points.map(() => null));
    expect(calls).toBe(0);
  });

  it('answers null for the points of a batch that fails or comes back with a different shape, and the others keep their answer', async () => {
    const points = Array.from({ length: 150 }, (_, i) => ({ lat: 40 + i * 0.01, lon: 3 }));
    let call = 0;
    const provider = new OpenMeteoElevationProvider({
      baseUrl: BASE,
      fetch: (async (url: URL) => (++call === 2 ? new Response('down', { status: 503 }) : answerFor(new URL(url)))) as unknown as typeof fetch,
    });
    const answers = await provider.elevationsAt(points);
    expect(answers.slice(0, 100).every((m) => m !== null)).toBe(true);
    expect(answers.slice(100)).toEqual(Array(50).fill(null));
    const short = new OpenMeteoElevationProvider({ baseUrl: BASE, fetch: (async () => Response.json({ elevation: [1] })) as unknown as typeof fetch });
    expect(await short.elevationsAt(points.slice(0, 3))).toEqual([null, null, null]);
  });
});

describe('CompositeElevationProvider.elevationsAt', () => {
  it('asks each source only for the points the previous ones could not answer', async () => {
    const asked: number[][] = [];
    const source = (known: Set<number>, tag: number): ElevationProvider => ({
      elevationAt: async () => null,
      elevationsAt: async (points) => {
        asked.push(points.map((p) => p.lat));
        return points.map((p) => (known.has(p.lat) ? p.lat * 10 + tag : null));
      },
    });
    const composite = new CompositeElevationProvider([source(new Set([1, 3]), 0), source(new Set([2, 3]), 1)]);
    const answers = await composite.elevationsAt([1, 2, 3, 4].map((lat) => ({ lat, lon: 0 })));
    expect(answers).toEqual([10, 21, 30, null]);
    expect(asked).toEqual([
      [1, 2, 3, 4],
      [2, 4],
    ]);
  });
});
