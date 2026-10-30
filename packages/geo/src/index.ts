// Geometría pura de OnWay (distancias, perfiles, GPX). Sin React, NestJS ni código de apps/*: la reutilizará la app móvil.
// H1: celda de ~1 km y luz del sol y la luna. Las demás funciones llegan en H1–H2 (documento 07).
export { CELL_DEGREES, ELEVATION_BAND_M, elevationBand, roundToCell, type LatLon } from './cell.js';
export { moonLight, moonPhaseName, sunLight, type Instant, type MoonLight, type MoonPhaseName, type SunLight } from './light.js';
