/**
 * Lesson topics on the classroom device (S13a, D-101): the "Today's topic" step of Start Lesson
 * (pre-filled from the weekly plan; the teacher confirms or changes it, up to three topics or none)
 * and "Today's focus" above the student grid with its icon, changeable during the lesson (hidden when
 * no topic is set: only a small "Choose a topic" action stays; the routine's "Learning goal" stage
 * shows the topics too)
 * ('lesson.setTopics', an outbox command naming the lesson). Topics are the subject's skill
 * categories (Reading, Speaking, Phonics … and the teacher's own).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as L from '../../../shared/contracts/lessons.ts';
import type { LessonState, LessonTopic } from '../../../shared/contracts/lessons.ts';
import { MAX_LESSON_TOPICS } from '../../../shared/lessons.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { IconBook, IconCheck } from '../../ui/icons.tsx';
import { TopicPicto } from '../../ui/pictos.tsx';
import { startStep, type ClassroomContext, type DashboardSlot, type StartStepProps } from '../types.ts';
import { patchLesson, sendLessonCommand } from './lessonClient.ts';

export const topicsKey = (contextId: string) => ['classroom', 'topics', contextId] as const;
export const useClassroomTopics = (contextId: string | null) =>
  useQuery({ queryKey: topicsKey(contextId ?? 'none'), queryFn: () => call(L.classroomTopics, { contextId: contextId! }), enabled: Boolean(contextId), staleTime: 60_000 });

/** Big toggle buttons, one per topic (icon + name), at most MAX_LESSON_TOPICS chosen. */
export function TopicChooser({ topics, value, onChange }: { topics: readonly LessonTopic[]; value: readonly string[]; onChange: (ids: string[]) => void }) {
  const { t, locale } = useI18n();
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (value.length < MAX_LESSON_TOPICS) onChange([...value, id]);
  };
  return (
    <div className="cc-stack">
      <ul className="cc-topic-choices" aria-label={t('lesson.topic.choices')}>
        {topics.map((tp) => {
          const on = value.includes(tp.id);
          return (
            <li key={tp.id}>
              <Button size="big" className="cc-topic-choice" aria-pressed={on} isDisabled={!on && value.length >= MAX_LESSON_TOPICS} onPress={() => toggle(tp.id)}>
                <TopicPicto icon={tp.icon} />
                <span>{pickText(tp.name, locale)}</span>
                {on ? <IconCheck /> : null}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="cc-muted">{t('lesson.topic.max', { count: MAX_LESSON_TOPICS })}</p>
    </div>
  );
}

/** Draft value: null = not touched (the weekly plan's topics are used). */
type TopicDraft = string[] | null;

function TopicStartStep({ context, value, onChange }: StartStepProps<TopicDraft>) {
  const { t } = useI18n();
  const q = useClassroomTopics(context.id);
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  const chosen = value ?? q.data.plannedToday;
  return (
    <div className="cc-stack" data-testid="topic-step">
      <p className="cc-muted">{q.data.plannedToday.length ? t('lesson.topic.fromPlan') : t('lesson.topic.noPlan')}</p>
      <TopicChooser topics={q.data.topics} value={chosen} onChange={(ids) => onChange(() => ids)} />
    </div>
  );
}

function useTopicContribution(context: ClassroomContext, value: TopicDraft, enabled: boolean) {
  const q = useClassroomTopics(enabled ? context.id : null);
  if (!enabled || value === null) return { input: {}, ready: true };
  // Only ids the server still offers (a topic archived meanwhile is dropped, never sent).
  const live = new Set((q.data?.topics ?? []).map((x) => x.id));
  return { input: { topicIds: value.filter((id) => live.has(id)) }, ready: Boolean(q.data) };
}

export const topicStartStep = startStep<TopicDraft>({
  key: 'topics',
  module: null,
  order: 80,
  title: 'lesson.step.topics',
  initial: () => null,
  Component: TopicStartStep,
  useContribution: useTopicContribution,
});

function TodaysFocus({ context, lesson }: { context: ClassroomContext; lesson: LessonState }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const q = useClassroomTopics(open ? context.id : null);
  const [draft, setDraft] = useState<string[]>([]);
  const openDialog = () => {
    setDraft(lesson.topics.map((x) => x.id));
    setOpen(true);
  };
  const save = () => {
    const byId = new Map((q.data?.topics ?? []).map((x) => [x.id, x]));
    const next = draft.map((id) => byId.get(id)).filter((x): x is LessonTopic => Boolean(x));
    patchLesson(lesson.contextId, (l) => ({ ...l, topics: next }));
    void sendLessonCommand('lesson.setTopics', { contextId: lesson.contextId, lessonId: lesson.id, topicIds: next.map((x) => x.id) });
    setOpen(false);
  };
  const dialog = (
    <Modal isOpen={open} onOpenChange={setOpen} title={t('lesson.topic.changeTitle')} size="wide">
      {q.data ? <TopicChooser topics={q.data.topics} value={draft} onChange={setDraft} /> : <p className="cc-muted">{t('common.loading')}</p>}
      <DialogActions>
        <Button onPress={() => setOpen(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" onPress={save} isDisabled={!q.data}>
          <IconCheck />
          {t('lesson.topic.save')}
        </Button>
      </DialogActions>
    </Modal>
  );
  // No topic: the focus strip is hidden; only a small, quiet "Choose a topic" action stays (S13a 7).
  if (!lesson.topics.length)
    return (
      <div className="cc-focus-empty" data-testid="todays-focus-empty">
        <Button size="small" variant="ghost" onPress={openDialog}>
          {t('lesson.topic.choose')}
        </Button>
        {dialog}
      </div>
    );
  return (
    <section className="cc-focus" aria-labelledby="cc-focus-title" data-testid="todays-focus">
      <h2 id="cc-focus-title" className="cc-focus__title">
        {t('lesson.topic.todaysFocus')}
      </h2>
      <FocusTopics topics={lesson.topics} />
      <Button size="small" className="cc-push-right" onPress={openDialog}>
        {t('lesson.topic.change')}
      </Button>
      {dialog}
    </section>
  );
}

/** The lesson's topics as icon + name (the focus strip and the routine's "Learning goal" stage). */
export function FocusTopics({ topics, size = '1.8em' }: { topics: readonly LessonTopic[]; size?: string }) {
  const { locale } = useI18n();
  return (
    <ul className="cc-focus__list">
      {topics.map((tp) => (
        <li key={tp.id} className="cc-focus__topic">
          <TopicPicto icon={tp.icon} size={size} />
          <span>{pickText(tp.name, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

export const focusDashboardSlot: DashboardSlot = { key: 'focus', module: null, order: 5, dock: { Icon: IconBook, label: 'lesson.topic.todaysFocus' }, Component: TodaysFocus };
