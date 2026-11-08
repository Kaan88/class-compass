/**
 * Goals on the personal student page (S10: GOL-1..5, STU-2, D-014), one subject:
 * My goals · Add a goal · My reflections · My evidence · Teacher feedback (read-only).
 * A student edits or deletes only what they wrote; teacher goals, progress, outcomes and feedback are
 * shown read-only. Evidence uses the shared EvidenceAdder (S13b2, D-119); picture and voice choices
 * appear only when the admin media flags allow them.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as G from '../../shared/contracts/goals.ts';
import type { Goal, StudentGoalsSection, StudentPage } from '../../shared/contracts/goals.ts';
import { pickText, type MessageKey } from '../../shared/i18n/index.ts';
import { checkStudentText, exampleKeyFor, findRiskyWord, type TextKind, type TextLimits } from '../../shared/text/textQuality.ts';
import { call, upload } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useRun } from '../lib/useRun.ts';
import { CONFIDENCE_LEVELS, EntryLine, EvidenceView, FeedbackLine, GoalSummary, goalText } from '../modules/goals/shared.tsx';
import { Button } from '../ui/Button.tsx';
import { Select, TextArea, TextField } from '../ui/Fields.tsx';
import { IconCheck, IconPlus, IconTrash } from '../ui/icons.tsx';
import { EvidenceAdder, type EvidenceHintKind } from '../modules/goals/EvidenceAdder.tsx';
import { STUDENT_PAGE_KEY } from './keys.ts';

type Media = StudentPage['media'];
const OWN = '__own__';

/**
 * Live, kind feedback while typing (S13c item 12, D-123): the same shared rules the server applies
 * (the server checks again, with the school's and teachers' extra words). Shown once the student has
 * typed a few letters, with an example of a good sentence.
 */
function textHint(t: ReturnType<typeof useI18n>['t'], text: string, kind: TextKind, limits: TextLimits): string | undefined {
  if (text.trim().length < 4) return undefined;
  // The school's goal limits come with the page, so the hint agrees with what the server accepts.
  const r = checkStudentText(text, kind, { limits });
  if (r.ok) return undefined;
  return r.reason === 'BLOCKED_WORD' ? t('textCheck.BLOCKED_WORD') : `${t(`textCheck.${r.reason}`)} ${t(exampleKeyFor(kind))}`;
}

function useTextHint(text: string, kind: TextKind, limits: TextLimits): string | undefined {
  const { t } = useI18n();
  return textHint(t, text, kind, limits);
}

const splitChoices = (practice: string) =>
  practice
    .split(/[\n,]/u)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, G.MAX_PRACTICE_CHOICES);

/** Practice choices (comma or line separated): the first one that does not pass. */
function usePracticeHint(text: string, limits: TextLimits): string | undefined {
  const { t } = useI18n();
  for (const c of splitChoices(text)) {
    const h = textHint(t, c, 'practiceChoice', limits);
    if (h) return h;
  }
  return undefined;
}

/** Evidence words, captions and link addresses (the address gets the language check only, as on the server). */
function useEvidenceHint(limits: TextLimits) {
  const { t } = useI18n();
  return (text: string, kind: EvidenceHintKind) => {
    if (kind !== 'url') return textHint(t, text, kind, limits);
    let words = text;
    try {
      words = decodeURIComponent(text);
    } catch {
      // keep the address as typed
    }
    return findRiskyWord(words) ? t('textCheck.BLOCKED_WORD') : undefined;
  };
}

/** Run a student action and refresh the page (a revoked link then shows the "no longer works" page). */
function useStudentRun() {
  const run = useRun();
  const qc = useQueryClient();
  return async <T,>(fn: () => Promise<T>, success?: string) => {
    const r = await run(fn, success ? { success } : {});
    void qc.invalidateQueries({ queryKey: STUDENT_PAGE_KEY });
    return r;
  };
}

function ConfidencePicker({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="cc-field cc-confidence-picker">
      <legend className="cc-field__label">{t('student.confidence')}</legend>
      <div className="cc-row">
        {CONFIDENCE_LEVELS.map((n) => (
          <Button key={n} variant={value === n ? 'primary' : 'secondary'} aria-pressed={value === n} aria-label={t('goals.confidenceValue', { n })} onPress={() => onChange(n)}>
            {String(n)}
          </Button>
        ))}
      </div>
      <p className="cc-field__hint">{t('student.confidenceHint')}</p>
    </fieldset>
  );
}

