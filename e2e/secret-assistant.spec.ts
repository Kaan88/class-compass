/**
 * Secret Students and Daily Assistant on the classroom display (SEC-1..7, LES-3, DSH-3/6, AST-2/3):
 * choose secret students, refresh, check that no name of a chosen student reaches the DOM or any
 * secret-related network response before the reveal, then reveal at End Lesson and record outcomes.
 * Then the teacher-area weekly assistant schedule. Fictional demo data only.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { api, ensurePin, login, PIN } from './helpers.ts';

async function endActiveLessons(page: Page) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

async function axe(page: Page, selector: string) {
  const r = await new AxeBuilder({ page }).include(selector).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

interface Captured {
  url: string;
  body: string;
}

test('secret students: draw, refresh, nothing leaks before the reveal, reveal and outcomes at End Lesson', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  await endActiveLessons(page);
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; className: string; subjectName: { en: string } }>;
  const contextId = mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!.id;
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${contextId}/roster`)).body.students as Array<{ id: string; fullName: string }>;
  expect(roster.length).toBeGreaterThan(5);

  // Every response the page receives before the reveal, kept to check afterwards.
  const captured: Captured[] = [];
  let capturing = true;
  page.on('response', async (r) => {
    if (!capturing || !r.url().includes('/api/')) return;
    try {
      captured.push({ url: r.url(), body: await r.text() });
    } catch {
      /* redirects and 304s have no body */
    }
  });

  try {
    // Everyone present (as the Start Lesson screen records by default): only present/late students can be chosen.
    const started = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type: 'lesson.start', contextId, payload: { contextId, othersPresent: true } }] });
    expect(started.body.results[0].ok).toBe(true);
    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    const panel = page.getByTestId('secret-panel');
    await expect(panel).toBeVisible();

    // Draw (SEC-1): the panel shows only how many were chosen.
    await panel.getByRole('button', { name: 'Choose secret students' }).click();
    await expect(panel.getByTestId('secret-count')).toHaveText('2 secret students chosen');
    const panelText = async () => panel.innerText();
    for (const s of roster) expect(await panelText()).not.toContain(s.fullName);

    // Refresh: the round is still there, still without names (SEC-3).
    await page.reload();
    await expect(page.getByTestId('secret-count')).toHaveText('2 secret students chosen');
    await axe(page, '[data-testid="secret-panel"]');
    if (await page.getByTestId('assistant-panel').count()) await axe(page, '[data-testid="assistant-panel"]');
    for (const s of roster) expect(await page.getByTestId('secret-panel').innerText()).not.toContain(s.fullName);
    // Nothing in the DOM marks a student as chosen (no attribute or hidden text).
    const html = await page.content();
    expect(html).not.toMatch(/secret-(selected|chosen)|data-secret/);

    // End Lesson: reveal (LES-3).
    await page.getByRole('button', { name: 'End lesson', exact: true }).click();
    const end = page.getByTestId('end-lesson');
    await expect(end.getByRole('heading', { name: 'Secret Students' })).toBeVisible();
    capturing = false;
    await end.getByRole('button', { name: 'Reveal the secret students' }).click();
    const reveal = end.getByTestId('secret-reveal');
    await expect(reveal).toBeVisible();
    const cards = reveal.getByTestId('secret-reveal-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(1)).toHaveCSS('opacity', '1');
    await axe(page, '[data-testid="secret-reveal"]');
    const revealedNames: string[] = [];
    for (let i = 0; i < 2; i++) {
      const text = await cards.nth(i).innerText();
      const who = roster.find((s) => text.includes(s.fullName));
      expect(who).toBeTruthy();
      revealedNames.push(who!.fullName);
    }
    const revealedIds = roster.filter((s) => revealedNames.includes(s.fullName)).map((s) => s.id);

    // Before the reveal no secret-related answer named or identified a chosen student (SEC-3).
    for (const c of captured) {
      let scope = '';
      if (c.url.includes('/secret') || c.url.endsWith('/api/commands')) scope = c.body;
      else if (/\/api\/classroom\/contexts\/[^/]+\/lesson$/.test(new URL(c.url).pathname) && c.body) scope = JSON.stringify((JSON.parse(c.body) as { secret?: unknown }).secret ?? null);
      for (const id of revealedIds) expect(scope, c.url).not.toContain(id);
      for (const n of revealedNames) expect(scope, c.url).not.toContain(n);
    }
    expect(captured.some((c) => c.url.endsWith('/api/commands'))).toBe(true);

    // Outcomes (SEC-5): goal met for the first, still practising + a celebration for the second.
    await cards.nth(0).getByRole('radio', { name: 'Goal met' }).click();
    await expect(cards.nth(0).getByRole('radio', { name: 'Goal met' })).toHaveAttribute('aria-checked', 'true');
    await cards.nth(1).getByRole('radio', { name: 'Still practising' }).click();
    await expect(cards.nth(1).getByRole('radio', { name: 'Still practising' })).toHaveAttribute('aria-checked', 'true');
    await cards.nth(1).getByText(`Celebrate ${revealedNames[1]}`).click();
    // The full-screen celebration (S13b, D-110) is triggered by this classroom action, not only from the catalog.
    await expect(page.getByTestId('celebration')).toBeVisible();
    await expect(page.getByTestId('celebration')).toContainText(`Well done, ${revealedNames[1]}!`);
    await expect(cards.nth(1).getByText(`Well done, ${revealedNames[1]}!`)).toBeVisible();

    // The reveal and outcomes are on the server.
    const lessonId = (await api(page, 'GET', '/api/classroom/lessons/active')).body.lessons.find((l: { contextId: string }) => l.contextId === contextId).lessonId as string;
    await expect
      .poll(async () => {
        const r = await api(page, 'GET', `/api/classroom/lessons/${lessonId}/secret`);
        return ((r.body?.reveal?.selections ?? []) as Array<{ outcome: string | null }>).map((s) => s.outcome).sort();
      })
      .toEqual(['goal_met', 'still_practising']);

    await end.getByRole('button', { name: 'Save and end lesson' }).click();
    await expect(page.getByTestId('end-lesson')).toHaveCount(0);
  } finally {
    capturing = false;
    await endActiveLessons(page);
  }

  // Teacher area: the revealed outcomes are in the history; the weekly assistant schedule.
  expect((await api(page, 'POST', '/api/auth/pin/unlock', { pin: PIN })).status).toBe(200);
  expect((await api(page, 'POST', '/api/classroom/leave')).status).toBe(200);
  await page.goto('/teacher/secret');
  await expect(page.getByTestId('secret-page')).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();

  await page.goto('/teacher/assistant');
  const ap = page.getByTestId('assistant-page');
  await expect(ap).toBeVisible();
  await ap.getByRole('button', { name: 'Next week' }).click();
  const plan = ap.getByRole('button', { name: 'Plan this week' });
  await expect(plan).toBeVisible();
  await plan.click();
  await expect(ap.getByText('Not announced yet')).toBeVisible();
  await expect(ap.getByRole('table').first().getByRole('row')).toHaveCount(6); // header + Mon–Fri
  await expect(ap.getByText('Not planned yet')).toHaveCount(0);
  await ap.getByRole('button', { name: 'Announce' }).click();
  await expect(ap.getByText(/^Announced on/)).toBeVisible();
  await axe(page, '[data-testid="assistant-page"]');
});
