/**
 * Project lint rules that ESLint does not cover (THM-5, UX-9, I18N):
 *  - client code uses semantic CSS tokens only, no raw colour literals outside the token sheet;
 *  - en.ts and tr.ts have exactly the same keys at runtime (the type checker only checks one way);
 *  - JSX contains no hard-coded user-visible text: every label goes through t().
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const CLIENT = join(ROOT, 'src', 'client');
/** The only place where colour values may be written: primitive tokens mapped to semantic ones. */
const TOKEN_SHEET = join(CLIENT, 'styles', 'app.css');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');

describe('no raw colours outside the token sheet', () => {
  const RAW = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
  it('src/client code and styles only reference var(--cc-*) tokens', () => {
    const offenders: string[] = [];
    for (const f of walk(CLIENT)) {
      if (f === TOKEN_SHEET || !/\.(tsx?|css)$/.test(f)) continue;
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (RAW.test(line.replace(/\/\/.*$/, ''))) offenders.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('component rules in the token sheet use semantic tokens, not primitives or literals', () => {
    // Literal colours are allowed only in custom-property declarations (`--p-*: #…` / `--cc-*: …`).
    const offenders: string[] = [];
    readFileSync(TOKEN_SHEET, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('--') || t.startsWith('/*') || t.startsWith('*')) return;
        // A colour function whose every argument is a token (e.g. the avatar hue) is still token-only.
        const literalPart = t.replace(/var\(--[\w-]+(?:,\s*[^()]*)?\)/g, '').replace(/\b(?:rgba?|hsla?)\(\s*\)/g, '');
        if (RAW.test(literalPart) || /var\(--p-/.test(t)) offenders.push(`app.css:${i + 1}: ${t}`);
      });
    expect(offenders).toEqual([]);
  });
});

describe('en/tr dictionaries', () => {
  it('have exactly the same keys', () => {
    const e = Object.keys(en).sort();
    const r = Object.keys(tr).sort();
    expect(r.filter((k) => !e.includes(k))).toEqual([]);
    expect(e.filter((k) => !r.includes(k))).toEqual([]);
  });

  it('use the same {placeholders} in both languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const mismatched = Object.keys(en).filter((k) => {
      const t = (tr as Record<string, string>)[k];
      return t !== undefined && JSON.stringify(ph((en as Record<string, string>)[k]!)) !== JSON.stringify(ph(t));
    });
    expect(mismatched).toEqual([]);
  });

  it('have no empty values', () => {
    const empty = [...Object.entries(en), ...Object.entries(tr)].filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });
});

describe('no untranslated text in JSX', () => {
  /** Attributes whose string value is shown to (or read out for) the user. */
  const TEXT_ATTRS = new Set(['aria-label', 'aria-description', 'title', 'alt', 'label', 'placeholder', 'description', 'errorMessage', 'caption', 'emptyText', 'actionLabel']);
  /** Non-language strings that legitimately appear as text: data formats and fictional examples. */
  const ALLOW = new Set(['Europe/Istanbul', 'user', 'user.create', '3-A', '2026–2027']);
  const hasWords = (s: string) => /\p{L}/u.test(s) && !ALLOW.has(s.trim());

  it('every user-visible string in .tsx files goes through t()', () => {
    const offenders: string[] = [];
    for (const f of walk(CLIENT).filter((x) => x.endsWith('.tsx'))) {
      const src = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const report = (node: ts.Node, text: string) => {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart());
        offenders.push(`${rel(f)}:${line + 1}: ${JSON.stringify(text.trim())}`);
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && hasWords(node.text)) report(node, node.text);
        if (ts.isJsxAttribute(node) && TEXT_ATTRS.has(node.name.getText(src)) && node.initializer) {
          const init = node.initializer;
          const lit = ts.isStringLiteral(init)
            ? init
            : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
              ? init.expression
              : null;
          if (lit && hasWords(lit.text)) report(node, lit.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(src);
    }
    expect(offenders).toEqual([]);
  });
});
