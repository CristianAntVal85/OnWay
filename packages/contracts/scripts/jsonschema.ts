import { z } from 'zod';

// El esquema JSON es dinámico por naturaleza: `any` se queda confinado a este alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;

export const toJson = (s: z.ZodType, io: 'input' | 'output'): J => z.toJSONSchema(s, { io, unrepresentable: 'any', target: 'draft-2020-12', reused: 'inline' }) as J;

/** Tipo legible de un nodo JSON Schema: uuid, string, int, enum(a|b), array<…>, objeto{…}. */
export function typeOf(n: J): string {
  if (!n) return 'any';
  if (n.anyOf || n.oneOf) {
    const parts = (n.anyOf ?? n.oneOf) as J[];
    const nonNull = parts.filter((p) => p.type !== 'null');
    const nullable = nonNull.length !== parts.length;
    const inner = nonNull.map(typeOf).join(' | ');
    return nullable ? `${inner} \\| null` : inner;
  }
  if (n.const !== undefined) return JSON.stringify(n.const);
  if (n.enum) return n.enum.map(String).join(' \\| ');
  switch (n.type) {
    case 'string':
      if (n.format === 'uuid') return 'uuid';
      if (n.format === 'date-time') return 'fecha-hora';
      if (n.format === 'date') return 'fecha';
      if (n.format === 'email') return 'correo';
      if (n.format === 'uri') return 'url';
      return 'texto';
    case 'integer':
      return 'entero';
    case 'number':
      return 'número';
    case 'boolean':
      return 'booleano';
    case 'array':
      return n.prefixItems ? `[${n.prefixItems.map(typeOf).join(', ')}]` : `lista de ${typeOf(n.items)}`;
    case 'object':
      return n.properties ? 'objeto' : 'objeto libre';
    case 'null':
      return 'null';
    default:
      return n.type ?? 'any';
  }
}

export interface Row {
  path: string;
  type: string;
  required: boolean;
  note: string;
}

/** Aplana las propiedades de un esquema hasta `depth` niveles de objetos anidados. */
export function flatten(n: J, prefix = '', depth = 2, required = true): Row[] {
  const rows: Row[] = [];
  const props: J | undefined = n.properties ?? (n.anyOf ? undefined : undefined);
  if (n.anyOf && !props) {
    const objs = (n.anyOf as J[]).filter((p) => p.properties);
    if (objs.length) objs.forEach((o) => rows.push(...flatten(o, prefix, depth, required)));
    return dedupe(rows);
  }
  if (!props) return rows;
  const req = new Set<string>(n.required ?? []);
  for (const [k, v] of Object.entries<J>(props)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const isReq = required && req.has(k);
    const lim = (x: number | undefined) => (x === undefined || Math.abs(x) > 1e15 ? undefined : x);
    const note = [
      lim(v.minimum) !== undefined ? `≥${v.minimum}` : '',
      lim(v.maximum) !== undefined ? `≤${v.maximum}` : '',
      v.minLength ? `min ${v.minLength}` : '',
      v.maxLength ? `máx ${v.maxLength}` : '',
      v.default !== undefined ? `por defecto ${JSON.stringify(v.default)}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    rows.push({ path, type: typeOf(v), required: isReq, note });
    const arr = v.type === 'array' ? v : v.anyOf?.find((p: J) => p.type === 'array' && p.items?.type === 'object');
    const obj = v.type === 'object' ? v : v.anyOf?.find((p: J) => p.type === 'object' && p.properties);
    if (depth > 1 && arr?.items?.properties) rows.push(...flatten(arr.items, `${path}[]`, depth - 1, isReq));
    else if (depth > 1 && obj?.properties) rows.push(...flatten(obj, path, depth - 1, isReq));
  }
  return dedupe(rows);
}
const dedupe = (rows: Row[]) => {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
};
