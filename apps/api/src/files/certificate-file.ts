/** Content types of a certificate (RF-808), decided from the first bytes and never from the name or the declared type. */
export type CertificateContentType = 'application/pdf' | 'image/jpeg' | 'image/png';

const SIGNATURES: readonly { type: CertificateContentType; bytes: readonly number[] }[] = [
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/** The type of a certificate, or `null` when the bytes are none of PDF, JPEG or PNG. */
export function certificateContentType(buffer: Uint8Array): CertificateContentType | null {
  for (const { type, bytes } of SIGNATURES) if (buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte)) return type;
  return null;
}
