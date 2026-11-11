/**
 * S20a missing automated checks (D-037, UX-1, UX-6, DSH-1): a class of 40 (fictional names, some of
 * them long) on the classroom board at the measured classroom display, 1536×703 at device scale 1.25
 * with touch (ROADMAP "Classroom display" sample), and at 1920×1080. At both sizes: all 40 cards are
 * there, the page never scrolls sideways and no card reaches past the screen, every name is readable
 * (its text box has room, stays inside its card and is not cut off, clipped or ellipsed) and a word
 * of a name breaks over two lines only when it is wider than its name column (S14i: compact board
 * cards put the name across the card), at Normal and at Compact display density; the full rows of
 * cards on screen are counted (two at 1920×1080; one at 1536×703, an open ROADMAP S16c box); when
 * the grid cuts a row "N more students below" says how many and scrolls until the last card is in view. Axe on the student grid. The class is made for the test through the admin API and erased afterwards
 * (lesson ended, assignment ended, students deactivated and erased, class archived).
 */
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

const SIZES = [
  { width: 1536, height: 703, scale: 1.25, name: '1536x703@1.25' },
  { width: 1920, height: 1080, scale: 1, name: '1920x1080' },
] as const;

/** Display densities a teacher picks on the board (per device); the grid itself is compact above 24 students (CRD-3). */
const DENSITIES = ['Normal', 'Compact'] as const;
/**
 * Full rows of cards the board shows before "N more students below". Known gap (ROADMAP S16c, open
 * box): at 1536×703 with the default layout only one full row of a class of 40 fits (the routine,
 * timer and counter boxes take the rest), not the two that D-148 aims for on short displays.
 */
const MIN_ROWS: Record<(typeof SIZES)[number]['name'], number> = { '1536x703@1.25': 1, '1920x1080': 2 };

const GIVEN = ['Ada', 'Bora', 'Ceren', 'Deniz', 'Ece', 'Furkan', 'Gökçe Nur', 'Harun', 'Irmak', 'İlkay', 'Kerem', 'Lale', 'Mert', 'Nehir', 'Oğuz', 'Öykü', 'Rüzgar', 'Selin', 'Şahin', 'Tuana'];
const FAMILY = ['Kurgu', 'Örnekçi', 'Deneme', 'Karaağaçlıoğlu', 'Yıldırımkaya', 'Uydurma', 'Masalcı', 'Hayaloğlu'];
/** 40 distinct fictional names: two rounds over the given names with different family names. */
const NAMES = Array.from({ length: 40 }, (_, i) => `${GIVEN[i % GIVEN.length]} ${FAMILY[(i + Math.floor(i / GIVEN.length) * 3) % FAMILY.length]}`);

const TAG_LETTERS = 'abcdefghjklmnoprstuvyz';
const letters = () => Array.from({ length: 4 }, () => TAG_LETTERS[Math.floor(Math.random() * TAG_LETTERS.length)]).join('');

async function endLessonsOf(page: Page, contextId: string) {
  const active = await api(page, 'GET', '/api/classroom/lessons/active');
  for (const l of (active.body?.lessons ?? []) as Array<{ contextId: string; lessonId: string }>) {
    if (l.contextId !== contextId) continue;
    await api(page, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.end', contextId: l.contextId, lessonId: l.lessonId, payload: { contextId: l.contextId, lessonId: l.lessonId, steps: {} } }],
    });
  }
}

/** Cards fully inside the student box and the screen. */
async function cardsOnScreen(page: Page) {
  return page.evaluate(() => {
    const box = document.querySelector('[data-box="core.students"] > .cc-lesson-box__body')!.getBoundingClientRect();
    return [...document.querySelectorAll('.cc-student-card')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= Math.max(0, box.top) - 0.5 && r.bottom <= Math.min(window.innerHeight, box.bottom) + 0.5 && r.left >= 0 && r.right <= window.innerWidth + 0.5;
    }).length;
  });
}

/** Names that are not readable: too little room, outside their card, or cut off (clipped, ellipsed, line-clamped). */
async function unreadableNames(page: Page) {
  return page.locator('.cc-student-card').evaluateAll((cards) =>
    cards.flatMap((card) => {
      const el = card.querySelector<HTMLElement>('.cc-student-card__name-text');
      if (!el) return ['a card without a name'];
      const text = el.textContent ?? '';
      const c = card.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const out: string[] = [];
      if (!text.trim()) out.push('an empty name');
      if (r.width < 48 || r.height < 12) out.push(`${text}: ${Math.round(r.width)}×${Math.round(r.height)} px`);
      if (r.left < c.left - 1 || r.right > c.right + 1 || r.bottom > c.bottom + 1) out.push(`${text}: outside its card`);
      for (const e of [el, el.closest<HTMLElement>('.cc-student-card__name-btn'), el.closest<HTMLElement>('.cc-student-card__name')]) {
        if (!e) continue;
        const st = getComputedStyle(e);
        const clips = st.overflowX !== 'visible' || st.overflowY !== 'visible';
        if (clips && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)) out.push(`${text}: cut off (${e.className})`);
        if (clips && st.textOverflow === 'ellipsis') out.push(`${text}: ellipsed (${e.className})`);
        const clamp = st.getPropertyValue('-webkit-line-clamp');
        if (clamp && clamp !== 'none') out.push(`${text}: line-clamped (${e.className})`);
      }
      return out;
    }),
  );
}

