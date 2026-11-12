/**
 * Student cards on the classroom board for small and large classes (S20a; S22c, D-177; S27c, D-195;
 * D-037, UX-1, UX-6, DSH-1, CRD-1..3).
 *
 * Classes of 8, 16, 24, 32 and 40 (fictional names, some of them long) are made for the test through
 * the admin API and erased afterwards (lessons ended, assignments ended, students deactivated and
 * erased, classes archived). Each is shown on the board with the default layout (the routine, the timer
 * and the class counter above the students, the dock under them, as in a normal lesson) at the real
 * classroom display in its window, 1536×703 at device scale 1.25 with touch (ROADMAP S16c "Classroom
 * display"), the same display in full screen (1536×864 at 1.25), Sare's MacBook (1440×787 at 2) and
 * 1280×720. S27c (D-195): there is one automatic card size (the Compact / Normal / Large choice was
 * removed by the owner), so every board is checked once. Everywhere:
 * - the page never scrolls sideways and no card reaches past the screen;
 * - every name is readable (its text box has room, stays inside its card, is not cut off, clipped or
 *   ellipsed) and a word of a name breaks over two lines only when it is wider than the card beside
 *   the avatar (S14i);
 * - the + button is at least a touch target (`--cc-touch`);
 * - the cards fit the Students box (D-177): every card of a class is on screen without scrolling where
 *   the box can hold them (`ALL_FIT`), the box does not scroll then and no "more students" cue shows;
 *   a class of 8 grows above the middle size into the free height; a larger class shows at least
 *   `FLOOR` whole cards in at least two full rows, and "N more students below" says how many and
 *   scrolls until the last card is in view. What the box can hold is limited by the + button: a card is
 *   never lower than a touch target, so the Students box of 1536×703 (about 238 px under the routine,
 *   the timer and the counter) has room for two rows of cards (D-195).
 * Then this lesson's achievements and the group numbers (card marks from the achievements and grouping
 * add-ons) are given in the 24 and 40 classes: they show with their accessible names, never overlap the
 * name, the + button or the chips, and disappear when the module is switched off. On a phone (375×812,
 * where the page scrolls and the fit does not size the cards) the classes of 8, 24 and 40 (with marks)
 * keep names whole and the + button a touch target (S22c review); S23b (D-183): with the small mark
 * pills a phone card stays under 120 px. S25a (D-185): in the narrowest layout (`tight`, checked at
 * 1536×703@1.25 with 40 students) every mark sits on the count's line (icon and number only), also on
 * the cards of Late students (whose Late chip goes after the marks; such a card is no taller than the
 * others). Axe on the student grid. Screenshots for review in `test-results/s27c/` (CC_SHOTS_DIR to
 * change it).
 */
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

const SHOTS = process.env.CC_SHOTS_DIR ?? 'test-results/s27c';

const SIZES = [
  { width: 1536, height: 703, scale: 1.25, name: '1536x703@1.25' },
  { width: 1536, height: 864, scale: 1.25, name: '1536x864@1.25' },
  { width: 1440, height: 787, scale: 2, name: '1440x787@2' },
  { width: 1280, height: 720, scale: 1, name: '1280x720' },
] as const;
type Size = (typeof SIZES)[number];

const CLASS_SIZES = [8, 16, 24, 32, 40] as const;

type Round = 'plain' | 'marks';
/**
 * The largest class (of the ones tested) whose every card shows without scrolling, per display, without
 * and with the card marks (measured for S27c, D-195, with the default layout and these fictional names).
 */
const ALL_FIT: Record<Size['name'], Record<Round, number>> = {
  '1536x703@1.25': { plain: 16, marks: 16 },
  '1536x864@1.25': { plain: 24, marks: 16 },
  '1440x787@2': { plain: 16, marks: 16 },
  '1280x720': { plain: 16, marks: 16 },
};
/** Whole cards a larger class shows at least (two full rows or more), without and with the card marks. */
const FLOOR: Record<Size['name'], Record<Round, number>> = {
  '1536x703@1.25': { plain: 18, marks: 16 },
  '1536x864@1.25': { plain: 24, marks: 21 },
  '1440x787@2': { plain: 18, marks: 16 },
  '1280x720': { plain: 14, marks: 14 },
};

