// Geometría pura de OnWay (distancias, perfiles, GPX). Sin React, NestJS ni código de apps/*: la reutilizará la app móvil.
// H1: celda de ~1 km, luz del sol y la luna, y lectura y formato de coordenadas (decimal, GMS y UTM). Las demás funciones llegan en H1–H2 (documento 07).
export { CELL_DEGREES, ELEVATION_BAND_M, elevationBand, roundToCell, type LatLon } from './cell.js';
export { moonLight, moonPhaseName, sunLight, type Instant, type MoonLight, type MoonPhaseName, type SunLight } from './light.js';
export { formatCoordinate, formatDecimal, formatDms, formatUtm, parseCoordinates, type CoordinateError, type CoordinateFormat, type ParsedCoordinates } from './coordinates.js';
export { fromUtm, toUtm, utmBandOf, utmZoneOf, type Utm } from './utm.js';
export { COORDINATE_DECIMALS, EARTH_RADIUS_M, MAX_SPACING_M, MIN_SPACING_M, densify, haversineM, lengthM, prepareLine, quantize, thin, type Position2D, type Position3D } from './geometry.js';
export { groupIntervals, labelIntervals, type LabelledStretch, type Run } from './segments.js';
export { distanceToLineM, resampleLine, sharedShare, squareRing } from './overlap.js';
export { ELEVATION_THRESHOLD_M, MAX_PROFILE_POINTS, PROFILE_STEP_M, SLOPE_WINDOW_M, computeMetrics, type MeasuredRoute, type RouteMetrics } from './metrics.js';
export {
  MAX_XML_CHARS,
  MAX_XML_DEPTH,
  MAX_XML_ELEMENTS,
  TrackParseError,
  buildGpx,
  buildKml,
  parseTrack,
  type ExportTrack,
  type ParsedTrack,
  type TrackErrorReason,
  type TrackFormat,
  type Waypoint,
} from './track.js';
