// @vitest-environment jsdom
/**
 * S27d (D-196): assistant answers as a safe Markdown subset, files attached to a message, and the page
 * in the admin area. HTML, scripts, pictures and javascript: links stay text; links open only http,
 * https and mailto in a new tab with rel="noopener noreferrer"; code blocks have Copy and, for JSON,
 * "Download as file"; a streaming answer with an unclosed fence draws a code block without buttons.
 * Fictional data only.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../src/shared/i18n/index.ts';

const calls: Array<{ path: string; method: string; input: any }> = [];
let answers: Record<string, unknown> = {};
vi.mock('../../src/client/lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/lib/api.ts')>()),
  call: (ep: { path: string; method: string }, input: unknown) => {
    calls.push({ path: ep.path, method: ep.method, input });
    const a = answers[`${ep.method} ${ep.path}`];
    return Promise.resolve(typeof a === 'function' ? a(input) : (a ?? { ok: true }));
  },
}));
const navigations: unknown[] = [];
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => (to: unknown) => {
    navigations.push(to);
    return Promise.resolve();
  },
  Link: ({ children }: { children: ReactNode }) => <a href="#x">{children}</a>,
}));

const { I18nProvider } = await import('../../src/client/lib/i18n.tsx');
const { ME_KEY } = await import('../../src/client/lib/session.ts');
const { ChatMarkdown, UserText, safeHref, jsonFileName, splitFences } = await import('../../src/client/modules/assistantChat/ChatMarkdown.tsx');
const { default: AssistantChatPage, readAttachment } = await import('../../src/client/modules/assistantChat/AssistantChatPage.tsx');
const { parseMarkdown } = await import('../../src/client/help/markdown.ts');

function wrap(node: ReactNode, locale: Locale = 'en') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_KEY, { id: 'u1', role: 'teacher', classroomMode: false, pinUnlocked: true, locale });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale={locale}>{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Markdown answers are safe (D-196)', () => {
  it('draws headings, emphasis, lists, tables, quotes and code', () => {
    const { container } = wrap(
      <ChatMarkdown
        text={[
          '# Plan',
          'A **bold** and *calm* week with `code`.',
          '',
          '- Monday',
          '- Tuesday',
          '',
          '1. First',
          '2. Second',
          '',
          '| Day | Topic |',
          '| --- | --- |',
          '| Mon | Weather |',
          '',
          '> A quiet note.',
          '',
          '```json',
          '{"key": "autumn-leaves"}',
          '```',
        ].join('\n')}
      />,
    );
    // Headings sit below the chat's own headings (h1 page, h2 chat title).
    expect(container.querySelector('h3')?.textContent).toBe('Plan');
    expect(container.querySelector('h1, h2')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('calm');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('table th')?.textContent).toBe('Day');
    expect(container.querySelector('blockquote')?.textContent).toBe('A quiet note.');
    expect(container.querySelector('pre code')?.textContent).toBe('{"key": "autumn-leaves"}');
    expect(screen.getByTestId('assistant-code-copy')).toBeTruthy();
    expect(screen.getByTestId('assistant-code-download')).toBeTruthy();
  });

  it('script, img, iframe and other HTML stay text; nothing is parsed as HTML', () => {
    const evil = '<script>alert(1)</script> <img src=x onerror="alert(2)"> <iframe src="https://example.org"></iframe> <b>bold?</b> <a href="javascript:alert(3)">x</a>';
    const { container } = wrap(<ChatMarkdown text={evil} />);
    expect(container.querySelector('script, img, iframe, b')).toBeNull();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<img src=x onerror="alert(2)">');
  });

  it('links: only http, https and mailto, in a new tab with noopener noreferrer; javascript:, data: and relative links are text', () => {
    const { container } = wrap(
      <ChatMarkdown
        text={'[guide](https://example.org/guide) [mail](mailto:office@example.org) [bad](javascript:alert(1)) [bad2](JaVaScRiPt:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=) [rel](/api/admin/users) [vb](vbscript:x)'}
      />,
    );
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.org/guide', 'mailto:office@example.org']);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(container.textContent).toContain('bad');
    expect(container.textContent).toContain('rel');
    expect(safeHref(' javascript:alert(1)')).toBeNull();
    expect(safeHref('https://example.org/a b')).toBe('https://example.org/a%20b');
    expect(safeHref('http:/\\evil')).toBe(null);
  });

  it('pictures are never loaded: the alternative text is shown', () => {
    const { container } = wrap(<ChatMarkdown text={'![a cat](https://example.org/cat.png)\n\nInline ![dog](https://example.org/d.png) here.'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('[picture not shown: a cat]');
    expect(container.textContent).toContain('[picture not shown: dog]');
  });

  it('a streaming answer: an unclosed fence is already a code block, its buttons wait for the end; growing text keeps earlier blocks', () => {
    const { container, rerender } = wrap(<ChatMarkdown text={'Here it is:\n\n```json\n{"key": "au'} streaming />);
    expect(container.querySelector('pre code')?.textContent).toBe('{"key": "au');
    expect(screen.queryByTestId('assistant-code-copy')).toBeNull();
    const first = container.querySelector('p');
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider locale="en">
          <ChatMarkdown text={'Here it is:\n\n```json\n{"key": "autumn"}\n```\nDone.'} />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(container.querySelector('p')?.textContent).toBe(first?.textContent);
    expect(screen.getByTestId('assistant-code-download')).toBeTruthy();
    expect(parseMarkdown('```json\n{}').at(-1)).toMatchObject({ kind: 'code', lang: 'json', open: true });
  });

  it('Download as file saves the JSON under the package key; Copy copies the code', async () => {
    const saved: Array<{ name: string; text: string }> = [];
    const createObjectURL = vi.fn((b: Blob) => {
      void b.text().then((text) => saved.push({ name: '', text }));
      return 'blob:x';
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      wrap(<ChatMarkdown text={'```json\n{"key": "autumn-leaves", "format": "class-compass-theme"}\n```'} />);
      fireEvent.click(screen.getByTestId('assistant-code-download'));
      expect(clicks).toEqual(['autumn-leaves.theme.json']);
      await waitFor(() => expect(saved[0]?.text).toBe('{"key": "autumn-leaves", "format": "class-compass-theme"}\n'));
      fireEvent.click(screen.getByTestId('assistant-code-copy'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('{"key": "autumn-leaves", "format": "class-compass-theme"}'));
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
    expect(jsonFileName('{"key": "../../etc"}')).toBe('assistant.json');
    expect(jsonFileName('not json')).toBe('assistant.json');
  });

  it("a teacher's own text is shown as typed (no Markdown); an attached file is a code block", () => {
    const { container } = wrap(<UserText text={'Please **check** <b>this</b>\n\nAttached file: a.json\n````json\n{"a": "```"}\n````'} />);
    expect(container.querySelector('strong, b')).toBeNull();
    expect(container.textContent).toContain('Please **check** <b>this</b>');
    expect(container.querySelector('pre code')?.textContent).toBe('{"a": "```"}');
    expect(splitFences('x\n```\ny')).toEqual([
      { kind: 'text', text: 'x' },
      { kind: 'code', text: 'y', lang: undefined },
    ]);
  });
});

describe('Markdown answers after the review', () => {
  it('a ``` line the fence test rejects never hangs the parser (```npm install```, ```js `x`, > ```x```)', () => {
    expect(parseMarkdown('Run:\n```npm install```')).toEqual([
      {
        kind: 'paragraph',
        content: [
          { kind: 'text', text: 'Run: ' },
          { kind: 'code', text: 'npm install' },
        ],
      },
    ]);
    expect(parseMarkdown('```js `x`')).toHaveLength(1);
    expect(parseMarkdown('> ```x```')).toEqual([{ kind: 'quote', blocks: [{ kind: 'paragraph', content: [{ kind: 'code', text: 'x' }] }] }]);
    expect(parseMarkdown('text\n```js `x`\nmore')).toHaveLength(1);
    const { container } = wrap(<ChatMarkdown text={'Run:\n```npm install```'} />);
    expect(container.querySelector('p code')?.textContent).toBe('npm install');
  });

  it('a fenced block under a list item is a code block of that item, with Copy and Download', () => {
    const blocks = parseMarkdown('- Use this:\n  ```\n  code\n  ```');
    expect(blocks).toEqual([{ kind: 'list', ordered: false, items: [{ content: [{ kind: 'text', text: 'Use this:' }], blocks: [{ kind: 'code', text: 'code' }], children: null }] }]);
    const text = '1. Save this file:\n   ```json\n   {"key": "winter-calm"}\n\n   ```\n2. Then attach it.';
    const { container } = wrap(<ChatMarkdown text={text} />);
    const items = container.querySelectorAll('ol > li');
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('pre code')?.textContent).toBe('{"key": "winter-calm"}\n');
    expect(within(items[0] as HTMLElement).getByTestId('assistant-code-download')).toBeTruthy();
    expect(items[1]!.textContent).toBe('Then attach it.');
  });

  it('an ordered list keeps its first number after an interruption', () => {
    const { container } = wrap(<ChatMarkdown text={'1. Open the file\n\n```json\n{}\n```\n\n2. Attach it\n3. Send'} />);
    const lists = container.querySelectorAll('ol');
    expect(lists).toHaveLength(2);
    expect(lists[0]!.getAttribute('start')).toBeNull();
    expect(lists[1]!.getAttribute('start')).toBe('2');
    expect(parseMarkdown('3. Third\n4. Fourth')[0]).toMatchObject({ kind: 'list', start: 3 });
  });

  it('lists show their markers and table cells wrap only between words (the message list sets list-style: none)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'client', 'modules', 'assistantChat', 'assistantChat.css'), 'utf8').replace(/\s+/gu, ' ');
    expect(css).toContain('.cc-md ul { list-style: disc; }');
    expect(css).toContain('.cc-md ol { list-style: decimal; }');
    expect(css).toMatch(/\.cc-md__table th, \.cc-md__table td \{ overflow-wrap: normal; word-break: normal; \}/u);
  });

  it('a link shows the site it opens next to its words', () => {
    const { container } = wrap(<ChatMarkdown text={'[See the summary](https://example.org/c?s=student-4) and [https://example.org](https://example.org/) and [mail](mailto:office@example.org)'} />);
    expect(container.textContent).toBe('See the summary (example.org) and https://example.org and mail');
  });
});

describe('attaching a file (D-196)', () => {
  const file = (name: string, text: string | Uint8Array, type = 'text/plain') => new File([text as BlobPart], name, { type });

  it('accepts .json, .txt and .md up to 200 KB; refuses other types, bigger files and binary content', async () => {
    expect(await readAttachment(file('theme.json', '{"key":"a"}'))).toMatchObject({ ok: true, attachment: { name: 'theme.json', text: '{"key":"a"}', bytes: 11 } });
    expect((await readAttachment(file('notes.md', '# hi'))).ok).toBe(true);
    expect((await readAttachment(file('notes.TXT', 'hi'))).ok).toBe(true);
    expect(await readAttachment(file('photo.png', 'x', 'image/png'))).toEqual({ ok: false, reason: 'wrongType' });
    expect(await readAttachment(file('page.html', '<p>'))).toEqual({ ok: false, reason: 'wrongType' });
    expect(await readAttachment(file('big.txt', 'a'.repeat(200 * 1024 + 1)))).toEqual({ ok: false, reason: 'tooBig' });
    expect(await readAttachment(file('bin.txt', new Uint8Array([0, 1, 2, 255])))).toEqual({ ok: false, reason: 'notText' });
  });

  it('the composer attaches a file, shows it, sends it with the message and refuses a picture', async () => {
    const CHAT = '00000000-0000-7000-8000-0000000000a1';
    answers = {
      'GET /api/teacher/assistant-chat': { available: true, unavailable: null, studentNames: false, connections: [], defaultConnectionId: null, defaultModel: null, retentionDays: 365 },
      'GET /api/teacher/assistant-chat/chats': { chats: [] },
      'GET /api/teacher/assistant-chat/chats/:chatId': { chat: { id: CHAT, title: '', createdAt: 1, lastMessageAt: 1, archived: false, connectionId: null, model: null }, messages: [], runId: null, compacted: false },
      'POST /api/teacher/assistant-chat/chats/:chatId/messages': { runId: '00000000-0000-7000-8000-0000000000c1', messageId: 'm1' },
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    wrap(<AssistantChatPage search={{ chat: CHAT }} />);
    const input = (await screen.findByTestId('assistant-attach')) as HTMLInputElement;
    expect(input.getAttribute('accept')).toContain('.json');
    fireEvent.change(input, { target: { files: [file('photo.png', 'x', 'image/png')] } });
    expect((await screen.findByTestId('assistant-attach-error')).textContent).toBe('Only .json, .txt and .md files can be attached.');
    fireEvent.change(input, { target: { files: [file('autumn.json', '{"key":"autumn"}')] } });
    expect((await screen.findByTestId('assistant-attached')).textContent).toContain('Attached: autumn.json (1 KB)');
    expect(screen.queryByTestId('assistant-attach-error')).toBeNull();
    // A file alone can be sent.
    fireEvent.click(screen.getByTestId('assistant-send'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/messages'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/messages'))!.input).toEqual({ chatId: CHAT, text: '', attachment: { name: 'autumn.json', text: '{"key":"autumn"}' } });
    await waitFor(() => expect(screen.queryByTestId('assistant-attached')).toBeNull());
  });
});

describe('the page in the admin area (D-196)', () => {
  beforeEach(() => {
    calls.length = 0;
    navigations.length = 0;
    answers = {
      'GET /api/teacher/assistant-chat': { available: true, unavailable: null, studentNames: false, connections: [], defaultConnectionId: null, defaultModel: null, retentionDays: 365 },
      'GET /api/teacher/assistant-chat/chats': { chats: [{ id: 'c1', title: 'Winter theme', createdAt: 1, lastMessageAt: 1, archived: false, connectionId: null, model: null }] },
    };
  });

  it('says what an administrator can ask and opens chats under /admin/ai-assistant', async () => {
    wrap(<AssistantChatPage search={{}} area="admin" />);
    expect(await screen.findByText(/Ask about school settings, classes and reports, or design a theme/u)).toBeTruthy();
    fireEvent.click(await screen.findByText('Winter theme'));
    expect(navigations.at(-1)).toMatchObject({ to: '/admin/ai-assistant', search: { chat: 'c1' } });
  });

  it('Turkish strings', async () => {
    wrap(<AssistantChatPage search={{}} area="admin" />, 'tr');
    expect(await screen.findByText(/Okul ayarları, sınıflar ve raporlar hakkında sorun/u)).toBeTruthy();
    const list = await screen.findByTestId('assistant-chat-list');
    expect(await within(list).findByText('Winter theme')).toBeTruthy();
  });
});
