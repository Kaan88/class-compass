/**
 * A small Markdown parser for the bundled user guides (docs/guides). It understands only the subset
 * the guides use: headings (# to ####), paragraphs, bullet and numbered lists (one nested level),
 * block quotes, tables, images on their own line, horizontal rules, fenced code, and inline bold,
 * italic, code, links and images.
 *
 * Safety: the result is a plain data tree that the Help screen renders with React elements, so raw
 * HTML in a guide is shown as text and never executed (no innerHTML). Link and image targets are
 * classified here; the renderer loads only bundled images and follows only guide links.
 *
 * The assistant chat (S27d, D-196) renders AI answers with the same parser (`assistantChat/ChatMarkdown.tsx`):
 * fences keep their language word, a longer fence can hold ``` lines, and a fence not closed yet (an
 * answer still streaming) is marked `open`. After the S27d review: a fence indented under a list item is
 * a code block of that item, an ordered list keeps its first number (`start`), a code span ends at a
 * run of as many backticks, and every pass of the block loop moves on at least one line.
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
  /** Blocks inside the item after its text: a fenced code block indented under it (S27d review). */
  blocks?: Block[];
  children: Block | null;
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; content: Inline[]; id: string }
  | { kind: 'paragraph'; content: Inline[] }
  /** `start`: the first number of an ordered list that does not start at 1 (one interrupted by a code block). */
  | { kind: 'list'; ordered: boolean; items: ListItem[]; start?: number }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'figure'; src: string; alt: string }
  | { kind: 'rule' }
  /** `lang`: the fence's language word (`json`), lower case; `open`: no closing fence yet (an answer still streaming, S27d). */
  | { kind: 'code'; text: string; lang?: string; open?: true };

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
      // A code span ends at a run of exactly as many backticks (```npm install``` is one span, CommonMark).
      const run = /^`+/u.exec(rest)![0];
      const close = new RegExp(`(?<!\`)${run}(?!\`)`, 'u').exec(src.slice(i + run.length));
      if (close) {
        flush();
        const inner = src.slice(i + run.length, i + run.length + close.index);
        out.push({ kind: 'code', text: run.length > 1 && /^ .* $/u.test(inner) ? inner.slice(1, -1) : inner });
        i += run.length + close.index + run.length;
        continue;
      }
      if (run.length > 1) {
        text += run;
        i += run.length;
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
const FENCE = /^\s*(`{3,})([^`]*)$/u;
const BULLET = /^(\s*)[-*]\s+(.*)$/u;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/u;
/** A closing fence line (backticks only); it closes an opening fence of at most as many backticks. */
const FENCE_CLOSE = /^\s*`{3,}\s*$/u;

/** Where the fence opened at `lines[at]` closes (the end of the text while it is not closed yet: an answer still streaming). */
function fenceEnd(lines: string[], at: number): { stop: number; closed: boolean } {
  const run = FENCE.exec(lines[at]!)![1]!.length;
  const end = lines.findIndex((l, j) => j > at && FENCE_CLOSE.test(l) && l.trim().length >= run);
  return end === -1 ? { stop: lines.length, closed: false } : { stop: end, closed: true };
}

/** The fenced code block opened at `lines[at]` (its lines lose the fence's own indentation) and the index after it. */
function fencedBlock(lines: string[], at: number): { block: Block; next: number } {
  const m = FENCE.exec(lines[at]!)!;
  const { stop, closed } = fenceEnd(lines, at);
  const pad = /^\s*/u.exec(lines[at]!)![0].length;
  const strip = new RegExp(`^\\s{0,${pad}}`, 'u');
  const text = lines
    .slice(at + 1, stop)
    .map((l) => l.replace(strip, ''))
    .join('\n');
  const lang = /^[A-Za-z0-9_+.-]{1,20}/u.exec(m[2]!.trim())?.[0].toLowerCase();
  return { block: { kind: 'code', text, ...(lang ? { lang } : {}), ...(closed ? {} : { open: true as const }) }, next: closed ? stop + 1 : stop };
}

/** A list marker line: its indentation, its text and, when numbered, its number. */
function markerOf(line: string): { indent: number; text: string; ordered: boolean; num: number } | null {
  const b = BULLET.exec(line);
  if (b) return { indent: b[1]!.length, text: b[2]!, ordered: false, num: 0 };
  const n = NUMBERED.exec(line);
  return n ? { indent: n[1]!.length, text: n[3]!, ordered: true, num: Number(n[2]) } : null;
}
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
  const first = markerOf(lines[0]!)!;
  const { ordered, indent } = first;
  const items: ListItem[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = markerOf(lines[i]!);
    if (!m || m.ordered !== ordered || m.indent !== indent) break;
    let text = m.text;
    const blocks: Block[] = [];
    i += 1;
    // Continuation lines (indented, not a list marker) belong to this item; an indented fence is a code block in it.
    while (i < lines.length && lines[i]!.trim() !== '' && /^\s{2,}\S/u.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBERED.test(lines[i]!)) {
      if (FENCE.test(lines[i]!)) {
        const f = fencedBlock(lines, i);
        blocks.push(f.block);
        i = f.next;
        continue;
      }
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
    items.push({ content: parseInline(text), ...(blocks.length ? { blocks } : {}), children });
  }
  return { block: { kind: 'list', ordered, items, ...(ordered && first.num !== 1 ? { start: first.num } : {}) }, used: Math.max(i, 1) };
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
    if (FENCE.test(line)) {
      // Closed by a line of at least as many backticks (CommonMark), so a longer fence can hold ``` lines.
      const f = fencedBlock(lines, i);
      blocks.push(f.block);
      i = f.next;
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
      // A list runs over marker lines and indented continuation lines; one blank line between items (or
      // before a fence indented under an item) is allowed. An indented fence runs to its closing line,
      // blank lines inside it included (S27d review: a code block under a numbered step).
      const marker = (l: string) => BULLET.test(l) || NUMBERED.test(l);
      const indented = (l: string) => /^\s{2,}\S/u.test(l);
      const chunk: string[] = [];
      let end = i;
      while (end < lines.length) {
        const l = lines[end]!;
        if (indented(l) && FENCE.test(l)) {
          const { stop, closed } = fenceEnd(lines, end);
          const next = closed ? stop + 1 : stop;
          chunk.push(...lines.slice(end, next));
          end = next;
          continue;
        }
        if (marker(l) || indented(l)) {
          chunk.push(l);
          end += 1;
          continue;
        }
        const after = lines[end + 1];
        if (l.trim() === '' && after !== undefined && (marker(after) || (indented(after) && FENCE.test(after)))) {
          end += 1;
          continue;
        }
        break;
      }
      let used = 0;
      while (used < chunk.length) {
        if (FENCE.test(chunk[used]!) && !marker(chunk[used]!)) {
          const f = fencedBlock(chunk, used);
          blocks.push(f.block);
          used = f.next;
          continue;
        }
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
      // The block loop's own fence test: a line like ```npm install``` is paragraph text, never a stop.
      !FENCE.test(lines[i]!)
    ) {
      para.push(lines[i]!.trim());
      i += 1;
    }
    // Always moves on: a line no rule above took is a paragraph of its own (never an endless loop).
    if (!para.length) {
      para.push(line.trim());
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
          if (item.blocks) walk(item.blocks);
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
