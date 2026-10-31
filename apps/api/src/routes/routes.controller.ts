import { Controller, Inject, Req } from '@nestjs/common';
import type { ImportPreviewRequest, OperationOutput } from '@onway/contracts';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { RouteImports } from './route-imports.service.js';

/** The route library (H2). Role, session and CSRF are decided by the global guard from the registry. */
@Controller()
export class RoutesController {
  constructor(@Inject(RouteImports) private readonly imports: RouteImports) {}

  @Operation('previewRouteImport')
  preview(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'previewRouteImport'>> {
    return this.imports.preview(request.principal!, (input.body as z.infer<typeof ImportPreviewRequest>).fileId);
  }
}
