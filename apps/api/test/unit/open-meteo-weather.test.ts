import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { WeatherBlock, WeatherDay, WeatherPoint } from '@onway/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { OpenMeteoWeatherProvider } from '../../src/weather/open-meteo-weather.js';
import { WeatherUnavailableError } from '../../src/weather/weather-provider.js';

beforeAll(() => Logger.overrideLogger(false));

// The answer was recorded from the real API once (Torla, 2300 m, `timezone=auto`) and trimmed: nothing here calls the network.
const RECORDED = JSON.parse(readFileSync(new URL('../fixtures/open-meteo-forecast.json', import.meta.url), 'utf8')) as unknown;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const BASE = 'https://weather.invalid/v1/forecast';

function provider(fetchImpl: unknown) {
  return new OpenMeteoWeatherProvider({ baseUrl: BASE, userAgent: 'OnWay/0.1 (test)', fetch: fetchImpl as typeof fetch });
}

describe('OpenMeteoWeatherProvider (RF-704, R-06)', () => {
  it('asks for OUR altitude of the place with `elevation`, the variables, kmh and the local clock (R-06)', async () => {
    const calls: { url: URL; agent: string }[] = [];
    const weather = provider(async (url: URL, init: RequestInit) => (calls.push({ url, agent: (init.headers as Record<string, string>)['user-agent']! }), json(RECORDED)));
    await weather.forecast({ lat: 42.63, lon: -0.1, elevationM: 2300 });

    expect(calls).toHaveLength(1);
    const { url, agent } = calls[0]!;
    expect(url.origin + url.pathname).toBe(BASE);
    expect(url.searchParams.get('elevation')).toBe('2300');
    expect(url.searchParams.get('latitude')).toBe('42.63');
    expect(url.searchParams.get('longitude')).toBe('-0.1');
    expect(url.searchParams.get('hourly')).toContain('freezing_level_height');
    expect(url.searchParams.get('current')).toContain('freezing_level_height');
    expect(url.searchParams.get('forecast_days')).toBe('7');
    expect(url.searchParams.get('wind_speed_unit')).toBe('kmh');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(agent).toBe('OnWay/0.1 (test)');
  });

  it('rounds a fractional altitude to whole metres in the request', async () => {
    let seen = '';
    await provider(async (url: URL) => ((seen = url.searchParams.get('elevation')!), json(RECORDED))).forecast({ lat: 42.63, lon: -0.1, elevationM: 2347.6 });
    expect(seen).toBe('2348');
  });

  it('turns the recorded answer into points that satisfy the contract, with local times as UTC instants', async () => {
    const forecast = await provider(async () => json(RECORDED)).forecast({ lat: 42.63, lon: -0.1, elevationM: 2300 });
    // 00:15 on 31 October in Madrid is UTC+1 (summer time ended on the 25th): 23:15 UTC on the 30th.
    expect(forecast.current).toMatchObject({ time: '2026-10-30T23:15:00.000Z', temperatureC: 0.9, windSpeedKmh: 0.5, windGustKmh: 5.4, cloudCoverPct: 0, freezingLevelM: 3580 });
    expect(forecast.hourly[0]!.time).toBe('2026-10-30T23:00:00.000Z');
    for (const point of [forecast.current!, ...forecast.hourly]) WeatherPoint.parse(point);
    expect(forecast.daily).toHaveLength(2);
    for (const day of forecast.daily) WeatherDay.parse(day);
    expect(forecast.daily[0]).toEqual({ date: '2026-10-31', minC: -0.7, maxC: 7.4, maxWindGustKmh: 22, precipitationMm: 0, snowfallCm: 0 });
    expect(WeatherBlock.shape.hourly.parse(forecast.hourly)).toHaveLength(forecast.hourly.length);
  });

  it('drops an hour that lacks a required value instead of inventing it', async () => {
    // The recording has 4 hours; the 4th has no wind speed.
    const forecast = await provider(async () => json(RECORDED)).forecast({ lat: 42.63, lon: -0.1, elevationM: 2300 });
    expect(forecast.hourly).toHaveLength(3);
  });

  it('keeps optional values as null: no gusts, no snow, no freezing level', async () => {
    const answer = structuredClone(RECORDED) as { current: Record<string, unknown> };
    Object.assign(answer.current, { wind_gusts_10m: null, snowfall: null, freezing_level_height: null });
    const { current } = await provider(async () => json(answer)).forecast({ lat: 42.63, lon: -0.1, elevationM: 2300 });
    expect(current).toMatchObject({ windGustKmh: null, snowfallCm: null, freezingLevelM: null });
  });

  it('says WeatherUnavailableError, and logs no place, when the source fails: a 503, the network, or something unexpected', async () => {
    const attempt = (fetchImpl: unknown) => provider(fetchImpl).forecast({ lat: 42.63, lon: -0.1, elevationM: 2300 });
    await expect(attempt(async () => json({ reason: 'down' }, 503))).rejects.toBeInstanceOf(WeatherUnavailableError);
    await expect(attempt(async () => Promise.reject(new TypeError('fetch failed')))).rejects.toBeInstanceOf(WeatherUnavailableError);
    await expect(attempt(async () => json({ other: 1 }))).rejects.toBeInstanceOf(WeatherUnavailableError);
    await expect(attempt(async () => new Response('<html>', { status: 200 }))).rejects.toBeInstanceOf(WeatherUnavailableError);
    const leaked = await attempt(async () => Promise.reject(new TypeError(`bad url ${BASE}?latitude=42.63`))).catch((e: Error) => e);
    expect(leaked).toBeInstanceOf(WeatherUnavailableError);
    expect((leaked as Error).message).not.toMatch(/42\.63/);
  });
});
