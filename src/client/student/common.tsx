/**
 * Small pieces shared by the student screens (S14d, D-151): the text check that runs
 * when the student presses Save (hints show only then, not while typing), the sentence starters of a
 * kind, the step counter and the big choice buttons.
 */
import type { ReactNode } from 'react';
import type { StudentGoalsSection } from '../../shared/contracts/goals.ts';
import type { Locale } from '../../shared/i18n/index.ts';
import { blankRange, hasBlank, starterKindsOf, type StarterKind } from '../../shared/text/starters.ts';
import { checkStudentText, exampleKeyFor, findRiskyWord, type TextKind } from '../../shared/text/textQuality.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';

/** The save runner (S26c, D-191: in `run.ts`, so My goals loads it without the text checks). */
export { useStudentRun } from './run.ts';

/** The page's starter texts of one text kind, in every language it has (for the "only a starter" check). */
export const starterTexts = (data: StudentGoalsSection, kind: TextKind) => {
  const kinds = starterKindsOf(kind);
  return data.starters.filter((s) => kinds.includes(s.kind)).flatMap((s) => [s.text.en, s.text.tr].filter((x): x is string => Boolean(x)));
};

/** Starters of one kind in the page language; a category's own starters first, then the general ones. */
export function startersOf(data: StudentGoalsSection, kind: StarterKind, locale: Locale, categoryId: string | null = null): string[] {
  const of = (s: StudentGoalsSection['starters'][number]) => s.kind === kind && Boolean(s.text[locale]);
  const own = categoryId ? data.starters.filter((s) => of(s) && s.categoryId === categoryId) : [];
  const general = data.starters.filter((s) => of(s) && s.categoryId === null);
  return [...own, ...general].map((s) => s.text[locale]!);
}

export type SaveCheck = { hint?: string; send: boolean };

/**
 * Check a text when the student presses Save (S14d: hints show only then). The same shared rules as
 * the server, with the school's limits and the page's starters. A text with an unkind word is still
 * sent, so the server counts the attempt for the teacher's notice (D-123); anything else waits for
 * the student to change it.
 */
export function useSaveCheck(data: StudentGoalsSection) {
  const { t } = useI18n();
  return (text: string, kind: TextKind | 'url'): SaveCheck => {
    if (kind === 'url') {
      let words = text;
      try {
        words = decodeURIComponent(text);
      } catch {
        // keep the address as typed
      }
      return findRiskyWord(words) ? { hint: t('textCheck.BLOCKED_WORD'), send: true } : { send: true };
    }
    const r = checkStudentText(text, kind, { limits: data.textLimits, starters: starterTexts(data, kind) });
    if (r.ok) return { send: true };
    if (r.reason === 'BLOCKED_WORD') return { hint: t('textCheck.BLOCKED_WORD'), send: true };
    // With the blank still there say where the words go; without it (the blank was deleted) do not name a ___ the child cannot see.
    if (r.reason === 'STARTER_UNFINISHED') return { hint: t(hasBlank(text) ? 'textCheck.STARTER_UNFINISHED' : 'starters.addWords'), send: false };
    return { hint: `${t(`textCheck.${r.reason}`)} ${t(exampleKeyFor(kind))}`, send: false };
  };
}

/** After a hint: back into the box, with a blank still in it selected (so the child types over it). */
export function focusBox(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.focus();
  const r = blankRange(el.value);
  if (r) el.setSelectionRange(r.start, r.end);
}

/** "Step 2 of 3" above a step's question. */
export function StepCount({ step, total }: { step: number; total: number }) {
  const { t } = useI18n();
  return <p className="cc-student__step">{t('student.step', { n: step, total })}</p>;
}

/** A big choice button (icon above words) in a `.cc-student-choices` grid. */
export function Choice({ icon, label, selected, onPress, testId }: { icon?: ReactNode; label: string; selected?: boolean; onPress: () => void; testId?: string }) {
  return (
    <Button className="cc-student-choice" variant={selected ? 'primary' : 'secondary'} aria-pressed={selected === undefined ? undefined : selected} onPress={onPress} data-testid={testId}>
      {icon}
      <span className="cc-student-choice__label">{label}</span>
    </Button>
  );
}