/**
 * Words of a name broken over two lines although the word would fit on one line beside the avatar
 * across the card (the S14i layout: the name has the card's whole width beside the avatar, the +
 * button sits under it), so a narrower name column, e.g. one squeezed beside the + button, fails.
 * `overflow-wrap: anywhere` may break only a word wider than that. The word's own width is the sum of
 * its pieces on each line.
 */
async function splitWords(page: Page) {
  return page.locator('.cc-student-card__name-text').evaluateAll((els) =>
    els.flatMap((el) => {
      const text = el.textContent ?? '';
      const node = el.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) return [];
      const card = el.closest<HTMLElement>('.cc-student-card')!;
      const cs = getComputedStyle(card);
      const avatar = card.querySelector('.cc-avatar')?.getBoundingClientRect().width ?? 0;
      const column = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - avatar - (parseFloat(cs.columnGap) || 0);
      return [...text.matchAll(/\S+/gu)].flatMap((m) => {
        const range = document.createRange();
        range.setStart(node, m.index!);
        range.setEnd(node, m.index! + m[0].length);
        const pieces = [...range.getClientRects()].filter((x) => x.width > 0);
        const tops = new Set(pieces.map((x) => Math.round(x.top)));
        const width = pieces.reduce((sum, x) => sum + x.width, 0);
        return tops.size > 1 && width <= column + 1 ? [`${text}: "${m[0]}" (${Math.round(width)} px in a ${Math.round(column)} px column)`] : [];
      });
    }),
  );
}

/** Rows of cards fully inside the student box and the screen (cards of one row share their top). */
async function fullRowsOnScreen(page: Page) {
  return page.evaluate(() => {
    const box = document.querySelector('[data-box="core.students"] > .cc-lesson-box__body')!.getBoundingClientRect();
    const bottom = Math.min(window.innerHeight, box.bottom) + 0.5;
    const rows = new Map<number, boolean>();
    for (const e of document.querySelectorAll('.cc-student-card')) {
      const r = e.getBoundingClientRect();
      const top = Math.round(r.top);
      rows.set(top, (rows.get(top) ?? true) && r.top >= Math.max(0, box.top) - 0.5 && r.bottom <= bottom);
    }
    return [...rows.values()].filter(Boolean).length;
  });
}

/** The scroll position of the student box (the element "N more students below" scrolls). */
const studentsScrollTop = (page: Page) => page.evaluate(() => document.querySelector('[data-box="core.students"] > .cc-lesson-box__body')!.scrollTop);

async function onDisplay(browser: Browser, size: (typeof SIZES)[number], className: string) {
  // Reduced motion: "N more students below" scrolls at once, so no wait for a smooth scroll is needed.
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, hasTouch: true, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await login(p, 'english');
  await p.goto('/classroom');
  await p.getByRole('button', { name: new RegExp(`${className} · English`, 'u') }).first().click();
  await expect(p.getByTestId('lesson-dashboard')).toBeVisible();
  return { ctx, p };
}

