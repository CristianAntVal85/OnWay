import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@onway/contracts';
import { LOCALES, errorKey, es, fr, resources } from '../src/index.js';

type Tree = { [key: string]: string | Tree };

/** Claves de hoja con ruta, p. ej. `login.title`. */
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!).sort();

/** Claves que tiene una y no la otra. */
function keyDifference(a: Tree, b: Tree) {
  const fa = Object.keys(flatten(a));
  const fb = new Set(Object.keys(flatten(b)));
  return { onlyInA: fa.filter((k) => !fb.has(k)), onlyInB: [...fb].filter((k) => !fa.includes(k)) };
}

describe('paridad es / fr', () => {
  it('tienen exactamente las mismas claves', () => {
    expect(keyDifference(es as unknown as Tree, fr as unknown as Tree)).toEqual({ onlyInA: [], onlyInB: [] });
  });

  it('la comprobación detecta una clave que falta', () => {
    expect(keyDifference({ a: 'x', b: { c: 'y' } }, { a: 'x', b: {} })).toEqual({ onlyInA: ['b.c'], onlyInB: [] });
    expect(keyDifference({ a: 'x' }, { a: 'x', z: 'q' })).toEqual({ onlyInA: [], onlyInB: ['z'] });
  });

  it('ningún texto está vacío', () => {
    for (const locale of LOCALES) {
      for (const [key, text] of Object.entries(flatten(resources[locale].translation as unknown as Tree))) {
        expect(text.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('los marcadores {{…}} coinciden entre idiomas', () => {
    const fes = flatten(es as unknown as Tree);
    const ffr = flatten(fr as unknown as Tree);
    for (const key of Object.keys(fes)) expect(placeholders(ffr[key] ?? ''), key).toEqual(placeholders(fes[key]!));
  });
});

describe('errores (doc 06, AC-05)', () => {
  it.each(LOCALES)('%s tiene un texto por cada código de ERROR_HTTP y ninguno de más', (locale) => {
    const errors = Object.keys(resources[locale].translation.errors).sort();
    expect(errors).toEqual([...ERROR_CODES].sort());
  });

  it('errorKey apunta a una clave existente de cada idioma', () => {
    for (const locale of LOCALES) {
      const flat = flatten(resources[locale].translation as unknown as Tree);
      for (const code of ERROR_CODES) expect(flat[errorKey(code)], `${locale}:${code}`).toBeTruthy();
    }
  });

  it('los códigos con plazo llevan su marcador', () => {
    for (const locale of LOCALES) {
      expect(placeholders(resources[locale].translation.errors.ACCOUNT_LOCKED)).toEqual(['seconds']);
      expect(placeholders(resources[locale].translation.errors.RATE_LIMITED)).toEqual(['seconds']);
    }
  });
});
