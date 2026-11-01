import 'reflect-metadata';
import { applyDecorators, createParamDecorator, HttpCode, RequestMapping, RequestMethod, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { ENDPOINTS, MILESTONES, type Endpoint, type Milestone, type OperationId, type OperationOutput } from '@onway/contracts';
import type { Request } from 'express';
import type { ContextRole } from '../db/database.service.js';

/** Milestone in progress: operations of later milestones cannot be mounted (rule 7). */
export const CURRENT_MILESTONE: Milestone = 'H3';

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
  return mountEndpoint(endpoint);
}

/**
 * Mounts a handler from an endpoint definition WITHOUT the milestone check. Production controllers use only
 * `Operation(id)`; this exists so that test controllers can mount synthetic endpoints (outside the registry and
 * the OpenAPI) to exercise the guards, e.g. a staff-only route for RF-103, when H0 has no staff-only operation.
 * A unit test fails if any file under `src/` other than this one mentions it.
 */
export function mountEndpoint(endpoint: Endpoint): MethodDecorator {
  return applyDecorators(
    RequestMapping({ path: nestPath(endpoint.path), method: RequestMethod[endpoint.method as keyof typeof RequestMethod] }),
    HttpCode(endpoint.response.status),
    SetMetadata(OPERATION_KEY, endpoint),
  );
}

/** The operation a handler was mounted as, or `undefined` for a handler without `@Operation`. */
export function operationOf(handler: object): Endpoint | undefined {
  return Reflect.getMetadata(OPERATION_KEY, handler) as Endpoint | undefined;
}

export type AccountStatus = OperationOutput<'getMe'>['user']['accountStatus'];

/** Who made the request: the authenticated session, resolved on every request (D-H0-03). */
export interface Principal {
  userId: string;
  /** Null while the account waits for approval: it belongs to no organization yet. */
  orgId: string | null;
  role: ContextRole | 'pending';
  accountStatus: AccountStatus;
  /** SHA-256 of the session token: the key of the row in `sessions`. The token itself is never kept. */
  sessionId: Buffer;
  csrfToken: string;
}

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
