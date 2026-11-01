import type { Position2D } from '@onway/geo';

/** The road types of `route_segments` that the engine can tell apart (`offtrail` is v2.2; `unknown` is a finding, never a guess). */
export type EngineRoadType = 'road' | 'track' | 'path' | 'unknown';

export interface LatLon {
  lat: number;
  lon: number;
}

/** A stretch of the route: the vertices `fromIndex` to `toIndex` (both included) are of one road type. */
export interface EngineSegment {
  fromIndex: number;
  toIndex: number;
  roadType: EngineRoadType;
}

/**
 * What the engine returns for one route. `coordinates` are `[lon, lat, ...]`: any third value (the engine's own altitude)
 * is never used, because the server measures every route with its own elevation model (rule 6, INV-15).
 */
export interface EngineRoute {
  coordinates: number[][];
  segments: EngineSegment[];
}

export interface AlternativesRequest {
  from: LatLon;
  to: LatLon;
  /** Points the route must pass, in order (RF-501). */
  via: LatLon[];
  /** Closed rings `[lon, lat]` the routes must not cross (RF-507). */
  avoid: Position2D[][];
  /** How many routes are wanted (at most; the terrain may allow fewer, D-04). */
  count: number;
}

/**
 * Port `RoutingProvider` (doc 04 §3, H3): the routing engine behind an interface, so that it can be replaced (Valhalla is the
 * documented plan B) and so that the jobs can be tested without it.
 *
 * Failures are `DomainError`s with the code the API answers: `NO_ROUTE_POSSIBLE` (no way by the network, or the zones to
 * avoid cannot be avoided), `OUTSIDE_COVERAGE` (a point is outside the network the engine knows) and `ROUTING_UNAVAILABLE`
 * (the engine is down or does not answer). Anything else is a plain `Error` (`INTERNAL`).
 */
export interface RoutingProvider {
  /** Several routes between two points, the first one the best (D-H3-03: the engine's own alternatives, then detours). */
  alternatives(request: AlternativesRequest): Promise<EngineRoute[]>;
  /** One route that joins the points in order following the paths (the hand-drawn route, `snapRoute`). */
  snap(points: LatLon[], avoid?: Position2D[][]): Promise<EngineRoute>;
  /** Whether the engine answers right now. */
  isAvailable(): Promise<boolean>;
}

/** Injection token, as `ELEVATION_PROVIDER` is: the domain asks for the port, never for an adapter. */
export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