function AddGoal({ data, subjectId }: { data: StudentGoalsSection; subjectId: string }) {
  const { t, locale } = useI18n();
  const run = useStudentRun();
  const [categoryId, setCategoryId] = useState(data.categories[0]?.id ?? '');
  const presets = data.presets.filter((p) => p.categoryId === categoryId);
  const [choice, setChoice] = useState('');
  const [text, setText] = useState('');
  const [practice, setPractice] = useState('');
  const own = choice === OWN || presets.length === 0;
  const goalHint = useTextHint(text, 'goal', data.textLimits);
  const practiceHint = usePracticeHint(practice, data.textLimits);
  const valid = Boolean(categoryId) && (own ? Boolean(text.trim()) : Boolean(choice));
  const save = async () => {
    const practiceChoices = splitChoices(practice);
    const r = await run(
      () => call(G.studentCreateGoal, { subjectId, ...(own ? { categoryId, text: text.trim() } : { presetId: choice }), ...(practiceChoices.length ? { practiceChoices } : {}) }),
      t('student.toast.goalAdded'),
    );
    if (r) {
      setChoice('');
      setText('');
      setPractice('');
    }
  };
  return (
    <section className="cc-card cc-stack" aria-labelledby={`add-goal-${subjectId}`}>
      <h3 id={`add-goal-${subjectId}`} className="cc-h2">
        {t('student.addGoal')}
      </h3>
      <Select
        label={t('student.category')}
        items={data.categories.map((c) => ({ id: c.id, label: pickText(c.name, locale) }))}
        value={categoryId}
        onChange={(v) => {
          setCategoryId(v);
          setChoice('');
        }}
      />
      {presets.length ? (
        <Select
          label={t('student.chooseGoal')}
          placeholder={t('student.chooseGoalPlaceholder')}
          items={[...presets.map((p) => ({ id: p.id, label: pickText(p.text, locale) })), { id: OWN, label: t('student.writeOwn') }]}
          value={choice}
          onChange={setChoice}
        />
      ) : null}
      {own ? <TextField label={t('student.myGoalWords')} value={text} onChange={setText} maxLength={500} errorMessage={goalHint} /> : null}
      <TextField label={t('student.practice')} description={t('student.practiceHint')} value={practice} onChange={setPractice} errorMessage={practiceHint} />
      <div>
        <Button variant="primary" isDisabled={!valid} onPress={() => void save()}>
          <IconPlus />
          {t('student.addGoalButton')}
        </Button>
      </div>
    </section>
  );
}

