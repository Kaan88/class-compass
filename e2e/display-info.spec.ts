/**
 * S16c (D-165): the demo teacher opens the classroom board at a known window size; the administrator
 * sees that size under Maintenance → Classroom screens (axe on the tab). A lesson this test starts is
 * ended again. Fictional demo data only.
 */
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

type Ctx = { id: string; className: string; subjectName: { en: string } };

async function endLesson(page: Page, contextId: string) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    if (l.contextId !== contextId) continue;
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

test('the classroom board records its screen size and the administrator sees it', async ({ browser }) => {
  test.setTimeout(90_000);
  const viewport = { width: 1366, height: 768 };
  const tctx = await browser.newContext({ viewport, hasTouch: true });
  const t = await tctx.newPage();
  let started: string | null = null;
  try {
    await login(t, 'english');
    await ensurePin(t);
    const ctx = ((await api(t, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[]).find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
    const active = (await api(t, 'GET', '/api/classroom/lessons/active')).body.lessons as Array<{ contextId: string }>;
    if (!active.some((l) => l.contextId === ctx.id)) {
      const r = await api(t, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: ctx.id, payload: { contextId: ctx.id, othersPresent: true, attendance: [] } }] });
      expect(r.body.results[0].ok).toBe(true);
      started = ctx.id;
    }
    const sent = t.waitForResponse((r) => r.url().endsWith('/api/classroom/display-info') && r.request().method() === 'POST');
    await t.goto('/classroom');
    await t.getByRole('button', { name: /3-A · (English|İngilizce)/u }).first().click();
    await expect(t.getByTestId('lesson-dashboard')).toBeVisible();
    expect((await sent).status()).toBe(200);
  } finally {
    if (started) await endLesson(t, started);
    await tctx.close();
  }

  const actx = await browser.newContext();
  const a = await actx.newPage();
  try {
    await login(a, 'admin');
    await a.goto('/admin/maintenance');
    await a.getByRole('tab', { name: 'Classroom screens' }).click();
    const table = a.getByRole('table', { name: 'Classroom screens by teacher' });
    const row = table.getByRole('row').filter({ hasText: 'Deniz Akın (English)' });
    await expect(row).toContainText('1366 × 768');
    await expect(row).toContainText('Chrome');
    await new AxeBuilder({ page: a }).include('[data-testid="display-info"]').analyze().then((r) => expect(r.violations).toEqual([]));
  } finally {
    await actx.close();
  }
});
