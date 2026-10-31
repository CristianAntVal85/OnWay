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