function MyGoals({ data, canWrite, subjectId }: { data: StudentGoalsSection; canWrite: boolean; subjectId: string }) {
  const { t } = useI18n();
  const run = useStudentRun();
  return (
    <section className="cc-stack" aria-labelledby={`my-goals-${subjectId}`}>
      <h3 id={`my-goals-${subjectId}`} className="cc-h2">
        {t('student.myGoals')}
      </h3>
      {data.goals.length === 0 ? <p className="cc-muted">{t('student.noGoals')}</p> : null}
      <ul className="cc-stack">
        {data.goals.map((g) => (
          <li key={g.id} className="cc-card cc-stack cc-goal" data-testid="student-goal">
            <GoalSummary goal={g} outcomes={data.outcomes} />
            {g.entries.filter((e) => e.authorType === 'teacher').length ? (
              <ul className="cc-stack">
                {g.entries
                  .filter((e) => e.authorType === 'teacher')
                  .map((e) => (
                    <EntryLine key={e.id} entry={e} />
                  ))}
              </ul>
            ) : null}
            {canWrite && g.authorType === 'student' ? (
              <div className="cc-row">
                {g.status === 'active' ? (
                  <Button onPress={() => void run(() => call(G.studentUpdateGoal, { goalId: g.id, status: 'achieved' }), t('student.toast.achieved'))}>
                    <IconCheck />
                    {t('student.markAchieved')}
                  </Button>
                ) : null}
                <Button variant="ghost" onPress={() => window.confirm(t('student.confirmDelete')) && void run(() => call(G.studentDeleteGoal, { goalId: g.id }), t('student.toast.deleted'))}>
                  <IconTrash />
                  {t('student.deleteGoal')}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Reflections({ data, canWrite, subjectId }: { data: StudentGoalsSection; canWrite: boolean; subjectId: string }) {
  const { t, locale } = useI18n();
  const run = useStudentRun();
  const [goalId, setGoalId] = useState('');
  const [kind, setKind] = useState<(typeof G.STUDENT_ENTRY_KINDS)[number]>('self_assessment');
  const [body, setBody] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const live = data.goals.filter((g) => g.status !== 'archived');
  const target = goalId || live[0]?.id || '';
  const bodyHint = useTextHint(body, kind === 'self_assessment' ? 'selfAssessment' : kind === 'note' ? 'note' : 'reflection', data.textLimits);
  const valid = Boolean(target) && Boolean(body.trim()) && (kind !== 'self_assessment' || confidence !== null);
  const mine = data.goals.flatMap((g) => g.entries.filter((e) => e.authorType === 'student').map((e) => ({ e, g })));
  const save = async () => {
    const r = await run(() => call(G.studentAddEntry, { goalId: target, kind, body: body.trim(), ...(kind === 'self_assessment' && confidence !== null ? { confidence } : {}) }), t('student.toast.reflectionAdded'));
    if (r) {
      setBody('');
      setConfidence(null);
    }
  };
  return (
    <section className="cc-stack" aria-labelledby={`my-reflections-${subjectId}`}>
      <h3 id={`my-reflections-${subjectId}`} className="cc-h2">
        {t('student.myReflections')}
      </h3>
      {canWrite && live.length ? (
        <div className="cc-card cc-stack" data-testid="reflection-form">
          <Select label={t('student.whichGoal')} items={live.map((g: Goal) => ({ id: g.id, label: goalText(g, locale) }))} value={target} onChange={setGoalId} />
          <Select
            label={t('student.reflectionKind')}
            items={G.STUDENT_ENTRY_KINDS.map((k) => ({ id: k, label: t(`goals.entry.${k}` as MessageKey) }))}
            value={kind}
            onChange={(v) => setKind(v as typeof kind)}
          />
          <TextArea label={t('student.reflectionWords')} rows={3} value={body} onChange={setBody} maxLength={2000} errorMessage={bodyHint} />
          {kind === 'self_assessment' ? <ConfidencePicker value={confidence} onChange={setConfidence} /> : null}
          <div>
            <Button variant="primary" isDisabled={!valid} onPress={() => void save()}>
              <IconPlus />
              {t('student.addReflection')}
            </Button>
          </div>
        </div>
      ) : null}
      {canWrite && !live.length ? <p className="cc-muted">{t('student.reflectNeedsGoal')}</p> : null}
      {mine.length === 0 ? <p className="cc-muted">{t('student.noReflections')}</p> : null}
      <ul className="cc-stack">
        {mine.map(({ e, g }) => (
          <EntryLine
            key={e.id}
            entry={e}
            actions={
              <div className="cc-row">
                <span className="cc-muted">{t('student.forGoal', { goal: goalText(g, locale) })}</span>
                {canWrite ? (
                  <Button size="small" variant="ghost" onPress={() => window.confirm(t('student.confirmDelete')) && void run(() => call(G.studentDeleteEntry, { entryId: e.id }), t('student.toast.deleted'))}>
                    <IconTrash />
                    {t('student.delete')}
                  </Button>
                ) : null}
              </div>
            }
          />
        ))}
      </ul>
    </section>
  );
}

export function GoalsSection({ data, subjectId, media }: { data: StudentGoalsSection; subjectId: string; media: Media }) {
  const { t, locale } = useI18n();
  const run = useStudentRun();
  const evidenceHint = useEvidenceHint(data.textLimits);
  return (
    <div className="cc-stack" data-testid="student-goals">
      {!data.canWrite ? <p className="cc-card cc-muted">{t('student.readOnly')}</p> : null}
      <MyGoals data={data} canWrite={data.canWrite} subjectId={subjectId} />
      {data.canWrite ? <AddGoal data={data} subjectId={subjectId} /> : null}
      <Reflections data={data} canWrite={data.canWrite} subjectId={subjectId} />
      <section className="cc-stack" aria-labelledby={`my-evidence-${subjectId}`}>
        <h3 id={`my-evidence-${subjectId}`} className="cc-h2">
          {t('student.myEvidence')}
        </h3>
        {data.canWrite ? (
          <EvidenceAdder
            idPrefix={`evidence-${subjectId}`}
            goals={data.goals.map((g) => ({ id: g.id, label: goalText(g, locale) }))}
            media={media}
            upload={(kind, file, name) => upload(G.studentUploadFile, { kind }, file, name)}
            add={(input) => call(G.studentAddEvidence, { subjectId, ...input })}
            run={(fn, success) => run(fn, success)}
            hint={evidenceHint}
          />
        ) : null}
        {data.evidence.length === 0 ? <p className="cc-muted">{t('student.noEvidence')}</p> : null}
        <ul className="cc-stack">
          {data.evidence.map((e) => (
            <EvidenceView
              key={e.id}
              item={e}
              fileUrl={G.studentFileUrl}
              actions={
                data.canWrite && e.authorType === 'student' ? (
                  <div>
                    <Button size="small" variant="ghost" onPress={() => window.confirm(t('student.confirmDelete')) && void run(() => call(G.studentDeleteEvidence, { evidenceId: e.id }), t('student.toast.deleted'))}>
                      <IconTrash />
                      {t('student.delete')}
                    </Button>
                  </div>
                ) : null
              }
            />
          ))}
        </ul>
      </section>
      <section className="cc-stack" aria-labelledby={`feedback-${subjectId}`}>
        <h3 id={`feedback-${subjectId}`} className="cc-h2">
          {t('student.teacherFeedback')}
        </h3>
        {data.feedback.length === 0 ? <p className="cc-muted">{t('student.noFeedback')}</p> : null}
        <ul className="cc-stack" data-testid="student-feedback">
          {data.feedback.map((f) => (
            <FeedbackLine key={f.id} item={f} />
          ))}
        </ul>
      </section>
    </div>
  );
}
