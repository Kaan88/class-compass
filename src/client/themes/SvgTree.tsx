/**
 * Draws theme package art (S14g, D-158): a tree from the shared SVG sanitiser
 * (`shared/themePackage/svg.ts`), rendered with `createElement`, never as markup and never with
 * `dangerouslySetInnerHTML`. As a second line of defence only allow-listed elements and attributes
 * are passed to React (anything else in a tree is dropped), and attribute names are mapped to their
 * React props here, not taken from the tree.
 */
import { createElement, Fragment, type ReactNode } from 'react';
import { isSvgTag, svgAttributeAllowed, type SvgNode } from '../../shared/themePackage/svg.ts';

const REACT_PROP: Record<string, string> = {
  fill: 'fill',
  stroke: 'stroke',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
  opacity: 'opacity',
  'fill-opacity': 'fillOpacity',
  'stroke-opacity': 'strokeOpacity',
  'fill-rule': 'fillRule',
  transform: 'transform',
  d: 'd',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  rx: 'rx',
  ry: 'ry',
  x: 'x',
  y: 'y',
  width: 'width',
  height: 'height',
  x1: 'x1',
  y1: 'y1',
  x2: 'x2',
  y2: 'y2',
  points: 'points',
};

function renderNode(node: SvgNode, key: number, depth: number): ReactNode {
  if (depth > 16 || !isSvgTag(node.tag)) return null;
  const props: Record<string, string | number> = { key };
  for (const [name, value] of Object.entries(node.attrs)) {
    const prop = REACT_PROP[name];
    if (prop && svgAttributeAllowed(node.tag, name) && typeof value === 'string') props[prop] = value;
  }
  const children = node.tag === 'g' ? (node.children ?? []).map((c, i) => renderNode(c, i, depth + 1)) : [];
  return createElement(node.tag, props, ...children);
}

/** The pictures of a sanitised tree, inside the caller's `<svg>` (Mascot, ThemeIllustration…). */
export function SvgTree({ nodes }: { nodes: readonly SvgNode[] }) {
  return createElement(Fragment, null, ...nodes.map((n, i) => renderNode(n, i, 0)));
}
