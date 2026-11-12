/**
 * Lesson goals (S25d, D-188; LES-1, LES-3, DSH-4, RPT-1, CFG-1): the teacher turns Lesson goals on for
 * 3-A English, starts a lesson with a goal, the board shows it to the class and it is changed during the
 * lesson, End Lesson asks "Did we reach our goal?", and the report lists the goal with the answer.
 * S28a (D-197): the routine's "Learning goal" stage shows the goal (the topics move up beside the stage
 * name while it is shown), and the "Lesson saved" summary shows the goal with the class's answer (axe on
 * both); a 140-character goal on that stage stays inside the routine box in whole words at 1536x703 and
 * 1536x864 (1.25), English and Turkish, with one topic and with three, and costs the student grid at
 * most one row of cards on that stage only (a whole row stays wherever the stage had one without it).
 * The module is switched off again in `finally` (the e2e suite shares one database). Fictional data only.
 */
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { api, ensurePin, login } from './helpers.ts';

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
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), selector).toEqual([]);
}

test('start a lesson with a goal, see it on the board, change it, answer it at the end, find it in the report', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  // Settings and the report go through a second session: the display's session is in classroom mode.
  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, 'english');
  const contexts = (await api(office, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; className: string; subjectName: { en: string }; modules: Record<string, boolean> }>;
  const ctx = contexts.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  // Off by default in every class+subject (CFG-1, D-188).
  expect(ctx.modules.lessonGoals).toBe(false);
  await endActiveLessons(page);
  const goal = `We can ask and answer about the weather ${randomUUID().slice(0, 4)}.`;
  const changed = `We can describe today's weather ${randomUUID().slice(0, 4)}.`;
  try {
    expect((await api(office, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/lessonGoals`, { enabled: true })).status).toBe(200);

    await page.goto('/classroom');
    await page.getByRole('button', { name: /3-A · English/ }).click();
    await expect(page.getByTestId('no-lesson')).toBeVisible();
    await page.getByRole('button', { name: 'Start lesson' }).click();
    const start = page.getByTestId('start-lesson');
    await expect(start).toBeVisible();
    // Step through to "Today's goal" (after the topic), type the goal, then on to Begin (LES-1).
    await expect(start.getByRole('listitem').filter({ hasText: "Today's goal" })).toHaveCount(1);
    const goalStep = start.getByTestId('lesson-goal-step');
    for (let i = 0; i < 6 && !(await goalStep.isVisible()); i++) await start.getByRole('button', { name: 'Next', exact: true }).click();
    await goalStep.getByLabel('Our goal today (optional)').fill(goal);
    for (let i = 0; i < 6 && (await start.getByRole('button', { name: 'Begin lesson' }).count()) === 0; i++) await start.getByRole('button', { name: 'Next', exact: true }).click();
    await start.getByRole('button', { name: 'Begin lesson' }).click();

    // The board shows the goal to the class (DSH-4).
    const box = page.getByTestId('lesson-goal');
    await expect(box).toContainText("Today's goal");
    await expect(box).toContainText(goal);
    await expect(page.locator('[data-box="lessonGoal"]')).toHaveCount(1);
    await axe(page, '[data-box="lessonGoal"]');

    // Changed during the lesson ('lessonGoals.set', an outbox command naming the lesson).
    await box.getByRole('button', { name: 'Change' }).click();
    const dialog = page.getByTestId('lesson-goal-dialog');
    await dialog.getByLabel('Our goal today (optional)').fill(changed);
    await axe(page, '[data-testid="lesson-goal-dialog"]');
    await dialog.getByRole('button', { name: 'Save goal' }).click();
    await expect(box).toContainText(changed);
    // A reload reads it back from the server.
    await page.reload();
    await expect(page.getByTestId('lesson-goal')).toContainText(changed);

    // The routine's "Learning goal" stage shows the goal for the class to read (S28a, D-197; RTN-1).
    await expect(page.getByTestId('stage-goal')).toHaveCount(0);
    await page.getByTestId('routine-stages').getByRole('button', { name: /Learning goal/u }).click();
    await expect(page.getByTestId('current-stage')).toContainText('Learning goal');
    await expect(page.getByTestId('stage-goal')).toContainText("Today's goal");
    await expect(page.getByTestId('stage-goal')).toContainText(changed);
    await axe(page, '[data-box="routine"]');

    // End Lesson: "Did we reach our goal?" before the reflection (LES-3).
    await page.getByRole('button', { name: 'End lesson', exact: true }).click();
    const end = page.getByTestId('end-lesson');
    const review = end.getByTestId('lesson-goal-review');
    await expect(review).toContainText(changed);
    await review.getByRole('radio', { name: 'Yes, we did!' }).click();
    await expect(review.getByRole('radio', { name: 'Yes, we did!' })).toHaveAttribute('aria-checked', 'true');
    await axe(page, '[data-testid="lesson-goal-review"]');
    await end.getByRole('button', { name: 'Save and end lesson' }).click();
    await expect(page.getByTestId('lesson-summary')).toBeVisible();
    // The "Lesson saved" summary: the goal and the class's answer, in words (S28a, D-197).
    const summaryGoal = page.getByTestId('summary-goal');
    await expect(summaryGoal).toContainText(changed);
    await expect(summaryGoal).toContainText('Yes, we did!');
    await expect(page.getByTestId('lesson-summary')).toContainText('Our goal');
    await axe(page, '[data-testid="lesson-summary"]');

    // The report lists the goal with the class's answer (RPT-1).
    await office.goto(`/teacher/reports?contextId=${ctx.id}`);
    const section = office.locator('details[data-section="lessonGoals"]');
    await expect(section).toHaveCount(1);
    await expect(section).toContainText('Lesson goals');
    await expect(section).toContainText(changed);
    await expect(section).toContainText('Yes, we did!');
  } finally {
    await endActiveLessons(page);
    await api(office, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/lessonGoals`, { enabled: false });
    await officeCtx.close();
  }
});

/** The measured classroom displays (D-177): 1536x703 and 1536x864 at device scale 1.25. */
const DISPLAYS_125 = [
  { name: '1536x703@1.25', width: 1536, height: 703, scale: 1.25 },
  { name: '1536x864@1.25', width: 1536, height: 864, scale: 1.25 },
];

async function onDevice(browser: Browser, page: Page, vp: (typeof DISPLAYS_125)[number], reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  const c = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale, hasTouch: true, reducedMotion });
  return { c, p: await c.newPage() };
}

