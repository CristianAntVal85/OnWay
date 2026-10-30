// Ejecución común del cliente generado (gen/client.ts): ruta, consulta, cuerpo, cabecera CSRF y errores.
// Sin React ni NestJS: sirve igual a la web, a las pruebas y a una app móvil.
import { ErrorResponse, type ErrorCode } from './errors.js';

/** Error de cualquier respuesta no satisfactoria. El texto para la persona se elige por `code` (packages/i18n). */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly requestId: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(init: { code: ErrorCode; message: string; status: number; requestId: string; details?: Record<string, unknown> | undefined }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

export interface ClientOptions {
  /** Por defecto `/api/v1` (mismo origen). En Node hace falta una URL absoluta. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Token CSRF explícito. Si no se da, el cliente recuerda el que traen `login` y `getMe`. */
  getCsrfToken?: () => string | null | undefined;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** Fila de la tabla `OPERATIONS` que genera `gen:client` a partir del registro. */
export interface OperationSpec {
  readonly id: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body: 'json' | 'multipart' | null;
  readonly response: 'json' | 'empty' | 'file';
}

export interface RequestInput {
  params?: Record<string, unknown> | undefined;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
}

export type Requester = (op: OperationSpec, input?: RequestInput, options?: RequestOptions) => Promise<unknown>;

function buildUrl(baseUrl: string, op: OperationSpec, input: RequestInput | undefined): string {
  const path = op.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = input?.params?.[name];
    if (value === undefined || value === null) throw new TypeError(`Falta el parámetro de ruta «${name}» de ${op.path}`);
    return encodeURIComponent(String(value));
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input?.query ?? {})) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  const qs = search.toString();
  return `${baseUrl.replace(/\/+$/, '')}${path}${qs ? `?${qs}` : ''}`;
}

async function toApiError(res: Response): Promise<ApiError> {
  const header = res.headers.get('x-request-id') ?? '';
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  const ok = ErrorResponse.safeParse(parsed);
  if (ok.success) {
    const { code, message, requestId, details } = ok.data.error;
    return new ApiError({ code, message, status: res.status, requestId, details });
  }
  // Un proxy o un fallo previo a la aplicación: no sigue el formato único.
  const code: ErrorCode = res.status === 502 || res.status === 503 || res.status === 504 ? 'UPSTREAM_UNAVAILABLE' : 'INTERNAL';
  return new ApiError({ code, message: `HTTP ${res.status}`, status: res.status, requestId: header });
}

export function createRequester(options: ClientOptions = {}): Requester {
  const baseUrl = options.baseUrl ?? '/api/v1';
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  let remembered: string | undefined;

  return async (op, input, requestOptions) => {
    const headers = new Headers({ Accept: 'application/json' });
    if (op.method !== 'GET') {
      const token = options.getCsrfToken ? options.getCsrfToken() : remembered;
      if (token) headers.set('X-CSRF-Token', token);
    }
    let body: BodyInit | undefined;
    if (op.body === 'json' && input?.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(input.body);
    } else if (op.body === 'multipart') {
      body = input?.body as FormData; // el navegador fija el límite del multipart
    }

    let res: Response;
    try {
      res = await doFetch(buildUrl(baseUrl, op, input), { method: op.method, headers, body, credentials: 'include', signal: requestOptions?.signal ?? null });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new ApiError({ code: 'UPSTREAM_UNAVAILABLE', message: cause instanceof Error ? cause.message : 'network error', status: 0, requestId: '' });
    }
    if (!res.ok) throw await toApiError(res);

    if (op.response === 'empty' || res.status === 204) {
      if (op.id === 'logout') remembered = undefined;
      return undefined;
    }
    if (op.response === 'file') return res.blob();
    const data: unknown = await res.json();
    const token = (data as { csrfToken?: unknown } | null)?.csrfToken;
    if (typeof token === 'string') remembered = token;
    return data;
  };
}
