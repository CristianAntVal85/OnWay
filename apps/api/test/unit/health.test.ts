import { ENDPOINTS } from '@onway/contracts';
import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseService } from '../../src/db/database.service.js';
import { HealthService } from '../../src/health/health.service.js';

const schema = ENDPOINTS.find((e) => e.id === 'getHealth')!.response.schema!;

describe('HealthService (D-H0-12)', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('reports degraded, not an error, when the database is down', async () => {
    const down = { withAnonymous: () => Promise.reject(new Error('connection refused')) } as unknown as DatabaseService;
    const result = await new HealthService(down).check();
    expect(schema.parse(result)).toEqual({ status: 'degraded', checks: { database: false, routingEngine: false, weatherProvider: false } });
  });

  it('keeps status ok while only the unbuilt adapters are false', async () => {
    const up = { withAnonymous: () => Promise.resolve([]) } as unknown as DatabaseService;
    const result = await new HealthService(up).check();
    expect(result).toEqual({ status: 'ok', checks: { database: true, routingEngine: false, weatherProvider: false } });
  });
});
