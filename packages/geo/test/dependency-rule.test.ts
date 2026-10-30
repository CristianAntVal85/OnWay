// Regla de dependencias del doc 04 §4: packages/* no importan apps/*, React ni NestJS.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FORBIDDEN: { why: string; test: (specifier: string) => boolean }[] = [
  { why: 'apps/*', test: (s) => /(^|\/)apps\//.test(s) || /^@onway\/(api|web)(\/|$)/.test(s) },
  { why: 'React', test: (s) => /^(react|react-dom|react-router|react-i18next|react-map-gl|@tanstack\/react-query)(\/|$)/.test(s) },
  { why: 'NestJS', test: (s) => /^@nestjs\//.test(s) },
];

/** Especificadores de módulo de un archivo TypeScript (import, export … from, import(), require()). */
export function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const re of patterns) for (const m of source.matchAll(re)) out.push(m[1]!);
  return out;
}

export function violations(source: string): string[] {
  return importSpecifiers(source).flatMap((s) => FORBIDDEN.filter((f) => f.test(s)).map((f) => `${s} (${f.why})`));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('packages/geo', () => {
  it('no importa apps/*, React ni NestJS', () => {
    const files = sourceFiles(join(root, 'src'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(violations(readFileSync(file, 'utf8')), file).toEqual([]);
  });

  it('no declara esas dependencias en package.json', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const declared = ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap((k) => Object.keys(pkg[k] ?? {}));
    expect(declared.filter((d) => FORBIDDEN.some((f) => f.test(d)))).toEqual([]);
  });

  it('la comprobación detecta cada tipo de importación prohibida', () => {
    expect(violations(`import { x } from '../../apps/api/src/x.js';`)).toHaveLength(1);
    expect(violations(`import React from 'react';`)).toHaveLength(1);
    expect(violations(`import { useQuery } from '@tanstack/react-query';`)).toHaveLength(1);
    expect(violations(`import { Module } from '@nestjs/common';`)).toHaveLength(1);
    expect(violations(`const m = await import('react-dom/client');`)).toHaveLength(1);
    expect(violations(`const x = require('@nestjs/core');`)).toHaveLength(1);
    expect(violations(`import { a } from './local.js';\nimport { z } from 'zod';`)).toEqual([]);
  });
});
