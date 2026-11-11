/**
 * The assistant chat (S19b, D-180), against a scripted local model (never a real provider): the
 * administrator connects an OpenAI-compatible fake on 127.0.0.1 and switches the chat on; a teacher asks
 * a question and sees the streamed answer after a read tool ("Looked at"), confirms one change on its
 * card (the homework is really set, through the assistant), refuses another (nothing is set), copies a
 * parent draft (the page says nothing is ever sent from the app), and the page passes axe at 1280 and
 * 375 px. Every switch and every record made here is undone in `finally`. Fictional data only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_KEYS, FakeProvider } from '../tests/ai-fake.ts';
import { lastToolResult, script } from '../tests/assistant-fake.ts';
import { api, login } from './helpers.ts';

async function seriousViolations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

const SET_TITLE = 'E2E assistant homework: read chapter 3';
const REFUSED_TITLE = 'E2E assistant homework that was refused';
const DRAFT = 'Dear parents, next week we visit the science museum. Please send a packed lunch. Thank you!';

test('Assistant: a streamed answer with a read tool, one change confirmed, one refused, a parent draft copied', async ({ browser }) => {
  const fake = new FakeProvider();
  const base = `${await fake.start()}/v1`;
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  let connectionId: string | null = null;
  let chatId: string | null = null;
  const madeHomework: string[] = [];
  await login(admin, 'admin');
  await login(page, 'english');
  try {
    const contexts = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; modules: Record<string, boolean> }>;
    const contextId = contexts.find((c) => c.modules.homework)?.id;
    expect(contextId).toBeTruthy();

    // Off: the teacher is told why.
    await page.goto('/teacher/ai-assistant');
    await expect(page.getByTestId('assistant-unavailable')).toContainText('The assistant is not switched on');

    // The administrator connects the fake, switches AI tools and the chat on.
    const conn = await api(admin, 'POST', '/api/admin/ai-connections', { type: 'openaiCompatible', name: 'E2E fake model', baseUrl: base, localNetwork: true, models: ['fake-tools-model'], apiKey: FAKE_KEYS.compatible, kvkkConfirmed: true });
    expect(conn.status).toBe(200);
    connectionId = conn.body.id as string;
    expect((await api(admin, 'PUT', '/api/admin/ai-connection-settings', { defaultConnectionId: connectionId, defaultModel: 'fake-tools-model' })).status).toBe(200);
    expect((await api(admin, 'PUT', '/api/admin/ai-tools', { mcpEnabled: true })).status).toBe(200);
    await admin.goto('/admin/ai-tools');
    const adminSection = admin.getByTestId('assistant-chat-admin');
    await adminSection.getByText('Teachers can use the assistant chat').click();
    await expect(admin.getByText('Assistant chat settings saved')).toBeVisible();
    await expect(adminSection.getByRole('switch')).toBeChecked();

    // The scripted model: reads first, proposes changes, writes a draft.
    const seen = script(fake, [
      (body) => {
        const last = body.messages.at(-1);
        if (last.role === 'user' && /homework is due/u.test(last.content)) return { text: 'Let me look at your classes.', calls: [{ name: 'list_my_classes', args: {} }] };
        if (last.role === 'tool' && Array.isArray(lastToolResult(body)?.contexts)) return { text: `You teach ${lastToolResult(body).contexts.length} classes. Nothing is due this week.` };
        if (last.role === 'user' && /Set reading homework/u.test(last.content)) return { text: 'Here is the homework.', calls: [{ name: 'create_homework', args: { contextId, title: SET_TITLE, dueOn: '2026-12-31' } }] };
        if (last.role === 'user' && /one more homework/u.test(last.content)) return { calls: [{ name: 'create_homework', args: { contextId, title: REFUSED_TITLE, dueOn: '2026-12-31' } }] };
        if (last.role === 'tool' && /declined/u.test(last.content)) return { text: 'All right, nothing was changed.' };
        if (last.role === 'tool') {
          const hw = lastToolResult(body);
          if (hw?.id) madeHomework.push(hw.id);
          return { text: 'The homework is set.' };
        }
        return { text: DRAFT };
      },
    ]);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Assistant', level: 1 })).toBeVisible();
    await expect(page.getByTestId('assistant-privacy')).toContainText('Student names stay at school');
    await page.getByTestId('assistant-new-chat').click();
    await expect(page.getByTestId('assistant-suggestions')).toBeVisible();
    chatId = new URL(page.url()).searchParams.get('chat');
    expect(chatId).toBeTruthy();

    // 1. A question: a read tool runs at once and the answer streams in.
    await page.getByTestId('assistant-suggestions').getByRole('button', { name: 'Which homework is due this week in my classes?' }).click();
    await page.getByTestId('assistant-send').click();
    const messages = page.getByTestId('assistant-messages');
    await expect(messages.getByText(/^You teach \d+ classes\. Nothing is due this week\.$/u)).toBeVisible();
    await expect(messages.getByTestId('assistant-activity').first()).toHaveText('Looked at: Your classes');
    expect(seen[0]!.body.tools.map((t: { function: { name: string } }) => t.function.name)).toContain('create_homework');
    expect(await seriousViolations(page)).toEqual([]);

    // 2. A change: the card waits; Yes sets the homework once.
    const composer = page.getByLabel('Your message');
    await composer.fill('Set reading homework for my class.');
    await page.getByTestId('assistant-send').click();
    const card = page.getByTestId('assistant-change-card').last();
    await expect(card).toHaveAttribute('data-state', 'pending');
    await expect(card).toContainText('Change: New homework');
    await expect(card).toContainText('Due on');
    // The waiting card is brought into view (on a phone it would be screens below the header).
    await expect(card).toBeInViewport();
    await expect(card).toContainText(SET_TITLE);
    expect(await seriousViolations(page)).toEqual([]);
    await card.getByTestId('assistant-card-yes').click();
    await expect(messages.getByText('The homework is set.')).toBeVisible();
    await expect(card.getByTestId('assistant-card-decided')).toHaveText('You said Yes. The change is made.');
    const listed = await api(page, 'GET', `/api/teacher/contexts/${contextId}/homework?view=month&date=2026-12-31`);
    expect(JSON.stringify(listed.body).split(SET_TITLE).length - 1).toBe(1);

    // 3. Another change, refused: nothing is set.
    await composer.fill('Please add one more homework.');
    await page.getByTestId('assistant-send').click();
    const second = page.getByTestId('assistant-change-card').last();
    await expect(second).toHaveAttribute('data-state', 'pending');
    await second.getByTestId('assistant-card-no').click();
    await expect(messages.getByText('All right, nothing was changed.')).toBeVisible();
    await expect(second.getByTestId('assistant-card-decided')).toHaveText('You said No. Nothing was changed.');
    expect(JSON.stringify((await api(page, 'GET', `/api/teacher/contexts/${contextId}/homework?view=month&date=2026-12-31`)).body)).not.toContain(REFUSED_TITLE);

    // 4. A parent draft: copied, never sent.
    await composer.fill('Draft a note to parents about the museum trip.');
    await page.getByTestId('assistant-send').click();
    await expect(messages.getByText(DRAFT)).toBeVisible();
    await expect(page.getByTestId('assistant-parents-note')).toHaveText('Class Compass never sends anything to parents or anyone else. To use a draft, copy it and send it yourself.');
    await page.getByTestId('assistant-copy').last().click();
    await expect(page.getByText('Copied. Paste it where you want to send it.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(DRAFT);
    // The key never reaches the page.
    expect(await page.evaluate(() => document.body.innerHTML)).not.toContain(FAKE_KEYS.compatible);
    expect(await seriousViolations(page)).toEqual([]);

    // Phone width: the open chat takes the screen, "All chats" goes back to the list.
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.getByTestId('assistant-chat-list')).toBeHidden();
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByRole('button', { name: 'All chats' }).click();
    await expect(page.getByTestId('assistant-chat-list')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await seriousViolations(page)).toEqual([]);
    // Continuing the chat on a phone brings its newest message into view, below the header.
    await page.getByTestId('assistant-chat-list').locator('.cc-assistant__chat').first().click();
    await expect(page.getByTestId('assistant-message-assistant').last()).toBeInViewport();
  } finally {
    // Leave nothing behind for later specs (one shared server and database).
    for (const id of madeHomework) await api(page, 'POST', `/api/teacher/homework/${id}/archive`, { archived: true });
    if (chatId) await api(page, 'DELETE', `/api/teacher/assistant-chat/chats/${chatId}`);
    await api(admin, 'PUT', '/api/admin/assistant-chat', { enabled: false });
    await api(admin, 'PUT', '/api/admin/ai-tools', { mcpEnabled: false });
    await api(admin, 'PUT', '/api/admin/ai-connection-settings', { defaultConnectionId: null, defaultModel: null });
    if (connectionId) await api(admin, 'DELETE', `/api/admin/ai-connections/${connectionId}`);
    await adminCtx.close();
    await ctx.close();
    await fake.close();
  }
});
