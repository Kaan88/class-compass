/**
 * User documentation (docs/guides, ROADMAP "User documentation"): every guide exists in English and
 * Turkish, every link and image a guide references exists (relative files, other guides, heading
 * anchors), every screenshot is used, stays small and belongs to its language, and the Markdown
 * subset the in-app Help screen renders cannot run HTML or load anything from another site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_IDS } from '../../src/client/help/guideList.ts';
import { LOCALES } from '../../src/shared/languages.ts';
import { classifyLink, collectTargets, parseMarkdown, slugify, type Block } from '../../src/client/help/markdown.ts';

const root = path.resolve(import.meta.dirname, '../../docs/guides');
/** Every ready interface language (S26c, D-191): a language marked ready has its guides checked here. */
const LANGS = LOCALES;

const read = (p: string) => fs.readFileSync(p, 'utf8');
const mdFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
const allGuides = [path.join(root, 'README.md'), ...LANGS.flatMap((l) => mdFiles(path.join(root, l)).map((f) => path.join(root, l, f)))];

function headingIds(blocks: Block[]): Set<string> {
  return new Set(blocks.filter((b) => b.kind === 'heading').map((b) => (b.kind === 'heading' ? b.id : '')));
}

describe('user guides', () => {
  it('every guide exists in both languages, and the languages have the same files', () => {
    for (const lang of LANGS) {
      for (const id of GUIDE_IDS) expect(fs.existsSync(path.join(root, lang, `${id}.md`)), `${lang}/${id}.md`).toBe(true);
    }
    for (const lang of LANGS) expect(mdFiles(path.join(root, lang)).sort(), lang).toEqual(mdFiles(path.join(root, 'en')).sort());
    expect(fs.existsSync(path.join(root, 'README.md'))).toBe(true);
  });

  it('every link and image a guide references exists', () => {
    const problems: string[] = [];
    for (const file of allGuides) {
      const blocks = parseMarkdown(read(file));
      const { links, images } = collectTargets(blocks);
      const dir = path.dirname(file);
      for (const href of links) {
        const target = classifyLink(href);
        if (target.kind === 'web') {
          problems.push(`${file}: web link ${href} (guides link only to files in the repository)`);
        } else if (target.kind === 'anchor') {
          if (!headingIds(blocks).has(target.anchor)) problems.push(`${file}: no heading for #${target.anchor}`);
        } else if (target.kind === 'guide') {
          const other = path.join(dir, `${target.guide}.md`);
          if (!fs.existsSync(other)) problems.push(`${file}: missing guide ${href}`);
          else if (target.anchor && !headingIds(parseMarkdown(read(other))).has(target.anchor)) problems.push(`${file}: no heading for ${href}`);
        } else {
          const [p, anchor] = target.path.split('#');
          const other = path.resolve(dir, p!);
          if (!fs.existsSync(other)) problems.push(`${file}: missing file ${href}`);
          else if (anchor && other.endsWith('.md') && !headingIds(parseMarkdown(read(other))).has(anchor)) problems.push(`${file}: no heading for ${href}`);
        }
      }
      for (const src of images) {
        const img = path.resolve(dir, src);
        if (!fs.existsSync(img)) problems.push(`${file}: missing image ${src}`);
        const lang = path.basename(dir);
        if ((LANGS as readonly string[]).includes(lang) && !src.startsWith(`../img/${lang}/`)) problems.push(`${file}: image ${src} is not in img/${lang}/`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every screenshot is used by a guide, is a PNG and is reasonably small', () => {
    const used = new Set<string>();
    for (const file of allGuides) for (const src of collectTargets(parseMarkdown(read(file))).images) used.add(path.resolve(path.dirname(file), src));
    for (const lang of LANGS) {
      const dir = path.join(root, 'img', lang);
      const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      expect(files.length, `screenshots in img/${lang}`).toBeGreaterThan(0);
      for (const f of files) {
        const p = path.join(dir, f);
        expect(f, 'lower-case PNG names').toMatch(/^[a-z0-9-]+\.png$/u);
        expect(used.has(p), `${lang}/${f} is used by a guide`).toBe(true);
        const bytes = fs.readFileSync(p);
        expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
        expect(bytes.length, `${lang}/${f} size`).toBeLessThan(450 * 1024);
      }
    }
  });

  it('every guide starts with one top-level heading', () => {
    for (const lang of LANGS) {
      for (const id of GUIDE_IDS) {
        const blocks = parseMarkdown(read(path.join(root, lang, `${id}.md`)));
        expect(blocks[0]?.kind, `${lang}/${id}`).toBe('heading');
        expect(blocks.filter((b) => b.kind === 'heading' && b.level === 1).length, `${lang}/${id}`).toBe(1);
      }
    }
  });
});

describe('guide Markdown subset (sanitised by construction)', () => {
  it('keeps raw HTML as text and never treats script links as links', () => {
    const blocks = parseMarkdown('Hello <img src=x onerror=alert(1)> and [click](javascript:alert(1)) and ![x](https://example.org/a.png)');
    const p = blocks[0];
    expect(p?.kind).toBe('paragraph');
    if (p?.kind !== 'paragraph') return;
    expect(p.content[0]).toEqual({ kind: 'text', text: 'Hello <img src=x onerror=alert(1)> and ' });
    const link = p.content.find((n) => n.kind === 'link');
    expect(link && link.kind === 'link' ? classifyLink(link.href).kind : null).toBe('other');
    expect(classifyLink('https://example.org/a.png').kind).toBe('web');
  });

  it('parses headings, lists, notes, tables and figures', () => {
    const md = [
      '# Title',
      '',
      'Some **bold**, *italic* and `code`.',
      '',
      '- one',
      '- two',
      '  - nested',
      '',
      '1. first',
      '2. second',
      '',
      '> **Note:** careful.',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '![Teacher menu](../img/en/teacher-menu.png)',
      '',
      '## Öğretmen menüsü',
    ].join('\n');
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'table', 'figure', 'heading']);
    const list = blocks[2];
    expect(list?.kind === 'list' && list.items[1]?.children?.kind).toBe('list');
    const last = blocks[7];
    expect(last?.kind === 'heading' && last.id).toBe('öğretmen-menüsü');
    expect(slugify('Signing in (password or email link)')).toBe('signing-in-password-or-email-link');
  });

  it('classifies guide links with anchors', () => {
    expect(classifyLink('teacher.md#pin-and-classroom-lock')).toEqual({ kind: 'guide', guide: 'teacher', anchor: 'pin-and-classroom-lock' });
    expect(classifyLink('../../OPERATIONS.md')).toEqual({ kind: 'other', path: '../../OPERATIONS.md' });
  });
});