const GIVEN = ['Ada', 'Bora', 'Ceren', 'Deniz', 'Ece', 'Furkan', 'Gökçe Nur', 'Harun', 'Irmak', 'İlkay', 'Kerem', 'Lale', 'Mert', 'Nehir', 'Oğuz', 'Öykü', 'Rüzgar', 'Selin', 'Şahin', 'Tuana'];
const FAMILY = ['Kurgu', 'Örnekçi', 'Deneme', 'Karaağaçlıoğlu', 'Yıldırımkaya', 'Uydurma', 'Masalcı', 'Hayaloğlu'];
/** n distinct fictional names: rounds over the given names with different family names. */
const namesOf = (n: number) => Array.from({ length: n }, (_, i) => `${GIVEN[i % GIVEN.length]} ${FAMILY[(i + Math.floor(i / GIVEN.length) * 3) % FAMILY.length]}`);

const TAG_LETTERS = 'abcdefghjklmnoprstuvyz';
const letters = () => Array.from({ length: 4 }, () => TAG_LETTERS[Math.floor(Math.random() * TAG_LETTERS.length)]).join('');

interface TestClass {
  size: number;
  name: string;
  classId: string;
  contextId: string | null;
  lessonId: string | null;
  students: Array<{ id: string; fullName: string }>;
}

const BOX = '[data-box="core.students"] > .cc-lesson-box__body';

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
  return page.evaluate((sel) => {
    const box = document.querySelector(sel)!.getBoundingClientRect();
    return [...document.querySelectorAll('.cc-student-card')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= Math.max(0, box.top) - 0.5 && r.bottom <= Math.min(window.innerHeight, box.bottom) + 0.5 && r.left >= 0 && r.right <= window.innerWidth + 0.5;
    }).length;
  }, BOX);
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
 * across the card (the S14i rule), so a narrower name column, e.g. one squeezed beside the + button,
 * fails. `overflow-wrap: anywhere` may break only a word wider than that. The word's own width is the
 * sum of its pieces on each line.
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

/** + buttons smaller than a touch target (`--cc-touch`). */
async function smallAddButtons(page: Page) {
  return page.locator('.cc-student-card__add').evaluateAll((els) => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--cc-touch)';
    document.querySelector('.cc-classroom')!.append(probe);
    const touch = probe.getBoundingClientRect().width;
    probe.remove();
    return els.map((e) => e.getBoundingClientRect()).filter((r) => r.width < touch - 0.5 || r.height < touch - 0.5).map((r) => `${Math.round(r.width)}×${Math.round(r.height)} < ${Math.round(touch)}`);
  });
}

/** Parts of a card that overlap: the name, the + button, the count, the level chip, attendance chips and the marks. */
async function overlaps(page: Page) {
  return page.locator('.cc-student-card').evaluateAll((cards) =>
    cards.flatMap((card) => {
      const parts = [
        ...[...card.querySelectorAll('.cc-student-card__name-text')].map((e) => ['name', e] as const),
        ...[...card.querySelectorAll('.cc-student-card__add')].map((e) => ['+', e] as const),
        ...[...card.querySelectorAll('.cc-student-card__count')].map((e) => ['count', e] as const),
        ...[...card.querySelectorAll('.cc-level, .cc-att-chip, .cc-chip')].map((e) => ['chip', e] as const),
        ...[...card.querySelectorAll('.cc-student-card__mark')].map((e) => [`mark ${(e as HTMLElement).dataset.mark}`, e] as const),
        ...[...card.querySelectorAll('.cc-avatar')].map((e) => ['avatar', e] as const),
      ].map(([what, e]) => [what, e.getBoundingClientRect()] as const);
      const c = card.getBoundingClientRect();
      const out: string[] = [];
      const name = card.getAttribute('aria-label');
      for (const [what, r] of parts) if (r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1) out.push(`${name}: ${what} outside the card`);
      for (let i = 0; i < parts.length; i += 1)
        for (let j = i + 1; j < parts.length; j += 1) {
          const [a, ra] = parts[i]!;
          const [b, rb] = parts[j]!;
          const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (x > 1 && y > 1) out.push(`${name}: ${a} overlaps ${b}`);
        }
      return out;
    }),
  );
}

