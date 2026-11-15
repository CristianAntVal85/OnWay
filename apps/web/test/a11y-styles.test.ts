// Accesibilidad de la hoja en los dos temas (plan UI-rediseno T8, doc 01 §7, doc 04 §3): `forced-colors: active` para todo lo que solo se
// distingue por fondo, ninguna transición al cambiar de tema (y las nuevas, solo con `prefers-reduced-motion: no-preference`) y foco visible
// contra cada superficie de los dos temas. Lee `src/styles.css` y `src/theme/tokens.css`; no mide píxeles (eso se mira con DevTools).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const STYLES = strip(readFileSync(join(ROOT, 'src/styles.css'), 'utf8'));
const TOKENS = strip(readFileSync(join(ROOT, 'src/theme/tokens.css'), 'utf8'));

interface Rule {
  selectors: string[];
  media: string[];
  declarations: Array<{ property: string; value: string }>;
}

const normalize = (selector: string) => selector.replace(/\s+/g, ' ').trim();

/** Reglas de una hoja con las condiciones de `@media` que las envuelven (las de `@keyframes` y similares no cuentan como reglas). */
function parse(css: string, media: string[] = []): Rule[] {
  const rules: Rule[] = [];
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf('{', index);
    if (open < 0) break;
    const prelude = css.slice(index, open).trim();
    let depth = 1;
    let end = open + 1;
    while (end < css.length && depth > 0) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}') depth--;
      end++;
    }
    const body = css.slice(open + 1, end - 1);
    if (prelude.startsWith('@media')) rules.push(...parse(body, [...media, prelude.slice(6).trim()]));
    else if (!prelude.startsWith('@')) {
      const declarations = body
        .split(';')
        .map((part) => ({ colon: part.indexOf(':'), part }))
        .filter(({ colon }) => colon > 0)
        .map(({ colon, part }) => ({ property: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() }));
      rules.push({ selectors: prelude.split(',').map(normalize), media, declarations });
    }
    index = end;
  }
  return rules;
}

const RULES = parse(STYLES);
const isForced = (rule: Rule) => rule.media.some((condition) => /forced-colors\s*:\s*active/.test(condition));
const FORCED = RULES.filter(isForced);
const BASE = RULES.filter((rule) => !isForced(rule));

/** Colores de sistema (los únicos que sobreviven a `forced-colors`), más las palabras clave que no son un color propio. */
const SYSTEM =
  /^(?:canvas|canvastext|linktext|visitedtext|activetext|buttonface|buttontext|buttonborder|field|fieldtext|highlight|highlighttext|selecteditem|selecteditemtext|mark|marktext|graytext|accentcolor|accentcolortext|transparent|currentcolor|inherit|none)$/i;
const COLOR_PROPERTY = /^(?:color|background|background-color|border(?:-[a-z]+)*-color|outline-color|text-decoration-color|fill|stroke)$/;

/** ¿La regla de `forced-colors` aporta algo que no es el fondo? Borde, contorno, subrayado o dejar los colores como están. */
function hasCue(rule: Rule): boolean {
  return rule.declarations.some(
    ({ property, value }) =>
      /^(?:border|outline|text-decoration|forced-color-adjust|filter)/.test(property) ||
      (/^(?:background|background-color|background-image|color)$/.test(property) && /\b(?:Highlight|HighlightText|CanvasText|GrayText|LinkText)\b/.test(value)),
  );
}

const covered = (selector: string) => FORCED.some((rule) => rule.selectors.includes(selector) && hasCue(rule));

