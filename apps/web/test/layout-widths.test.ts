// Anchos (plan UI-rediseno §2 «Anchos», T6): el contenido se centra debajo de la cabecera, que sigue a todo el ancho, y cada tipo de
// página tiene su ancho: lectura y formularios (64rem), listas y tablas (`.page-wide-flow`, 80rem) y páginas con mapa (`.page-wide`, sin
// límite). El acceso y las pantallas sueltas también se centran. Esta prueba vigila la hoja y la clase de cada página; las medidas en
// pantalla (centrado ±1 px, hueco máximo) están en `specs/UI-rediseno/medidas.md` §6 y las repite la demostración de T9.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const css = read('src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Cuerpos de todos los bloques cuyo selector es exactamente `selector` (en cualquier profundidad de @media). */
function bodies(selector: string): string[] {
  const out: string[] = [];
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (sel!.split(',').some((part) => part.trim() === selector)) out.push(body!);
  }
  return out;
}

/** Valor de la última declaración de `property` entre los bloques de `selector`, o `undefined`. */
function value(selector: string, property: string): string | undefined {
  const all = bodies(selector).flatMap((body) => body.split(';'));
  const found = all
    .map((decl) => decl.split(/:(.*)/s))
    .filter(([name]) => name?.trim() === property)
    .map(([, v]) => v?.trim());
  return found.at(-1);
}

describe('anchos de página (T6)', () => {
  it('`.content` se centra y su ancho por defecto es el de lectura y formularios', () => {
    expect(value('.content', 'max-width')).toBe('64rem');
    expect(value('.content', 'margin-inline')).toBe('auto');
  });

  it('las listas y tablas llegan a 80rem y las páginas con mapa no tienen límite, las dos centradas por `.content`', () => {
    expect(value('.content:has(.page-wide-flow)', 'max-width')).toBe('80rem');
    expect(value('.content:has(.page-wide)', 'max-width')).toBe('none');
  });

  it('el tipo de página no recorta el ancho con otro `max-width` en `.content`', () => {
    const widths = bodies('.content').flatMap((body) => [...body.matchAll(/max-width:\s*([^;]+)/g)].map((m) => m[1]!.trim()));
    expect(widths).toEqual(['64rem']);
  });

  it('el acceso y las pantallas sueltas se centran', () => {
    for (const selector of ['.login-main', '.single-main']) {
      expect(value(selector, 'margin-inline'), selector).toBe('auto');
    }
  });

  it('la cabecera no tiene límite de ancho', () => {
    for (const selector of ['.app-header', '.app-header-bar', '.main-nav']) {
      expect(value(selector, 'max-width'), selector).toBeUndefined();
    }
  });

  it('los `max-width` que quedan son medida de lectura, diálogos, celdas o el recuadro que no desborda', () => {
    const ALLOWED = new Set([
      'var(--measure)', // párrafos, estados, paneles: medida de lectura
      '100%', // no desbordar al contenedor
      '30rem', // formulario de acceso
      '38rem', // pantallas sueltas
      '34rem', // diálogos
      '44rem', // diálogo de añadir ruta
      '48rem', // sección de Administración (columna de lectura)
      '22rem', // celda de la ruta en la tabla de la misión
      '14rem', // nombre de la organización en la cabecera
      '64rem', // .content
      '80rem', // .content:has(.page-wide-flow)
      'none', // .content:has(.page-wide)
    ]);
    const found = [...css.matchAll(/max-width:\s*([^;}]+)/g)].map((m) => m[1]!.trim());
    expect(found.filter((width) => !ALLOWED.has(width))).toEqual([]);
  });
});

describe('cada página lleva la clase de su tipo', () => {
  const WIDE = ['create-mission-page', 'mission-detail-page', 'my-mission-detail-page', 'routes-page', 'route-detail-page', 'route-editor-page', 'generate-routes-page', 'import-route-page'];
  const FLOW = ['home-page', 'my-missions-page', 'missions-page'];
  // Lectura y formularios (sin clase, 64rem): Administración, Cuenta, Mi perfil, 403, 404 y «más adelante».
  const READING = ['admin-page', 'account-page', 'profile-page', 'forbidden-page', 'not-found-page', 'later-page'];

  it.each(WIDE)('%s es una página con mapa (page-wide)', (page) => {
    expect(read(`src/pages/${page}.tsx`)).toMatch(/className="[^"]*\bpage-wide\b(?!-)[^"]*"/);
  });

  it.each(FLOW)('%s es una lista (page-wide-flow)', (page) => {
    expect(read(`src/pages/${page}.tsx`)).toMatch(/className="[^"]*\bpage-wide-flow\b[^"]*"/);
  });

  it.each(READING)('%s es de lectura (ni page-wide ni page-wide-flow)', (page) => {
    expect(read(`src/pages/${page}.tsx`)).not.toMatch(/\bpage-wide/);
  });
});