/**
 * S25a (D-185): marks that are not on the count's line (their middle outside the count's box) on the
 * cards that show a count.
 */
async function marksOffCountLine(page: Page) {
  return page.locator('.cc-student-card').evaluateAll((cards) =>
    cards.flatMap((card) => {
      const count = card.querySelector('.cc-student-card__count')?.getBoundingClientRect();
      if (!count) return [];
      return [...card.querySelectorAll<HTMLElement>('.cc-student-card__mark')]
        .filter((m) => {
          const r = m.getBoundingClientRect();
          const mid = (r.top + r.bottom) / 2;
          return mid < count.top || mid > count.bottom;
        })
        .map((m) => `${card.getAttribute('aria-label')}: mark ${m.dataset.mark} on its own line`);
    }),
  );
}

/** Rows of cards fully inside the student box and the screen (cards of one row share their top). */
async function fullRowsOnScreen(page: Page) {
  return page.evaluate((sel) => {
    const box = document.querySelector(sel)!.getBoundingClientRect();
    const bottom = Math.min(window.innerHeight, box.bottom) + 0.5;
    const rows = new Map<number, boolean>();
    for (const e of document.querySelectorAll('.cc-student-card')) {
      const r = e.getBoundingClientRect();
      const top = Math.round(r.top);
      rows.set(top, (rows.get(top) ?? true) && r.top >= Math.max(0, box.top) - 0.5 && r.bottom <= bottom);
    }
    return [...rows.values()].filter(Boolean).length;
  }, BOX);
}

/** The tallest card on the board. */
const cardHeight = (p: Page) => p.locator('.cc-student-card').evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().height)));

const PHONE = { width: 375, height: 812, scale: 2, name: '375x812@2' } as const;

/**
 * The board on a phone: the page scrolls, the fit leaves the cards alone, and the name still takes the
 * whole first line beside the avatar (no word broken inside), the + button is a touch target and
 * nothing overlaps or reaches past the screen (S22c review).
 */