describe('forced-colors: lo que solo se distingue por fondo no se pierde', () => {
  // El estado de un elemento (pulsado, seleccionado, actual, marcado, un `data-*`) que hoy se pinta con un fondo: sin fondo propio en
  // `forced-colors`, el estado se borraría.
  const STATE = /\[(?:aria-(?:pressed|selected|current|checked|invalid)|data-[\w-]+)|:checked/;
  const discovered = [
    ...new Set(
      BASE.filter((rule) => rule.declarations.some(({ property }) => /^background(?:-color)?$/.test(property)))
        .flatMap((rule) => rule.selectors)
        .filter((selector) => STATE.test(selector)),
    ),
  ];

  it('la búsqueda encuentra los estados con fondo que la hoja usa (pulsado, insignias, filas marcadas…)', () => {
    expect(discovered).toEqual(
      expect.arrayContaining([
        '.segment input:checked + span',
        ".tab[aria-selected='true']",
        ".mission-pick[aria-pressed='true']",
        ".status-badge[data-status='active']",
        ".status-badge[data-version='validated']",
        ".status-badge[data-signup='rejected']",
        '.route-card[data-selected]',
        '.signup-row[data-checked]',
      ]),
    );
    expect(discovered.length).toBeGreaterThan(20);
  });

  it.each(discovered)('%s tiene su bloque de forced-colors con algo más que el fondo', (selector) => {
    expect(covered(selector), `Falta un bloque @media (forced-colors: active) para ${selector}`).toBe(true);
  });

  it.each([
    // lo que tiene color propio y no cambia de estado: bandas de vías, marcas, marcadores, manijas y el indicador de carga
    '.road-mix-road',
    '.road-mix-track',
    '.road-mix-path',
    '.road-mix-offtrail',
    '.road-mix-unknown',
    ".main-nav a[aria-current='page']::before",
    '.map-marker',
    '.vertex-handle',
    '.spinner',
    '.blaze',
    '.mission-card[data-picked]',
    '.map-view .maplibregl-ctrl-group .maplibregl-ctrl-icon',
  ])('%s tiene su bloque de forced-colors', (selector) => {
    expect(covered(selector), `Falta un bloque @media (forced-colors: active) para ${selector}`).toBe(true);
  });

  it('todo lo que se pinta con Highlight lleva forced-color-adjust: none (si no, Chrome pone tras el texto un fondo Canvas y HighlightText no se lee)', () => {
    const highlighted = FORCED.filter((rule) => rule.declarations.some(({ property, value }) => /^background/.test(property) && /\bHighlight\b/.test(value)));
    expect(highlighted.length).toBeGreaterThan(0);
    for (const rule of highlighted) {
      expect(
        rule.declarations.some(({ property, value }) => property === 'forced-color-adjust' && value.startsWith('none')),
        rule.selectors.join(', '),
      ).toBe(true);
    }
  });

  it('la marca de sendero lleva marco de texto sobre las superficies donde su borde era transparente (el blanco se perdería sobre un Canvas claro)', () => {
    const rule = FORCED.find((candidate) => candidate.selectors.includes('.app-header-bar .blaze'));
    expect(rule?.declarations.find(({ property }) => property === 'border-color')?.value).toBe('CanvasText');
  });

  it('cada banda de la composición por tipo de vía se dibuja con un patrón distinto (no solo con color)', () => {
    const kinds = ['road', 'track', 'path', 'offtrail', 'unknown'];
    const patterns = kinds.map((kind) => {
      const rule = FORCED.find((candidate) => candidate.selectors.includes(`.road-mix-${kind}`));
      const background = rule?.declarations
        .filter(({ property }) => /^background/.test(property))
        .map(({ property, value }) => `${property}:${value}`)
        .join(';');
      return background;
    });
    for (const [index, pattern] of patterns.entries()) expect(pattern, `.road-mix-${kinds[index]}`).toBeTruthy();
    // Chrome deja `background-image: none` con forced-colors: active: sin forced-color-adjust: none los patrones desaparecen
    for (const kind of kinds) {
      const rule = FORCED.find((candidate) => candidate.selectors.includes(`.road-mix-${kind}`));
      expect(
        rule?.declarations.some(({ property, value }) => property === 'forced-color-adjust' && value === 'none'),
        `.road-mix-${kind}`,
      ).toBe(true);
    }
    expect(new Set(patterns).size).toBe(kinds.length);
  });

  it('las insignias se distinguen por el trazo del borde (continuo, discontinuo, punteado, doble), que sobrevive a forced-colors', () => {
    const styles = new Set<string>();
    for (const rule of FORCED) {
      if (!rule.selectors.some((selector) => selector.startsWith('.status-badge['))) continue;
      for (const { property, value } of rule.declarations) if (property === 'border-style') styles.add(value);
    }
    expect([...styles].sort()).toEqual(['dashed', 'dotted', 'double', 'solid']);
  });

  it('los bloques de forced-colors solo usan colores de sistema (los tokens los sustituiría el navegador) y no llevan !important', () => {
    for (const rule of FORCED) {
      if (rule.declarations.some(({ property, value }) => property === 'forced-color-adjust' && value === 'none')) continue;
      for (const { property, value } of rule.declarations) {
        if (!COLOR_PROPERTY.test(property)) continue;
        // sin los nombres de función (`repeating-linear-gradient(`) ni las medidas y palabras de forma de un degradado
        for (const word of value.replace(/[a-z-]+\(/gi, '(').match(/[a-zA-Z]+/g) ?? []) {
          if (/^(?:circle|deg|px|solid|dashed|dotted|double|no|repeat)$/i.test(word)) continue;
          expect(word, `${rule.selectors.join(', ')} { ${property}: ${value} }`).toMatch(SYSTEM);
        }
        expect(value, `${rule.selectors.join(', ')}`).not.toMatch(/var\(|#[0-9a-f]{3,8}\b/i);
      }
    }
    expect(STYLES).not.toMatch(/!important/);
  });

  it('forced-colors no quita el contorno del foco (solo se anula en los destinos programáticos tabindex=-1)', () => {
    for (const rule of RULES) {
      for (const { property, value } of rule.declarations) {
        if (property !== 'outline' && property !== 'outline-style') continue;
        if (!/^(?:none|0)$/.test(value)) continue;
        expect(rule.selectors, 'outline: none').toEqual(["[tabindex='-1']:focus"]);
      }
    }
  });
});

describe('movimiento: ninguna transición al cambiar de tema y todo lo nuevo, solo sin preferencia de reducir', () => {
  const NO_PREFERENCE = /prefers-reduced-motion\s*:\s*no-preference/;

  it('toda transición o desplazamiento suave va dentro de (prefers-reduced-motion: no-preference)', () => {
    for (const rule of RULES) {
      for (const { property, value } of rule.declarations) {
        // `transition: none` (y `0s`) no mueve nada: es justo lo que se pide con reduce
        const motion = (/^transition/.test(property) && !/^(?:none|0s)$/.test(value)) || (property === 'scroll-behavior' && value !== 'auto');
        if (!motion) continue;
        expect(
          rule.media.some((condition) => NO_PREFERENCE.test(condition)),
          `${rule.selectors.join(', ')} { ${property}: ${value} }`,
        ).toBe(true);
      }
    }
  });

  it('ninguna transición toca la raíz, el cuerpo, el atributo del tema ni el selector universal (cambiar de tema es instantáneo)', () => {
    const THEME_WIDE = /^(?:\*|:root|html|body|\[data-theme[^\]]*\](?:\s.*)?|html\[data-theme[^\]]*\])$/;
    for (const rule of RULES) {
      if (!rule.declarations.some(({ property }) => /^transition/.test(property))) continue;
      for (const selector of rule.selectors) expect(selector, 'selector con transición').not.toMatch(THEME_WIDE);
    }
    // y el tema no se cambia con una clase que active transiciones desde el código
    const themeSources = ['src/theme/theme-context.tsx', 'src/theme/theme.ts', 'public/theme-boot.js'].map((file) => readFileSync(join(ROOT, file), 'utf8'));
    for (const source of themeSources) expect(source).not.toMatch(/transition/i);
  });

  it('toda animación del mapa (easeTo, flyTo, fitBounds…) y todo desplazamiento suave de la interfaz consulta antes prefers-reduced-motion', () => {
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? sources(full) : /\.tsx?$/.test(name) ? [full] : [];
      });
    for (const file of sources(join(ROOT, 'src'))) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/behavior:\s*['"]smooth['"]/);
      if (!/\.(?:easeTo|flyTo|fitBounds|panTo|zoomTo|jumpTo)\(/.test(source)) continue;
      // las llamadas con duración la fijan en 0 si la persona pidió reducir el movimiento
      for (const call of source.match(/\.(?:easeTo|flyTo|fitBounds|panTo|zoomTo)\([\s\S]*?\)\s*;/g) ?? []) {
        expect(call, `${file}: ${call.slice(0, 60)}`).toMatch(/duration:\s*prefersReducedMotion\(\)\s*\?\s*0/);
      }
    }
  });

  it('con prefers-reduced-motion: reduce los marcadores de MapLibre no se desvanecen (su hoja les pone transition: opacity 0.2s)', () => {
    const rule = RULES.find((candidate) => candidate.selectors.includes('.map-view .maplibregl-marker') && candidate.media.some((condition) => /prefers-reduced-motion\s*:\s*reduce/.test(condition)));
    expect(rule?.declarations.find(({ property }) => property === 'transition')?.value).toBe('none');
  });

  it('toda animación tiene su alternativa en (prefers-reduced-motion: reduce)', () => {
    const animated = BASE.filter((rule) => rule.declarations.some(({ property, value }) => /^animation/.test(property) && value !== 'none'));
    expect(animated.length).toBeGreaterThan(0);
    for (const rule of animated) {
      for (const selector of rule.selectors) {
        const reduced = RULES.some(
          (candidate) =>
            candidate.media.some((condition) => /prefers-reduced-motion\s*:\s*reduce/.test(condition)) &&
            candidate.selectors.includes(selector) &&
            candidate.declarations.some(({ property, value }) => /^animation/.test(property) && value === 'none'),
        );
        expect(reduced, `${selector} sin alternativa para reduce`).toBe(true);
      }
    }
  });
});

describe('foco visible contra cada superficie de los dos temas', () => {
  type Tokens = Map<string, string>;
  const declarations = (needle: string): Tokens => {
    const tokens: Tokens = new Map();
    for (const [, selector, body] of TOKENS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selector!.includes(needle)) continue;
      for (const [, name, value] of body!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(name!, value!.trim());
    }
    return tokens;
  };
  const DARK = declarations("[data-theme='dark']");
  const LIGHT = declarations("[data-theme='light']");
  const resolve = (theme: Tokens, name: string): string => {
    const raw = theme.get(name) ?? DARK.get(name);
    if (raw === undefined) throw new Error(`Falta el token ${name}`);
    const reference = /^var\((--[\w-]+)\)$/.exec(raw);
    return reference ? resolve(theme, reference[1]!) : raw;
  };
  const luminance = (hex: string) => {
    const value = parseInt(hex.slice(1, 7), 16);
    const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
      const v = channel / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

  // Todo lo que puede haber detrás de un elemento enfocado: fondos de página, paneles, diálogos y barra, cabecera, avisos y el amarillo del enlace de salto.
  const SURFACES = ['--bg', '--surface', '--surface-raised', '--header-bg', '--success-soft', '--warn-soft', '--danger-soft', '--attention', '--accent'];

  const themes: Array<[string, Tokens]> = [
    ['oscuro', DARK],
    ['claro', LIGHT],
  ];

  it.each(themes)('%s: el anillo doble se ve contra cada superficie (al menos uno de los dos aros a 3:1) y sus dos aros se distinguen entre sí', (_name, theme) => {
    const outer = resolve(theme, '--focus');
    const inner = resolve(theme, '--focus-inner');
    expect(ratio(outer, inner), 'aro exterior contra aro interior').toBeGreaterThanOrEqual(3);
    for (const surface of SURFACES) {
      const behind = resolve(theme, surface);
      const best = Math.max(ratio(outer, behind), ratio(inner, behind));
      expect(best, `${surface} (${behind}): foco ${outer} / ${inner}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('el foco no se recorta: dentro de la tabla de vértices (overflow: auto) y sobre el lienzo del mapa (overflow: hidden) el anillo va por dentro', () => {
    const table = BASE.find((candidate) => candidate.selectors.includes('.vertex-scroll :focus-visible'));
    expect(table?.declarations.find(({ property }) => property === 'outline-offset')?.value).toBe('-3px');
    expect(table?.declarations.find(({ property }) => property === 'box-shadow')?.value).toBe('inset 0 0 0 5px var(--focus-inner)');
    const map = BASE.find((candidate) => candidate.selectors.some((selector) => selector.includes(':has(.maplibregl-canvas:focus-visible)::after')));
    const value = (property: string) => map?.declarations.find((declaration) => declaration.property === property)?.value;
    expect(value('outline')).toBe('3px solid var(--focus)');
    expect(value('outline-offset')).toBe('-3px');
    expect(value('box-shadow')).toBe('inset 0 0 0 5px var(--focus-inner)');
    expect(value('pointer-events')).toBe('none');
    // y por debajo de los controles de MapLibre (z-index 2)
    expect(Number(value('z-index'))).toBeLessThan(2);
  });

  it('el foco usa el anillo doble en la regla general, con grosor de al menos 3 px y separación', () => {
    const rule = BASE.find((candidate) => candidate.selectors.includes(':focus-visible'));
    const get = (property: string) => rule?.declarations.find((declaration) => declaration.property === property)?.value;
    expect(get('outline')).toBe('3px solid var(--focus)');
    expect(get('outline-offset')).toBe('2px');
    expect(get('box-shadow')).toBe('0 0 0 2px var(--focus-inner)');
  });
});
