import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveMigrationsFolder } from '../../src/db/migrate.js';

describe('Drizzle journal over the hand-written SQL (D-H0-04)', () => {
  const folder = resolveMigrationsFolder({});
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    dialect: string;
    entries: { idx: number; tag: string; when: number; breakpoints: boolean }[];
  };

  it('lists 0002 onwards, in order, without 0001 (superuser start-up)', () => {
    const files = readdirSync(folder)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith('0001_'))
      .map((f) => f.replace(/\.sql$/, ''))
      .sort();
    expect(journal.dialect).toBe('postgresql');
    expect(journal.entries.map((e) => e.tag)).toEqual(files);
    expect(journal.entries.map((e) => e.idx)).toEqual(files.map((_, i) => i));
  });

  it('has strictly increasing timestamps', () => {
    const whens = journal.entries.map((e) => e.when);
    expect(whens).toEqual([...whens].sort((a, b) => a - b));
    expect(new Set(whens).size).toBe(whens.length);
  });

  it('keeps each migration as one statement (no breakpoint markers in the SQL)', () => {
    for (const e of journal.entries) {
      expect(readFileSync(join(folder, `${e.tag}.sql`), 'utf8')).not.toContain('statement-breakpoint');
    }
  });
});
