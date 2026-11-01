import { Controller, Inject, Req } from '@nestjs/common';
import type { OperationOutput, UploadFileFields } from '@onway/contracts';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { FilesService } from './files.service.js';

/** `uploadFile`. The multipart body is read by the operation interceptor before the transaction opens; the file is `request.file`. */
@Controller()
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Operation('uploadFile')
  upload(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'uploadFile'>> {
    return this.files.upload(request.principal!, input.body as z.infer<typeof UploadFileFields>, request.file);
  }
}
