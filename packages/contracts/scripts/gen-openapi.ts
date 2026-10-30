// Genera openapi.json a partir del registro. Uso: tsx scripts/gen-openapi.ts [salida]
import { writeFileSync } from 'node:fs';
import { ENDPOINTS, allErrors, ERROR_HTTP, ErrorResponse } from '../src/index.js';
import { toJson } from './jsonschema.js';

const out = process.argv[2] ?? 'openapi.json';
const paths: Record<string, Record<string, unknown>> = {};

for (const e of ENDPOINTS) {
  if (e.delivery === 'pendiente') continue; // Q-33: fuera del contrato publicado hasta decidirlo
  const parameters: unknown[] = [];
  if (e.params) for (const [name, schema] of Object.entries(toJson(e.params, 'input').properties ?? {})) parameters.push({ name, in: 'path', required: true, schema });
  if (e.query) {
    const js = toJson(e.query, 'input');
    for (const [name, schema] of Object.entries(js.properties ?? {})) parameters.push({ name, in: 'query', required: (js.required ?? []).includes(name), schema });
  }
  const responses: Record<string, unknown> = {};
  const ok = e.response;
  responses[String(ok.status)] = ok.schema
    ? { description: 'OK', content: { 'application/json': { schema: toJson(ok.schema, 'output') } } }
    : ok.file
      ? { description: 'Archivo', content: Object.fromEntries(ok.file.split(' | ').map((t) => [t, { schema: { type: 'string', format: 'binary' } }])) }
      : { description: 'Sin contenido' };
  const byStatus = new Map<number, string[]>();
  for (const c of allErrors(e)) byStatus.set(ERROR_HTTP[c], [...(byStatus.get(ERROR_HTTP[c]) ?? []), c]);
  for (const [status, codes] of byStatus) responses[String(status)] = { description: codes.join(' | '), content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } };

  const op: Record<string, unknown> = {
    operationId: e.id,
    'x-milestone': e.milestone,
    tags: [e.tag],
    summary: e.summary,
    description: [e.notes, e.delivery === 2 ? 'Segunda entrega: responde 501 hasta entonces.' : '', e.audited ? 'Deja registro en audit_log.' : ''].filter(Boolean).join('\n\n') || undefined,
    parameters: parameters.length ? parameters : undefined,
    security: e.roles.includes('public') ? [] : [{ cookieAuth: [] }],
    'x-roles': e.roles,
    responses,
  };
  if (e.body) op.requestBody = { required: true, content: { 'application/json': { schema: toJson(e.body, 'input') } } };
  if (e.multipart)
    op.requestBody = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['file', ...Object.keys(toJson(e.multipart, 'input').properties ?? {})],
            properties: { ...toJson(e.multipart, 'input').properties, file: { type: 'string', format: 'binary' } },
          },
        },
      },
    };
  (paths[`/api/v1${e.path}`] ??= {})[e.method.toLowerCase()] = op;
}

const doc = {
  openapi: '3.1.0',
  info: { title: 'OnWay API', version: '1.0.0', description: 'Generado desde packages/contracts. No editar a mano.' },
  servers: [{ url: '/' }],
  paths,
  components: {
    schemas: { ErrorResponse: toJson(ErrorResponse, 'output') },
    securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'onway_session', description: 'Sesión. Las peticiones que modifican datos llevan además la cabecera X-CSRF-Token.' } },
  },
};
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`OpenAPI: ${Object.keys(paths).length} rutas, ${Object.values(paths).reduce((n, p) => n + Object.keys(p).length, 0)} operaciones → ${out}`);
