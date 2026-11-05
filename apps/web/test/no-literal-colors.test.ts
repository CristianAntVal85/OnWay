// Ningún color literal fuera de los tokens (plan UI-rediseno §6, D-U3, D-U4, D-U8): los colores viven en `src/theme/tokens.css`;
// `styles.css` (y cualquier otro CSS de `src/`) solo usa `var(--token)`. Lista cerrada de excepciones en TypeScript: las dos de
// MapLibre, cuya pintura no lee variables CSS (D-U12; el estilo del mapa lo trata T5).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TONE_COLORS } from '../src/map/route-layers';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const TOKENS = 'src/theme/tokens.css';

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full, pattern) : pattern.test(name) ? [full] : [];
  });
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const SHEETS = files(SRC, /\.css$/).map((file) => relative(ROOT, file));
const OTHER_SHEETS = SHEETS.filter((sheet) => sheet !== TOKENS);

/** Un color literal en notación hexadecimal o funcional. */
const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const FUNCTIONAL = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/gi;

/** Nombres de color CSS; los de sistema de `forced-colors` y las palabras clave de color se permiten (más abajo). */
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
    'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey ' +
    'darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink ' +
    'indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise ' +
    'palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray ' +
    'slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

/** Propiedades donde puede aparecer un color como palabra suelta. */
const COLOR_PROPERTIES =
  /^(?:color|background|background-color|background-image|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline|outline-color|fill|stroke|box-shadow|text-shadow|text-decoration|text-decoration-color|accent-color|caret-color|column-rule|column-rule-color)$/;

interface Declaration {
  selector: string;
  property: string;
  value: string;
}

function declarations(css: string): Declaration[] {
  const out: Declaration[] = [];
  const clean = stripComments(css);
  // Cada bloque `selector { … }` de cualquier profundidad (los de @media y @keyframes incluidos).
  for (const [, selector, body] of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const part of body!.split(';')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      out.push({ selector: selector!.trim(), property: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() });
    }
  }
  return out;
}

describe('sin colores literales fuera de los tokens', () => {
  it('hay un solo archivo de tokens y al menos styles.css además', () => {
    expect(SHEETS).toContain(TOKENS);
    expect(OTHER_SHEETS).toContain('src/styles.css');
  });

  it('ni styles.css ni ningún otro CSS de src/ lleva hexadecimales ni rgb(), hsl() u otras funciones de color', () => {
    for (const sheet of OTHER_SHEETS) {
      const css = stripComments(read(sheet));
      expect(css.match(HEX) ?? [], `${sheet}: hexadecimales`).toEqual([]);
      expect(css.match(FUNCTIONAL) ?? [], `${sheet}: funciones de color`).toEqual([]);
    }
  });

  it('ni nombres de color (red, white, gray…) en las propiedades de color, salvo transparent, currentColor, inherit y los colores de sistema de forced-colors', () => {
    for (const sheet of OTHER_SHEETS) {
      for (const { selector, property, value } of declarations(read(sheet))) {
        if (!COLOR_PROPERTIES.test(property)) continue;
        // Lo que va dentro de var(...) es un token, no una palabra de color.
        const words = value.replace(/var\([^)]*\)/g, ' ').match(/[a-z]+/gi) ?? [];
        const named = words.filter((word) => NAMED_COLORS.has(word.toLowerCase()));
        expect(named, `${sheet}: ${selector} { ${property}: ${value} }`).toEqual([]);
      }
    }
  });

  it('los literales viven en tokens.css (hay hexadecimales de verdad y siguen el patrón #rrggbb u #rrggbbaa)', () => {
    const literals = stripComments(read(TOKENS)).match(HEX) ?? [];
    expect(literals.length).toBeGreaterThan(40);
    for (const literal of literals) expect(literal).toMatch(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i);
  });

  it('el CSS no tiene ningún !important (el recuento anotado en medidas.md es 0)', () => {
    for (const sheet of SHEETS) expect(stripComments(read(sheet)).match(/!\s*important/gi) ?? [], sheet).toEqual([]);
  });

  it('cada var(--token) que usa la hoja está definida (sin alias huérfanos) y los nombres antiguos ya no existen', () => {
    const all = SHEETS.map((sheet) => stripComments(read(sheet))).join('\n');
    const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]!));
    const used = new Set([...all.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!));
    expect([...used].filter((name) => !defined.has(name)).sort()).toEqual([]);
    const OLD = ['--rock', '--slate', '--stone', '--snow', '--paper', '--line', '--blaze', '--blaze-deep', '--signal', '--signal-soft', '--alarm-soft'];
    expect(OLD.filter((name) => defined.has(name) || used.has(name))).toEqual([]);
  });

  it('en TypeScript solo quedan los colores de MapLibre (rutas y fondo del estilo), que no leen variables CSS', () => {
    const EXCEPTIONS = new Set(['src/map/route-layers.ts', 'src/map/style.ts']);
    const offenders = files(SRC, /\.tsx?$/)
      .map((file) => relative(ROOT, file))
      .filter((file) => !EXCEPTIONS.has(file))
      .filter((file) => {
        const text = readFileSync(join(ROOT, file), 'utf8');
        return (text.match(HEX) ?? []).length > 0 || (text.match(FUNCTIONAL) ?? []).length > 0;
      });
    expect(offenders).toEqual([]);
  });

  it('los colores fijos de las rutas de tokens.css (--route-*) coinciden con TONE_COLORS, los que pinta MapLibre', () => {
    const css = stripComments(read(TOKENS));
    for (const [tone, color] of Object.entries(TONE_COLORS)) {
      const token = new RegExp(`--route-${tone}\\s*:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(css)?.[1];
      expect(token?.toLowerCase(), `--route-${tone}`).toBe(color.toLowerCase());
    }
  });
});
