import { Module } from '@nestjs/common';
import { AvoidZonesController } from './avoid-zones.controller.js';
import { AvoidZones } from './avoid-zones.service.js';

/** Zones to avoid (RF-507). The audit writer and the database are global. */
@Module({ controllers: [AvoidZonesController], providers: [AvoidZones], exports: [AvoidZones] })
export class AvoidZonesModule {}
