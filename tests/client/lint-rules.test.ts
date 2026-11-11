/**
 * Project lint rules that ESLint does not cover (THM-5, UX-9, I18N):
 *  - client code uses semantic CSS tokens only, no raw colour literals outside the theme token sheets;
 *  - components never branch on a theme key and only use known tokens (theme lint, SX);
 *  - en.ts and tr.ts have exactly the same keys at runtime (the type checker only checks one way);
 *  - JSX contains no hard-coded user-visible text: every label goes through t().
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
import { DEFAULT_THEME, THEME_KEYS, type BuiltinThemeKey } from '../../src/shared/themes.ts';
import { themeTokens } from '../../src/client/themes/css.ts';
import { THEMES } from '../../src/client/themes/registry.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const CLIENT = join(ROOT, 'src', 'client');
const THEMES_DIR = join(CLIENT, 'themes');
const APP_CSS = join(CLIENT, 'styles', 'app.css');
/**
 * The only places where colour values may be written (SX, D-070): the shared theme base and each
 * theme's token file. Everything else uses semantic tokens (`var(--cc-*)` / `tok()` in theme art).
 */
const isTokenSheet = (f: string) => f === join(THEMES_DIR, 'base.ts') || (rel(f).startsWith('src/client/themes/') && f.endsWith(`${sep}tokens.ts`));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
function rel(f: string) {
  return relative(ROOT, f).replace(/\\/g, '/');
}

describe('no raw colours outside the theme token sheets', () => {
  const RAW = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
  it('src/client code and styles only reference var(--cc-*) tokens', () => {
    const offenders: string[] = [];
    for (const f of walk(CLIENT)) {
      if (isTokenSheet(f) || f === APP_CSS || !/\.(tsx?|css)$/.test(f)) continue;
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (RAW.test(line.replace(/\/\/.*$/, ''))) offenders.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('app.css has component rules only: no colour literals and no primitive tokens', () => {
    const offenders: string[] = [];
    readFileSync(APP_CSS, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('/*') || t.startsWith('*')) return;
        // A colour function whose every argument is a token (e.g. the avatar hue) is still token-only.
        const literalPart = t.replace(/var\(--[\w-]+(?:,\s*[^()]*)?\)/g, '').replace(/\b(?:rgba?|hsla?)\(\s*\)/g, '');
        if (RAW.test(literalPart) || /--p-/.test(t)) offenders.push(`app.css:${i + 1}: ${t}`);
      });
    expect(offenders).toEqual([]);
  });
});

describe('theme lint (THM-3, THM-4)', () => {
  const sources = () => walk(CLIENT).filter((f) => /\.(tsx?|css)$/.test(f));

  it('components never branch on a theme key (a theme key literal next to "theme"): theme differences live in src/client/themes only', () => {
    const keyLiteral = new RegExp(`['"\`](?:${THEME_KEYS.join('|')})['"\`]`);
    const offenders: string[] = [];
    for (const f of sources()) {
      if (rel(f).startsWith('src/client/themes/') || !/\.tsx?$/.test(f)) continue;
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '');
          if (keyLiteral.test(code) && /theme/i.test(code)) offenders.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('every var(--cc-*) used by a component is a theme token or a layout/component variable declared in app.css', () => {
    const known = new Set(themeTokens(THEMES[DEFAULT_THEME]).map(([k]) => k));
    for (const m of readFileSync(APP_CSS, 'utf8').matchAll(/(--cc-[\w-]+)\s*:/g)) known.add(m[1]!);
    // Variables components set inline (avatar hue from the student id; the text scale on <html>).
    for (const f of sources()) for (const m of readFileSync(f, 'utf8').matchAll(/['"](--cc-[\w-]+)['"]/g)) known.add(m[1]!);
    const unknown: string[] = [];
    for (const f of sources()) {
      for (const m of readFileSync(f, 'utf8').matchAll(/var\((--cc-[\w-]+)/g)) if (!known.has(m[1]!)) unknown.push(`${rel(f)}: ${m[1]}`);
    }
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('every theme emits the same complete set of tokens (no theme can miss a slot)', () => {
    const names = (k: BuiltinThemeKey) => themeTokens(THEMES[k]).map(([n]) => n);
    for (const k of THEME_KEYS) expect(names(k)).toEqual(names(DEFAULT_THEME));
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

  it('say "achievements", never "badges" (EN) or "rozet" (TR) (S14a, D-144)', () => {
    // Placeholders such as {badge} are code, not words the user reads.
    const words = (s: string) => s.replace(/\{\w+\}/g, '');
    const enHits = Object.entries(en).filter(([, v]) => /\bbadges?\b/i.test(words(v))).map(([k]) => k);
    const trHits = Object.entries(tr).filter(([, v]) => /rozet/i.test(words(v))).map(([k]) => k);
    expect(enHits).toEqual([]);
    expect(trHits).toEqual([]);
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

describe('file pickers (owner feedback 2026-11-11)', () => {
  // The browser's own file input looks like plain text ("Choose File · No file chosen", in the
  // browser's language), so nobody sees it opens a picker. Every picker is the shared FilePick button
  // (src/client/ui/FilePick.tsx) or, beside other buttons, a button-styled label around a hidden input.
  it('every <input type="file"> is visually hidden and drawn as a button', () => {
    const offenders: string[] = [];
    for (const f of walk(CLIENT)) {
      if (!f.endsWith('.tsx')) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<input\b[^>]*?type="file"[^>]*?>/gs)) {
        if (!/cc-visually-hidden/.test(m[0])) offenders.push(`${rel(f)}: ${m[0].slice(0, 80).replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
