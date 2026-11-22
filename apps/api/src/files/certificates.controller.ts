import { Controller, Inject, Req, Res, StreamableFile } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import type { Response } from 'express';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { CertificateLinks } from './certificate-links.js';

const EXTENSIONS: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** `getCertificateLink` (audits the foreign opening) and `openCertificate` (serves the bytes; the signature already proved the right to them). */
@Controller()
export class CertificatesController {
  constructor(@Inject(CertificateLinks) private readonly links: CertificateLinks) {}

  @Operation('getCertificateLink')
  link(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'getCertificateLink'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.links.link(request.principal!, (input.params as { skillId: string }).skillId);
  }

  @Operation('openCertificate')
  async open(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const file = await this.links.open(request.principal!, (input.params as { token: string }).token);
    // Shown in the tab, not downloaded (D-S3); the type is the one decided from the bytes at upload, and nosniff keeps the browser to it.
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `inline; filename="certificado.${EXTENSIONS[file.contentType] ?? 'bin'}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store, private');
    return new StreamableFile(file.content);
  }
}
