import { Inject, Injectable } from '@nestjs/common';
import type { ExportRouteQuery, ExportRoutesQuery } from '@onway/contracts';
import { buildGpx, buildKml, type ExportTrack } from '@onway/geo';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { ExportedFile } from '../common/download.js';
import type { Principal } from '../common/operation.js';
import { viewerOf } from '../missions/mission-support.js';
import { RouteLibrary, type ExportRow } from './route-library.service.js';

type Format = 'gpx' | 'kml';

export type { ExportedFile };

const CONTENT_TYPE: Record<Format, string> = { gpx: 'application/gpx+xml; charset=utf-8', kml: 'application/vnd.google-earth.kml+xml; charset=utf-8' };

/** Only `[A-Za-z0-9._-]` survive in a file name: the route's name is text a person typed and goes into a header. */
export function safeFileName(text: string, fallback = 'route'): string {
  const plain = text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return plain || fallback;
}

/** The text that travels with a version: its number and, if validated, when and the warning of RF-506. No author, no e-mail (D-H2-14). */
function describe(row: ExportRow): string {
  return row.status === 'validated'
    ? `Versión ${row.versionNumber}, validada el ${row.validatedAt!.slice(0, 10)}. Es una propuesta y no sustituye el criterio del equipo.`
    : `Versión ${row.versionNumber}, borrador sin validar. Es una propuesta y no sustituye el criterio del equipo.`;
}

const trackOf = (row: ExportRow): ExportTrack => ({ name: row.name, description: describe(row), coordinates: row.coordinates });

/** One `<trk>` (or Placemark) per row, in the order given: the file of the library and of the routes of a mission (H4) are written the same way. */
export function exportFile(rows: readonly ExportRow[], format: Format, baseName: string): ExportedFile {
  const tracks = rows.map(trackOf);
  return { content: format === 'gpx' ? buildGpx(tracks) : buildKml(tracks), contentType: CONTENT_TYPE[format], fileName: `${baseName}.${format}` };
}

/**
 * GPX and KML of the library (RF-511): metres and degrees (INV-17), one `<trk>` or `Placemark` per route, written by
 * `@onway/geo` from the stored line. Reading and exporting leave no audit row (D-H2-07).
 */
@Injectable()
export class RouteExports {
  constructor(
    @Inject(RouteLibrary) private readonly library: RouteLibrary,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async one(principal: Principal, routeId: string, query: z.infer<typeof ExportRouteQuery>): Promise<ExportedFile> {
    const { orgId } = viewerOf(principal);
    const [row] = await this.library.exportable(orgId, [routeId], query.versionId ? { versionId: query.versionId } : {});
    if (!row) throw new DomainError('NOT_FOUND');
    return exportFile([row], query.format, `${safeFileName(row.name)}-v${row.versionNumber}`);
  }

  async many(principal: Principal, query: z.infer<typeof ExportRoutesQuery>): Promise<ExportedFile> {
    const { orgId } = viewerOf(principal);
    const ids = [...new Set(query.ids.split(','))];
    const rows = await this.library.exportable(orgId, ids, { validatedOnly: query.validatedOnly === 'true' });
    // Routes of another organization, unknown ids and (with validatedOnly) routes without a validated version are not there.
    if (rows.length === 0) throw new DomainError('NOT_FOUND');
    return exportFile(rows, query.format, `onway-routes-${this.clock.now().toISOString().slice(0, 10)}`);
  }
}
