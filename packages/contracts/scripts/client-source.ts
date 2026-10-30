// Texto de gen/client.ts: cliente tipado generado desde el registro ENDPOINTS (D-H0-14). Sin dependencias nuevas: usa `fetch`.
import { ENDPOINTS, type Endpoint } from '../src/index.js';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').replace(/\*\//g, '* /').trim();

function inputKind(e: Endpoint): 'none' | 'optional' | 'required' {
  if (e.params || e.body || e.multipart) return 'required';
  if (e.query) return e.query.safeParse({}).success ? 'optional' : 'required';
  return 'none';
}

const bodyKind = (e: Endpoint) => (e.multipart ? 'multipart' : e.body ? 'json' : null);
const responseKind = (e: Endpoint) => (e.response.file ? 'file' : e.response.schema ? 'json' : 'empty');

export function renderClient(contractsImport = '../src/index.js'): string {
  const ops = ENDPOINTS.map((e) => {
    const kind = inputKind(e);
    const input = kind === 'none' ? '' : `input${kind === 'optional' ? '?' : ''}: OperationInput<'${e.id}'>, `;
    return {
      table: `  ${e.id}: { id: '${e.id}', method: '${e.method}', path: '${e.path}', body: ${bodyKind(e) ? `'${bodyKind(e)}'` : 'null'}, response: '${responseKind(e)}' },`,
      signature: `  /** ${oneLine(e.summary)} · \`${e.method} ${e.path}\` · ${e.milestone} */\n  ${e.id}(${input}options?: RequestOptions): Promise<OperationOutput<'${e.id}'>>;`,
      impl: `    ${e.id}: (${kind === 'none' ? 'options' : 'input, options'}) => request(OPERATIONS.${e.id}, ${kind === 'none' ? 'undefined' : 'input'}, options) as Promise<OperationOutput<'${e.id}'>>,`,
    };
  });
  // Lo que se ejecuta viene de `http-client`; el resto son tipos (se borran al compilar). Así un empaquetador (Vite) no arrastra
  // todos los esquemas Zod del API a la web.
  const runtimeImport = contractsImport.replace(/index\.js$/, 'http-client.js');
  return `// GENERADO por \`pnpm --filter @onway/contracts gen:client\` desde ENDPOINTS. No editar ni versionar.
import { createRequester, ApiError, type ClientOptions, type RequestOptions } from '${runtimeImport}';
import type { OperationInput, OperationOutput } from '${contractsImport}';

export { ApiError };
export type { ClientOptions, OperationInput, OperationOutput, RequestOptions };

/** Método, ruta y forma de cada operación. */
export const OPERATIONS = {
${ops.map((o) => o.table).join('\n')}
} as const;

export interface ApiClient {
${ops.map((o) => o.signature).join('\n')}
}

export function createApiClient(options: ClientOptions = {}): ApiClient {
  const request = createRequester(options);
  return {
${ops.map((o) => o.impl).join('\n')}
  };
}
`;
}
