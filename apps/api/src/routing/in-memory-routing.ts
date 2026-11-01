import { haversineM, type Position2D } from '@onway/geo';
import { DomainError } from '../common/domain-error.js';
import type { AlternativesRequest, EngineRoute, LatLon, RoutingProvider } from './routing.js';

export interface InMemoryRoutingOptions {
  /** The engine fails with this error on every call (a `DomainError` code, or `'INTERNAL'` for a plain `Error`). */
  failWith?: 'NO_ROUTE_POSSIBLE' | 'OUTSIDE_COVERAGE' | 'ROUTING_UNAVAILABLE' | 'INTERNAL';
  /** Awaited before every answer: lets a test stop a worker in the middle of a job, or make the engine fail once. */
  beforeAnswer?: () => Promise<void>;
  /** Altitude written in the third value of every vertex: the proof that the server never uses the engine's (INV-15). */
  falseElevationM?: number;
}

/**
 * A routing engine for the tests of the jobs: straight lines between the points, with detours that bend to one side. Its
 * answers are deterministic, it records its calls and it can fail on demand. It is not an engine: the real one is tested
 * by `test:routing`.
 */
export class InMemoryRouting implements RoutingProvider {
  readonly calls: { method: 'alternatives' | 'snap'; points: LatLon[]; avoid: Position2D[][] }[] = [];

  constructor(private readonly options: InMemoryRoutingOptions = {}) {}

  /** Changes what happens before each answer (see the option of the same name). */
  setBeforeAnswer(beforeAnswer: InMemoryRoutingOptions['beforeAnswer']): void {
    this.options.beforeAnswer = beforeAnswer;
  }

  setFailure(failWith: InMemoryRoutingOptions['failWith']): void {
    (this.options as { failWith?: InMemoryRoutingOptions['failWith'] }).failWith = failWith;
  }

  async alternatives(request: AlternativesRequest): Promise<EngineRoute[]> {
    const points = [request.from, ...request.via, request.to];
    this.calls.push({ method: 'alternatives', points, avoid: request.avoid });
    await this.answer();
    // Detours bend 0.002° to the north, then south, …: distinct from the main route and from each other.
    return Array.from({ length: Math.max(1, request.count) }, (_, index) => this.line(points, index === 0 ? 0 : (index % 2 === 1 ? 1 : -1) * Math.ceil(index / 2) * 0.002));
  }

  async snap(points: LatLon[], avoid: Position2D[][] = []): Promise<EngineRoute> {
    this.calls.push({ method: 'snap', points, avoid });
    await this.answer();
    return this.line(points, 0);
  }

  async isAvailable(): Promise<boolean> {
    return this.options.failWith !== 'ROUTING_UNAVAILABLE';
  }

  private async answer(): Promise<void> {
    await this.options.beforeAnswer?.();
    const { failWith } = this.options;
    if (failWith === 'INTERNAL') throw new Error('the in-memory engine was told to fail');
    if (failWith) throw new DomainError(failWith);
  }

  /** The points joined by straight lines, one vertex about every 100 m, with a bend of `bendDeg` in the middle. */
  private line(points: LatLon[], bendDeg: number): EngineRoute {
    const coordinates: number[][] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const steps = Math.max(2, Math.ceil(haversineM([a.lon, a.lat], [b.lon, b.lat]) / 100));
      for (let step = i === 0 ? 0 : 1; step <= steps; step++) {
        const t = step / steps;
        const bend = bendDeg * Math.sin(Math.PI * t);
        coordinates.push(this.withElevation([a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t + bend]));
      }
    }
    // One stretch per half: a road for the first half, a path for the second, so that the composition is not trivial.
    const half = Math.floor(coordinates.length / 2);
    return {
      coordinates,
      segments: [
        { fromIndex: 0, toIndex: half, roadType: 'road' },
        { fromIndex: half, toIndex: coordinates.length - 1, roadType: 'path' },
      ],
    };
  }

  private withElevation(position: number[]): number[] {
    return this.options.falseElevationM === undefined ? position : [...position, this.options.falseElevationM];
  }
}