/** Cards fully on screen: inside the window and inside the student grid's scroll box. */
const cardsOnScreen = (page: Page) =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('.cc-student-card')];
    const firstTop = all[0] ? Math.round(all[0].getBoundingClientRect().top) : 0;
    const perRow = all.filter((e) => Math.abs(Math.round(e.getBoundingClientRect().top) - firstTop) <= 1).length;
    const box = document.querySelector('[data-box="core.students"] > .cc-lesson-box__body')!.getBoundingClientRect();
    const cards = all.filter((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= Math.max(0, box.top) - 0.5 && r.bottom <= Math.min(window.innerHeight, box.bottom) + 0.5 && r.left >= 0 && r.right <= window.innerWidth + 0.5;
    }).length;
    return { cards, perRow };
  });

/** The routine box and its goal: does anything scroll or stick out, and is any word of the goal split over two lines? */
const routineFacts = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('[data-box="routine"] > .cc-lesson-box__body')!;
    const b = box.getBoundingClientRect();
    const goal = document.querySelector('[data-testid="stage-goal"]');
    const text = document.querySelector('[data-testid="stage-goal"] .cc-routine__goal-text');
    const split: string[] = [];
    const node = text?.firstChild;
    if (node && node.nodeType === Node.TEXT_NODE) {
      for (const m of (node.textContent ?? '').matchAll(/\S+/gu)) {
        const r = document.createRange();
        r.setStart(node, m.index!);
        r.setEnd(node, m.index! + m[0].length);
        if (new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size > 1) split.push(m[0]);
      }
    }
    const g = goal?.getBoundingClientRect();
    const name = document.querySelector('[data-box="routine"] .cc-routine__now-name')?.getBoundingClientRect();
    const focus = document.querySelector('[data-testid="stage-focus"]')?.getBoundingClientRect();
    return {
      // With the goal shown the topics sit beside the stage name (review of D-197), not on a line of their own.
      focusBesideName: name && focus ? focus.top < name.bottom - 1 && focus.left >= name.right - 0.5 : null,
      scrolls: box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1,
      goalInside: g ? g.top >= b.top - 0.5 && g.bottom <= b.bottom + 0.5 && g.left >= b.left - 0.5 && g.right <= b.right + 0.5 : null,
      split,
      focus: document.querySelectorAll('[data-testid="stage-focus"]').length,
    };
  });

