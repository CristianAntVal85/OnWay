import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';
import { WeatherHealth } from '../weather/weather-health.js';

/**
 * D-H0-12: the database is checked with `SELECT 1`. `routingEngine` stays `false` until its adapter exists and does not
 * degrade `status` before that (doc 06, note of `getHealth`). D-H1-12: `weatherProvider` is passive, it reflects how the
 * last real call to the provider went (`WeatherHealth`), and a failed call degrades `status`; no call is made for the health.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WeatherHealth) private readonly weather: WeatherHealth,
  ) {}

  async check(): Promise<OperationOutput<'getHealth'>> {
    let databaseUp = false;
    try {
      await this.database.withAnonymous((tx) => tx.execute(sql`SELECT 1`));
      databaseUp = true;
    } catch (error) {
      this.logger.warn(`database check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const weatherUp = this.weather.isHealthy();
    return { status: databaseUp && weatherUp ? 'ok' : 'degraded', checks: { database: databaseUp, routingEngine: false, weatherProvider: weatherUp } };
  }
}
