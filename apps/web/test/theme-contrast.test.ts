// Contraste de los dos temas (plan UI-rediseno §5, D-U3, D-U10, D-U11, D-U13): lee `src/theme/tokens.css`
// y recalcula cada par con la fórmula de WCAG 2.x. Esta prueba manda: si un token baja de su umbral, falla.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(import.meta.dirname, '../src/theme/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Tokens = Map<string, string>;

/** Declaraciones de las reglas cuyo selector contiene `needle`, en el orden del archivo. */
function declarations(needle: string): Tokens {
  const tokens: Tokens = new Map();
  for (const [, selector, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector!.includes(needle)) continue;
    for (const [, name, value] of body!.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) tokens.set(name!, value!.trim());
  }
  return tokens;
}

const DARK = declarations("[data-theme='dark']");
const LIGHT = declarations("[data-theme='light']");

/** Valor de un token en un tema; los que el claro no redefine (marca y mapa, fijos) salen del oscuro. */
function resolve(theme: Tokens, name: string, seen: string[] = []): string {
  if (seen.includes(name)) throw new Error(`Referencia circular: ${[...seen, name].join(' -> ')}`);
  const raw = theme.get(name) ?? DARK.get(name);
  if (raw === undefined) throw new Error(`Falta el token ${name}`);
  const reference = /^var\((--[\w-]+)\)$/.exec(raw);
  return reference ? resolve(theme, reference[1]!, [...seen, name]) : raw;
}

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Se esperaba #rrggbb y llegó «${hex}»`);
  const value = parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Luminancia relativa (WCAG 2.x). */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const TEXT = 4.5; // texto normal (AA)
const COMPONENT = 3; // componentes, foco y bordes que delimitan un control (AA no textual)
const AAA = 7; // D-U10: texto del claro

interface Pair {
  fg: string;
  bg: string;
  min: number;
}

const pair = (fg: string, bgs: string[], min: number): Pair[] => bgs.map((bg) => ({ fg, bg, min }));

const SURFACES = ['--bg', '--surface', '--surface-raised'];
const SOFT: Record<string, string> = { '--success': '--success-soft', '--warn': '--warn-soft', '--accent-text': '--danger-soft' };

const COMMON: Pair[] = [
  ...pair('--on-accent', ['--accent'], TEXT),
  ...pair('--accent-text', ['--bg', '--surface', '--danger-soft'], TEXT),
  ...pair('--border-strong', ['--bg', '--surface'], COMPONENT),
  ...pair('--focus', ['--bg', '--surface'], COMPONENT),
  ...pair('--success', ['--bg', '--surface', '--success-soft'], TEXT),
  ...pair('--warn', ['--bg', '--surface', '--warn-soft'], TEXT),
  ...pair('--info', ['--bg', '--surface'], TEXT),
  ...pair('--text', ['--success-soft', '--warn-soft', '--danger-soft'], TEXT),
  ...pair('--header-text', ['--header-bg', '--header-hover'], TEXT),
  ...pair('--header-muted', ['--header-bg'], TEXT),
  ...pair('--on-attention', ['--attention'], TEXT),
  ...pair('--accent', ['--bg', '--surface'], COMPONENT), // botón principal contra el fondo y los paneles
  ...pair('--accent-hover', ['--bg', '--surface'], COMPONENT),
];

const DARK_PAIRS: Pair[] = [
  ...pair('--text', SURFACES, TEXT),
  ...pair('--text-muted', SURFACES, TEXT),
  ...pair('--accent', ['--surface-raised'], COMPONENT),
  ...pair('--accent-text', ['--surface-raised'], TEXT),
  ...pair('--border-strong', ['--surface-raised'], COMPONENT),
  ...pair('--focus', ['--surface-raised'], COMPONENT),
  ...pair('--success', ['--surface-raised'], TEXT),
  ...pair('--warn', ['--surface-raised'], TEXT),
  ...pair('--info', ['--surface-raised'], TEXT),
  ...pair('--text-muted', ['--success-soft', '--warn-soft', '--danger-soft'], TEXT),
  ...pair('--bg', ['--text'], TEXT), // elemento pulsado (capas del mapa, selector): --bg sobre --text
];