/**
 * The routine's stage chips (S29, D-200): is every visible stage name whole (no ellipsis, no word split
 * over two lines, at most two lines), do the chips keep to one line, is every chip a touch target, and
 * does every chip's accessible name hold its whole stage name?
 */
const stepperFacts = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[data-box="routine"] [data-testid="routine-stages"]')!;
    const probe = document.createElement('div');
    probe.style.height = 'var(--cc-touch)';
    document.body.append(probe);
    const touch = probe.getBoundingClientRect().height;
    probe.remove();
    const problems: string[] = [];
    const tops = new Set<number>();
    let shown = 0;
    for (const li of list.querySelectorAll<HTMLElement>(':scope > li')) {
      const btn = li.querySelector<HTMLElement>('button')!;
      const name = li.querySelector<HTMLElement>('.cc-stepper__name')!;
      const label = name.textContent ?? '';
      const b = btn.getBoundingClientRect();
      tops.add(Math.round(b.top));
      if (b.height < touch - 0.5 || b.width < touch - 0.5) problems.push(`${label}: ${b.width.toFixed(1)}x${b.height.toFixed(1)} under the touch size`);
      if (!(btn.textContent ?? '').includes(label)) problems.push(`${label}: not in the accessible name`);
      const r = name.getBoundingClientRect();
      if (r.width <= 1) continue; // compact: only the number on screen, the name for screen readers
      shown++;
      if (name.scrollWidth > name.clientWidth + 1 || getComputedStyle(name).textOverflow === 'ellipsis') problems.push(`${label}: cut`);
      if (r.right > b.right + 0.5 || r.left < b.left - 0.5) problems.push(`${label}: outside its chip`);
      const lines = Math.round(r.height / parseFloat(getComputedStyle(name).lineHeight));
      if (lines > 2) problems.push(`${label}: ${lines} lines`);
      const node = name.firstChild;
      if (node && node.nodeType === Node.TEXT_NODE)
        for (const m of (node.textContent ?? '').matchAll(/\S+/gu)) {
          const range = document.createRange();
          range.setStart(node, m.index!);
          range.setEnd(node, m.index! + m[0].length);
          if (new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size > 1) problems.push(`${label}: "${m[0]}" split`);
        }
    }
    const current = list.querySelector<HTMLElement>('[aria-current="step"] .cc-stepper__name');
    // Every chip shows its number on screen in the compact fit, done chips too (S29 review): done
    // chips must not all look the same.
    const unnumbered =
      list.dataset.fit !== 'compact'
        ? []
        : [...list.querySelectorAll<HTMLElement>(':scope > li')].flatMap((li, i) => {
            const num = li.querySelector<HTMLElement>('.cc-stepper__done-num') ?? li.querySelector<HTMLElement>('.cc-stepper__num');
            const shown = num && num.getBoundingClientRect().width > 0 && (num.textContent ?? '').trim() === String(i + 1);
            return li.hasAttribute('aria-current') || shown ? [] : [li.querySelector('.cc-stepper__name')?.textContent ?? ''];
          });
    const box = list.closest<HTMLElement>('.cc-lesson-box__body')!;
    return {
      unnumbered,
      boxScrolls: box.scrollHeight > box.clientHeight + 1,
      fit: list.dataset.fit ?? null,
      chipLines: tops.size,
      overflow: list.scrollWidth > list.clientWidth + 1,
      shown,
      currentShown: current ? current.getBoundingClientRect().width > 1 : false,
      problems,
    };
  });

