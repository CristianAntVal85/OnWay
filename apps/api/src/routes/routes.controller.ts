import { Controller, Inject, Req } from '@nestjs/common';
import type { CreateRouteRequest, CreateVersionRequest, DeriveRouteRequest, ImportPreviewRequest, OperationOutput, ValidateVersionRequest } from '@onway/contracts';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { RouteImports } from './route-imports.service.js';
import { RouteWrites } from './route-writes.service.js';

type RouteParams = { routeId: string };
type VersionParams = { routeId: string; versionId: string };

/** The route library (H2). Role, session and CSRF are decided by the global guard from the registry. */
@Controller()
export class RoutesController {
  constructor(
    @Inject(RouteImports) private readonly imports: RouteImports,
    @Inject(RouteWrites) private readonly writes: RouteWrites,
  ) {}

  @Operation('createRoute')
  create(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'createRoute'>> {
    return this.writes.create(request.principal!, input.body as z.infer<typeof CreateRouteRequest>);
  }

  @Operation('previewRouteImport')
  preview(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'previewRouteImport'>> {
    return this.imports.preview(request.principal!, (input.body as z.infer<typeof ImportPreviewRequest>).fileId);
  }

  @Operation('archiveRoute')
  archive(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'archiveRoute'>> {
    return this.writes.archive(request.principal!, (input.params as RouteParams).routeId);
  }

  @Operation('createRouteVersion')
  createVersion(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'createRouteVersion'>> {
    return this.writes.createVersion(request.principal!, (input.params as RouteParams).routeId, input.body as z.infer<typeof CreateVersionRequest>);
  }

  @Operation('deriveRoute')
  derive(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'deriveRoute'>> {
    return this.writes.derive(request.principal!, (input.params as RouteParams).routeId, input.body as z.infer<typeof DeriveRouteRequest>);
  }

  @Operation('validateRouteVersion')
  validate(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'validateRouteVersion'>> {
    const { routeId, versionId } = input.params as VersionParams;
    return this.writes.validate(request.principal!, routeId, versionId, input.body as z.infer<typeof ValidateVersionRequest>);
  }
}
