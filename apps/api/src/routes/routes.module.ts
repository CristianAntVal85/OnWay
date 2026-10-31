import { Module } from '@nestjs/common';
import { RouteImports } from './route-imports.service.js';
import { RouteMeasurement } from './route-measurement.js';
import { RoutesController } from './routes.controller.js';

/** The route library. The audit writer, clock, elevation port and files module are global. */
@Module({ controllers: [RoutesController], providers: [RouteMeasurement, RouteImports], exports: [RouteMeasurement] })
export class RoutesModule {}