/** Today's focus box on the board (S29, D-200): one line of topics, "+N" for the rest, Change as an icon. */
const focusFacts = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('[data-box="focus"] [data-testid="todays-focus"]');
    if (!box) return null;
    const visible = [...box.querySelectorAll<HTMLElement>('.cc-focus__topic')].filter((li) => li.getBoundingClientRect().width > 1);
    const more = box.querySelector<HTMLElement>('[data-testid="focus-more"]');
    // Lines of each topic's own text (a topic that wraps inside its item is still one item top), and
    // items drawn over each other (S29 review: with reduced motion the first topic was read at 0 px).
    const textLines = Math.max(
      0,
      ...visible.map((li) => {
        const r = document.createRange();
        r.selectNodeContents(li.querySelector('span')!);
        return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
      }),
    );
    const shown = [...visible, ...(more && more.getBoundingClientRect().width > 0 ? [more] : [])].map((e) => e.getBoundingClientRect()).sort((a, b) => a.left - b.left);
    const overlap = shown.some((r, i) => i > 0 && r.left < shown[i - 1]!.right - 0.5);
    return {
      lines: new Set(visible.map((li) => Math.round(li.getBoundingClientRect().top))).size,
      textLines,
      overlap,
      visible: visible.length,
      listed: box.querySelectorAll('.cc-focus__topic').length,
      more: more && more.getBoundingClientRect().width > 0 ? (more.textContent ?? '') : null,
      cut: visible.some((li) => li.scrollWidth > li.clientWidth + 1),
    };
  });

