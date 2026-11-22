import { describe, expect, it } from 'vitest';
import { certificateContentType } from '../../src/files/certificate-file.js';

describe('certificateContentType', () => {
  it('recognises a PDF, a JPEG and a PNG by their first bytes', () => {
    expect(certificateContentType(Buffer.from('%PDF-1.7\nfictitious'))).toBe('application/pdf');
    expect(certificateContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('image/jpeg');
    expect(certificateContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('image/png');
  });

  it('ignores the name: text, a GPX, an SVG, a GIF and a truncated signature are none of them', () => {
    expect(certificateContentType(Buffer.from('this is plain text'))).toBeNull();
    expect(certificateContentType(Buffer.from('<?xml version="1.0"?><gpx></gpx>'))).toBeNull();
    expect(certificateContentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(certificateContentType(Buffer.from('GIF89a'))).toBeNull();
    expect(certificateContentType(Buffer.from('%PDF'))).toBeNull();
    expect(certificateContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(certificateContentType(Buffer.alloc(0))).toBeNull();
  });
});
