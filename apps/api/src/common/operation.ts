import 'reflect-metadata';
import { applyDecorators, createParamDecorator, HttpCode, RequestMapping, RequestMethod, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { ENDPOINTS, MILESTONES, type Endpoint, type Milestone, type OperationId } from '@onway/contracts';
import type { Request } from 'express';
import type { DbContext } from '../db/database.service.js';

/** Milestone in progress: operations of later milestones cannot be mounted (rule 7). */
export const CURRENT_MILESTONE: Milestone = 'H0';

export const OPERATION_KEY = 'onway:operation';

export function endpointById(id: string): Endpoint {
  const endpoint = ENDPOINTS.find((e) => e.id === id);
  if (!endpoint) throw new Error(`unknown operation "${id}": it is not in the ENDPOINTS registry`);
  return endpoint;
}

/** `{missionId}` in the registry is `:missionId` in Nest. */
export const nestPath = (path: string) => path.replace(/\{([^}]+)\}/g, ':$1');

/**
 * Mounts a handler as the registry operation `id` (D-H0-06): method, path, success status and roles all come
 * from `ENDPOINTS`; nothing is repeated by hand in the controller. The global guard, interceptor and filter
 * read the same metadata.
 */
export function Operation(id: OperationId): MethodDecorator {
  const endpoint = endpointById(id);
  if (MILESTONES.indexOf(endpoint.milestone) > MILESTONES.indexOf(CURRENT_MILESTONE)) {
    throw new Error(`operation "${id}" belongs to ${endpoint.milestone}, but the milestone in progress is ${CURRENT_MILESTONE}`);
  }
  return applyDecorators(
    RequestMapping({ path: nestPath(endpoint.path), method: RequestMethod[endpoint.method as keyof typeof RequestMethod] }),
    HttpCode(endpoint.response.status),
    SetMetadata(OPERATION_KEY, endpoint.id),
  );
}

/** The registry operation a handler was mounted as, or `undefined` for a handler without `@Operation`. */
export function operationOf(handler: object): Endpoint | undefined {
  const id = Reflect.getMetadata(OPERATION_KEY, handler) as string | undefined;
  return id ? endpointById(id) : undefined;
}

/** Who made the request, once an authenticator has set it (sessions arrive in T5). */
export type Principal = DbContext;

export interface OperationInput {
  params: unknown;
  query: unknown;
  body: unknown;
}

export interface OnwayRequest extends Request {
  requestId: string;
  principal?: Principal;
  input?: OperationInput;
}

/** The request's params, query and body, already validated with the registry schemas. */
export const Input = createParamDecorator((_data: unknown, context: ExecutionContext): OperationInput | undefined => {
  return context.switchToHttp().getRequest<OnwayRequest>().input;
});
