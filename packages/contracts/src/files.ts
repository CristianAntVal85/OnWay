// Archivos: certificados (privados) y GPX/KML para importar. Se suben antes y se referencian por id.
import { z } from 'zod';
import { FilePurpose } from './enums.js';
import { Id, Timestamp } from './common.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // coincide con el CHECK de files.size_bytes

export const CONTENT_TYPES_BY_PURPOSE = {
  certificate: ['application/pdf', 'image/jpeg', 'image/png'],
  route_import: ['application/gpx+xml', 'application/vnd.google-earth.kml+xml'],
} as const;

/** multipart/form-data: campo `purpose` + campo `file`. El tipo se comprueba por contenido, no por extensión. */
export const UploadFileFields = z.strictObject({ purpose: FilePurpose });

export const FileRef = z.strictObject({
  id: Id,
  purpose: FilePurpose,
  contentType: z.string(),
  sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
  createdAt: Timestamp,
});

/** Enlace firmado y de vida corta para abrir un certificado. Cada petición ajena queda auditada (RN-24). */
export const SignedLink = z.strictObject({ url: z.url(), expiresAt: Timestamp });
