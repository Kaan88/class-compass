/**
 * A small Markdown parser for the bundled user guides (docs/guides). It understands only the subset
 * the guides use: headings (# to ####), paragraphs, bullet and numbered lists (one nested level),
 * block quotes, tables, images on their own line, horizontal rules, fenced code, and inline bold,
 * italic, code, links and images.
 *
 * Safety: the result is a plain data tree that the Help screen renders with React elements, so raw
 * HTML in a guide is shown as text and never executed (no innerHTML). Link and image targets are
 * classified here; the renderer loads only bundled images and follows only guide links.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'image'; src: string; alt: string };

export interface ListItem {
  content: Inline[];
  children: Block | null;
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; content: Inline[]; id: string }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'figure'; src: string; alt: string }
  | { kind: 'rule' }
  | { kind: 'code'; text: string };

/**
 * Heading anchors, GitHub style: lower case, punctuation removed, spaces become hyphens; letters of
 * any alphabet (ç, ğ, ı, ö, ş, ü) are kept. Repeated headings get -1, -2 … like on GitHub.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/gu, '-');
}

/** Plain text of inline content (for anchors and accessible names). */
export function plainText(nodes: Inline[]): string {
  return nodes.map((n) => (n.kind === 'text' || n.kind === 'code' ? n.text : n.kind === 'image' ? n.alt : plainText(n.children))).join('');
}