test('the goal on the Learning goal stage fits the routine box in whole words at 1536x703 and 1536x864 (1.25), English and Turkish, with one and three topics (S28a, D-197; S29, D-200: a whole row of cards with three topics, whole stage names)', async ({ page, browser }) => {
  test.setTimeout(480_000);
  mkdirSync('test-results/fit', { recursive: true });
  await login(page, 'english');
  await ensurePin(page);
  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, 'english');
  const contexts = (await api(office, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; classId: string; className: string; subjectName: { en: string } }>;
  const ctx = contexts.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  // About 140 characters, the longest goal there can be (MAX_LESSON_GOAL_LENGTH), as in the board's fit test.
  const LONG = {
    en: 'We can ask and answer questions about the weather, say what we wear on a rainy day and write two short sentences about it.',
    tr: 'Hava durumu hakkında soru sorup cevap verebilir, yağmurlu bir günde ne giydiğimizi söyleyebilir ve bunu iki kısa cümleyle yazabiliriz.',
  };
  await endActiveLessons(page);
  try {
    expect((await api(office, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/lessonGoals`, { enabled: true })).status).toBe(200);
    const cmd = async (type: string, payload: Record<string, unknown>) => {
      const r = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type, contextId: ctx.id, ...(payload.lessonId ? { lessonId: payload.lessonId } : {}), payload: { contextId: ctx.id, ...payload } }] });
      expect(r.body.results[0].ok, type).toBe(true);
      return r.body.results[0].result;
    };
    const { lessonId } = (await cmd('lesson.start', { othersPresent: true, attendance: [] })) as { lessonId: string };
    const state = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/lesson`)).body;
    const stageIndex = (state.lesson.routine.stages as Array<{ id: string }>).findIndex((st) => st.id === 'learning-goal');
    expect(stageIndex).toBeGreaterThanOrEqual(0);
    await cmd('lesson.setStage', { lessonId, stageIndex });
    // The topics stay on the stage with the goal: one topic (the usual lesson) and three (review of D-197:
    // several topics must not push the last whole row of cards off the screen).
    const topics = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/topics`)).body.topics as Array<{ id: string }>;
    expect(topics.length).toBeGreaterThanOrEqual(3);

    for (const nTopics of [1, 3]) {
      await cmd('lesson.setTopics', { lessonId, topicIds: topics.slice(0, nTopics).map((t) => t.id) });
      for (const lang of ['en', 'tr'] as const) {
        expect((await api(office, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: lang, secondLanguageEnabled: false })).status).toBe(200);
        for (const vp of DISPLAYS_125) {
          const run = `${vp.name} ${lang} ${nTopics} topic(s)`;
          const measure = async (shot: string) => {
            const { c, p } = await onDevice(browser, page, vp);
            try {
              await p.goto('/classroom');
              await p.getByRole('button', { name: /3-A · (English|İngilizce)/u }).first().click();
              await expect(p.getByTestId('lesson-dashboard')).toBeVisible();
              await expect(p.locator('.cc-student-card').first()).toBeVisible();
              await p.waitForTimeout(300);
              await p.screenshot({ path: `test-results/fit/stage-goal-${vp.name}-${lang}-${nTopics}t-${shot}.png` });
              return { ...(await cardsOnScreen(p)), ...(await routineFacts(p)), goal: await p.getByTestId('stage-goal').count(), stepper: await stepperFacts(p), box: await focusFacts(p) };
            } finally {
              await c.close();
            }
          };
          await cmd('lessonGoals.set', { lessonId, text: '' });
          const none = await measure('no-goal');
          await cmd('lessonGoals.set', { lessonId, text: LONG[lang] });
          const long = await measure('long-goal');
          // Another stage with the same goal: the routine box shows no goal and the board loses nothing.
          await cmd('lesson.setStage', { lessonId, stageIndex: 0 });
          const other = await measure('other-stage');
          await cmd('lesson.setStage', { lessonId, stageIndex });
          test.info().annotations.push({ type: 'cards on screen', description: `${run}: Learning goal stage without a goal ${none.cards}, with a 140-character goal ${long.cards} (${long.perRow} a row); another stage ${other.cards}` });
          expect(none.goal, run).toBe(0);
          expect(other.goal, run).toBe(0);
          expect(long.goal, run).toBe(1);
          expect(long.focus, `${run}: the topics are still shown`).toBe(1);
          expect(long.scrolls, `${run}: the routine box does not scroll`).toBe(false);
          expect(long.goalInside, `${run}: the whole goal is inside the routine box`).toBe(true);
          expect(long.split, `${run}: whole words`).toEqual([]);
          expect(long.focusBesideName, `${run}: the topics move up beside the stage name`).toBe(true);
          // While the class reads the goal the student grid gives up at most one row of cards and keeps a
          // whole row on screen; on every other stage the goal costs nothing. With three topics at
          // 1536x703 the stage used to show no whole row even without a goal (D-197): the board's Today's
          // focus box now keeps to one line ("+N", Change as an icon), so a whole row stays (S29, D-200).
          expect(long.cards, `${run}: at most one row less`).toBeGreaterThanOrEqual(none.cards - long.perRow);
          expect(none.cards, `${run}: a whole row of cards without the goal`).toBeGreaterThanOrEqual(none.perRow);
          expect(long.cards, `${run}: a whole row of cards with the goal`).toBeGreaterThanOrEqual(long.perRow);
          expect(other.cards, `${run}: another stage`).toBeGreaterThanOrEqual(none.cards);
          // Every stage name whole on every screen of the run (S29, D-200).
          for (const [shot, m] of [['no goal', none], ['goal', long], ['other stage', other]] as const) {
            expect(m.stepper.problems, `${run} ${shot}: stage names`).toEqual([]);
            expect(m.stepper.overflow, `${run} ${shot}: the chips stay inside the box`).toBe(false);
            expect(m.stepper.chipLines, `${run} ${shot}: one line of chips`).toBe(1);
            expect(m.stepper.shown, `${run} ${shot}: the default routine names every stage`).toBe(6);
            expect(m.box, `${run} ${shot}: today's focus`).toMatchObject({ lines: 1, textLines: 1, overlap: false, listed: nTopics, cut: false });
            if (nTopics === 1) expect(m.box?.more, `${run} ${shot}: no +N with one topic`).toBeNull();
            else expect(m.box!.visible + Number((m.box!.more ?? '+0').slice(1)), `${run} ${shot}: shown topics and +N add up`).toBe(nTopics);
          }
        }
      }
    }
  } finally {
    await endActiveLessons(page);
    await api(office, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: 'en', secondLanguageEnabled: false });
    await api(office, 'PUT', `/api/teacher/contexts/${ctx.id}/modules/lessonGoals`, { enabled: false });
    await officeCtx.close();
  }
});

