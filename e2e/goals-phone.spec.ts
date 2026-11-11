/**
 * S23b (D-183): the teacher's Goals → Students table on a phone. At 375×812 (and 320×640) every
 * student is a card: the name keeps its words (no word broken over two lines, before: one letter per
 * line in rows about 330 px tall), every column's label and value lie inside the screen (before: the
 * Evidence column was cut off at the card's edge), the page does not scroll sideways, the name still
 * opens the student's goals, and axe finds nothing serious. Fictional demo data only; nothing is
 * changed.
 */
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

type Ctx = { id: string; className: string; subjectName: { en: string } };

async function seriousViolations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

/** Names split inside a word, cells outside the screen, and sideways scrolling of the page. */
async function tableProblems(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    const table = document.querySelector<HTMLElement>('.cc-table')!;
    for (const td of table.querySelectorAll<HTMLElement>('tbody td')) {
      const r = td.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`"${td.dataset.label}" cell off the screen (${Math.round(r.left)}–${Math.round(r.right)} of ${vw})`);
      if (td.scrollWidth > td.clientWidth + 1) out.push(`"${td.dataset.label}" cell cut off (${td.scrollWidth} in ${td.clientWidth})`);
    }
    for (const btn of table.querySelectorAll<HTMLElement>('tbody td:first-child button')) {
      const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode())
        for (const m of (n.textContent ?? '').matchAll(/\S+/gu)) {
          const range = document.createRange();
          range.setStart(n, m.index);
          range.setEnd(n, m.index + m[0].length);
          if (new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size > 1) out.push(`"${btn.textContent?.trim()}": "${m[0]}" split over lines`);
        }
    }
    return out;
  });
}

test('teacher Goals → Students on a phone: whole-word names, every column in view, axe (S23b, D-183)', async ({ browser }) => {
  test.setTimeout(120_000);
  mkdirSync('test-results/s23b', { recursive: true });
  for (const size of [
    { width: 375, height: 812 },
    { width: 320, height: 640 },
  ]) {
    const ctx = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true, locale: 'en-GB' });
    const page = await ctx.newPage();
    try {
      await login(page, 'english');
      await ensurePin(page);
      const c = ((await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Ctx[]).find((x) => x.className === '3-A' && x.subjectName.en === 'English')!;
      await page.goto(`/teacher/goals?contextId=${c.id}`);
      const table = page.getByRole('table', { name: 'Goals in 3-A' });
      await expect(table).toBeVisible();
      const rows = table.locator('tbody tr');
      expect(await rows.count()).toBeGreaterThan(5);
      // Every column of a student's card is there with its label (the Evidence column included).
      const first = rows.first();
      for (const label of ['Active goals', 'Achieved', 'Evidence']) {
        const cell = first.locator(`td[data-label="${label}"]`);
        await cell.scrollIntoViewIfNeeded();
        await expect(cell).toBeInViewport({ ratio: 1 });
      }
      expect(await tableProblems(page), `${size.width}px`).toEqual([]);
      // The name line takes at most two lines of touch-size buttons (a long name puts the statistics
      // button under it; before: one letter per line, about 330 px).
      const nameLine = await rows.evaluateAll((els) => Math.max(...els.map((e) => e.querySelector('td')!.getBoundingClientRect().height)));
      expect(nameLine, `${size.width}px tallest name line`).toBeLessThan(150);
      await page.screenshot({ path: `test-results/s23b/goals-students-${size.width}.png`, fullPage: true });
      expect(await seriousViolations(page), `${size.width}px axe`).toEqual([]);
      // The name still opens the student's goals.
      const name = (await first.locator('td').first().getByRole('button').first().textContent())!.trim();
      await first.locator('td').first().getByRole('button').first().click();
      await expect(page.getByRole('heading', { name, exact: false }).first()).toBeVisible();
    } finally {
      await ctx.close();
    }
  }
});
