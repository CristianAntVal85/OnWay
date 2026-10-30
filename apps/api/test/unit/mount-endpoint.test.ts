import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('the milestone limit of @Operation (rule 7)', () => {
  it('cannot be skipped by production code: mountEndpoint is used only where it is defined', () => {
    const users = files(src).filter((file) => readFileSync(file, 'utf8').includes('mountEndpoint'));
    expect(users.map((file) => file.slice(src.length + 1))).toEqual(['common/operation.ts']);
  });
});