async function checkPhone(browser: Browser, cls: TestClass, label: string) {
  const ctx = await browser.newContext({ viewport: { width: PHONE.width, height: PHONE.height }, deviceScaleFactor: PHONE.scale, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  try {
    await login(p, 'english');
    await p.goto('/classroom');
    await p.getByRole('button', { name: new RegExp(`${cls.name} · English`, 'u') }).first().click();
    await expect(p.locator('.cc-student-card')).toHaveCount(cls.size);
    await expect(p.locator('.cc-student-grid')).not.toHaveAttribute('data-fit', /.*/u);
    await settle(p);
    await p.screenshot({ path: `${SHOTS}/${label.replace(/\s+/gu, '-')}.png`, fullPage: true });
    const se = await p.evaluate(() => document.scrollingElement!.scrollWidth > document.scrollingElement!.clientWidth + 1);
    expect(se, `${label}: sideways page scroll`).toBe(false);
    expect(await unreadableNames(p), `${label}: unreadable names`).toEqual([]);
    expect(await splitWords(p), `${label}: words split over two lines`).toEqual([]);
    expect(await smallAddButtons(p), `${label}: + buttons under a touch target`).toEqual([]);
    expect(await overlaps(p), `${label}: overlapping card parts`).toEqual([]);
    const height = await cardHeight(p);
    test.info().annotations.push({ type: 'phone card height', description: `${label}: ${Math.round(height)} px` });
    // S23b (D-183): the count, the chip and the small mark pills share two lines beside the + button
    // (before, one line each: a card with marks was about 164 px tall).
    expect(height, `${label}: phone card height`).toBeLessThan(120);
  } finally {
    await ctx.close();
  }
}

/** The scroll position of the student box (the element "N more students below" scrolls). */
const studentsScrollTop = (page: Page) => page.evaluate((sel) => document.querySelector(sel)!.scrollTop, BOX);
const fitStep = (page: Page) => page.locator('.cc-student-grid').getAttribute('data-fit');
/** The step's place on the ladder: tight < s0 < … < s2 (where the fit starts) < … < s3 (the largest). */
const stepValue = (step: string | null) => (step === 'tight' ? -1 : step ? Number(step.slice(1)) : Number.NaN);

async function settle(p: Page) {
  await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function openDisplay(browser: Browser, size: Size) {
  // Reduced motion: "N more students below" scrolls at once, so no wait for a smooth scroll is needed.
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, hasTouch: true, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await login(p, 'english');
  await p.goto('/classroom');
  return { ctx, p };
}

async function showClass(p: Page, cls: TestClass) {
  await p.getByRole('button', { name: new RegExp(`${cls.name} · English`, 'u') }).first().click();
  await expect(p.getByTestId('lesson-dashboard')).toBeVisible();
  await expect(p.locator('.cc-student-card')).toHaveCount(cls.size);
  await expect(p.locator('.cc-student-grid')).toHaveAttribute('data-fit', /.+/u);
  await settle(p);
}

/** The checks every board passes; returns what it saw. */
async function checkBoard(p: Page, cls: TestClass, label: string) {
  await p.screenshot({ path: `${SHOTS}/${label.replace(/\s+/gu, '-')}.png` });
  const facts = await p.evaluate(() => {
    const se = document.scrollingElement!;
    const cards = [...document.querySelectorAll('.cc-student-card')].map((c) => c.getBoundingClientRect());
    return { hScroll: se.scrollWidth > se.clientWidth + 1, pastRight: cards.filter((r) => r.right > window.innerWidth + 1 || r.left < -1).length };
  });
  expect(facts.hScroll, `${label}: sideways page scroll`).toBe(false);
  expect(facts.pastRight, `${label}: cards past the screen edge`).toBe(0);
  expect(await unreadableNames(p), `${label}: unreadable names`).toEqual([]);
  expect(await splitWords(p), `${label}: words split over two lines`).toEqual([]);
  expect(await smallAddButtons(p), `${label}: + buttons under a touch target`).toEqual([]);
  expect(await overlaps(p), `${label}: overlapping card parts`).toEqual([]);

  const visible = await cardsOnScreen(p);
  const rows = await fullRowsOnScreen(p);
  const step = await fitStep(p);
  test.info().annotations.push({ type: 'cards on screen', description: `${label}: ${visible} of ${cls.size} in ${rows} full rows, step ${step}` });
  const more = p.getByTestId('students-more');
  if (visible < cls.size) {
    await expect(more, label).toBeVisible();
    await expect(more).toContainText(new RegExp(`^${cls.size - visible} more students? below$`, 'u'));
  } else {
    await expect(more, label).toHaveCount(0);
    // Every card fits: the box has nothing to scroll.
    expect(await p.evaluate((sel) => document.querySelector(sel)!.scrollHeight <= document.querySelector(sel)!.clientHeight + 1, BOX), `${label}: the box scrolls although every card fits`).toBe(true);
  }
  return { visible, rows, step };
}

/** "N more students below" scrolls until the last card is in view, then the box goes back up. */
async function checkMoreCue(p: Page, label: string) {
  const more = p.getByTestId('students-more');
  for (let i = 0; i < 12 && (await more.count()); i += 1) {
    const before = await studentsScrollTop(p);
    await more.click();
    await expect.poll(() => studentsScrollTop(p), `${label}: the box scrolled`).toBeGreaterThan(before);
    // The cue recounts on the scroll event: let two frames pass before asking for it again.
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  await expect(more).toHaveCount(0);
  const lastShown = await p.evaluate((sel) => {
    const box = document.querySelector(sel)!.getBoundingClientRect();
    const cards = document.querySelectorAll('.cc-student-card');
    return cards[cards.length - 1]!.getBoundingClientRect().bottom <= Math.min(box.bottom, window.innerHeight) + 1;
  }, BOX);
  expect(lastShown, `${label}: the last card in view`).toBe(true);
  await p.evaluate((sel) => document.querySelector(sel)!.scrollTo({ top: 0 }), BOX);
  await expect(more).toBeVisible();
}

/** Gives this lesson's achievements (two to the first three students, one to the next three) and applies groups. */
async function giveMarks(teacher: Page, cls: TestClass) {
  const contextId = cls.contextId!;
  const lessonId = cls.lessonId!;
  const view = (await api(teacher, 'GET', `/api/classroom/contexts/${contextId}/achievements?lessonId=${lessonId}`)).body as { badges: Array<{ id: string }> };
  expect(view.badges.length, 'manual achievements to give').toBeGreaterThanOrEqual(2);
  for (const [badge, studentIds] of [
    [view.badges[0]!.id, cls.students.slice(0, 6).map((s) => s.id)],
    [view.badges[1]!.id, cls.students.slice(0, 3).map((s) => s.id)],
  ] as const) {
    const r = await api(teacher, 'POST', '/api/commands', {
      commands: [{ opId: randomUUID(), type: 'achievements.award', contextId, lessonId, payload: { contextId, lessonId, achievementId: badge, studentIds } }],
    });
    expect(r.body.results[0].ok, JSON.stringify(r.body.results[0])).toBe(true);
  }
  let arrangements = (await api(teacher, 'GET', `/api/classroom/contexts/${contextId}/grouping/arrangements`)).body.arrangements as Array<{ id: string }>;
  if (!arrangements.length) {
    await api(teacher, 'POST', `/api/teacher/contexts/${contextId}/grouping/use-defaults`, {});
    arrangements = (await api(teacher, 'GET', `/api/classroom/contexts/${contextId}/grouping/arrangements`)).body.arrangements as Array<{ id: string }>;
  }
  expect(arrangements.length, 'a group arrangement').toBeGreaterThan(0);
  const applied = await api(teacher, 'POST', '/api/commands', {
    commands: [{ opId: randomUUID(), type: 'grouping.apply', contextId, lessonId, payload: { contextId, lessonId, templateId: arrangements[0]!.id } }],
  });
  expect(applied.body.results[0].ok, JSON.stringify(applied.body.results[0])).toBe(true);
}

/** The marks given by `giveMarks` on the board, with every board check. */
async function checkMarks(p: Page, cls: TestClass, label: string) {
  const card = (i: number) => p.locator('.cc-student-card').filter({ has: p.getByRole('button', { name: cls.students[i]!.fullName, exact: true }) });
  await expect(card(0).locator('[data-mark="achievements"]')).toHaveAttribute('aria-label', '2 achievements this lesson');
  await expect(card(0).locator('[data-mark="achievements"]')).toHaveText('2');
  await expect(card(3).locator('[data-mark="achievements"]')).toHaveAttribute('aria-label', '1 achievement this lesson');
  await expect(card(6).locator('[data-mark="achievements"]')).toHaveCount(0);
  await expect(p.locator('[data-mark="achievements"]')).toHaveCount(6);
  await expect(card(0).locator('[data-mark="group"]')).toHaveAttribute('aria-label', /^In group \d+$/u);
  await expect(p.locator('[data-mark="group"]')).toHaveCount(cls.size);
  await settle(p);
  const seen = await checkBoard(p, cls, label);
  if (seen.step === 'tight') expect(await marksOffCountLine(p), `${label}: marks on the count's line in tight`).toEqual([]);
  return seen;
}

/**
 * S25a review (D-185): a Late student still shows the count, and the Late chip comes before it in the
 * DOM. In `tight` the marks must still share the count's line (the chip goes after them) and such a
 * card is no taller than the others. Students 0, 3 and 6 (two achievements, one, none; all with a
 * group) are marked Late for this lesson and put back in `finally`.
 */
async function checkLate(p: Page, teacher: Page, cls: TestClass, label: string) {
  const late = [0, 3, 6].map((i) => cls.students[i]!);
  const contextId = cls.contextId!;
  const lessonId = cls.lessonId!;
  const setLate = async (status: 'late' | null) => {
    const r = await api(teacher, 'POST', '/api/commands', {
      commands: late.map((s) => ({ opId: randomUUID(), type: 'attendance.setLessonException', contextId, lessonId, payload: { contextId, lessonId, studentId: s.id, status } })),
    });
    for (const res of r.body.results as Array<{ ok: boolean }>) expect(res.ok, JSON.stringify(res)).toBe(true);
  };
  try {
    await setLate('late');
    await p.reload();
    await showClass(p, cls);
    const lateCards = p.locator('.cc-student-card').filter({ has: p.locator('.cc-att-chip[data-status="late"]') });
    await expect(lateCards).toHaveCount(late.length);
    await expect(lateCards.locator('.cc-student-card__count')).toHaveCount(late.length);
    const seen = await checkMarks(p, cls, label);
    expect(seen.step, `${label}: the narrowest layout`).toBe('tight');
    const heights = await p.locator('.cc-student-card').evaluateAll((cards) => {
      const h = (late: boolean) => Math.max(...cards.filter((c) => !!c.querySelector('.cc-att-chip[data-status="late"]') === late).map((c) => c.getBoundingClientRect().height));
      return { late: h(true), others: h(false) };
    });
    expect(heights.late, `${label}: a Late card is no taller than the others (${JSON.stringify(heights)})`).toBeLessThanOrEqual(heights.others + 1);
  } finally {
    await setLate(null);
    await p.reload();
    await showClass(p, cls);
  }
}

/**
 * One test per class size, so the teacher's class tabs above the board are the demo classes plus one,
 * as on a real teacher's board (four extra tabs would wrap and take height from the board).
 */
for (const classSize of CLASS_SIZES) {
  test(`a class of ${classSize} on the board at 1536×703 and 1536×864 (scale 1.25), 1440×787 (scale 2) and 1280×720`, async ({ page, browser }) => {
    test.setTimeout(classSize >= 24 ? 420_000 : 240_000);
    await login(page, 'admin');
    const years = (await api(page, 'GET', '/api/admin/years')).body.years as Array<{ id: string; archived: boolean; startsOn: string }>;
    const year = years.filter((y) => !y.archived).sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0]!;
    const english = ((await api(page, 'GET', '/api/admin/subjects')).body.subjects as Array<{ id: string; name: { en: string }; archived: boolean }>).find((s) => s.name.en === 'English' && !s.archived)!;
    const teacherUser = ((await api(page, 'GET', '/api/admin/users')).body.users as Array<{ id: string; login: string }>).find((u) => u.login === 'english')!;
    const name = `9-${letters().toUpperCase()}`;
    const created = await api(page, 'POST', '/api/admin/classes', { schoolYearId: year.id, name, grade: null });
    expect(created.status).toBe(200);
    const cls: TestClass = { size: classSize, name, classId: created.body.id as string, contextId: null, lessonId: null, students: [] };
    const cleanupFailures: string[] = [];
    const teacherCtx = await browser.newContext();
    const teacher = await teacherCtx.newPage();
    try {
      for (const fullName of namesOf(classSize)) {
        const r = await api(page, 'POST', '/api/admin/students', { classId: cls.classId, fullName, allowDuplicateName: true });
        expect(r.status, fullName).toBe(200);
        cls.students.push({ id: r.body.id as string, fullName });
      }
      const assigned = await api(page, 'POST', '/api/admin/teaching-contexts', { teacherId: teacherUser.id, classId: cls.classId, subjectId: english.id });
      expect(assigned.status).toBe(200);
      cls.contextId = assigned.body.id as string;
      // The teacher starts the lesson (everyone present) from a session that never enters classroom mode.
      await login(teacher, 'english');
      await ensurePin(teacher);
      const started = await api(teacher, 'POST', '/api/commands', {
        commands: [{ opId: randomUUID(), type: 'lesson.start', contextId: cls.contextId, payload: { contextId: cls.contextId, othersPresent: true, attendance: [] } }],
      });
      expect(started.body.results[0].ok).toBe(true);
      const active = (await api(teacher, 'GET', '/api/classroom/lessons/active')).body.lessons as Array<{ contextId: string; lessonId: string }>;
      cls.lessonId = active.find((l) => l.contextId === cls.contextId)!.lessonId;

      const withMarks = classSize === 24 || classSize === 40;
      for (const round of withMarks ? (['plain', 'marks'] as const) : (['plain'] as const)) {
        if (round === 'marks') await giveMarks(teacher, cls);
        for (const size of SIZES) {
          const { ctx, p } = await openDisplay(browser, size);
          try {
            await showClass(p, cls);
            // S27c (D-195): one automatic size, no Compact / Normal / Large on the shell.
            await expect(p.getByTestId('classroom-shell')).not.toHaveAttribute('data-density', /./u);
            const label = `${size.name} ${classSize}${round === 'marks' ? ' marks' : ''}`;
            const seen = round === 'marks' ? await checkMarks(p, cls, label) : await checkBoard(p, cls, label);
            if (classSize <= ALL_FIT[size.name][round]) {
              // Every student on screen without scrolling, at the largest size that fits.
              expect(seen.visible, `${label}: every card on screen`).toBe(classSize);
            } else {
              expect(seen.visible, `${label}: whole cards on screen`).toBeGreaterThanOrEqual(FLOOR[size.name][round]);
              expect(seen.rows, `${label}: full rows of cards on screen`).toBeGreaterThanOrEqual(2);
              if (round === 'plain' && classSize === 40) await checkMoreCue(p, label);
            }
            // A small class grows into the free height: above the middle size where the fit starts.
            if (classSize === 8) expect(stepValue(seen.step), `${label}: cards grown above the middle size (step ${seen.step})`).toBeGreaterThan(2);
            // S25a (D-185): the measured classroom display shows a class of 40 in `tight`, where the marks share the count's line.
            if (round === 'marks' && classSize === 40 && size === SIZES[0]) {
              expect(seen.step, `${label}: the narrowest layout`).toBe('tight');
              await checkLate(p, teacher, cls, `${label} late`);
            }
            if (size === SIZES[0] && (classSize === 8 || round === 'marks')) await checkPhone(browser, cls, `${PHONE.name} ${classSize}${round === 'marks' ? ' marks' : ''}`);
            if (size === SIZES[0] && round === 'plain') {
              const r = await new AxeBuilder({ page: p }).include('[data-box="core.students"]').analyze();
              expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
            }
          } finally {
            await ctx.close();
          }
        }
      }

      if (classSize === 24) {
        // Switched off, a module's marks are gone (and come back when it is on again).
        const { ctx, p } = await openDisplay(browser, SIZES[0]);
        try {
          for (const module of ['achievements', 'grouping'] as const) {
            const mark = module === 'achievements' ? 'achievements' : 'group';
            try {
              expect((await api(teacher, 'PUT', `/api/teacher/contexts/${cls.contextId}/modules/${module}`, { enabled: false })).status).toBe(200);
              await p.reload();
              await showClass(p, cls);
              await expect(p.locator(`[data-mark="${mark}"]`)).toHaveCount(0);
              await checkBoard(p, cls, `${SIZES[0].name} ${classSize} ${module} off`);
            } finally {
              expect((await api(teacher, 'PUT', `/api/teacher/contexts/${cls.contextId}/modules/${module}`, { enabled: true })).status).toBe(200);
            }
            await p.reload();
            await showClass(p, cls);
            await expect(p.locator(`[data-mark="${mark}"]`).first()).toBeVisible();
          }
        } finally {
          await ctx.close();
        }
      }
    } finally {
      if (cls.contextId) await endLessonsOf(teacher, cls.contextId).catch(() => undefined);
      await teacherCtx.close();
      if (cls.contextId) await api(page, 'POST', `/api/admin/teaching-contexts/${cls.contextId}/end`, {});
      for (const s of cls.students) {
        await api(page, 'POST', `/api/admin/students/${s.id}/deactivate`, {});
        const erased = await api(page, 'POST', `/api/admin/students/${s.id}/erase`, { confirm: s.fullName });
        if (erased.status !== 200) cleanupFailures.push(`erase ${s.fullName}: ${erased.status}`);
      }
      const archived = await api(page, 'POST', `/api/admin/classes/${cls.classId}/archive`, {});
      if (archived.status !== 200) cleanupFailures.push(`archive ${cls.name}: ${archived.status}`);
    }
    expect(cleanupFailures, 'the test class and its students are gone again').toEqual([]);
  });
}
