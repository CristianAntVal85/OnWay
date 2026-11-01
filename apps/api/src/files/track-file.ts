import { CONTENT_TYPES_BY_PURPOSE } from '@onway/contracts';
import { parseTrack, TrackParseError, type ParsedTrack } from '@onway/geo';
import { DomainError } from '../common/domain-error.js';

/** First bytes of the formats people attach by mistake (or on purpose, under a `.gpx` name): they are not GPX or KML. */
const BINARY_MAGIC: readonly Buffer[] = [Buffer.from('%PDF-'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('GIF8')];

const isBinary = (content: Buffer): boolean => content.includes(0) || BINARY_MAGIC.some((magic) => content.subarray(0, magic.length).equals(magic));

/**
 * Reads the bytes of a file as a GPX or KML track, deciding what they are from the content and never from the name or the
 * `Content-Type` the client sent (RF-510). Not GPX or KML at all → `UNSUPPORTED_FILE_TYPE`; one of them but unusable → `INVALID_FILE_CONTENT`.
 */
export function parseTrackFile(content: Buffer): ParsedTrack {
  if (isBinary(content)) throw new DomainError('UNSUPPORTED_FILE_TYPE', 'The file is not a GPX or KML file');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new DomainError('INVALID_FILE_CONTENT', 'The file is not valid UTF-8 text');
  }
  try {
    return parseTrack(text);
  } catch (error) {
    if (!(error instanceof TrackParseError)) throw error;
    if (error.reason === 'unsupported_root') throw new DomainError('UNSUPPORTED_FILE_TYPE', 'The file is not a GPX or KML file');
    throw new DomainError('INVALID_FILE_CONTENT', 'The file is not a valid GPX or KML track', { reason: error.reason });
  }
}

export const contentTypeOf = (format: ParsedTrack['format']): (typeof CONTENT_TYPES_BY_PURPOSE.route_import)[number] =>
  format === 'gpx' ? CONTENT_TYPES_BY_PURPOSE.route_import[0] : CONTENT_TYPES_BY_PURPOSE.route_import[1];
