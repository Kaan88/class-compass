// @vitest-environment jsdom
/**
 * S20d (D-172, refines D-099): the label editors follow the class language. `LangFields` shows one
 * field per class language, main language first, keeps the text of a language that is off and marks
 * "Needs translation"; the routine stage, homework status and goal outcome editors use it with the
 * languages of the class being edited (all of the teacher's classes for a routine "for all classes").
 * Fictional data only.
 */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { LocalizedTextValue } from '../../src/shared/contracts/define.ts';
import { DEFAULT_GOAL_OUTCOMES } from '../../src/shared/contracts/goals.ts';
import { DEFAULT_HOMEWORK_STATUSES } from '../../src/shared/contracts/homework.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { tr } from '../../src/shared/i18n/tr.ts';
import { translate } from '../../src/shared/i18n/index.ts';
import { SENSITIVE } from '../../src/client/lib/queryClient.ts';
import { LangFields, useEditorLocales } from '../../src/client/ui/LangFields.tsx';
import { HomeworkSettingsPanel } from '../../src/client/routes/teacher/Homework.tsx';
import { GoalsSettingsPanel } from '../../src/client/routes/teacher/Goals.tsx';
import { RoutinesPage } from '../../src/client/routes/teacher/Routines.tsx';

afterEach(cleanup);

const field = (label: string, lang: 'en' | 'tr') => translate('en', lang === 'en' ? 'language.field.en' : 'language.field.tr', { label });
const ctx = (id: string, className: string, mainLanguage: 'en' | 'tr', secondLanguageEnabled: boolean, page: { main: 'en' | 'tr'; second: boolean } | null = null) => ({
  id,
  classId: `class-${id}`,
  className,
  subjectId: 'subject-en',
  subjectName: { en: 'English', tr: 'İngilizce' },
  theme: 'classroom',
  chosenTheme: 'classroom',
  timezone: 'Europe/Istanbul',
  soundsEnabled: true,
  animationsEnabled: true,
  mainLanguage,
  secondLanguageEnabled,
  studentPageMainLanguage: page?.main ?? null,
  studentPageSecondLanguageEnabled: page?.second ?? null,
  modules: {},
});
const CONTEXTS = [ctx('c-tr', '3-A', 'tr', false), ctx('c-en', '3-B', 'en', false), ctx('c-both', '4-A', 'en', true), ctx('c-page', '4-B', 'tr', false, { main: 'en', second: false })];

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(['classroom', 'contexts'], { contexts: CONTEXTS, media: {}, modulesAvailable: {} });
  return qc;
}
const wrap = (qc: QueryClient, node: React.ReactNode) => render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);

