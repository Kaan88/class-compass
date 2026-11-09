/**
 * "How is it going?" in short steps (S14d, D-151; GOL-3): 1 which goal (cards; the goal goes into the
 * page address) → 2 a face from 1 to 5 (a self-assessment), or "Something I learned" (a reflection) or
 * "Note to myself" (a note), so every kind of entry stays reachable → 3 a few words, with sentence
 * starters, and Save. Text hints show when Save is pressed.
 */
import { useEffect, useRef, useState } from 'react';
import * as G from '../../../shared/contracts/goals.ts';
import type { StudentGoalsSection } from '../../../shared/contracts/goals.ts';
import type { MessageKey } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { CONFIDENCE_LEVELS, goalText } from '../../modules/goals/shared.tsx';
import { Button } from '../../ui/Button.tsx';
import { TextArea } from '../../ui/Fields.tsx';
import { IconBook, IconCheck, IconFace, IconNote, IconPlus, IconTarget } from '../../ui/icons.tsx';
import { Choice, focusBox, StepCount, startersOf, useSaveCheck, useStudentRun } from '../common.tsx';
import { SentenceStarters } from '../SentenceStarters.tsx';
import type { ScreenProps } from '../sections.tsx';

type Pick = { kind: 'self_assessment'; confidence: number } | { kind: 'reflection' | 'note' };
const STARTER_KIND = { self_assessment: 'selfAssessment', reflection: 'reflection', note: 'note' } as const;
const TEXT_KIND = { self_assessment: 'selfAssessment', reflection: 'reflection', note: 'note' } as const;
export const faceKey = (n: number) => `student.how.face.${n}` as MessageKey;

export function HowIsItGoing({ data, subjectId, nav, go, finish }: ScreenProps<StudentGoalsSection>) {
  const { t, locale } = useI18n();
  const run = useStudentRun();
  const check = useSaveCheck(data);
  const [pick, setPick] = useState<Pick | null>(null);
  const [body, setBody] = useState('');
  const [hint, setHint] = useState<string>();
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const live = data.goals.filter((g) => g.status !== 'archived');
  const goal = live.find((g) => g.id === nav.goal) ?? null;
  const step = nav.step >= 2 && !goal ? 1 : nav.step >= 3 && !pick ? 2 : Math.min(nav.step, 3);
  const toStep = (n: number, goalId: string | null = goal?.id ?? null, replace = false) => go({ screen: 'howIsItGoing', subject: subjectId, goal: n > 1 ? goalId : null, step: n }, { replace });
  useEffect(() => {
    if (step !== nav.step) toStep(step, goal?.id ?? null, true);
  });

  if (!data.canWrite) return <p className="cc-card cc-muted">{t('student.readOnly')}</p>;
  if (!live.length)
    return (
      <div className="cc-card cc-stack">
        <p>{t('student.how.needGoal')}</p>
        <div>
          <Button variant="primary" size="big" onPress={() => go({ screen: 'newGoal', subject: subjectId })}>
            <IconPlus />
            {t('student.tile.newGoal')}
          </Button>
        </div>
      </div>
    );

  if (step === 1)
    return (
      <section className="cc-card cc-stack" aria-labelledby="how-q" data-step="1">
        <StepCount step={1} total={3} />
        <h2 id="how-q" className="cc-h2">
          {t('student.whichGoal')}
        </h2>
        <div className="cc-student-choices cc-student-choices--list">
          {live.map((g) => (
            <Choice key={g.id} icon={<IconTarget />} label={goalText(g, locale)} selected={goal?.id === g.id} onPress={() => toStep(2, g.id)} />
          ))}
        </div>
      </section>
    );

  const choose = (p: Pick) => {
    setPick(p);
    setHint(undefined);
    toStep(3);
  };
  if (step === 2)
    return (
      <section className="cc-card cc-stack" aria-labelledby="how-q" data-step="2">
        <StepCount step={2} total={3} />
        <p className="cc-goal__text">{goalText(goal!, locale)}</p>
        <h2 id="how-q" className="cc-h2">
          {t('student.how.what')}
        </h2>
        <div className="cc-student-faces" role="group" aria-label={t('student.how.faces')}>
          {CONFIDENCE_LEVELS.map((n) => (
            <Choice
              key={n}
              icon={<IconFace level={n} />}
              label={t(faceKey(n))}
              selected={pick?.kind === 'self_assessment' && pick.confidence === n}
              onPress={() => choose({ kind: 'self_assessment', confidence: n })}
              testId={`how-face-${n}`}
            />
          ))}
        </div>
        <p className="cc-muted">{t('student.how.or')}</p>
        <div className="cc-student-choices">
          <Choice icon={<IconBook />} label={t('student.how.learned')} selected={pick?.kind === 'reflection'} onPress={() => choose({ kind: 'reflection' })} />
          <Choice icon={<IconNote />} label={t('student.how.note')} selected={pick?.kind === 'note'} onPress={() => choose({ kind: 'note' })} />
        </div>
      </section>
    );

  const p = pick!;
  const save = async () => {
    const r = check(body.trim(), TEXT_KIND[p.kind]);
    setHint(r.hint);
    if (!r.send) return focusBox(box.current);
    setBusy(true);
    try {
      const ok = await run(() => call(G.studentAddEntry, { goalId: goal!.id, kind: p.kind, body: body.trim(), ...(p.kind === 'self_assessment' ? { confidence: p.confidence } : {}) }), t('student.toast.reflectionAdded'));
      if (ok) finish({ screen: 'goals', subject: subjectId });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="cc-card cc-stack" aria-labelledby="how-q" data-step="3">
      <StepCount step={3} total={3} />
      <p className="cc-goal__text">{goalText(goal!, locale)}</p>
      <p className="cc-row cc-student-picked">
        {p.kind === 'self_assessment' ? <IconFace level={p.confidence as 1 | 2 | 3 | 4 | 5} /> : p.kind === 'reflection' ? <IconBook /> : <IconNote />}
        <strong>{p.kind === 'self_assessment' ? t(faceKey(p.confidence)) : p.kind === 'reflection' ? t('student.how.learned') : t('student.how.note')}</strong>
      </p>
      <h2 id="how-q" className="cc-h2">
        {t(p.kind === 'self_assessment' ? 'student.how.why' : p.kind === 'reflection' ? 'student.how.whatLearned' : 'student.how.whatNote')}
      </h2>
      <SentenceStarters starters={startersOf(data, STARTER_KIND[p.kind], locale, goal!.category.id)} value={body} onChange={(v) => (setBody(v), setHint(undefined))} target={box} />
      <TextArea label={t('student.reflectionWords')} rows={3} value={body} onChange={(v) => (setBody(v), setHint(undefined))} maxLength={2000} errorMessage={hint} inputRef={box} />
      <div>
        <Button variant="primary" size="big" isDisabled={!body.trim() || busy} onPress={() => void save()}>
          <IconCheck />
          {t('student.how.save')}
        </Button>
      </div>
    </section>
  );
}
