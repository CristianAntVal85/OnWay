import { Controller, Inject, Req, Res, StreamableFile } from '@nestjs/common';
import type {
  CreateRouteRequest,
  CreateVersionRequest,
  DeriveRouteRequest,
  ExportRouteQuery,
  ExportRoutesQuery,
  ImportPreviewRequest,
  ListRoutesQuery,
  OperationOutput,
  ValidateVersionRequest,
} from '@onway/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { RouteExports, type ExportedFile } from './route-exports.service.js';
import { RouteImports } from './route-imports.service.js';
import { RouteLibrary } from './route-library.service.js';
import { RouteWrites } from './route-writes.service.js';

type RouteParams = { routeId: string };
type VersionParams = { routeId: string; versionId: string };

/** A file answer: type and a plain attachment name (`safeFileName`); nothing in it identifies who asked. */
function download(response: Response, file: ExportedFile): StreamableFile {
  response.setHeader('Content-Type', file.contentType);
  response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  return new StreamableFile(Buffer.from(file.content, 'utf8'));
}

/** The route library (H2). Role, session and CSRF are decided by the global guard from the registry. */
@Controller()
export class RoutesController {
  constructor(
    @Inject(RouteImports) private readonly imports: RouteImports,
    @Inject(RouteWrites) private readonly writes: RouteWrites,
    @Inject(RouteLibrary) private readonly library: RouteLibrary,
    @Inject(RouteExports) private readonly exports: RouteExports,
  ) {}

  @Operation('listRoutes')
  list(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'listRoutes'>> {
    return this.library.list(request.principal!, input.query as z.infer<typeof ListRoutesQuery>);
  }

  /** Declared before `getRoute`: `/routes/export` must not be read as a route id. */
  @Operation('exportRoutes')
  async exportMany(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    return download(response, await this.exports.many(request.principal!, input.query as z.infer<typeof ExportRoutesQuery>));
  }

  @Operation('getRoute')
  get(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'getRoute'>> {
    return this.library.get(request.principal!, (input.params as RouteParams).routeId);
  }

  @Operation('getRouteVersion')
  getVersion(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'getRouteVersion'>> {
    const { routeId, versionId } = input.params as VersionParams;
    return this.library.getVersion(request.principal!, routeId, versionId);
  }

  @Operation('exportRoute')
  async exportOne(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    return download(response, await this.exports.one(request.principal!, (input.params as RouteParams).routeId, input.query as z.infer<typeof ExportRouteQuery>));
  }

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
