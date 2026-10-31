/** A point on the ground, in degrees (WGS84). */
export interface GroundPoint {
  lat: number;
  lon: number;
}

/**
 * Port `ElevationProvider` (doc 04 §5.2, rule 6): the altitude of a point in metres, calculated by the server.
 * `null` means that no source covers the point; the caller answers `OUTSIDE_COVERAGE`. A source that is down is
 * also `null` (the service degrades, it does not guess).
 */
export interface ElevationProvider {
  elevationAt(point: GroundPoint): Promise<number | null>;
}

/** Injection token, as `CLOCK` is: the domain asks for the port, never for an adapter. */
export const ELEVATION_PROVIDER = Symbol('ELEVATION_PROVIDER');
