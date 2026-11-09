/**
 * Strict SVG tokenizer and sanitiser for theme package art (S14g, D-158). It accepts a small,
 * fixed subset of SVG and turns it into a JSON tree (`SvgNode[]`); the client draws the tree with
 * `createElement` (`client/themes/SvgTree.tsx`), never as markup. Nothing is "cleaned up": anything
 * outside the allow-list is refused with a reason, so what was checked is exactly what is drawn.
 *
 * Allowed:
 * - elements `g`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon` (only `g` has children);
 * - geometry attributes of each element, a strict `transform` grammar, `fill` / `stroke` only as
 *   `none`, `currentColor` or `var(--cc-<colour token>)`, and a few numeric presentation attributes.
 * Refused: ids, `class`, `style`, `href`, event handlers, `filter`, `mask`, `url()`, text, `image`,
 * `use`, `foreignObject`, `script`, comments, CDATA, entities (`&`), processing instructions, any
 * colour literal, and more than ART_LIMITS nodes, bytes or nesting depth.
 */
import { ART_LIMITS } from './limits.ts';
import { isColorToken } from './tokens.ts';

export const SVG_ELEMENTS = ['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'] as const;
export type SvgTag = (typeof SVG_ELEMENTS)[number];

type ValueKind = 'num' | 'len' | 'paint' | 'opacity' | 'path' | 'points' | 'transform' | 'linecap' | 'linejoin' | 'fillRule' | 'dash';

/** Presentation attributes every element may carry. */
const COMMON: Record<string, ValueKind> = {
  fill: 'paint',
  stroke: 'paint',
  'stroke-width': 'len',
  'stroke-linecap': 'linecap',
  'stroke-linejoin': 'linejoin',
  'stroke-dasharray': 'dash',
  opacity: 'opacity',
  'fill-opacity': 'opacity',
  'stroke-opacity': 'opacity',
  'fill-rule': 'fillRule',
  transform: 'transform',
};
const GEOMETRY: Record<SvgTag, Record<string, ValueKind>> = {
  g: {},
  path: { d: 'path' },
  circle: { cx: 'num', cy: 'num', r: 'len' },
  ellipse: { cx: 'num', cy: 'num', rx: 'len', ry: 'len' },
  rect: { x: 'num', y: 'num', width: 'len', height: 'len', rx: 'len', ry: 'len' },
  line: { x1: 'num', y1: 'num', x2: 'num', y2: 'num' },
  polyline: { points: 'points' },
  polygon: { points: 'points' },
};

/** Every attribute name the sanitiser can let through (the renderer maps these and nothing else). */
export const SVG_ATTRIBUTES: readonly string[] = [...new Set([...Object.keys(COMMON), ...Object.values(GEOMETRY).flatMap((g) => Object.keys(g))])];

export const isSvgTag = (v: string): v is SvgTag => (SVG_ELEMENTS as readonly string[]).includes(v);
/** Is `name` allowed on `tag`? */
export const svgAttributeAllowed = (tag: SvgTag, name: string): boolean => Object.hasOwn(COMMON, name) || Object.hasOwn(GEOMETRY[tag], name);

export interface SvgNode {
  tag: SvgTag;
  attrs: Record<string, string>;
  children?: SvgNode[];
}

export type SvgErrorReason =
  | 'empty'
  | 'tooLarge'
  | 'tooManyNodes'
  | 'tooDeep'
  | 'markup'
  | 'entity'
  | 'text'
  | 'element'
  | 'attribute'
  | 'duplicateAttribute'
  | 'value'
  | 'children'
  | 'syntax'
  | 'unclosed';

export interface SvgError {
  reason: SvgErrorReason;
  /** Character offset in the source. */
  at: number;
  /** The element, attribute or value concerned (shortened; never more than 60 characters). */
  detail?: string;
}

export type SvgResult = { ok: true; nodes: SvgNode[]; count: number } | { ok: false; error: SvgError };

