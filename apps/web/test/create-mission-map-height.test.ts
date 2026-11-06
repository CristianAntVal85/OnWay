// Alto del mapa de Crear misión (plan UI-rediseno §2, T7). En escritorio (>= 64rem) el mapa llena su sección pegada (`.split-map`, sin
// hueco debajo); en columna (< 64rem) mide `clamp(20rem, 42dvh, 36rem)`: nunca menos que los 320 px de siempre y, a 375x812 y a 768x1024,
// al menos el 40 % del alto de la ventana (umbral de `specs/UI-rediseno/medidas.md` §6). Esta prueba vigila la hoja y hace la cuenta del
// `clamp`; las medidas en pantalla (alto, sin solape con el primer campo, barra inferior) están en `medidas.md` §10.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const raw = readFileSync(join(ROOT, 'src/styles.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const REM = 16;

/** Bloques `selector { cuerpo }` en orden de aparición, con la posición de cada uno y si cuelgan de `@media (min-width: 64rem)`. */
function blocks(selector: string): { index: number; body: string; desktop: boolean }[] {
  const desktopRanges: [number, number][] = [];
  for (const m of css.matchAll(/@media \(min-width: 64rem\)\s*\{/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    while (depth > 0 && i < css.length) {
      depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
      i++;
    }
    desktopRanges.push([m.index!, i]);
  }
  const out: { index: number; body: string; desktop: boolean }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(',').some((part) => part.trim() === selector)) {
      out.push({ index: m.index!, body: m[2]!, desktop: desktopRanges.some(([from, to]) => m.index! >= from && m.index! < to) });
    }
  }
  return out;
}

const declarations = (body: string, property: string) =>
  body
    .split(';')
    .map((d) => d.split(/:(.*)/s))
    .filter(([name]) => name?.trim() === property)
    .map(([, v]) => v!.trim());

describe('alto del mapa de Crear misión (T7)', () => {
  const column = blocks('.split-map .map-canvas').filter((b) => !b.desktop);
  const desktop = blocks('.split-map .map-canvas').filter((b) => b.desktop);

  it('en columna el mapa tiene su regla, con un respaldo sin `dvh` justo antes', () => {
    expect(column).toHaveLength(1);
    const heights = declarations(column[0]!.body, 'height');
    expect(heights).toHaveLength(2);
    expect(heights[0]).toMatch(/^clamp\(20rem, \d+vh, 36rem\)$/);
    expect(heights[1]).toMatch(/^clamp\(20rem, \d+dvh, 36rem\)$/);
    expect(heights[0]!.replace('vh', 'dvh')).toBe(heights[1]);
  });

  it('cumple los umbrales de medidas.md a 375x812, 375x667, 768x1024 y 819x614', () => {
    const [, min, share, max] = declarations(column[0]!.body, 'height')[1]!
      .match(/^clamp\((\d+)rem, (\d+)dvh, (\d+)rem\)$/)!
      .map(Number) as [number, number, number, number];
    const heightAt = (viewport: number) => Math.min(Math.max(min * REM, (share / 100) * viewport), max * REM);
    expect(heightAt(812) / 812).toBeGreaterThanOrEqual(0.4);
    expect(heightAt(1024) / 1024).toBeGreaterThanOrEqual(0.4);
    expect(heightAt(667)).toBeGreaterThanOrEqual(320);
    expect(heightAt(614)).toBeGreaterThanOrEqual(320);
    // nunca por debajo de lo de siempre (20rem) ni tan alto que el formulario quede a varias pantallas
    expect(min * REM).toBe(320);
    expect(heightAt(100000)).toBeLessThanOrEqual(576);
  });

  it('en escritorio el mapa sigue llenando su sección (sin alto propio), después de la regla de columna', () => {
    expect(desktop).toHaveLength(1);
    expect(declarations(desktop[0]!.body, 'flex')).toEqual(['1 1 auto']);
    expect(declarations(desktop[0]!.body, 'height')).toEqual(['auto']);
    expect(desktop[0]!.index).toBeGreaterThan(column[0]!.index);
  });

  it('la regla de columna no toca los demás mapas (biblioteca, detalle, ruta, editor)', () => {
    expect(css.match(/\.map-canvas\s*\{[^}]*height:\s*20rem/g)).toHaveLength(1);
    for (const selector of ['.library-map-view .map-canvas', '.route-map-view .map-canvas', '.editor-map-view .map-canvas']) {
      expect(blocks(selector).length, selector).toBeGreaterThan(0);
    }
  });

  it('la barra inferior fija deja sitio al foco: `scroll-padding-bottom` cubre su alto máximo medido (136 px)', () => {
    const [padding] = blocks('html:has(.action-bar)').flatMap((b) => declarations(b.body, 'scroll-padding-bottom'));
    expect(padding).toMatch(/^\d+(\.\d+)?rem$/);
    expect(parseFloat(padding!) * REM).toBeGreaterThanOrEqual(136);
  });

  it('sin `!important`', () => {
    expect(css).not.toMatch(/!important/);
  });
});
