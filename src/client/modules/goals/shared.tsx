/**
 * Goal display pieces shared by the teacher Goals page and the personal student page (S10).
 * Labels are teacher-editable data (pickText); everything else goes through t().
 * Links open in a new tab with rel="noopener noreferrer" and are never fetched for a preview.
 */
import type { ReactNode } from 'react';
import type { Evidence, Feedback, Goal, GoalEntry, OutcomeDef } from '../../../shared/contracts/goals.ts';
import { formatDate, pickText, type Locale, type MessageKey } from '../../../shared/i18n/index.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { IconFile, IconLink, IconMic, IconNote } from '../../ui/icons.tsx';

export const CONFIDENCE_LEVELS = [1, 2, 3, 4, 5] as const;

/** The goal's words: a preset in the viewer's language, else what was written. */
export const goalText = (g: Goal, locale: Locale) => (g.presetText ? pickText(g.presetText, locale) || g.text : g.text);

export const whenText = (ms: number, locale: Locale) => formatDate(ms, locale, Intl.DateTimeFormat().resolvedOptions().timeZone, { day: 'numeric', month: 'short', year: 'numeric' });

/** Current category name; the name at the time the goal was set when it was renamed since (DAT-6). */
export function CategoryLabel({ goal }: { goal: Goal }) {
  const { t, locale } = useI18n();
  const now = pickText(goal.category.name, locale);
  const then = pickText(goal.category.nameAtCreation, locale);
  return (
    <span className="cc-chip" data-testid="goal-category">
      {now}
      {then && then !== now ? ` ${t('goals.renamedFrom', { name: then })}` : null}
    </span>
  );
}

export function ConfidenceChip({ value }: { value: number }) {
  const { t } = useI18n();
  return <span className="cc-chip cc-confidence" data-level={value}>{t('goals.confidenceValue', { n: value })}</span>;
}

export function OutcomeChip({ outcome, outcomes }: { outcome: string; outcomes: readonly OutcomeDef[] }) {
  const { t, locale } = useI18n();
  const def = outcomes.find((o) => o.key === outcome);
  return (
    <span className="cc-chip cc-outcome" data-outcome={outcome}>
      {t('goals.outcomeIs', { outcome: def ? pickText(def.label, locale) : outcome })}
    </span>
  );
}

const ENTRY_KIND: Record<GoalEntry['kind'], MessageKey> = {
  progress: 'goals.entry.progress',
  reflection: 'goals.entry.reflection',
  note: 'goals.entry.note',
  self_assessment: 'goals.entry.self_assessment',
};
export const entryKindLabel = (kind: GoalEntry['kind']) => ENTRY_KIND[kind];

/** One entry line: who, what kind, when, the words and (self-assessment) the confidence. */
export function EntryLine({ entry, actions }: { entry: GoalEntry; actions?: ReactNode }) {
  const { t, locale } = useI18n();
  return (
    <li className="cc-entry" data-author={entry.authorType}>
      <div className="cc-row">
        <IconNote />
        <strong>{t(ENTRY_KIND[entry.kind])}</strong>
        <span className="cc-muted">{entry.authorType === 'teacher' ? t('goals.byTeacher') : t('goals.byStudent')}</span>
        <span className="cc-muted">{whenText(entry.createdAt, locale)}</span>
        {entry.confidence !== null ? <ConfidenceChip value={entry.confidence} /> : null}
      </div>
      <p className="cc-entry__body">{entry.body}</p>
      {actions}
    </li>
  );
}

/** Goal heading block: category, words, practice choices, status, review date and latest outcome. */
export function GoalSummary({ goal, outcomes }: { goal: Goal; outcomes: readonly OutcomeDef[] }) {
  const { t, locale } = useI18n();
  const latest = goal.assessments[0];
  return (
    <div className="cc-stack cc-goal__summary">
      <div className="cc-row">
        <CategoryLabel goal={goal} />
        <span className="cc-chip" data-status={goal.status}>
          {t(`goals.status.${goal.status}` as MessageKey)}
        </span>
        {goal.authorType === 'teacher' ? <span className="cc-chip">{t('goals.setByTeacher')}</span> : null}
        {latest ? <OutcomeChip outcome={latest.outcome} outcomes={outcomes} /> : null}
      </div>
      <p className="cc-goal__text">{goalText(goal, locale)}</p>
      {goal.practiceChoices.length ? (
        <p className="cc-muted">{t('goals.practiceList', { list: goal.practiceChoices.join(', ') })}</p>
      ) : null}
      {goal.reviewOn ? <p className="cc-muted">{t('goals.reviewOn', { date: goal.reviewOn })}</p> : null}
    </div>
  );
}

/** Evidence item: text, a safe external link, a protected file (image preview) or an audio player. */
export function EvidenceView({ item, fileUrl, actions }: { item: Evidence; fileUrl: (fileId: string, thumb?: boolean) => string; actions?: ReactNode }) {
  const { t, locale } = useI18n();
  const f = item.file;
  return (
    <li className="cc-card cc-stack cc-evidence" data-kind={item.kind}>
      <div className="cc-row">
        {item.kind === 'link' ? <IconLink /> : item.kind === 'audio' ? <IconMic /> : item.kind === 'file' ? <IconFile /> : <IconNote />}
        <strong>{t(`goals.evidenceKind.${item.kind}` as MessageKey)}</strong>
        <span className="cc-muted">{whenText(item.createdAt, locale)}</span>
        {item.authorType === 'teacher' ? <span className="cc-chip">{t('goals.byTeacher')}</span> : null}
      </div>
      {item.body ? <p className="cc-entry__body">{item.body}</p> : null}
      {item.url ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="cc-evidence__link">
          {item.url}
        </a>
      ) : null}
      {f && item.kind === 'audio' ? <audio controls preload="none" src={fileUrl(f.id)} aria-label={t('goals.recording')} /> : null}
      {f && item.kind === 'file' ? (
        <a href={fileUrl(f.id)} target="_blank" rel="noopener noreferrer" className="cc-row">
          {f.hasThumbnail ? <img src={fileUrl(f.id, true)} alt={t('goals.photoOf', { name: f.name ?? '' })} className="cc-evidence__thumb" /> : null}
          <span>{f.name ?? t('goals.openFile')}</span>
        </a>
      ) : null}
      {item.kind !== 'text' && item.kind !== 'link' && !f ? <p className="cc-muted">{t('goals.fileRemoved')}</p> : null}
      {actions}
    </li>
  );
}

export function FeedbackLine({ item, actions }: { item: Feedback; actions?: ReactNode }) {
  const { t, locale } = useI18n();
  return (
    <li className="cc-card cc-stack cc-feedback">
      <div className="cc-row">
        <strong>{t('goals.feedbackFrom', { name: item.teacherName })}</strong>
        <span className="cc-muted">{whenText(item.createdAt, locale)}</span>
      </div>
      <p className="cc-entry__body">{item.body}</p>
      {actions}
    </li>
  );
}