/** Characters an attribute value may contain at all (no `#`, `:`, `;`, `/`, `\`, quotes, `<`, `>`, `&`, `%`). */
const VALUE_CHARS = /^[A-Za-z0-9 .,+\-()\t\n\r]*$/u;
const NUM = /^[+-]?(?:\d{1,7}(?:\.\d{0,7})?|\.\d{1,7})$/u;
const NUM_IN = /[+-]?(?:\d+\.?\d*|\.\d+)/gu;
const LIMIT_NUMBERS = 4000;

const isNum = (v: string) => NUM.test(v);
function numberList(v: string): number[] | null {
  const parts = v.trim().split(/[\s,]+/u).filter(Boolean);
  if (parts.length === 0 || parts.length > LIMIT_NUMBERS || !parts.every(isNum)) return null;
  return parts.map(Number);
}

const TRANSFORM_ARGS: Record<string, readonly number[]> = { translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1], matrix: [6] };
function validTransform(v: string): boolean {
  const re = /\s*(translate|scale|rotate|skewX|skewY|matrix)\s*\(([^()]*)\)\s*,?/uy;
  let i = 0;
  let fns = 0;
  while (i < v.length) {
    if (/^\s*$/u.test(v.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(v);
    if (!m) return false;
    const args = numberList(m[2]!);
    if (!args || !TRANSFORM_ARGS[m[1]!]!.includes(args.length)) return false;
    i = re.lastIndex;
    if (++fns > 8) return false;
  }
  return fns > 0;
}

function validPath(v: string): boolean {
  if (v.length > 8000 || !/^[MmZzLlHhVvCcSsQqTtAa0-9.,\s+-]*$/u.test(v) || !/^\s*[Mm]/u.test(v)) return false;
  const nums = v.match(NUM_IN) ?? [];
  if (nums.length > LIMIT_NUMBERS) return false;
  // After removing commands, numbers and separators nothing may be left (e.g. a lone "+" or ".").
  return v.replace(NUM_IN, ' ').replace(/[MmZzLlHhVvCcSsQqTtAa\s,]/gu, '') === '';
}

function validValue(kind: ValueKind, raw: string): boolean {
  const v = raw.trim();
  switch (kind) {
    case 'num':
      return isNum(v);
    case 'len':
      return isNum(v) && Number(v) >= 0;
    case 'opacity':
      return isNum(v) && Number(v) >= 0 && Number(v) <= 1;
    case 'paint': {
      if (v === 'none' || v === 'currentColor') return true;
      const m = /^var\(--cc-([a-zA-Z0-9-]+)\)$/u.exec(v);
      return m !== null && isColorToken(m[1]!);
    }
    case 'path':
      return validPath(v);
    case 'points': {
      const n = numberList(v);
      return n !== null && n.length >= 4 && n.length % 2 === 0;
    }
    case 'transform':
      return validTransform(v);
    case 'linecap':
      return v === 'butt' || v === 'round' || v === 'square';
    case 'linejoin':
      return v === 'miter' || v === 'round' || v === 'bevel';
    case 'fillRule':
      return v === 'nonzero' || v === 'evenodd';
    case 'dash':
      return v === 'none' || (numberList(v)?.every((x) => x >= 0) ?? false);
  }
}

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);
const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/**
 * Parses an SVG fragment (the content of a 100×100 or 200×140 `<svg>`, without the `<svg>` element
 * itself) into a tree, or says exactly why it is refused. Never throws.
 */
export function parseSvg(src: string, limits: { maxNodes?: number; maxBytes?: number; maxDepth?: number } = {}): SvgResult {
  const maxNodes = limits.maxNodes ?? ART_LIMITS.svgMaxNodes;
  const maxBytes = limits.maxBytes ?? ART_LIMITS.svgMaxBytes;
  const maxDepth = limits.maxDepth ?? ART_LIMITS.svgMaxDepth;
  const fail = (reason: SvgErrorReason, at: number, detail?: string): SvgResult => ({ ok: false, error: detail === undefined ? { reason, at } : { reason, at, detail: short(detail) } });
  if (typeof src !== 'string') return fail('syntax', 0);
  if (utf8Length(src) > maxBytes) return fail('tooLarge', 0, String(maxBytes));
  const amp = src.indexOf('&');
  if (amp !== -1) return fail('entity', amp);

  const roots: SvgNode[] = [];
  const stack: SvgNode[] = [];
  const n = src.length;
  let i = 0;
  let count = 0;
  const ws = (c: string | undefined) => c === ' ' || c === '\n' || c === '\t' || c === '\r';
  const nameRe = /[A-Za-z_][A-Za-z0-9_:.-]*/uy;
  const readName = () => {
    nameRe.lastIndex = i;
    const m = nameRe.exec(src);
    if (!m) return null;
    i = nameRe.lastIndex;
    return m[0];
  };

  while (i < n) {
    const c = src[i];
    if (ws(c)) {
      i++;
      continue;
    }
    if (c !== '<') return fail('text', i, src.slice(i, i + 20));
    const next = src[i + 1];
    if (next === '!' || next === '?') return fail('markup', i, src.slice(i, i + 12));
    if (next === '/') {
      const start = i;
      i += 2;
      const name = readName();
      while (ws(src[i])) i++;
      if (name === null || src[i] !== '>') return fail('syntax', start);
      const top = stack.pop();
      if (!top || top.tag !== name) return fail('syntax', start, name);
      i++;
      continue;
    }
    const start = i;
    i++;
    const name = readName();
    if (name === null) return fail('syntax', start);
    if (!isSvgTag(name)) return fail('element', start, name);
    const parent = stack[stack.length - 1];
    if (parent && parent.tag !== 'g') return fail('children', start, parent.tag);
    if (stack.length + 1 > maxDepth) return fail('tooDeep', start, String(maxDepth));
    if (++count > maxNodes) return fail('tooManyNodes', start, String(maxNodes));
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      const before = i;
      while (ws(src[i])) i++;
      if (src.startsWith('/>', i)) {
        selfClosing = true;
        i += 2;
        break;
      }
      if (src[i] === '>') {
        i++;
        break;
      }
      if (i >= n) return fail('unclosed', start, name);
      if (i === before) return fail('syntax', i);
      const at = i;
      const attr = readName();
      if (attr === null) return fail('syntax', at, src.slice(at, at + 12));
      if (!svgAttributeAllowed(name, attr)) return fail('attribute', at, `${name} ${attr}`);
      if (Object.hasOwn(attrs, attr)) return fail('duplicateAttribute', at, attr);
      while (ws(src[i])) i++;
      if (src[i] !== '=') return fail('syntax', i, attr);
      i++;
      while (ws(src[i])) i++;
      const q = src[i];
      if (q !== '"' && q !== "'") return fail('syntax', i, attr);
      const end = src.indexOf(q, i + 1);
      if (end === -1) return fail('syntax', i, attr);
      const value = src.slice(i + 1, end);
      const kind = Object.hasOwn(COMMON, attr) ? COMMON[attr]! : GEOMETRY[name][attr]!;
      if (!VALUE_CHARS.test(value) || !validValue(kind, value)) return fail('value', i, `${attr}="${value}"`);
      attrs[attr] = value.trim().replace(/\s+/gu, ' ');
      i = end + 1;
    }
    const node: SvgNode = { tag: name, attrs };
    if (parent) (parent.children ??= []).push(node);
    else roots.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length > 0) return fail('unclosed', n, stack[stack.length - 1]!.tag);
  if (roots.length === 0) return fail('empty', 0);
  return { ok: true, nodes: roots, count };
}

/** Canonical text of a tree (distinctness checks, tests). Attribute order is sorted. */
export function svgToString(nodes: readonly SvgNode[]): string {
  return nodes
    .map((nd) => {
      const attrs = Object.keys(nd.attrs)
        .sort()
        .map((k) => ` ${k}="${nd.attrs[k]}"`)
        .join('');
      return nd.children?.length ? `<${nd.tag}${attrs}>${svgToString(nd.children)}</${nd.tag}>` : `<${nd.tag}${attrs}/>`;
    })
    .join('');
}

/** Number of nodes in a tree. */
export const svgNodeCount = (nodes: readonly SvgNode[]): number => nodes.reduce((s, nd) => s + 1 + svgNodeCount(nd.children ?? []), 0);
