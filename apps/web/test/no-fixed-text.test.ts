// Ningún texto fijo en componentes: todo lo que se ve pasa por packages/i18n (es / fr).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const SRC = join(import.meta.dirname, '../src');
const TEXT_ATTRIBUTES = new Set(['aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'title', 'alt', 'placeholder', 'label']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

/** Texto visible escrito directamente en el JSX: texto entre etiquetas, `{'literal'}` o atributos que se leen en voz alta. */
export function fixedTexts(source: string, fileName = 'x.tsx'): string[] {
  const found: string[] = [];
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const hasLetters = (text: string) => /\p{L}/u.test(text);
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && hasLetters(node.text)) found.push(node.text.trim());
    if (ts.isJsxExpression(node) && node.expression && (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression)) && ts.isJsxElement(node.parent)) {
      if (hasLetters(node.expression.text)) found.push(node.expression.text);
    }
    if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(sf)) && node.initializer) {
      const init = node.initializer;
      const literal = ts.isStringLiteral(init) ? init.text : ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression) ? init.expression.text : null;
      if (literal && hasLetters(literal)) found.push(`${node.name.getText(sf)}="${literal}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('sin texto fijo en componentes', () => {
  it('la comprobación detecta texto escrito a mano', () => {
    expect(fixedTexts('const A = () => <p>Hola mundo</p>;')).toEqual(['Hola mundo']);
    expect(fixedTexts('const A = () => <button aria-label="Cerrar">x</button>;')).toEqual(['aria-label="Cerrar"', 'x']);
    expect(fixedTexts("const A = () => <p>{'Hola'}</p>;")).toEqual(['Hola']);
    expect(fixedTexts('const A = () => <p>{t("login.title")}</p>;')).toEqual([]);
    expect(fixedTexts('const A = () => <input type="email" name="email" />;')).toEqual([]);
  });

  it('ningún componente de apps/web/src tiene texto fijo', () => {
    const offenders = files(SRC).flatMap((file) => fixedTexts(readFileSync(file, 'utf8'), file).map((text) => `${relative(SRC, file)}: ${text}`));
    expect(offenders).toEqual([]);
  });
});
