/**
 * Assistant: Markdown answers, file attach and theme drafts (S27d, D-196), against a scripted local model
 * (never a real provider). A teacher attaches a theme file; the model sees it as fenced text, answers in
 * Markdown (a table, a JSON code block with Download) and proposes `import_theme_draft` with the file's
 * reference (`attachment: "file-1"`: saved exactly as attached); the teacher says
 * Yes on the card and the administrator sees the draft on Admin → Themes with "Proposed by", never
 * enabled. The administrator then uses the chat on Admin → Assistant. Every switch, chat and draft made
 * here is undone in `finally`. Fictional data only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FAKE_KEYS, FakeProvider } from '../tests/ai-fake.ts';
import { lastToolResult, script } from '../tests/assistant-fake.ts';
import { api, login } from './helpers.ts';

const KEY = 'e2e-autumn-draft';
const ocean = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'docs', 'examples', 'ocean.theme.json'), 'utf8')) as Record<string, unknown>;
const pkg = { ...ocean, key: KEY, name: { en: 'E2E Autumn', tr: 'E2E Sonbahar' } };

test('Assistant: a theme file attached, a Markdown answer, a teacher draft confirmed and seen by the administrator', async ({ browser }) => {
  const fake = new FakeProvider();
  const base = `${await fake.start()}/v1`;
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const admin = await adminCtx.newPage();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  let connectionId: string | null = null;
  const chats: Array<{ page: typeof page; id: string }> = [];
  await login(admin, 'admin');
  await login(page, 'english');
  try {
    const conn = await api(admin, 'POST', '/api/admin/ai-connections', { type: 'openaiCompatible', name: 'E2E fake model', baseUrl: base, localNetwork: true, models: ['fake-tools-model'], apiKey: FAKE_KEYS.compatible, kvkkConfirmed: true });
    expect(conn.status).toBe(200);
    connectionId = conn.body.id as string;
    expect((await api(admin, 'PUT', '/api/admin/ai-connection-settings', { defaultConnectionId: connectionId, defaultModel: 'fake-tools-model' })).status).toBe(200);
    expect((await api(admin, 'PUT', '/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(200);
    expect((await api(admin, 'PUT', '/api/admin/assistant-chat', { enabled: true })).status).toBe(200);

    const seen = script(fake, [
      (body) => {
        const last = body.messages.at(-1);
        if (last.role === 'user' && /Attached file: autumn\.theme\.json/u.test(last.content)) {
          const fenced = /```json\n([\s\S]*)\n```/u.exec(last.content)?.[1] ?? '{}';
          const ref = /attachment (file-\d+)/u.exec(last.content)?.[1] ?? 'none';
          return {
            text: '## Your theme\n\n| Part | Value |\n|---|---|\n| Key | `' + KEY + '` |\n| Base | Ocean |\n\nThe package:\n\n```json\n' + fenced + '\n```\n\nSee [the guide](https://example.org/themes).',
            // The file reached the model as fenced text (names filtered while student data is off, D-161);
            // the model saves it by its reference, so the file is imported exactly as attached and never
            // copied back through the model's output (review fix).
            calls: [{ name: 'import_theme_draft', args: { attachment: ref } }],
          };
        }
        if (last.role === 'tool') return { text: `Saved as a draft: **${lastToolResult(body)?.name?.en ?? '?'}**. An administrator decides whether to enable it.` };
        if (last.role === 'user' && /school settings/u.test(last.content)) return { text: '- **Timezone:** Europe/Istanbul\n- *Week starts on* Monday' };
        return { text: 'Hello.' };
      },
    ]);

    // Teacher: attach the theme file and send it with a short message.
    await page.goto('/teacher/ai-assistant');
    await page.getByTestId('assistant-new-chat').click();
    await page.waitForURL(/[?&]chat=/u);
    const chatId = new URL(page.url()).searchParams.get('chat');
    expect(chatId).toBeTruthy();
    chats.push({ page, id: chatId! });
    // A picture is refused in the page, before anything is sent.
    await page.getByTestId('assistant-attach').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    await expect(page.getByTestId('assistant-attach-error')).toBeVisible();
    await expect(page.getByTestId('assistant-attached')).toHaveCount(0);
    await page.getByTestId('assistant-attach').setInputFiles({ name: 'autumn.theme.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pkg, null, 2)) });
    await expect(page.getByTestId('assistant-attached')).toContainText('autumn.theme.json');
    await expect(page.getByTestId('assistant-attach-error')).toHaveCount(0);
    await page.getByLabel('Your message').fill('Please save this as a theme draft.');
    await page.getByTestId('assistant-send').click();

    const messages = page.getByTestId('assistant-messages');
    // The user's message shows the file as a code block; the model got it as fenced text.
    await expect(page.getByTestId('assistant-message-user').last().getByTestId('assistant-code')).toContainText(`"key": "${KEY}"`);
    // Markdown: a heading, a table, a code block with Copy and Download, a safe link.
    const answer = page.getByTestId('assistant-message-assistant').filter({ has: page.getByRole('heading', { name: 'Your theme' }) });
    await expect(answer.getByRole('heading', { name: 'Your theme' })).toBeVisible();
    await expect(answer.getByRole('table')).toContainText(KEY);
    const link = answer.getByRole('link', { name: 'the guide' });
    await expect(link).toHaveAttribute('href', 'https://example.org/themes');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(answer.getByTestId('assistant-code-copy')).toBeVisible();
    const download = page.waitForEvent('download');
    await answer.getByTestId('assistant-code-download').click();
    expect((await download).suggestedFilename()).toBe(`${KEY}.theme.json`);

    // The card says what the draft is; nothing is saved before Yes.
    const card = page.getByTestId('assistant-change-card').last();
    await expect(card).toHaveAttribute('data-state', 'pending');
    await expect(card).toContainText(KEY);
    await expect(card).toContainText('E2E Autumn');
    expect((await api(admin, 'GET', '/api/admin/themes')).body.themes.some((t: { key: string }) => t.key === KEY)).toBe(false);
    // Preview theme (owner 2026-11-12): the Admin → Themes preview inside the chat, before saying Yes.
    const call = page.getByTestId('assistant-theme-preview').last();
    await call.getByTestId('assistant-theme-preview-open').click();
    const preview = call.getByTestId('theme-package-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('heading', { name: 'Preview: E2E Autumn' })).toBeVisible();
    await expect(preview.getByTestId(`theme-preview-area-cc-preview-${KEY}`)).toBeVisible();
    expect((await api(admin, 'GET', '/api/admin/themes')).body.themes.some((t: { key: string }) => t.key === KEY)).toBe(false);
    await preview.getByRole('button', { name: 'Close the preview' }).click();
    await expect(preview).toHaveCount(0);
    await card.getByTestId('assistant-card-yes').click();
    await expect(messages.getByText(/Saved as a draft:/u)).toBeVisible();
    await expect(messages.getByText('E2E Autumn', { exact: true })).toBeVisible();
    expect(seen.length).toBeGreaterThanOrEqual(2);

    // Administrator: the draft shows who proposed it, and it is not enabled.
    await admin.goto('/admin/themes');
    await expect(admin.getByTestId(`theme-proposed-${KEY}`)).toContainText('Proposed by');
    await expect(admin.getByTestId(`theme-enable-${KEY}`)).toBeVisible();
    const listed = (await api(admin, 'GET', '/api/admin/themes')).body.themes.find((t: { key: string }) => t.key === KEY);
    expect(listed).toMatchObject({ status: 'draft', classCount: 0 });

    // Administrator: Admin → Assistant, a Markdown answer.
    await admin.getByRole('link', { name: 'Assistant' }).first().click();
    await expect(admin).toHaveURL(/\/admin\/ai-assistant/u);
    await admin.getByTestId('assistant-new-chat').click();
    await admin.waitForURL(/[?&]chat=/u);
    const adminChat = new URL(admin.url()).searchParams.get('chat');
    expect(adminChat).toBeTruthy();
    chats.push({ page: admin, id: adminChat! });
    await admin.getByLabel('Your message').fill('Show me the school settings.');
    await admin.getByTestId('assistant-send').click();
    const adminAnswer = admin.getByTestId('assistant-message-assistant').last();
    await expect(adminAnswer.getByRole('listitem').first()).toContainText('Timezone:');
    // Lists keep their bullets inside the message list (which has none of its own).
    expect(await adminAnswer.locator('ul').first().evaluate((el) => getComputedStyle(el).listStyleType)).toBe('disc');
    await expect(adminAnswer.locator('strong').first()).toHaveText('Timezone:');
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    for (const c of chats) await api(c.page, 'DELETE', `/api/teacher/assistant-chat/chats/${c.id}`);
    await api(admin, 'DELETE', `/api/admin/themes/${KEY}`, { confirm: KEY });
    await api(admin, 'PUT', '/api/admin/assistant-chat', { enabled: false });
    await api(admin, 'PUT', '/api/admin/ai-tools', { mcpEnabled: false });
    await api(admin, 'PUT', '/api/admin/ai-connection-settings', { defaultConnectionId: null, defaultModel: null });
    if (connectionId) await api(admin, 'DELETE', `/api/admin/ai-connections/${connectionId}`);
    await adminCtx.close();
    await ctx.close();
    await fake.close();
  }
});
