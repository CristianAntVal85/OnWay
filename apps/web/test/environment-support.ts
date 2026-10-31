// Apoyo de las pruebas de T9: ubicación simulada del navegador y respuestas de `getEnvironment`.
import { vi } from 'vitest';

export type GeolocationMode = 'granted' | 'denied' | 'unavailable' | 'none';

/** Posición exacta de la persona en las pruebas (Pirineos, inventada): nunca debe salir tal cual. */
export const EXACT = { latitude: 42.63456, longitude: 0.10987 };
/** Su celda de ~1 km. */
export const CELL = { lat: '42.63', lon: '0.11' };

/**
 * Sustituye `navigator.geolocation`. `none` = el navegador no la ofrece. Devuelve el espía de `getCurrentPosition`
 * para contar cuántas veces se pide.
 */
export function mockGeolocation(mode: GeolocationMode, coords = EXACT) {
  const getCurrentPosition = vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null, _options?: PositionOptions) => {
    if (mode === 'granted') {
      success({ coords: { ...coords, accuracy: 50, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) }, timestamp: 0, toJSON: () => ({}) } as GeolocationPosition);
    } else {
      const code = mode === 'denied' ? 1 : 2;
      failure?.({ code, message: 'test', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    }
  });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: mode === 'none' ? undefined : { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() } });
  return getCurrentPosition;
}

export function restoreGeolocation() {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
}

const hour = (index: number) => {
  const time = new Date(Date.UTC(2026, 10, 1, 8 + index)).toISOString();
  return { time, temperatureC: 2 + index, windSpeedKmh: 17, windGustKmh: 32.4, precipitationMm: 0.4, snowfallCm: 0.3, cloudCoverPct: 63, freezingLevelM: 2890 };
};

export type EnvironmentBody = ReturnType<typeof environment>;

/** Una respuesta de `getEnvironment` con todo presente; las pruebas cambian lo que necesiten. */
export function environment(overrides: Record<string, unknown> = {}) {
  return {
    basis: 'device',
    missionId: null,
    location: { lat: 42.63, lon: 0.11, elevationM: 2140, country: null },
    weather: {
      status: 'ok',
      provider: 'open-meteo',
      fetchedAt: '2026-11-01T08:00:00.000Z',
      current: hour(0),
      hourly: Array.from({ length: 24 }, (_, index) => hour(index)),
      daily: [
        { date: '2026-11-01', minC: 0, maxC: 6, maxWindGustKmh: 40, precipitationMm: 1.2, snowfallCm: 0.5 },
        { date: '2026-11-02', minC: -2, maxC: 4, maxWindGustKmh: null, precipitationMm: 0, snowfallCm: null },
      ],
    },
    sun: {
      date: '2026-11-01',
      sunrise: '2026-11-01T06:45:00.000Z',
      sunset: '2026-11-01T16:50:00.000Z',
      civilDawn: '2026-11-01T06:15:00.000Z',
      civilDusk: '2026-11-01T17:20:00.000Z',
      nauticalDawn: '2026-11-01T05:40:00.000Z',
      nauticalDusk: '2026-11-01T17:55:00.000Z',
    },
    moon: { phaseName: 'waxing_gibbous', illuminationPct: 73, moonrise: '2026-11-01T11:10:00.000Z', moonset: null },
    bulletins: [],
    ...overrides,
  };
}

export const unavailableWeather = { status: 'unavailable', provider: null, fetchedAt: null, current: null, hourly: [], daily: [] };
