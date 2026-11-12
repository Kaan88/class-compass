/**
 * Assistant answers as a safe Markdown subset (S27d, D-196). The text is parsed by the app's own small
 * parser (`help/markdown.ts`, the one the Help screen uses for the guides: no dependency) into a data
 * tree and drawn with React elements only, never `innerHTML`, so HTML, scripts and pictures in an answer
 * stay text:
 *
 * - headings (one level below the chat's own headings), paragraphs, **bold**, *italic*, `code`, lists,
 *   tables (scrolling inside their box), quotes and fenced code blocks;
 * - links only to http, https and mailto addresses (`safeHref`), opened in a new tab with
 *   `rel="noopener noreferrer"`; any other link (javascript:, data:, a relative path) is its text only;
 * - images are never loaded: their alternative text is shown in brackets;
 * - a code block has Copy and, for JSON, "Download as file" (a theme package, named after its key).
 *
 * Streaming: the whole text is parsed again on each piece (it is small), so a growing answer only ever
 * adds content; an unclosed fence shows as a code block straight away (its buttons wait for the end).
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, plainText, type Block, type Inline } from '../../help/markdown.ts';
import { copyText, showManualCopy } from '../../lib/clipboard.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { Button } from '../../ui/Button.tsx';
import { IconCopy, IconFile } from '../../ui/icons.tsx';

/** The address a link may open, or null: only http, https and mailto, parsed as a URL. */
export function safeHref(href: string): string | null {
  const raw = href.trim();
  if (!/^(?:https?:\/\/|mailto:)/iu.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The file name for a JSON block: a theme package's key (a slug) or a neutral name. */
export function jsonFileName(text: string): string {
  try {
    const v = JSON.parse(text) as unknown;
    const key = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>).key : null;
    if (typeof key === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/u.test(key)) return `${key}.theme.json`;
  } catch {
    // Not complete JSON: still offered as a file under a neutral name.
  }
  return 'assistant.json';
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text.endsWith('\n') ? text : `${text}\n`], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function InlineNodes({ nodes }: { nodes: Inline[] }): ReactNode {
  const { t } = useI18n();
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'strong':
        return (
          <strong key={i}>
            <InlineNodes nodes={n.children} />
          </strong>
        );
      case 'em':
        return (
          <em key={i}>
            <InlineNodes nodes={n.children} />
          </em>
        );
      case 'code':
        return <code key={i}>{n.text}</code>;
      case 'image':
        return <Fragment key={i}>{t('assistantChat.image', { alt: n.alt })}</Fragment>;
      case 'link': {
        const href = safeHref(n.href);
        const label = <InlineNodes nodes={n.children} />;
        return href ? (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          <Fragment key={i}>{label}</Fragment>
        );
      }
    }
  });
}

export function CodeBlock({ text, lang, done }: { text: string; lang: string | undefined; done: boolean }) {
  const { t } = useI18n();
  const copy = async () => {
    if (await copyText(text)) showToast({ message: t('assistantChat.code.copied'), kind: 'success' });
    else showManualCopy({ title: t('assistantChat.code.copy'), label: t('assistantChat.code.copy'), text });
  };
  return (
    <figure className="cc-md__code" data-testid="assistant-code">
      <figcaption className="cc-md__code-head">
        <span className="cc-muted">{lang ? t('assistantChat.code.label', { lang }) : t('assistantChat.code.labelPlain')}</span>
        {done ? (
          <span className="cc-row cc-md__code-actions">
            <Button size="small" variant="ghost" onPress={() => void copy()} data-testid="assistant-code-copy">
              <IconCopy />
              <span>{t('assistantChat.code.copy')}</span>
            </Button>
            {lang === 'json' ? (
              <Button size="small" variant="ghost" onPress={() => saveFile(jsonFileName(text), text)} data-testid="assistant-code-download">
                <IconFile />
                <span>{t('assistantChat.code.download')}</span>
              </Button>
            ) : null}
          </span>
        ) : null}
      </figcaption>
      <pre tabIndex={0}>
        <code>{text}</code>
      </pre>
    </figure>
  );
}

const HEADINGS = ['h3', 'h4', 'h5', 'h6'] as const;

function Blocks({ blocks, streaming }: { blocks: Block[]; streaming: boolean }): ReactNode {
  return blocks.map((b, i) => {
    switch (b.kind) {
      case 'heading': {
        const Tag = HEADINGS[b.level - 1]!;
        return (
          <Tag key={i} className="cc-md__h">
            <InlineNodes nodes={b.content} />
          </Tag>
        );
      }
      case 'paragraph':
        return (
          <p key={i}>
            <InlineNodes nodes={b.content} />
          </p>
        );
      case 'list': {
        const items = b.items.map((item, j) => (
          <li key={j}>
            <InlineNodes nodes={item.content} />
            {item.children ? <Blocks blocks={[item.children]} streaming={streaming} /> : null}
          </li>
        ));
        return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
      }
      case 'quote':
        return (
          <blockquote key={i}>
            <Blocks blocks={b.blocks} streaming={streaming} />
          </blockquote>
        );
      case 'table':
        return (
          <div key={i} className="cc-md__table" tabIndex={0} role="group" aria-label={plainText(b.head.flat())}>
            <table className="cc-table">
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} scope="col">
                      <InlineNodes nodes={c} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k}>
                        <InlineNodes nodes={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'figure':
        return (
          <p key={i}>
            <InlineNodes nodes={[{ kind: 'image', src: b.src, alt: b.alt }]} />
          </p>
        );
      case 'rule':
        return <hr key={i} />;
      case 'code':
        return <CodeBlock key={i} text={b.text} lang={b.lang} done={!b.open && !streaming} />;
    }
  });
}

/** An assistant answer as Markdown (`streaming`: still being written, so code blocks wait with their buttons). */
export function ChatMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="cc-md" data-testid="assistant-text">
      <Blocks blocks={blocks} streaming={streaming} />
    </div>
  );
}

/** Parts of a teacher's own message: their text as typed, and fenced blocks (an attached file) as code. */
export function splitFences(text: string): Array<{ kind: 'text'; text: string } | { kind: 'code'; text: string; lang: string | undefined }> {
  const out: Array<{ kind: 'text'; text: string } | { kind: 'code'; text: string; lang: string | undefined }> = [];
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  let plain: string[] = [];
  const flush = () => {
    const s = plain.join('\n').replace(/^\n+|\n+$/gu, '');
    if (s) out.push({ kind: 'text', text: s });
    plain = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*(`{3,})([^`]*)$/u.exec(lines[i]!);
    if (!m) {
      plain.push(lines[i]!);
      continue;
    }
    const run = m[1]!.length;
    const end = lines.findIndex((l, j) => j > i && /^\s*`{3,}\s*$/u.test(l) && l.trim().length >= run);
    const stop = end === -1 ? lines.length : end;
    flush();
    out.push({ kind: 'code', text: lines.slice(i + 1, stop).join('\n'), lang: /^[A-Za-z0-9_+.-]{1,20}/u.exec(m[2]!.trim())?.[0].toLowerCase() });
    i = stop;
  }
  flush();
  return out;
}

/** A teacher's own message: text as typed (no Markdown), an attached file as a code block. */
export function UserText({ text }: { text: string }) {
  const parts = useMemo(() => splitFences(text), [text]);
  return (
    <div className="cc-md cc-md--user" data-testid="assistant-text">
      {parts.map((p, i) => (p.kind === 'text' ? <p key={i} className="cc-md__plain">{p.text}</p> : <CodeBlock key={i} text={p.text} lang={p.lang} done />))}
    </div>
  );
}
