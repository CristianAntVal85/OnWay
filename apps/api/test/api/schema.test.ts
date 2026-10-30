import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import * as schemaModule from '../../src/db/schema.js';
import { Fixtures } from '../support/fixtures.js';

let fixtures: Fixtures;

beforeAll(() => {
  fixtures = new Fixtures(inject('database').owner);
});

afterAll(async () => {
  await fixtures?.close();
});

/** Drizzle spells some types differently from `format_type`. */
const normalize = (type: string) => type.replace(/^char\((\d+)\)$/, 'character($1)');

describe('the Drizzle schema matches the migrated database (D-H0-01)', () => {
  const tables = Object.values(schemaModule.schema) as PgTable[];

  it('covers the tables H0 uses', () => {
    expect(tables.map((t) => getTableConfig(t).name).sort()).toEqual(['memberships', 'organizations', 'rescuer_profiles', 'sessions', 'team_members', 'teams', 'users']);
  });

  for (const table of tables) {
    const config = getTableConfig(table);

    it(`${config.name}: same columns, types, nullability and primary key`, async () => {
      const real = await fixtures.query<{ name: string; type: string; notnull: boolean }>(
        `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attname`,
        [config.name],
      );
      const declared = config.columns.map((c) => ({ name: c.name, type: normalize(c.getSQLType()), notnull: c.notNull })).sort((x, y) => (x.name < y.name ? -1 : 1));
      expect(declared).toEqual(real);

      const primary = await fixtures.query<{ name: string }>(
        `SELECT a.attname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
          WHERE i.indisprimary AND c.relname = $1 ORDER BY a.attname`,
        [config.name],
      );
      const declaredPrimary = [...config.columns.filter((c) => c.primary).map((c) => c.name), ...config.primaryKeys.flatMap((k) => k.columns.map((c) => c.name))].sort();
      expect(declaredPrimary).toEqual(primary.map((p) => p.name));
    });
  }

  it('declares the enums with the same values and order', async () => {
    const enums = Object.values(schemaModule.enums);
    expect(enums.length).toBe(5);
    for (const e of enums) {
      const rows = await fixtures.query<{ label: string }>(`SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder`, [
        e.enumName,
      ]);
      expect(e.enumValues).toEqual(rows.map((r) => r.label));
    }
  });
});
