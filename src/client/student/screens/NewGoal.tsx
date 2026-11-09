/**
 * "New goal" in short steps (S14d, D-151; GOL-1, GOL-2): 1 what to get better at (category tiles) →
 * 2 a ready goal, or my own words with sentence starters → 3 how I will practise (practice idea
 * chips, my own ideas) and Save. The step is in the page address; a step whose earlier choice was lost
 * (a reload) starts again from the first step. Text hints show when Next or Save is pressed.
 */
import { useEffect, useRef, useState } from 'react';
import * as G from '../../../shared/contracts/goals.ts';
import type { StudentGoalsSection } from '../../../shared/contracts/goals.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { TextArea } from '../../ui/Fields.tsx';
import { IconCheck, IconNext, IconPencil, IconPlus, IconX } from '../../ui/icons.tsx';
import { TopicPicto } from '../../ui/pictos.tsx';
import { Choice, focusBox, StepCount, startersOf, useSaveCheck, useStudentRun } from '../common.tsx';
import { SentenceStarters } from '../SentenceStarters.tsx';
import type { ScreenProps } from '../sections.tsx';

const OWN = '__own__';

export function NewGoal({ data, subjectId, nav, go, finish }: ScreenProps<StudentGoalsSection>) {
  const { t, locale } = useI18n();
  const run = useStudentRun();
  const check = useSaveCheck(data);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [textHint, setTextHint] = useState<string>();
  const [idea, setIdea] = useState('');
  const [ideaHint, setIdeaHint] = useState<string>();
  const [ideas, setIdeas] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const goalBox = useRef<HTMLTextAreaElement>(null);
  const ideaBox = useRef<HTMLTextAreaElement>(null);
  const presets = data.presets.filter((p) => p.categoryId === categoryId);
  // A step needs the choices before it; after a reload they are gone, so start again.
  const step = nav.step >= 2 && !categoryId ? 1 : nav.step >= 3 && !choice ? 2 : Math.min(nav.step, 3);
  const toStep = (n: number, replace = false) => go({ screen: 'newGoal', subject: subjectId, step: n }, { replace });
  useEffect(() => {
    if (step !== nav.step) toStep(step, true);
  });

  if (!data.canWrite) return <p className="cc-card cc-muted">{t('student.readOnly')}</p>;
  if (!data.categories.length) return <p className="cc-card cc-muted">{t('student.newGoal.noCategories')}</p>;

  if (step === 1)
    return (
      <section className="cc-card cc-stack" aria-labelledby="new-goal-q" data-step="1">
        <StepCount step={1} total={3} />
        <h2 id="new-goal-q" className="cc-h2">
          {t('student.category')}
        </h2>
        <div className="cc-student-choices">
          {data.categories.map((c) => (
            <Choice
              key={c.id}
              icon={<TopicPicto icon={c.icon ?? 'book'} size="2rem" />}
              label={pickText(c.name, locale)}
              selected={categoryId === c.id}
              onPress={() => {
                if (c.id !== categoryId) setChoice(null);
                setCategoryId(c.id);
                toStep(2);
              }}
            />
          ))}
        </div>
      </section>
    );

  const own = choice === OWN || (step === 2 && presets.length === 0);
  const goalText = () => {
    const r = check(text.trim(), 'goal');
    setTextHint(r.hint);
    if (!r.send) focusBox(goalBox.current);
    return r.send;
  };
  if (step === 2)
    return (
      <section className="cc-card cc-stack" aria-labelledby="new-goal-q" data-step="2">
        <StepCount step={2} total={3} />
        <h2 id="new-goal-q" className="cc-h2">
          {t('student.newGoal.pick')}
        </h2>
        {presets.length ? (
          <div className="cc-student-choices cc-student-choices--list">
            {presets.map((p) => (
              <Choice
                key={p.id}
                label={pickText(p.text, locale)}
                selected={choice === p.id}
                onPress={() => {
                  setChoice(p.id);
                  toStep(3);
                }}
              />
            ))}
            <Choice icon={<IconPencil />} label={t('student.newGoal.own')} selected={choice === OWN} onPress={() => setChoice(OWN)} />
          </div>
        ) : null}
        {own ? (
          <div className="cc-stack" data-testid="new-goal-own">
            <SentenceStarters starters={startersOf(data, 'goal', locale, categoryId)} value={text} onChange={(v) => (setText(v), setTextHint(undefined))} target={goalBox} />
            <TextArea label={t('student.myGoalWords')} rows={3} value={text} onChange={(v) => (setText(v), setTextHint(undefined))} maxLength={500} errorMessage={textHint} inputRef={goalBox} />
            <div>
              <Button
                variant="primary"
                size="big"
                isDisabled={!text.trim()}
                onPress={() => {
                  if (!goalText()) return;
                  setChoice(OWN);
                  toStep(3);
                }}
              >
                {t('student.next')}
                <IconNext />
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    );

  const addIdea = () => {
    const words = idea.trim();
    if (!words) return;
    const r = check(words, 'practiceChoice');
    setIdeaHint(r.hint);
    if (!r.send) return focusBox(ideaBox.current);
    setIdeas((xs) => (xs.includes(words) ? xs : [...xs, words].slice(0, G.MAX_PRACTICE_CHOICES)));
    setIdea('');
  };
  const save = async () => {
    if (choice === OWN && !goalText()) {
      toStep(2);
      return;
    }
    // An idea still in the box goes with the goal (the child may not press "Add idea" first).
    let list = ideas;
    const typed = idea.trim();
    if (typed) {
      const r = check(typed, 'practiceChoice');
      setIdeaHint(r.hint);
      if (!r.send) return focusBox(ideaBox.current);
      if (!list.includes(typed)) list = [...list, typed].slice(0, G.MAX_PRACTICE_CHOICES);
    }
    setBusy(true);
    try {
      const r = await run(
        () => call(G.studentCreateGoal, { subjectId, ...(choice === OWN ? { categoryId: categoryId!, text: text.trim() } : { presetId: choice! }), ...(list.length ? { practiceChoices: list } : {}) }),
        t('student.toast.goalAdded'),
      );
      if (r) finish({ screen: 'goals', subject: subjectId });
    } finally {
      setBusy(false);
    }
  };
  const chosen = choice === OWN ? text.trim() : pickText(data.presets.find((p) => p.id === choice)?.text, locale);
  return (
    <section className="cc-card cc-stack" aria-labelledby="new-goal-q" data-step="3">
      <StepCount step={3} total={3} />
      <p className="cc-goal__text">{chosen}</p>
      <h2 id="new-goal-q" className="cc-h2">
        {t('student.newGoal.practice')}
      </h2>
      <p className="cc-muted">{t('student.newGoal.practiceHint')}</p>
      {ideas.length ? (
        <ul className="cc-row cc-student-ideas" aria-label={t('student.newGoal.ideas')}>
          {ideas.map((x) => (
            <li key={x} className="cc-chip cc-student-idea">
              <span>{x}</span>
              <Button size="small" variant="ghost" aria-label={t('student.newGoal.removeIdea', { idea: x })} onPress={() => setIdeas((xs) => xs.filter((y) => y !== x))}>
                <IconX />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {ideas.length < G.MAX_PRACTICE_CHOICES ? (
        <div className="cc-stack">
          <SentenceStarters starters={startersOf(data, 'practice', locale, categoryId)} value={idea} onChange={(v) => (setIdea(v), setIdeaHint(undefined))} target={ideaBox} />
          <TextArea label={t('student.newGoal.idea')} rows={2} value={idea} onChange={(v) => (setIdea(v), setIdeaHint(undefined))} maxLength={120} errorMessage={ideaHint} inputRef={ideaBox} />
          <div>
            <Button isDisabled={!idea.trim()} onPress={addIdea}>
              <IconPlus />
              {t('student.newGoal.addIdea')}
            </Button>
          </div>
        </div>
      ) : null}
      <div>
        <Button variant="primary" size="big" isDisabled={busy} onPress={() => void save()}>
          <IconCheck />
          {t('student.newGoal.save')}
        </Button>
      </div>
    </section>
  );
}
