import { resampleLine, sharedShare, squareRing, type Position2D } from '@onway/geo';
import { DomainError } from '../common/domain-error.js';
import type { AlternativesRequest, EngineRoadType, EngineRoute, EngineSegment, LatLon, RoutingProvider } from './routing.js';

/** The profile of `infra/routing/mountain.json` (the weights are in that file, reviewed with the demonstration routes). */
const PROFILE = 'mountain';

/** GraphHopper's own alternative search: parameters measured in the technical test (doc 04 §7.6). */
const NATIVE_ALTERNATIVES = { maxShareFactor: 0.8, maxWeightFactor: 2.5 };
/** A detour counts only if it shares at most this much of its length with every route already kept (D-04: sharing is allowed, up to a point). */
const MAX_SHARED_SHARE = 0.7;
/** Side of the square blocked in the middle of a route to force a detour (half-side, metres). */
const BLOCK_HALF_SIDE_M = 100;
/** Where along the main route the detours are tried, in order. */
const BLOCK_FRACTIONS = [0.5, 0.25, 0.75, 0.4, 0.6, 0.15, 0.85];

const ROAD = new Set(['MOTORWAY', 'TRUNK', 'PRIMARY', 'SECONDARY', 'TERTIARY', 'RESIDENTIAL', 'UNCLASSIFIED', 'SERVICE', 'LIVING_STREET', 'ROAD']);
const TRACK = new Set(['TRACK', 'BRIDLEWAY']);
const PATH = new Set(['PATH', 'FOOTWAY', 'STEPS', 'PEDESTRIAN', 'CYCLEWAY', 'CORRIDOR', 'PLATFORM']);

/** GraphHopper's `road_class` to the road types of OnWay. */
export function roadTypeOfClass(roadClass: string): EngineRoadType {
  const key = roadClass.toUpperCase();
  if (ROAD.has(key)) return 'road';
  if (TRACK.has(key)) return 'track';
  if (PATH.has(key)) return 'path';
  return 'unknown';
}

export interface GraphHopperOptions {
  /** Base URL of the engine, e.g. `http://routing:8989`. */
  baseUrl: string;
  /** Milliseconds before a request is given up (the engine answers in tens of milliseconds; a hung one is a failure). */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface GhPath {
  points: { coordinates: number[][] };
  details?: { road_class?: [number, number, string][] };
}

/** The GraphHopper adapter of `RoutingProvider`. */
export class GraphHopperRouting implements RoutingProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: GraphHopperOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async alternatives(request: AlternativesRequest): Promise<EngineRoute[]> {
    const points = [request.from, ...request.via, request.to];
    const kept: EngineRoute[] = [];
    const first = request.via.length === 0 ? await this.route(points, request.avoid, request.count) : [(await this.route(points, request.avoid))[0]!];
    for (const route of first) if (differentEnough(route, kept)) kept.push(route);

    // The engine's search found fewer than asked (it found none for `ordesa-perdido`, with a detour of 4 km available): block 200 m
    // in the middle of the main route and ask again. A blocked point that makes the trip impossible only means "no detour here".
    for (const fraction of BLOCK_FRACTIONS) {
      if (kept.length >= request.count) break;
      const middle = resampleLine(kept[0]!.coordinates, 10);
      const ring = squareRing(middle[Math.floor(middle.length * fraction)]!, BLOCK_HALF_SIDE_M);
      let detour: EngineRoute | undefined;
      try {
        detour = (await this.route(points, [...request.avoid, ring]))[0];
      } catch (error) {
        if (error instanceof DomainError && (error.code === 'NO_ROUTE_POSSIBLE' || error.code === 'OUTSIDE_COVERAGE')) continue;
        throw error;
      }
      if (detour && differentEnough(detour, kept)) kept.push(detour);
    }
    return kept;
  }

  async snap(points: LatLon[], avoid: Position2D[][] = []): Promise<EngineRoute> {
    return (await this.route(points, avoid))[0]!;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(Math.min(this.timeoutMs, 5000)) });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** One request to `/route`; `alternatives > 1` asks the engine's own alternative search (two points only). */
  private async route(points: LatLon[], avoid: Position2D[][], alternatives = 1): Promise<EngineRoute[]> {
    const body: Record<string, unknown> = {
      points: points.map(({ lat, lon }) => [lon, lat]),
      profile: PROFILE,
      points_encoded: false,
      // The altitude of the engine is never used: not even asked for.
      elevation: false,
      instructions: false,
      details: ['road_class'],
    };
    if (alternatives > 1 && points.length === 2) {
      body.algorithm = 'alternative_route';
      body['alternative_route.max_paths'] = alternatives;
      body['alternative_route.max_share_factor'] = NATIVE_ALTERNATIVES.maxShareFactor;
      body['alternative_route.max_weight_factor'] = NATIVE_ALTERNATIVES.maxWeightFactor;
    }
    if (avoid.length > 0) body.custom_model = avoidModel(avoid);

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new DomainError('ROUTING_UNAVAILABLE');
    }
    if (response.status >= 500) throw new DomainError('ROUTING_UNAVAILABLE');
    const json = (await response.json().catch(() => ({}))) as { message?: string; hints?: { message?: string; details?: string }[]; paths?: GhPath[] };
    if (!response.ok) throw mapEngineError(json, avoid.length > 0);
    if (!json.paths || json.paths.length === 0) throw new DomainError('NO_ROUTE_POSSIBLE');
    return json.paths.map(toEngineRoute);
  }
}

/** Zones to avoid as a custom model: every edge inside any of the rings gets priority 0 (forbidden). */
function avoidModel(rings: Position2D[][]): Record<string, unknown> {
  const ids = rings.map((_, index) => `avoid${index}`);
  return {
    priority: [{ if: ids.map((id) => `in_${id}`).join(' || '), multiply_by: '0' }],
    areas: {
      type: 'FeatureCollection',
      features: rings.map((ring, index) => ({ type: 'Feature', id: ids[index], properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } })),
    },
  };
}

function toEngineRoute(path: GhPath): EngineRoute {
  const coordinates = path.points.coordinates;
  const segments: EngineSegment[] = (path.details?.road_class ?? []).map(([fromIndex, toIndex, roadClass]) => ({ fromIndex, toIndex, roadType: roadTypeOfClass(roadClass) }));
  return { coordinates, segments };
}

const differentEnough = (candidate: EngineRoute, kept: EngineRoute[]): boolean => kept.every((other) => sharedShare(candidate.coordinates, other.coordinates) <= MAX_SHARED_SHARE);

/**
 * GraphHopper's 4xx answers to the codes of the API. A point it cannot place on the network is "outside coverage", unless a zone
 * to avoid was asked for: then the zone may be what blocks the point (doc 03 §8.2: "zona a evitar imposible de esquivar").
 */
export function mapEngineError(json: { message?: string; hints?: { message?: string; details?: string }[] }, withAvoidZones: boolean): Error {
  const text = [json.message, ...(json.hints ?? []).flatMap((hint) => [hint.message, hint.details])].filter(Boolean).join(' | ');
  if (/ConnectionNotFound|Connection between locations not found/i.test(text)) return new DomainError('NO_ROUTE_POSSIBLE');
  if (/PointOutOfBounds|out of bounds/i.test(text)) return new DomainError('OUTSIDE_COVERAGE');
  if (/PointNotFound|Cannot find point/i.test(text)) return new DomainError(withAvoidZones ? 'NO_ROUTE_POSSIBLE' : 'OUTSIDE_COVERAGE');
  return new Error(`routing engine rejected the request: ${text || 'no message'}`);
}
