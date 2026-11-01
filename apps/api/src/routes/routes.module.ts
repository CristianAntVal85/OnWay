import { Module } from '@nestjs/common';
import { RouteExports } from './route-exports.service.js';
import { RouteGeneration } from './route-generation.service.js';
import { RouteImports } from './route-imports.service.js';
import { RouteLibrary } from './route-library.service.js';
import { RouteMeasurement } from './route-measurement.js';
import { RouteSnapping } from './route-snapping.service.js';
import { RouteWrites } from './route-writes.service.js';
import { RoutesController } from './routes.controller.js';

/** The route library. The audit writer, clock, elevation port and files module are global. */
@Module({ controllers: [RoutesController], providers: [RouteMeasurement, RouteImports, RouteWrites, RouteLibrary, RouteExports, RouteSnapping, RouteGeneration], exports: [RouteMeasurement] })
export class RoutesModule {}
