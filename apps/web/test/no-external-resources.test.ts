// Sin analítica ni recursos externos (doc 04 §10): ni fuentes, ni scripts, ni imágenes de terceros.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(css|html|tsx?|svg)$/.test(name) ? [full] : [];
  });
}

describe('sin recursos externos', () => {
  it('ni el HTML, ni el CSS, ni el código de la web, ni los iconos apuntan a una dirección absoluta', () => {
    const targets = [join(ROOT, 'index.html'), ...files(join(ROOT, 'src')), ...files(join(ROOT, 'public'))];
    const offenders = targets.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:https?:)?\/\/[\w.-]+\.[a-z]{2,}[^\s'")]*/gi)]
        .map((match) => match[0])
        // `xmlns` de un SVG es un identificador de espacio de nombres, no una petición.
        .filter((url) => url !== 'http://www.w3.org/2000/svg')
        .map((url) => `${relative(ROOT, file)}: ${url}`),
    );
    expect(offenders).toEqual([]);
  });

  it('el CSS no importa nada ni carga fuentes remotas', () => {
    const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8');
    expect(css).not.toMatch(/@import|@font-face|url\(/);
  });
});