/** Every measured classroom display (D-177, S16c): the window and full screen at 1.25, the MacBook, 1280x720 and a phone. */
const ALL_DISPLAYS = [
  ...DISPLAYS_125,
  { name: '1440x787@2', width: 1440, height: 787, scale: 2 },
  { name: '1280x720@1', width: 1280, height: 720, scale: 1 },
  { name: '375x812@3', width: 375, height: 812, scale: 3 },
];

test('every stage name of the default routine is whole in English and Turkish at every classroom display, and a routine of the most stages keeps the current one named (S29, D-200)', async ({ page, browser }) => {
  test.setTimeout(480_000);
  await login(page, 'english');
  await ensurePin(page);
  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, 'english');
  const contexts = (await api(office, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; classId: string; className: string; subjectName: { en: string } }>;
  const ctx = contexts.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
  // A routine with the most stages a routine may have (MAX_STAGES = 20): the default six, then fourteen more (fictional).
  const stages = (
    [
      ['Greeting', 'Selamlaşma'],
      ['Date and weather', 'Tarih ve hava durumu'],
      ['Assistant', 'Günün yardımcısı'],
      ['Learning goal', 'Öğrenme hedefi'],
      ['Activities', 'Etkinlikler'],
      ['Reflection', 'Değerlendirme'],
      ['Warm-up song', 'Isınma şarkısı'],
      ['Story time', 'Hikâye zamanı'],
      ['Vocabulary game', 'Kelime oyunu'],
      ['Pair work', 'Eşli çalışma'],
      ['Group work', 'Grup çalışması'],
      ['Reading aloud', 'Sesli okuma'],
      ['Listening', 'Dinleme'],
      ['Speaking circle', 'Konuşma çemberi'],
      ['Writing', 'Yazma'],
      ['Drawing', 'Çizim'],
      ['Quiz', 'Küçük sınav'],
      ['Show and tell', 'Göster ve anlat'],
      ['Tidy up', 'Toparlanma'],
      ['Goodbye song', 'Veda şarkısı'],
    ] as const
  ).map(([en, tr]) => ({ name: { en, tr } }));
  expect(stages).toHaveLength(20);
  const created = await api(office, 'POST', '/api/teacher/routines', { name: { en: 'Long day', tr: 'Uzun gün' }, contextId: ctx.id, stages });
  expect(created.status).toBe(200);
  const longRoutine = created.body.id as string;
  await endActiveLessons(page);
  const cmd = async (type: string, payload: Record<string, unknown>) => {
    const r = await api(page, 'POST', '/api/commands', { commands: [{ opId: randomUUID(), type, contextId: ctx.id, ...(payload.lessonId ? { lessonId: payload.lessonId } : {}), payload: { contextId: ctx.id, ...payload } }] });
    expect(r.body.results[0].ok, type).toBe(true);
    return r.body.results[0].result;
  };
  const open = async (vp: (typeof ALL_DISPLAYS)[number], reducedMotion: 'reduce' | 'no-preference' = 'no-preference') => {
    const { c, p } = await onDevice(browser, page, vp, reducedMotion);
    await p.goto('/classroom');
    await p.getByRole('button', { name: /3-A · (English|İngilizce)/u }).first().click();
    await expect(p.getByTestId('lesson-dashboard')).toBeVisible();
    await expect(p.locator('.cc-student-card').first()).toBeVisible();
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    return { c, p };
  };
  try {
    // The default routine with three topics: every stage in turn at the window size, two stages at the other displays.
    const { lessonId } = (await cmd('lesson.start', { routineTemplateId: 'builtin:default', othersPresent: true, attendance: [] })) as { lessonId: string };
    const topics = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/topics`)).body.topics as Array<{ id: string }>;
    await cmd('lesson.setTopics', { lessonId, topicIds: topics.slice(0, 3).map((t) => t.id) });
    for (const lang of ['en', 'tr'] as const) {
      expect((await api(office, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: lang, secondLanguageEnabled: false })).status).toBe(200);
      for (const vp of ALL_DISPLAYS) {
        // The routine box's height on each stage of this run: the same on every stage, so the student
        // grid does not jump between stages (S29 review: "Tarih ve hava durumu" took two lines at 1280).
        const heights: number[] = [];
        for (const stageIndex of vp.name.startsWith('1536x703') ? [0, 1, 2, 3, 4, 5] : [0, 1, 3]) {
          await cmd('lesson.setStage', { lessonId, stageIndex });
          const { c, p } = await open(vp);
          try {
            const run = `${vp.name} ${lang} stage ${stageIndex + 1}`;
            await expect(p.getByTestId('current-stage')).toContainText(stages[stageIndex]!.name[lang]);
            await p.screenshot({ path: `test-results/fit/stage-names-${vp.name}-${lang}-${stageIndex + 1}.png` });
            const s = await stepperFacts(p);
            test.info().annotations.push({ type: 'stage chips', description: `${run}: ${s.fit}, ${s.chipLines} line(s)` });
            expect(s.problems, run).toEqual([]);
            expect(s.overflow, `${run}: no sideways strip`).toBe(false);
            expect(s.shown, `${run}: every stage named on screen`).toBe(6);
            // A box at least 40rem wide keeps the chips to one line; a phone wraps them.
            if (vp.width >= 1024) expect(s.chipLines, `${run}: one line of chips`).toBe(1);
            if (vp.width >= 1024) {
              // Today's focus with three topics and the student grid at every classroom display, not
              // only at the two 1.25 displays (S29 review).
              const f = await focusFacts(p);
              expect(f, `${run}: today's focus`).toMatchObject({ lines: 1, textLines: 1, overlap: false, listed: 3, cut: false });
              expect(f!.visible + Number((f!.more ?? '+0').slice(1)), `${run}: shown topics and +N add up`).toBe(3);
              const cards = await cardsOnScreen(p);
              test.info().annotations.push({ type: 'cards on screen', description: `${run}: ${cards.cards} (${cards.perRow} a row)` });
              expect(cards.cards, `${run}: a whole row of cards`).toBeGreaterThanOrEqual(cards.perRow);
              // Stage 4 (Learning goal) shows the topics in the head; the other stages share one height.
              if (stageIndex !== 3) heights.push(await p.locator('[data-box="routine"]').evaluate((e) => Math.round(e.getBoundingClientRect().height)));
            }
            if (stageIndex === 3 && vp.name.startsWith('1536x703')) {
              await axe(p, '[data-box="routine"]');
              await axe(p, '[data-box="focus"]');
            }
          } finally {
            await c.close();
          }
        }
        if (heights.length) expect(Math.max(...heights) - Math.min(...heights), `${vp.name} ${lang}: the routine box keeps its height from stage to stage (${heights.join(', ')})`).toBeLessThanOrEqual(1);
      }
      // Reduced motion (Windows "Animation effects" off, common on classroom PCs): the fits measure with
      // transitions off, so Today's focus still keeps to one line with "+N" and nothing drawn over
      // anything (S29 review: every topic was shown, the first squeezed under the next).
      for (const vp of [DISPLAYS_125[0]!, ALL_DISPLAYS[3]!]) {
        for (const stageIndex of [0, 3]) {
          await cmd('lesson.setStage', { lessonId, stageIndex });
          const { c, p } = await open(vp, 'reduce');
          try {
            const run = `${vp.name} ${lang} stage ${stageIndex + 1}, reduced motion`;
            await p.screenshot({ path: `test-results/fit/reduced-motion-${vp.name}-${lang}-${stageIndex + 1}.png` });
            const f = await focusFacts(p);
            expect(f, `${run}: today's focus`).toMatchObject({ lines: 1, textLines: 1, overlap: false, listed: 3, cut: false });
            expect(f!.visible + Number((f!.more ?? '+0').slice(1)), `${run}: shown topics and +N add up`).toBe(3);
            const s = await stepperFacts(p);
            expect(s.problems, run).toEqual([]);
            expect(s.chipLines, `${run}: one line of chips`).toBe(1);
            // A larger text size set while the board is open, at the same width: the fits run again
            // (S29 review). The names stay whole and the routine box does not scroll.
            await p.evaluate(() => {
              document.documentElement.style.setProperty('--cc-text-scale', '1.5');
              document.documentElement.dataset.text = 'large';
            });
            await p.waitForTimeout(300);
            const big = await stepperFacts(p);
            test.info().annotations.push({ type: 'stage chips', description: `${run}, text 150 %: ${big.fit}, ${big.chipLines} line(s), ${big.shown} named` });
            await p.screenshot({ path: `test-results/fit/text-150-${vp.name}-${lang}-${stageIndex + 1}.png` });
            expect(big.problems, `${run}, text 150 %`).toEqual([]);
            expect(big.overflow, `${run}, text 150 %: no sideways strip`).toBe(false);
            expect(big.unnumbered, `${run}, text 150 %: every compact chip numbered`).toEqual([]);
            const fb = await focusFacts(p);
            expect(fb, `${run}, text 150 %: today's focus`).toMatchObject({ lines: 1, overlap: false, cut: false });
          } finally {
            await c.close();
          }
        }
      }
    }
    await endActiveLessons(page);

    // Twenty stages: the chips other than the current one show their number (the name stays the chip's
    // accessible name); the current chip and the head name the stage in full.
    const long = (await cmd('lesson.start', { routineTemplateId: longRoutine, othersPresent: true, attendance: [] })) as { lessonId: string };
    for (const lang of ['en', 'tr'] as const) {
      expect((await api(office, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: lang, secondLanguageEnabled: false })).status).toBe(200);
      for (const stageIndex of [0, 12, 19]) {
        await cmd('lesson.setStage', { lessonId: long.lessonId, stageIndex });
        for (const vp of [DISPLAYS_125[0]!, ALL_DISPLAYS[3]!]) {
          const { c, p } = await open(vp);
          try {
            const run = `${vp.name} ${lang} 20 stages, stage ${stageIndex + 1}`;
            await expect(p.getByTestId('current-stage')).toContainText(stages[stageIndex]!.name[lang]);
            await p.screenshot({ path: `test-results/fit/stage-names-20-${vp.name}-${lang}-${stageIndex + 1}.png` });
            const s = await stepperFacts(p);
            test.info().annotations.push({ type: 'stage chips', description: `${run}: ${s.fit}, ${s.chipLines} line(s), ${s.shown} named` });
            expect(s.problems, run).toEqual([]);
            expect(s.overflow, `${run}: no sideways strip`).toBe(false);
            expect(s.fit, run).toBe('compact');
            expect(s.currentShown, `${run}: the current stage is named`).toBe(true);
            expect(s.chipLines, `${run}: at most two lines of chips`).toBeLessThanOrEqual(2);
            // Done chips keep their number (with a tick badge), so they can be told apart (S29 review).
            expect(s.unnumbered, `${run}: every chip shows its number`).toEqual([]);
            if (stageIndex === 12 && vp === DISPLAYS_125[0]) await axe(p, '[data-box="routine"]');
          } finally {
            await c.close();
          }
        }
      }
    }
  } finally {
    await endActiveLessons(page);
    await api(office, 'PUT', `/api/teacher/classes/${ctx.classId}/language`, { mainLanguage: 'en', secondLanguageEnabled: false });
    await api(office, 'POST', `/api/teacher/routines/${longRoutine}/archive`, {});
    await officeCtx.close();
  }
});