const LIGHT_PAIRS: Pair[] = [
  ...pair('--text', SURFACES, AAA),
  ...pair('--text-muted', SURFACES, AAA),
  ...pair('--on-accent', ['--accent-hover'], TEXT),
  ...pair('--accent-text', ['--surface-raised'], TEXT),
  ...pair('--text-muted', ['--success-soft', '--warn-soft', '--danger-soft'], AAA),
  ...pair('--bg', ['--text'], AAA),
];

describe.each([
  ['oscuro (por defecto)', DARK, [...COMMON, ...DARK_PAIRS]],
  ['claro (alto contraste)', LIGHT, [...COMMON, ...LIGHT_PAIRS]],
] as const)('contraste del tema %s', (_name, theme, pairs) => {
  it.each(pairs.map((p) => [p.fg, p.bg, p.min] as const))('%s sobre %s alcanza %s:1', (fg, bg, min) => {
    expect(ratio(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(min);
  });

  it('cada color de fondo suave lleva su texto legible (estado sobre su fondo)', () => {
    for (const [fg, soft] of Object.entries(SOFT)) {
      expect(ratio(resolve(theme, fg), resolve(theme, soft)), `${fg} sobre ${soft}`).toBeGreaterThanOrEqual(TEXT);
    }
  });
});

describe('estructura de tokens.css', () => {
  it('sin atributo se ve el oscuro: va en :root y en [data-theme=dark]', () => {
    const root = /(^|\})\s*:root\s*,\s*\[data-theme='dark'\]\s*\{/.test(CSS);
    expect(root).toBe(true);
    expect(DARK.get('color-scheme')).toBe('dark');
  });

  it('el claro va en [data-theme=light], después del oscuro (misma especificidad: gana el último) y con su color-scheme', () => {
    expect(LIGHT.get('color-scheme')).toBe('light');
    expect(CSS.indexOf("[data-theme='light']")).toBeGreaterThan(CSS.indexOf("[data-theme='dark']"));
  });

  it('el claro redefine el mismo juego de tokens de tema que el oscuro, sin tokens que el oscuro no tenga', () => {
    const NAMES = [
      '--bg',
      '--surface',
      '--surface-raised',
      '--border',
      '--border-strong',
      '--text',
      '--text-muted',
      '--accent',
      '--accent-hover',
      '--on-accent',
      '--accent-text',
      '--focus',
      '--focus-inner',
      '--success',
      '--warn',
      '--info',
      '--success-soft',
      '--warn-soft',
      '--danger-soft',
      '--header-bg',
      '--header-text',
      '--header-muted',
      '--header-hover',
    ];
    for (const name of NAMES) {
      expect(DARK.has(name), `oscuro: ${name}`).toBe(true);
      expect(LIGHT.has(name), `claro: ${name}`).toBe(true);
    }
    expect([...LIGHT.keys()].filter((name) => !DARK.has(name))).toEqual([]);
  });

  it('D-U11: el principal oscuro no cambia de fondo al pasar el ratón', () => {
    expect(resolve(DARK, '--accent-hover')).toBe(resolve(DARK, '--accent'));
    expect(resolve(LIGHT, '--accent-hover')).not.toBe(resolve(LIGHT, '--accent'));
  });

  it('los valores de color de los temas son #rrggbb (o una referencia a otro token)', () => {
    for (const [theme, tokens] of [
      ['oscuro', DARK],
      ['claro', LIGHT],
    ] as const) {
      for (const [name, value] of tokens) {
        if (name === 'color-scheme') continue;
        expect(value, `${theme}: ${name}`).toMatch(/^(#[0-9a-f]{6}|var\(--[\w-]+\))$/i);
      }
    }
  });

  it('la prueba detecta una bajada de contraste: --on-accent gris sobre el rojo no llega a 4,5:1', () => {
    expect(ratio('#bbbbbb', resolve(DARK, '--accent'))).toBeLessThan(TEXT);
    expect(ratio(resolve(DARK, '--on-accent'), resolve(DARK, '--accent'))).toBeGreaterThanOrEqual(TEXT);
  });
});
