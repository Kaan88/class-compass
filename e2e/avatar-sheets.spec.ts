/**
 * Avatar review sheets (S17c, D-169): every species in all 12 colours at 48 px, the body-coloured
 * backgrounds, hats and extras on every species and every skin tone, in every built-in theme, plus
 * the picker on a 375 px phone. The pictures are saved for the owner under `test-results/s17c/<phase>/`
 * (`S17C_PHASE=before` was taken on the v1 art before the stage changed it; the default is `after`).
 * The checks: every species renders in every colour, as an image with a name, and the sheet has no
 * serious axe violations. Fictional demo data only.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ALL_SPECIES, AVATAR_COLOURS, SKIN_TONES } from '../src/shared/avatars.ts';
import { THEME_KEYS } from '../src/shared/themes.ts';
import { api, ensurePin, login, studentLinkUrl } from './helpers.ts';

const PHASE = process.env.S17C_PHASE ?? 'after';
const out = (name: string) => `test-results/s17c/${PHASE}/${name}.png`;

async function context3A(page: Page) {
  const mine = (await api(page, 'GET', '/api/teacher/contexts')).body.contexts as Array<{ id: string; classId: string; className: string; subjectName: { en: string } }>;
  return mine.find((c) => c.className === '3-A' && c.subjectName.en === 'English')!;
}

test('avatar sheets: every species × 12 colours at 48 px in every built-in theme', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'english');
  for (const theme of THEME_KEYS) {
    await page.goto(`/dev/avatars?theme=${theme}`);
    const species = page.getByTestId('sheet-species');
    await expect(species).toBeVisible();
    for (const s of ALL_SPECIES) await expect(page.getByTestId(`sheet-species-${s}`).locator('svg[role="img"]')).toHaveCount(AVATAR_COLOURS.length);
    await expect(page.getByTestId('sheet-people').locator('svg[role="img"]')).toHaveCount(SKIN_TONES.length * 8);
    for (const section of ['species', 'same', 'hats', 'people']) await page.getByTestId(`sheet-${section}`).screenshot({ path: out(`${theme}-${section}`) });
  }
  const r = await new AxeBuilder({ page }).include('[data-testid="sheet-species"]').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('avatar picker sheets on a 375 px phone', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'english');
  await ensurePin(page);
  const ctx = await context3A(page);
  const roster = (await api(page, 'GET', `/api/classroom/contexts/${ctx.id}/roster`)).body.students as Array<{ id: string }>;
  const link = await studentLinkUrl(page, ctx.classId, roster[11]!.id);
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
  const p = await phone.newPage();
  try {
    await p.goto(link);
    await p.getByRole('link', { name: 'My avatar' }).click();
    await p.getByTestId('avatar-change').click();
    const creator = p.getByTestId('avatar-creator');
    await expect(creator).toBeVisible();
    await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await creator.screenshot({ path: out('picker-ready') });
    await creator.getByTestId('avatar-tab-make').click();
    await creator.getByTestId('avatar-type-creature').click();
    await creator.screenshot({ path: out('picker-make-creature') });
    await creator.getByTestId('avatar-type-person').click();
    await creator.screenshot({ path: out('picker-make-person') });
  } finally {
    await phone.close();
  }
});
