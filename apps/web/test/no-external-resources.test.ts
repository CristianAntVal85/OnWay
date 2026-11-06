// Sin analítica ni recursos externos (doc 04 §10): ni fuentes, ni scripts, ni imágenes de terceros.
// Única excepción (D-H1-08): los servicios WMTS de IGN, declarados en UN solo módulo (src/map/ign.ts) y repetidos en la CSP de Caddy.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IGN_HOSTS } from '../src/map/ign';

const ROOT = join(import.meta.dirname, '..');
const IGN_MODULE = 'src/map/ign.ts';
const ABSOLUTE_URL = /(?:https?:)?\/\/([\w.-]+\.[a-z]{2,})[^\s'")]*/gi;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(css|html|tsx?|svg)$/.test(name) ? [full] : [];
  });
}

/** Anfitriones de las direcciones absolutas de un archivo. */
function hostsIn(file: string): string[] {
  return (
    [...readFileSync(file, 'utf8').matchAll(ABSOLUTE_URL)]
      // `xmlns` de un SVG es un identificador de espacio de nombres, no una petición.
      .filter((match) => match[0] !== 'http://www.w3.org/2000/svg')
      .map((match) => match[1]!.toLowerCase())
  );
}

const targets = () => [join(ROOT, 'index.html'), ...files(join(ROOT, 'src')), ...files(join(ROOT, 'public'))];

describe('sin recursos externos', () => {
  it('ni el HTML, ni el CSS, ni el código de la web, ni los iconos apuntan a una dirección absoluta, salvo el módulo de IGN', () => {
    const offenders = targets()
      .filter((file) => relative(ROOT, file) !== IGN_MODULE)
      .flatMap((file) => hostsIn(file).map((host) => `${relative(ROOT, file)}: ${host}`));
    expect(offenders).toEqual([]);
  });

  it('el módulo de IGN declara exactamente los dos servicios WMTS verificados, y la lista exportada coincide', () => {
    const hosts = [...new Set(hostsIn(join(ROOT, IGN_MODULE)))].sort();
    expect(hosts).toEqual(['data.geopf.fr', 'www.ign.es']);
    expect([...IGN_HOSTS].sort()).toEqual(hosts);
  });

  it('la CSP de Caddy admite esos mismos anfitriones en img-src y connect-src, y ninguno más', () => {
    const caddyfile = readFileSync(join(ROOT, '../../infra/Caddyfile'), 'utf8');
    const csp = /Content-Security-Policy\s+"([^"]+)"/.exec(caddyfile)?.[1];
    expect(csp).toBeTruthy();
    const directives = new Map(
      csp!
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .map(([name, ...values]) => [name!, values]),
    );
    const external = (name: string) =>
      (directives.get(name) ?? [])
        .filter((value) => /^https?:\/\//.test(value))
        .map((value) => new URL(value).host)
        .sort();
    expect(external('img-src')).toEqual([...IGN_HOSTS].sort());
    expect(external('connect-src')).toEqual([...IGN_HOSTS].sort());
    for (const [name, values] of directives) {
      if (name === 'img-src' || name === 'connect-src') continue;
      expect(
        values.filter((value) => /^https?:\/\//.test(value)),
        name,
      ).toEqual([]);
    }
  });

  it('ningún CSS de src/ importa nada ni carga fuentes remotas (styles.css, theme/tokens.css y los que vengan)', () => {
    const sheets = files(join(ROOT, 'src')).filter((file) => file.endsWith('.css'));
    const names = sheets.map((file) => relative(ROOT, file));
    expect(names).toContain('src/styles.css');
    expect(names).toContain('src/theme/tokens.css');
    for (const sheet of sheets) {
      expect(readFileSync(sheet, 'utf8'), relative(ROOT, sheet)).not.toMatch(/@import|@font-face|url\(/);
    }
  });
});