test('a class of 40 on the classroom board at 1536×703 (scale 1.25) and 1920×1080', async ({ page, browser }) => {
  test.setTimeout(300_000);
  await login(page, 'admin');
  const years = (await api(page, 'GET', '/api/admin/years')).body.years as Array<{ id: string; archived: boolean; startsOn: string }>;
  const year = years.filter((y) => !y.archived).sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0]!;
  const teacher = ((await api(page, 'GET', '/api/admin/users')).body.users as Array<{ id: string; login: string }>).find((u) => u.login === 'english')!;
  const english = ((await api(page, 'GET', '/api/admin/subjects')).body.subjects as Array<{ id: string; name: { en: string }; archived: boolean }>).find((s) => s.name.en === 'English' && !s.archived)!;
  const className = `9-${letters().toUpperCase()}`;
  const created = await api(page, 'POST', '/api/admin/classes', { schoolYearId: year.id, name: className, grade: null });
  expect(created.status).toBe(200);
  const classId = created.body.id as string;
  const studentIds: string[] = [];
  const cleanupFailures: string[] = [];
  let contextId: string | null = null;
  const teacherCtx = await browser.newContext();
  const teacherPage = await teacherCtx.newPage();
  try {
    for (const fullName of NAMES) {
      const r = await api(page, 'POST', '/api/admin/students', { classId, fullName, allowDuplicateName: true });
      expect(r.status, fullName).toBe(200);
      studentIds.push(r.body.id as string);
    }
    const assigned = await api(page, 'POST', '/api/admin/teaching-contexts', { teacherId: teacher.id, classId, subjectId: english.id });
    expect(assigned.status).toBe(200);
    contextId = assigned.body.id as string;

    // The teacher starts the lesson (everyone present) from a session that never enters classroom mode.
    await login(teacherPage, 'english');
    await ensurePin(teacherPage);
    const started = await api(teacherPage, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'lesson.start', contextId, payload: { contextId, othersPresent: true, attendance: [] } }],
    });
    expect(started.body.results[0].ok).toBe(true);

    for (const size of SIZES) {
      const { ctx, p } = await onDisplay(browser, size, className);
      try {
        await expect(p.locator('.cc-student-card')).toHaveCount(40);
        for (const density of DENSITIES) {
          const label = `${size.name} ${density}`;
          if (density !== 'Normal') {
            if (!(await p.getByTestId('density-control').isVisible())) await p.getByTestId('classroom-settings').click();
            await p.getByTestId('density-control').getByRole('button', { name: density, exact: true }).click();
            await p.keyboard.press('Escape');
          }
          await expect(p.getByTestId('classroom-shell')).toHaveAttribute('data-density', density.toLowerCase());
          await expect(p.locator('.cc-student-grid')).toHaveAttribute('data-density', 'compact');
          await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
          await p.screenshot({ path: test.info().outputPath(`board-40-${size.name}-${density}.png`) });

          const facts = await p.evaluate(() => {
            const se = document.scrollingElement!;
            const cards = [...document.querySelectorAll('.cc-student-card')].map((c) => c.getBoundingClientRect());
            return { hScroll: se.scrollWidth > se.clientWidth + 1, pastRight: cards.filter((r) => r.right > window.innerWidth + 1 || r.left < -1).length };
          });
          expect(facts.hScroll, `${label}: sideways page scroll`).toBe(false);
          expect(facts.pastRight, `${label}: cards past the screen edge`).toBe(0);
          expect(await unreadableNames(p), `${label}: unreadable names`).toEqual([]);
          // S14i: compact board cards put the name across the card, so a name breaks only between
          // words (inside a word only when that word alone is wider than the column).
          expect(await splitWords(p), `${label}: words split over two lines`).toEqual([]);

          // Full rows on screen (D-148 short displays aim for two); a cut row: the cue says how many
          // are below and scrolls until the last card is in view.
          const visible = await cardsOnScreen(p);
          const rows = await fullRowsOnScreen(p);
          test.info().annotations.push({ type: 'cards on screen', description: `${label}: ${visible} of 40 in ${rows} full rows` });
          expect(rows, `${label}: full rows of cards on screen`).toBeGreaterThanOrEqual(MIN_ROWS[size.name]);
          const more = p.getByTestId('students-more');
          if (visible < 40) {
            await expect(more, label).toBeVisible();
            await expect(more).toContainText(new RegExp(`^${40 - visible} more students? below$`, 'u'));
            for (let i = 0; i < 12 && (await more.count()); i += 1) {
              const before = await studentsScrollTop(p);
              await more.click();
              await expect.poll(() => studentsScrollTop(p), `${label}: the box scrolled`).toBeGreaterThan(before);
              // The cue recounts on the scroll event: let two frames pass before asking for it again.
              await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
            }
            await expect(more).toHaveCount(0);
            const lastShown = await p.evaluate(() => {
              const box = document.querySelector('[data-box="core.students"] > .cc-lesson-box__body')!.getBoundingClientRect();
              const cards = document.querySelectorAll('.cc-student-card');
              return cards[cards.length - 1]!.getBoundingClientRect().bottom <= Math.min(box.bottom, window.innerHeight) + 1;
            });
            expect(lastShown, `${label}: the last card in view`).toBe(true);
            await p.evaluate(() => document.querySelector('[data-box="core.students"] > .cc-lesson-box__body')!.scrollTo({ top: 0 }));
            await expect(more).toBeVisible();
          } else await expect(more, label).toHaveCount(0);

          if (size.name === '1536x703@1.25') {
            const r = await new AxeBuilder({ page: p }).include('[data-box="core.students"]').analyze();
            expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
          }
        }
      } finally {
        await ctx.close();
      }
    }
  } finally {
    if (contextId) await endLessonsOf(teacherPage, contextId).catch(() => undefined);
    await teacherCtx.close();
    if (contextId) await api(page, 'POST', `/api/admin/teaching-contexts/${contextId}/end`, {});
    for (const [i, id] of studentIds.entries()) {
      await api(page, 'POST', `/api/admin/students/${id}/deactivate`, {});
      const erased = await api(page, 'POST', `/api/admin/students/${id}/erase`, { confirm: NAMES[i] });
      if (erased.status !== 200) cleanupFailures.push(`erase ${NAMES[i]}: ${erased.status}`);
    }
    const archived = await api(page, 'POST', `/api/admin/classes/${classId}/archive`, {});
    if (archived.status !== 200) cleanupFailures.push(`archive ${className}: ${archived.status}`);
  }
  expect(cleanupFailures, 'the test class and its students are gone again').toEqual([]);
});
