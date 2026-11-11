/**
 * S20a missing automated checks (D-037, UX-1, UX-6, DSH-1): a class of 40 (fictional names, some of
 * them long) on the classroom board at the measured classroom display, 1536×703 at device scale 1.25
 * with touch (ROADMAP "Classroom display" sample), and at 1920×1080. At both sizes: all 40 cards are
 * there, the page never scrolls sideways and no card reaches past the screen, every name is readable
 * (its text box has room and stays inside its card; long words split over two lines are recorded as a
 * known gap, short ones never split), and when the
 * grid cuts a row "N more students below" says how many and scrolls until the last card is in view.
 * Axe on the student grid. The class is made for the test through the admin API and erased afterwards
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

/** Names that are not readable: too little room or outside their card. */
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
      return out;
    }),
  );
}

/** Words of a name broken over two lines (the card's `overflow-wrap: anywhere` fallback when a word is wider than its column). */
async function splitWords(page: Page) {
  return page.locator('.cc-student-card__name-text').evaluateAll((els) =>
    els.flatMap((el) => {
      const text = el.textContent ?? '';
      const node = el.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) return [];
      return [...text.matchAll(/\S+/gu)].flatMap((m) => {
        const range = document.createRange();
        range.setStart(node, m.index!);
        range.setEnd(node, m.index! + m[0].length);
        const tops = new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
        return tops.size > 1 ? [`${text}: "${m[0]}"`] : [];
      });
    }),
  );
}

async function onDisplay(browser: Browser, size: (typeof SIZES)[number], className: string) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, hasTouch: true });
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
        await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
        await p.screenshot({ path: test.info().outputPath(`board-40-${size.name}.png`) });

        const facts = await p.evaluate(() => {
          const se = document.scrollingElement!;
          const cards = [...document.querySelectorAll('.cc-student-card')].map((c) => c.getBoundingClientRect());
          return { hScroll: se.scrollWidth > se.clientWidth + 1, pastRight: cards.filter((r) => r.right > window.innerWidth + 1 || r.left < -1).length, density: document.querySelector('.cc-student-grid')?.getAttribute('data-density') ?? '' };
        });
        expect(facts.hScroll, `${size.name}: sideways page scroll`).toBe(false);
        expect(facts.pastRight, `${size.name}: cards past the screen edge`).toBe(0);
        expect(await unreadableNames(p), `${size.name}: unreadable names`).toEqual([]);
        const split = await splitWords(p);
        test.info().annotations.push({ type: 'words split over two lines', description: `${size.name}: ${split.length} of 40 names${split.length ? ` (${split.slice(0, 6).join('; ')}…)` : ''}` });
        // Known gap (ROADMAP S13 "Tests", open box): at both sizes the name column beside the + button
        // is narrower than a long family name (7+ letters, e.g. "Uydurma", "Karaağaçlıoğlu"), so the
        // word breaks mid-word. Recorded, not failed; a short word (up to 6 letters) never breaks.
        expect(split.filter((w) => [...(/"(.*)"$/u.exec(w)?.[1] ?? '')].length <= 6), `${size.name}: short words split`).toEqual([]);

        // A cut row: the cue says how many are below and scrolls until the last card is in view.
        const visible = await cardsOnScreen(p);
        test.info().annotations.push({ type: 'cards on screen', description: `${size.name} (${facts.density || 'normal'}): ${visible} of 40` });
        const more = p.getByTestId('students-more');
        if (visible < 40) {
          await expect(more, size.name).toBeVisible();
          await expect(more).toContainText(new RegExp(`^${40 - visible} more students? below$`, 'u'));
          for (let i = 0; i < 12 && (await more.count()); i += 1) {
            await more.click();
            await p.waitForTimeout(400);
          }
          await expect(more).toHaveCount(0);
          const lastShown = await p.evaluate(() => {
            const box = document.querySelector('[data-box="core.students"] > .cc-lesson-box__body')!.getBoundingClientRect();
            const cards = document.querySelectorAll('.cc-student-card');
            return cards[cards.length - 1]!.getBoundingClientRect().bottom <= Math.min(box.bottom, window.innerHeight) + 1;
          });
          expect(lastShown, `${size.name}: the last card in view`).toBe(true);
        } else await expect(more, size.name).toHaveCount(0);

        if (size.name === '1536x703@1.25') {
          const r = await new AxeBuilder({ page: p }).include('[data-box="core.students"]').analyze();
          expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
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