function Harness({ locales, initial }: { locales: Array<'en' | 'tr'>; initial: LocalizedTextValue }) {
  const [value, setValue] = useState<LocalizedTextValue>(initial);
  return (
    <>
      <LangFields label="Stage 1" value={value} onChange={setValue} locales={locales} testId="lf" />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe('LangFields (S20d, D-172)', () => {
  it('a Turkish-only class edits Turkish only; the English text is kept and the Turkish field needs translation', () => {
    render(<Harness locales={['tr']} initial={{ en: 'Greeting' }} />);
    expect(screen.queryByLabelText(field('Stage 1', 'en'))).toBeNull();
    const trField = screen.getByLabelText(field('Stage 1', 'tr'));
    expect(screen.getByTestId('needs-translation').textContent).toBe(en['language.needsTranslation']);
    fireEvent.change(trField, { target: { value: 'Selamlaşma' } });
    expect(JSON.parse(screen.getByTestId('value').textContent!)).toEqual({ en: 'Greeting', tr: 'Selamlaşma' });
    expect(screen.queryByTestId('needs-translation')).toBeNull();
  });

  it('two languages: both fields, the main language first, each with its own language name', () => {
    render(<Harness locales={['tr', 'en']} initial={{ tr: 'Selamlaşma' }} />);
    const inputs = within(screen.getByTestId('lf')).getAllByRole('textbox');
    expect(inputs).toHaveLength(2);
    expect(screen.getByLabelText(field('Stage 1', 'tr'))).toBe(inputs[0]);
    expect(screen.getByLabelText(field('Stage 1', 'en'))).toBe(inputs[1]);
    expect(screen.getAllByTestId('needs-translation')).toHaveLength(1);
    expect(screen.getByTestId('lf').querySelectorAll('[data-lang]')[1]!.getAttribute('data-lang')).toBe('en');
  });

  it('names the languages in Turkish for a Turkish interface', () => {
    expect(translate('tr', 'language.field.tr', { label: '1. aşama' })).toBe('1. aşama (Türkçe)');
    expect(tr['language.field.en']).toContain('İngilizce');
  });
});

describe('useEditorLocales', () => {
  function Show({ ids }: { ids?: string[] }) {
    return <output data-testid="locales">{useEditorLocales(ids).join(',')}</output>;
  }
  it('follows the class, adds the student-page language (D-117) and joins all classes when none is given', () => {
    const qc = client();
    const one = (ids?: string[]) => {
      cleanup();
      wrap(qc, <Show {...(ids ? { ids } : {})} />);
      return screen.getByTestId('locales').textContent;
    };
    expect(one(['c-tr'])).toBe('tr');
    expect(one(['c-en'])).toBe('en');
    expect(one(['c-both'])).toBe('en,tr');
    expect(one(['c-page'])).toBe('tr,en');
    expect(one()).toBe('tr,en');
  });
});

describe('label editors in a Turkish-only class (S20d, D-172)', () => {
  it('homework statuses: Turkish fields only, the stored English kept', () => {
    const qc = client();
    qc.setQueryData([SENSITIVE, 'teacher', 'homework', 'settings', 'c-tr'], { statuses: DEFAULT_HOMEWORK_STATUSES, checkingInClassroom: false });
    wrap(qc, <HomeworkSettingsPanel contextId="c-tr" />);
    const statuses = screen.getAllByTestId('homework-status');
    expect(statuses).toHaveLength(DEFAULT_HOMEWORK_STATUSES.length);
    for (const [i, s] of statuses.entries()) {
      const label = translate('en', 'homework.statusN', { n: i + 1 });
      expect(within(s).queryByLabelText(field(label, 'en'))).toBeNull();
      expect((within(s).getByLabelText(field(label, 'tr')) as HTMLInputElement).value).toBe(DEFAULT_HOMEWORK_STATUSES[i]!.label.tr);
    }
  });

  it('goal outcomes: Turkish fields only in a Turkish-only class, both in a two-language class', () => {
    const qc = client();
    for (const id of ['c-tr', 'c-both']) qc.setQueryData([SENSITIVE, 'teacher', 'goals', 'settings', id], { outcomes: DEFAULT_GOAL_OUTCOMES, blockedTextNotice: false });
    wrap(qc, <GoalsSettingsPanel contextId="c-tr" />);
    const label = translate('en', 'goals.outcomeN', { n: 1 });
    expect(screen.getByLabelText(field(label, 'tr'))).toBeTruthy();
    expect(screen.queryByLabelText(field(label, 'en'))).toBeNull();
    cleanup();
    wrap(qc, <GoalsSettingsPanel contextId="c-both" />);
    expect(screen.getByLabelText(field(label, 'en'))).toBeTruthy();
    expect(screen.getByLabelText(field(label, 'tr'))).toBeTruthy();
  });

  it('routine stages: every class language for "all my classes", only Turkish once the Turkish-only class is chosen', () => {
    const qc = client();
    qc.setQueryData([SENSITIVE, 'teacher', 'routines'], { templates: [], defaults: [] });
    wrap(qc, <RoutinesPage />);
    fireEvent.click(screen.getByRole('button', { name: en['routines.new'] }));
    const editor = screen.getByRole('form', { name: en['routines.editor'] });
    const stage = translate('en', 'routines.stageN', { n: 1 });
    expect(within(editor).getByLabelText(field(stage, 'en'))).toBeTruthy();
    expect(within(editor).getByLabelText(field(stage, 'tr'))).toBeTruthy();
    fireEvent.change(within(editor).getByLabelText(en['routines.scope']), { target: { value: 'c-tr' } });
    expect(within(editor).queryByLabelText(field(stage, 'en'))).toBeNull();
    expect(within(editor).getByLabelText(field(stage, 'tr'))).toBeTruthy();
    expect(within(editor).queryByLabelText(field(en['routines.name'], 'en'))).toBeNull();
    fireEvent.change(within(editor).getByLabelText(en['routines.scope']), { target: { value: 'c-en' } });
    expect(within(editor).queryByLabelText(field(stage, 'tr'))).toBeNull();
  });
});
