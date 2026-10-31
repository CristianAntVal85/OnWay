import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONTENT_TYPES_BY_PURPOSE, MAX_FILE_BYTES, type OperationOutput } from '@onway/contracts';
import { parseTrack, TrackParseError } from '@onway/geo';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService } from '../db/database.service.js';
import { files } from '../db/schema.js';
import { FILE_STORAGE, type FileStorage } from './file-storage.js';

type FileRef = OperationOutput<'uploadFile'>;
type Purpose = FileRef['purpose'];

/** First bytes of the formats people attach by mistake (or on purpose, under a `.gpx` name): they are not GPX or KML. */
const BINARY_MAGIC: readonly Buffer[] = [Buffer.from('%PDF-'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('GIF8')];

const isBinary = (content: Buffer): boolean => content.includes(0) || BINARY_MAGIC.some((magic) => content.subarray(0, magic.length).equals(magic));

/** What the bytes are, decided from the content and never from the name or the `Content-Type` the client sent. */
function routeFileType(content: Buffer): 'application/gpx+xml' | 'application/vnd.google-earth.kml+xml' {
  if (isBinary(content)) throw new DomainError('UNSUPPORTED_FILE_TYPE', 'The file is not a GPX or KML file');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new DomainError('INVALID_FILE_CONTENT', 'The file is not valid UTF-8 text');
  }
  try {
    return parseTrack(text).format === 'gpx' ? CONTENT_TYPES_BY_PURPOSE.route_import[0] : CONTENT_TYPES_BY_PURPOSE.route_import[1];
  } catch (error) {
    if (!(error instanceof TrackParseError)) throw error;
    if (error.reason === 'unsupported_root') throw new DomainError('UNSUPPORTED_FILE_TYPE', 'The file is not a GPX or KML file');
    throw new DomainError('INVALID_FILE_CONTENT', 'The file is not a valid GPX or KML track', { reason: error.reason });
  }
}

/**
 * Uploads (RF-510): the coordinator attaches a GPX or KML to import. The bytes go to the `FileStorage` port first and the row
 * after; if the row fails the bytes are removed, so a file never exists without its row. The reverse (a commit that fails
 * after the row was written) leaves a row without bytes only if the transaction itself fails to commit; the sweep of
 * unreferenced files (doc 07, H3/H7) covers the remaining orphans.
 */
@Injectable()
export class FilesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async upload(principal: Principal, fields: { purpose: Purpose }, file: Express.Multer.File | undefined): Promise<FileRef> {
    if (fields.purpose === 'certificate') {
      // Certificates are the rescuer's (RF-203) and arrive in H5; until then nobody can upload one.
      if (principal.role !== 'rescuer') throw new DomainError('FORBIDDEN');
      throw new DomainError('VALIDATION_FAILED', 'Certificates cannot be uploaded yet', {
        issues: [{ path: 'purpose', code: 'not_available', message: 'certificate uploads arrive with the rescuer profile (H5)' }],
      });
    }
    // route_import: whoever may create routes and points, i.e. the coordinator (files_insert, migration 0012).
    if (principal.role !== 'coordinator' || !principal.orgId) throw new DomainError('FORBIDDEN');
    if (!file) throw new DomainError('VALIDATION_FAILED', 'Request validation failed', { issues: [{ path: 'file', code: 'required', message: 'the file is required' }] });
    if (file.size === 0) throw new DomainError('INVALID_FILE_CONTENT', 'The file is empty', { reason: 'empty' });
    if (file.size > MAX_FILE_BYTES) throw new DomainError('FILE_TOO_LARGE');

    const contentType = routeFileType(file.buffer);
    const key = await this.storage.put(file.buffer);
    try {
      const [row] = await this.database
        .current()
        .insert(files)
        .values({
          organizationId: principal.orgId,
          purpose: 'route_import',
          contentType,
          sizeBytes: file.size,
          storageKey: key,
          sha256: createHash('sha256').update(file.buffer).digest(),
          createdBy: principal.userId,
        })
        .returning();
      return { id: row!.id, purpose: 'route_import', contentType: row!.contentType, sizeBytes: row!.sizeBytes, createdAt: row!.createdAt!.toISOString() };
    } catch (error) {
      await this.storage.delete(key);
      throw error;
    }
  }
}
