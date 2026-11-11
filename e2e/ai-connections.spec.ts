/**
 * Assistant connections (S19a, D-179): the administrator adds an OpenAI-compatible connection to a
 * local fake provider on 127.0.0.1 (ticking "on this server or the school's network"), confirms KVKK,
 * tests the model (text and tools), sees no key anywhere, and deletes it again. The page passes axe.
 * No real provider and no network: the fake server and its key are fictional and live in this test.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_KEYS, FakeProvider } from '../tests/ai-fake.ts';
import { api, login } from './helpers.ts';

async function seriousViolations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test('Admin → AI tools → Assistant connections: add a local OpenAI-compatible connection, test it, delete it', async ({ page }) => {
  const fake = new FakeProvider();
  const base = `${await fake.start()}/v1`;
  const NAME = 'Fake school model server';
  await login(page, 'admin');
  try {
    await page.goto('/admin/ai-tools');
    const section = page.getByTestId('ai-connections');
    await expect(section.getByRole('heading', { name: 'Assistant connections' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await section.getByTestId('ai-conn-add').click();
    const dialog = page.getByTestId('ai-conn-dialog');
    await dialog.getByLabel('Kind of connection').selectOption('openaiCompatible');
    await dialog.getByLabel(/^Name/u).fill(NAME);
    await dialog.getByLabel(/^Address/u).fill(base);
    await dialog.getByText('This address is on this server or the school’s network').click();
    await dialog.getByLabel(/API key/u).fill(FAKE_KEYS.compatible);
    await dialog.getByLabel(/Models, one per line/u).fill('fake-tools-model');
    await dialog.getByLabel(/Messages a day per teacher/u).fill('30');
    await dialog.getByTestId('ai-conn-kvkk').check();
    expect(await seriousViolations(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Connection added')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(section.getByRole('cell', { name: NAME, exact: true })).toBeVisible();

    await section.getByRole('button', { name: 'Test fake-tools-model' }).click();
    await expect(section.getByTestId('ai-conn-test-result')).toHaveText('fake-tools-model: text works and tools work.');
    // The fake saw our key in the header; the page and the API never show it.
    expect(fake.requests.filter((r) => r.path === '/v1/chat/completions')).toHaveLength(2);
    expect(await page.evaluate(() => document.body.innerHTML)).not.toContain(FAKE_KEYS.compatible);
    const listed = await api(page, 'GET', '/api/admin/ai-connections');
    expect(JSON.stringify(listed.body)).not.toContain(FAKE_KEYS.compatible);
    const row = listed.body.connections.find((c: { name: string }) => c.name === NAME);
    expect(row.models[0]).toMatchObject({ name: 'fake-tools-model', text: true, tools: true });
    expect(await seriousViolations(page)).toEqual([]);

    await section.getByRole('button', { name: 'Delete' }).click();
    await section.getByRole('group', { name: /^Delete Fake school model server\?/u }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Connection deleted')).toBeVisible();
    await expect(section.getByRole('cell', { name: NAME, exact: true })).toBeHidden();
  } finally {
    // Leave nothing behind for later specs.
    const left = await api(page, 'GET', '/api/admin/ai-connections');
    for (const c of left.body?.connections ?? []) if (c.name === NAME) await api(page, 'DELETE', `/api/admin/ai-connections/${c.id}`);
    await fake.close();
  }
});
