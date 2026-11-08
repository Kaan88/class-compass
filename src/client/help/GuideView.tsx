/**
 * Read-only view of one bundled user guide (docs/guides). The Markdown is parsed into a data tree
 * (markdown.ts) and rendered with React elements only, so nothing in a guide can run as HTML.
 * Images come only from the bundled screenshots (each opens full size in a new tab); links to other guides open them here; a link to a
 * file outside the guides (e.g. docs/OPERATIONS.md) is shown as plain text.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Locale } from '../../shared/i18n/index.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Alert } from '../ui/Feedback.tsx';
import { guideImageUrl, isGuideId, loadGuide, type GuideId } from './guides.ts';
import { classifyLink, parseMarkdown, type Block, type Inline } from './markdown.ts';

export interface GuideLinkHandler {
  /** Address shown for a link to another guide (used for "open in new tab" and the status bar). */
  href: (guide: GuideId, anchor: string | null) => string;
  /** Opens another guide in place. */
  open: (guide: GuideId, anchor: string | null) => void;
}

function InlineNodes({ nodes, links }: { nodes: Inline[]; links: GuideLinkHandler }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'strong':
        return (
          <strong key={i}>
            <InlineNodes nodes={n.children} links={links} />
          </strong>
        );
      case 'em':
        return (
          <em key={i}>
            <InlineNodes nodes={n.children} links={links} />
          </em>
        );
      case 'code':
        return <code key={i}>{n.text}</code>;
      case 'image': {
        const url = guideImageUrl(n.src);
        return url ? <img key={i} className="cc-guide__inline-img" src={url} alt={n.alt} /> : <Fragment key={i}>{n.alt}</Fragment>;
      }
      case 'link': {
        const target = classifyLink(n.href);
        const label = <InlineNodes nodes={n.children} links={links} />;
        if (target.kind === 'guide' && isGuideId(target.guide)) {
          const guide = target.guide;
          return (
            <a
              key={i}
              href={links.href(guide, target.anchor)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                links.open(guide, target.anchor);
              }}
            >
              {label}
            </a>
          );
        }
        if (target.kind === 'anchor') {
          return (
            <a key={i} href={`#${encodeURIComponent(target.anchor)}`}>
              {label}
            </a>
          );
        }
        if (target.kind === 'web') {
          return (
            <a key={i} href={target.href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          );
        }
        // A file outside the guides (operations notes for the server): text only.
        return <span key={i}>{label}</span>;
      }
    }
  });
}

function Blocks({ blocks, links }: { blocks: Block[]; links: GuideLinkHandler }): ReactNode {
  const { t } = useI18n();
  return blocks.map((b, i) => {
    switch (b.kind) {
      case 'heading': {
        const Tag = `h${b.level}` as const;
        return (
          <Tag key={i} id={b.id} className={`cc-guide__h${b.level}`}>
            <InlineNodes nodes={b.content} links={links} />
          </Tag>
        );
      }
      case 'paragraph':
        return (
          <p key={i}>
            <InlineNodes nodes={b.content} links={links} />
          </p>
        );
      case 'list': {
        const items = b.items.map((item, j) => (
          <li key={j}>
            <InlineNodes nodes={item.content} links={links} />
            {item.children ? <Blocks blocks={[item.children]} links={links} /> : null}
          </li>
        ));
        return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
      }
      case 'quote':
        return (
          <aside key={i} className="cc-guide__note">
            <Blocks blocks={b.blocks} links={links} />
          </aside>
        );
      case 'table':
        return (
          <div key={i} className="cc-table-wrap">
            <table className="cc-table">
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} scope="col">
                      <InlineNodes nodes={c} links={links} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k}>
                        <InlineNodes nodes={c} links={links} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'figure': {
        const url = guideImageUrl(b.src);
        return url ? (
          <figure key={i} className="cc-guide__figure">
            {/* Full size in a new tab: on a phone the shrunk desktop screenshot cannot be read. */}
            <a href={url} target="_blank" rel="noopener noreferrer">
              <img src={url} alt={b.alt} loading="lazy" />
              <span className="cc-visually-hidden">{t('help.imageFullSize')}</span>
            </a>
          </figure>
        ) : (
          <p key={i} className="cc-muted">
            {b.alt}
          </p>
        );
      }
      case 'rule':
        return <hr key={i} />;
      case 'code':
        return (
          <pre key={i} className="cc-guide__code">
            <code>{b.text}</code>
          </pre>
        );
    }
  });
}

/** One guide in one language. `anchor` scrolls to a heading once the guide is shown. */
export function GuideView({ guide, locale, anchor, links }: { guide: GuideId; locale: Locale; anchor?: string | null; links: GuideLinkHandler }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ key: string; text: string | null } | null>(null);
  const key = `${locale}/${guide}`;
  useEffect(() => {
    let live = true;
    loadGuide(guide, locale).then(
      (text) => live && setState({ key, text }),
      () => live && setState({ key, text: null }),
    );
    return () => {
      live = false;
    };
  }, [guide, locale, key]);
  const text = state?.key === key ? state.text : undefined;
  const blocks = useMemo(() => (text ? parseMarkdown(text) : []), [text]);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!text) return;
    const target = anchor ? root.current?.querySelector(`[id="${CSS.escape(anchor)}"]`) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else root.current?.scrollIntoView?.({ block: 'start' });
  }, [text, anchor]);
  if (text === undefined) return <p className="cc-muted">{t('common.loading')}</p>;
  if (text === null) return <Alert>{t('help.notFound')}</Alert>;
  return (
    <article ref={root} className="cc-guide" lang={locale} data-testid="guide" data-guide={guide}>
      <Blocks blocks={blocks} links={links} />
    </article>
  );
}
