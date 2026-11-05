import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

/** A file to hand over: its type and a plain attachment name (`safeFileName`). */
export interface ExportedFile {
  content: string;
  contentType: string;
  fileName: string;
}

/** A file answer: type and a plain attachment name; nothing in it identifies who asked. */
export function download(response: Response, file: ExportedFile): StreamableFile {
  response.setHeader('Content-Type', file.contentType);
  response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  return new StreamableFile(Buffer.from(file.content, 'utf8'));
}
