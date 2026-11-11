// @vitest-environment jsdom
/**
 * Admin → Themes words a lost avatar face in the admin's language (S21a review, D-173; THM-3): the
 * validator reports token names only (`fg: avatar-ink`, `or: avatar-white`), never English joining
 * words, and the page turns them into a whole English or Turkish sentence. Fictional data only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../src/client/lib/i18n.tsx';
import { IssueText } from '../../src/client/routes/admin/Themes.tsx';
import { validateThemePackage } from '../../src/shared/themePackage/validate.ts';

afterEach(cleanup);

/** The ocean example with a mid-grey rim and a mid navy: the faces get lost on the navy body. */
function lostFace() {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'examples', 'ocean.theme.json'), 'utf8')) as Record<string, any>;
  pkg.colors['avatar-white'] = '#8a90a0';
  pkg.colors['avatar-navy'] = '#4a5aa0';
  const issue = validateThemePackage(pkg).report.errors.find((e) => e.code === 'CONTRAST' && e.params?.bg === 'avatar-navy');
  expect(issue).toBeDefined();
  return issue!;
}

const text = (locale: 'en' | 'tr', issue: ReturnType<typeof lostFace>) =>
  render(createElement(I18nProvider, { locale, children: createElement(IssueText, { issue }) })).container.textContent ?? '';

describe('avatar face contrast in Admin → Themes (D-173)', () => {
  it('the report carries token names only', () => {
    const issue = lostFace();
    expect(issue.params).toMatchObject({ fg: 'avatar-ink', or: 'avatar-white', bg: 'avatar-navy', min: 3 });
    for (const v of Object.values(issue.params ?? {})) expect(String(v)).not.toMatch(/\sor\s/u);
  });

  it('reads as one sentence in English and in Turkish, with no English word in the Turkish one', () => {
    const issue = lostFace();
    const en = text('en', issue);
    expect(en).toContain('neither avatar-ink nor avatar-white stands out on avatar-navy');
    cleanup();
    const tr = text('tr', issue);
    expect(tr).toContain('avatar-navy üzerinde ne avatar-ink ne de avatar-white yeterince belirgin');
    expect(tr.replace(/avatar-[a-z0-9-]+/gu, '')).not.toMatch(/\b(or|on|neither|nor|needs)\b/u);
  });

  it('an ordinary pair keeps the ordinary message', () => {
    const tr = text('tr', { code: 'CONTRAST', path: 'colors.text', message: 'text on surface', params: { fg: 'text', bg: 'surface', ratio: 2.1, min: 4.5 } } as ReturnType<typeof lostFace>);
    expect(tr).toContain('surface üzerinde text 2.1:1, en az 4.5:1 olmalı');
  });
});
