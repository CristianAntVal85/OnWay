import { z } from 'zod';

/** Todos los nombres de propiedad que aparecen en un esquema (recursivo), vía JSON Schema. */
export function propertyNames(schema: z.ZodType, io: 'input' | 'output' = 'output'): Set<string> {
  const js = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' });
  const out = new Set<string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (o.properties && typeof o.properties === 'object') for (const k of Object.keys(o.properties)) out.add(k);
      Object.values(o).forEach(walk);
    }
  };
  walk(js);
  return out;
}

export const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const NOW = '2026-10-29T10:00:00Z';
