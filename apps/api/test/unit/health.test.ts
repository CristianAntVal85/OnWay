import { ENDPOINTS } from '@onway/contracts';
import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseService } from '../../src/db/database.service.js';
import { HealthService } from '../../src/health/health.service.js';
import { WeatherHealth } from '../../src/weather/weather-health.js';
import { FixedClock } from '../support/clock.js';

const schema = ENDPOINTS.find((e) => e.id === 'getHealth')!.response.schema!;
const down = { withAnonymous: () => Promise.reject(new Error('connection refused')) } as unknown as DatabaseService;
const up = { withAnonymous: () => Promise.resolve([]) } as unknown as DatabaseService;
const weather = () => new WeatherHealth(new FixedClock(new Date('2026-10-31T10:00:00Z')));

describe('HealthService (D-H0-12, D-H1-12)', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('reports degraded, not an error, when the database is down', async () => {
    const result = await new HealthService(down, weather()).check();
    expect(schema.parse(result)).toEqual({ status: 'degraded', checks: { database: false, routingEngine: false, weatherProvider: true } });
  });

  it('keeps status ok while the routing engine, which is not built, is false, and the weather has had no failure', async () => {
    const result = await new HealthService(up, weather()).check();
    expect(result).toEqual({ status: 'ok', checks: { database: true, routingEngine: false, weatherProvider: true } });
  });

  it('degrades status when the last real call to the weather provider failed, and recovers after a good one', async () => {
    const health = weather();
    const service = new HealthService(up, health);
    health.recordFailure();
    expect(schema.parse(await service.check())).toEqual({ status: 'degraded', checks: { database: true, routingEngine: false, weatherProvider: false } });
    health.recordSuccess();
    expect((await service.check()).status).toBe('ok');
  });
});
