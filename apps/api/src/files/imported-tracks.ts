import { Inject, Injectable } from '@nestjs/common';
import type { ParsedTrack } from '@onway/geo';
import { and, eq, isNull } from 'drizzle-orm';
import { DomainError } from '../common/domain-error.js';
import { DatabaseService } from '../db/database.service.js';
import { files } from '../db/schema.js';
import { FILE_STORAGE, FileNotFoundError, type FileStorage } from './file-storage.js';
import { parseTrackFile } from './track-file.js';

/** A file the coordinator uploaded to import, read back as a track together with the row it belongs to. */
export interface ImportedTrack {
  fileId: string;
  track: ParsedTrack;
}

/**
 * Opens an uploaded GPX or KML by its id for the operations that receive a `fileId` (INV-01): the row is looked up under
 * row level security, so a file of another organization is not there (`NOT_FOUND`, never 403) and neither is one that is
 * not a route import or was deleted. The bytes are parsed again; what is stored is never trusted to be valid.
 */
@Injectable()
export class ImportedTracks {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async open(orgId: string, fileId: string): Promise<ImportedTrack> {
    const [row] = await this.database
      .current()
      .select({ id: files.id, storageKey: files.storageKey })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.organizationId, orgId), eq(files.purpose, 'route_import'), isNull(files.deletedAt)));
    if (!row) throw new DomainError('NOT_FOUND');
    let content: Buffer;
    try {
      content = await this.storage.get(row.storageKey);
    } catch (error) {
      if (error instanceof FileNotFoundError) throw new DomainError('NOT_FOUND');
      throw error;
    }
    return { fileId: row.id, track: parseTrackFile(content) };
  }
}