const LINK = /^\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)\)/u;
const IMAGE = /^!\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)\)/u;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i]!;
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()!#|>-]/u.test(src[i + 1]!)) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ kind: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '!' && src[i + 1] === '[') {
      const m = IMAGE.exec(rest);
      if (m) {
        flush();
        out.push({ kind: 'image', alt: m[1]!.replace(/\\(.)/gu, '$1'), src: m[2]! });
        i += m[0].length;
        continue;
      }
    }
    if (ch === '[') {
      const m = LINK.exec(rest);
      if (m) {
        flush();
        out.push({ kind: 'link', href: m[2]!, children: parseInline(m[1]!) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: 'strong', children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' && src[i + 1] !== ' ') {
      const end = src.indexOf('*', i + 1);
      if (end > i + 1 && src[end - 1] !== ' ') {
        flush();
        out.push({ kind: 'em', children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,4})\s+(.*)$/u;
const BULLET = /^(\s*)[-*]\s+(.*)$/u;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/u;
const ALONE_IMAGE = /^!\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)\)$/u;

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split(/(?<!\\)\|/u)
    .map((c) => c.trim().replace(/\\\|/gu, '|'));

function isTableStart(lines: string[], i: number) {
  return lines[i]!.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/u.test(lines[i + 1]!);
}

function parseList(lines: string[]): { block: Block; used: number } {
  const first = BULLET.exec(lines[0]!) ?? NUMBERED.exec(lines[0]!);
  const ordered = !BULLET.test(lines[0]!);
  const indent = first![1]!.length;
  const items: ListItem[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = (ordered ? NUMBERED : BULLET).exec(line);
    if (!m || m[1]!.length !== indent) break;
    let text = m[2]!;
    i += 1;
    // Continuation lines (indented, not a list marker) belong to this item.
    while (i < lines.length && lines[i]!.trim() !== '' && /^\s{2,}\S/u.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBERED.test(lines[i]!)) {
      text += ` ${lines[i]!.trim()}`;
      i += 1;
    }
    let children: Block | null = null;
    const next = lines[i];
    const nested = next !== undefined ? (BULLET.exec(next) ?? NUMBERED.exec(next)) : null;
    if (nested && nested[1]!.length > indent) {
      const start = i;
      while (i < lines.length && lines[i]!.trim() !== '' && (/^\s+/u.exec(lines[i]!)?.[0].length ?? 0) > indent) i += 1;
      children = parseList(lines.slice(start, i)).block;
    }
    items.push({ content: parseInline(text), children });
  }
  return { block: { kind: 'list', ordered, items }, used: Math.max(i, 1) };
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: Block[] = [];
  const seen = new Map<string, number>();
  const anchor = (text: string) => {
    const base = slugify(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (line.trim().startsWith('```')) {
      const end = lines.findIndex((l, j) => j > i && l.trim().startsWith('```'));
      const stop = end === -1 ? lines.length : end;
      blocks.push({ kind: 'code', text: lines.slice(i + 1, stop).join('\n') });
      i = stop + 1;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const content = parseInline(h[2]!.trim());
      blocks.push({ kind: 'heading', level: h[1]!.length as 1 | 2 | 3 | 4, content, id: anchor(plainText(content)) });
      i += 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/u.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }
    if (line.startsWith('>')) {
      const inner: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        inner.push(lines[i]!.replace(/^>\s?/u, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', blocks: parseMarkdown(inner.join('\n')) });
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(splitRow(lines[i]!).map(parseInline));
        i += 1;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      // A list runs over marker lines and indented continuation lines; one blank line between items is allowed.
      const inList = (l: string) => BULLET.test(l) || NUMBERED.test(l) || /^\s{2,}\S/u.test(l);
      let end = i;
      while (end < lines.length && inList(lines[end]!)) end += 1;
      while (end + 1 < lines.length && lines[end]?.trim() === '' && (BULLET.test(lines[end + 1]!) || NUMBERED.test(lines[end + 1]!))) {
        end += 1;
        while (end < lines.length && inList(lines[end]!)) end += 1;
      }
      const chunk = lines.slice(i, end).filter((l) => l.trim() !== '');
      let used = 0;
      while (used < chunk.length) {
        if (!BULLET.test(chunk[used]!) && !NUMBERED.test(chunk[used]!)) {
          // A stray indented line between lists: keep it as a paragraph.
          blocks.push({ kind: 'paragraph', content: parseInline(chunk[used]!.trim()) });
          used += 1;
          continue;
        }
        const r = parseList(chunk.slice(used));
        blocks.push(r.block);
        used += r.used;
      }
      i = end;
      continue;
    }
    const alone = ALONE_IMAGE.exec(line.trim());
    if (alone) {
      blocks.push({ kind: 'figure', alt: alone[1]!.replace(/\\(.)/gu, '$1'), src: alone[2]! });
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !HEADING.test(lines[i]!) &&
      !lines[i]!.startsWith('>') &&
      !BULLET.test(lines[i]!) &&
      !NUMBERED.test(lines[i]!) &&
      !isTableStart(lines, i) &&
      !lines[i]!.trim().startsWith('```')
    ) {
      para.push(lines[i]!.trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', content: parseInline(para.join(' ')) });
  }
  return blocks;
}

/** Every link and image target in a parsed guide (for the link checker and the renderer). */
export function collectTargets(blocks: Block[]): { links: string[]; images: string[] } {
  const links: string[] = [];
  const images: string[] = [];
  const inl = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.kind === 'link') {
        links.push(n.href);
        inl(n.children);
      } else if (n.kind === 'image') images.push(n.src);
      else if (n.kind === 'strong' || n.kind === 'em') inl(n.children);
    }
  };
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.kind === 'heading' || b.kind === 'paragraph') inl(b.content);
      else if (b.kind === 'figure') images.push(b.src);
      else if (b.kind === 'quote') walk(b.blocks);
      else if (b.kind === 'table') [...b.head, ...b.rows.flat()].forEach(inl);
      else if (b.kind === 'list') {
        for (const item of b.items) {
          inl(item.content);
          if (item.children) walk([item.children]);
        }
      }
    }
  };
  walk(blocks);
  return { links, images };
}

/** What a link points at: another guide (with an optional anchor), an anchor here, a web page, or a file outside the guides. */
export type LinkTarget = { kind: 'guide'; guide: string; anchor: string | null } | { kind: 'anchor'; anchor: string } | { kind: 'web'; href: string } | { kind: 'other'; path: string };

export function classifyLink(href: string): LinkTarget {
  if (/^https?:\/\//iu.test(href)) return { kind: 'web', href };
  if (href.startsWith('#')) return { kind: 'anchor', anchor: decodeURIComponent(href.slice(1)) };
  const m = /^(?:\.\/)?([a-z0-9-]+)\.md(?:#(.+))?$/u.exec(href);
  if (m) return { kind: 'guide', guide: m[1]!, anchor: m[2] ? decodeURIComponent(m[2]) : null };
  return { kind: 'other', path: href };
}
