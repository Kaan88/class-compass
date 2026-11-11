/**
 * Daily Assistant on the classroom device (DSH-3, LES-1, LES-3, AST-1/2/6):
 * - dashboard panel: today's assistant with avatar, name and responsibilities, and this week's
 *   helpers (the classroom-safe weekly schedule, D-066);
 * - Start Lesson step: who helps today;
 * - End Lesson step (optional): thank today's assistant.
 * Plan editing, swaps, overrides and history live in the teacher area (/teacher/assistant).
 * S13a (D-100): during a lesson each responsibility has a big tick box ('assistant.checkDuty', an
 * outbox command recorded per day); the panel can be hidden for this lesson ('lesson.setDisplay'),
 * with a class+subject default in the teacher area.
 * S14b (D-149): the same tick boxes (`DutyTicks`) are on the Start Lesson step (sent with
 * 'lesson.start' as `steps.assistant`, applied only if that student is still today's assistant) and
 * on the End Lesson thank-you step (live 'assistant.checkDuty' commands).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as A from '../../../shared/contracts/assistant.ts';
import type { AssistantToday } from '../../../shared/contracts/assistant.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { formatDate, pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { getOutbox, type CommandInvalidation } from '../../lib/outbox-client.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { IconCalendar, IconCheck, IconChevronDown, IconChevronUp, IconStar } from '../../ui/icons.tsx';
import { PanelHead } from '../../ui/Layout.tsx';
import { Mascot } from '../../ui/Mascot.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { lessonKey, patchLesson, sendLessonCommand, useLessonState, type LessonQueryData } from '../lessons/lessonClient.ts';
import { endStepUi, startStep, type ClassroomContext, type DashboardSlot, type StartStepProps } from '../types.ts';
import { playEvent } from '../../themes/index.tsx';

/** A local calendar date ('YYYY-MM-DD') as a weekday + day label. */
export const dayLabel = (date: string, locale: 'en' | 'tr', opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  formatDate(Date.parse(`${date}T12:00:00Z`), locale, 'UTC', opts);

/** Listed in the assistant manifest: duty ticks refresh the lesson state. */
export const assistantInvalidation: CommandInvalidation = {
  prefix: 'assistant.',
  keys: (op) => (op.contextId ? [lessonKey(op.contextId)] : [['classroom', 'lesson']]),
};

async function tickDuty(lesson: LessonState, responsibilityId: string, checked: boolean) {
  if (checked) playEvent('assistantCheck');
  await queryClient.cancelQueries({ queryKey: lessonKey(lesson.contextId) });
  queryClient.setQueryData<LessonQueryData>(lessonKey(lesson.contextId), (q) => {
    const a = q?.data.assistant;
    if (!q || !a) return q;
    const next = checked ? [...new Set([...a.checked, responsibilityId])] : a.checked.filter((x) => x !== responsibilityId);
    return { etag: null, data: { ...q.data, assistant: { ...a, checked: next } } };
  });
  return getOutbox().enqueue('assistant.checkDuty', { contextId: lesson.contextId, lessonId: lesson.id, responsibilityId, checked }, { contextId: lesson.contextId, lessonId: lesson.id });
}

/** Big tick boxes, one per responsibility of today's assistant (dashboard, Start and End Lesson). */
export function DutyTicks({ today, isChecked, onToggle }: { today: AssistantToday; isChecked: (id: string) => boolean; onToggle: (id: string, checked: boolean) => void }) {
  const { t, locale } = useI18n();
  return (
    <ul className="cc-assistant__ticks" aria-label={t('assistant.responsibilities')} data-testid="assistant-duties">
      {today.responsibilities.map((r) => (
        <li key={r.id}>
          <label className="cc-tick">
            <input type="checkbox" checked={isChecked(r.id)} onChange={(e) => onToggle(r.id, e.target.checked)} />
            <span>{pickText(r.label, locale)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function TodayCard({ today, lesson, ticks }: { today: AssistantToday; lesson?: LessonState; ticks?: { isChecked: (id: string) => boolean; onToggle: (id: string, checked: boolean) => void } }) {
  const { t, locale } = useI18n();
  if (!today.schoolDay) return <p className="cc-muted">{t('assistant.noSchoolDay')}</p>;
  if (!today.assistant) return <p className="cc-muted">{t('assistant.nobody')}</p>;
  return (
    <div className="cc-stack" style={{ gap: '0.6rem' }}>
      <div className="cc-row">
        <Avatar name={today.assistant.fullName} id={today.assistant.id} hue={today.assistant.avatarHue} initials={today.assistant.initials} size="lg" />
        <span className="cc-assistant__name" data-testid="assistant-name">
          {today.assistant.fullName}
        </span>
        {today.thanked ? (
          <span className="cc-chip">
            <IconCheck />
            {t('assistant.thanked')}
          </span>
        ) : null}
      </div>
      {today.responsibilities.length && ticks ? (
        <DutyTicks today={today} isChecked={ticks.isChecked} onToggle={ticks.onToggle} />
      ) : today.responsibilities.length && lesson ? (
        <DutyTicks today={today} isChecked={(id) => today.checked.includes(id)} onToggle={(id, checked) => void tickDuty(lesson, id, checked)} />
      ) : today.responsibilities.length ? (
        <ul className="cc-assistant__jobs" aria-label={t('assistant.responsibilities')}>
          {today.responsibilities.map((r) => (
            <li key={r.id}>{pickText(r.label, locale)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function WeekDialog({ context, isOpen, onOpenChange }: { context: ClassroomContext; isOpen: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: ['classroom', 'assistant', 'week', context.id], queryFn: () => call(A.assistantWeek, { contextId: context.id }), enabled: isOpen });
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('assistant.weekTitle')}>
      {q.data && !q.data.announced ? (
        <p className="cc-muted">{t('assistant.weekNotAnnounced')}</p>
      ) : q.data ? (
        <ol className="cc-assistant__week">
          {q.data.days.map((d) => (
            <li key={d.date} className="cc-row">
              <span className="cc-assistant__day">{dayLabel(d.date, locale, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
              {d.assistant ? (
                <>
                  <Avatar name={d.assistant.fullName} id={d.assistant.id} hue={d.assistant.avatarHue} initials={d.assistant.initials} size="sm" />
                  <span>{d.assistant.fullName}</span>
                </>
              ) : (
                <span className="cc-muted">{t('assistant.notPlanned')}</span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="cc-muted">{t('common.loading')}</p>
      )}
      <DialogActions>
        <Button variant="primary" onPress={() => onOpenChange(false)}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

function setPanelVisible(lesson: LessonState, visible: boolean) {
  patchLesson(lesson.contextId, (l) => ({ ...l, display: { ...l.display, assistantVisible: visible } }));
  void sendLessonCommand('lesson.setDisplay', { contextId: lesson.contextId, lessonId: lesson.id, assistantVisible: visible });
}

function AssistantSlot({ context, lesson }: { context: ClassroomContext; lesson: LessonState }) {
  const { t } = useI18n();
  const today = useLessonState(context.id).data?.data.assistant ?? null;
  const [weekOpen, setWeekOpen] = useState(false);
  if (!today) return null;
  // Per-lesson choice first, then the class+subject default (S13a).
  const visible = lesson.display.assistantVisible ?? today.showPanel;
  if (!visible) {
    return (
      <div className="cc-row">
        <Button onPress={() => setPanelVisible(lesson, true)} data-testid="assistant-show">
          <IconChevronDown />
          {t('assistant.showPanel')}
        </Button>
      </div>
    );
  }
  return (
    <section className="cc-card cc-stack cc-assistant" aria-labelledby="cc-assistant-title" data-testid="assistant-panel">
      <PanelHead id="cc-assistant-title" title={t('assistant.title')}>
        <Button size="small" onPress={() => setWeekOpen(true)}>
          <IconCalendar />
          {t('assistant.thisWeek')}
        </Button>
        <Button size="small" onPress={() => setPanelVisible(lesson, false)} data-testid="assistant-hide">
          <IconChevronUp />
          {t('assistant.hidePanel')}
        </Button>
      </PanelHead>
      <TodayCard today={today} lesson={lesson} />
      <WeekDialog context={context} isOpen={weekOpen} onOpenChange={setWeekOpen} />
    </section>
  );
}

/** Dock badge: duties done today as "1 / 3" (nothing while there is no assistant or no duty). */
function useAssistantBadge(context: ClassroomContext) {
  const today = useLessonState(context.id).data?.data.assistant ?? null;
  if (!today?.assistant || !today.responsibilities.length) return null;
  return `${today.checked.filter((id) => today.responsibilities.some((r) => r.id === id)).length} / ${today.responsibilities.length}`;
}

export const assistantDashboardSlot: DashboardSlot = {
  key: 'assistant',
  module: 'assistant',
  order: 20,
  dock: { Icon: IconStar, label: 'assistant.title', useBadge: useAssistantBadge },
  Component: AssistantSlot,
};

const todayKey = (contextId: string) => ['classroom', 'assistant', 'today', contextId] as const;
const useToday = (contextId: string | null) => useQuery({ queryKey: todayKey(contextId ?? 'none'), queryFn: () => call(A.todayAssistant, { contextId: contextId! }), enabled: Boolean(contextId) });

/**
 * The start step's draft (S14b, D-149): the ticks the teacher changed on the start screen, for the
 * assistant the screen showed; null = nothing changed.
 */
type StartTicks = { studentId: string; ticks: Record<string, boolean> } | null;

/** Start Lesson step (LES-1): today's assistant, with the duty tick boxes (S14b). */
function AssistantStartStep({ context, value, onChange }: StartStepProps<StartTicks>) {
  const { t } = useI18n();
  const q = useToday(context.id);
  const today = q.data;
  const who = today?.assistant?.id ?? null;
  // Ticks for another assistant (the turn moved since) are not shown as this one's.
  const own = value && value.studentId === who ? value.ticks : {};
  const ticks = who
    ? {
        isChecked: (id: string) => own[id] ?? today!.checked.includes(id),
        onToggle: (id: string, checked: boolean) => {
          if (checked) playEvent('assistantCheck');
          onChange((v) => ({ studentId: who, ticks: { ...(v && v.studentId === who ? v.ticks : {}), [id]: checked } }));
        },
      }
    : undefined;
  return (
    <div className="cc-stack">
      {today ? <TodayCard today={today} ticks={ticks} /> : <p className="cc-muted">{t('common.loading')}</p>}
      {today?.assistant && today.responsibilities.length ? <p className="cc-muted">{t('assistant.startTicksHint')}</p> : null}
      <p className="cc-muted">{t('assistant.absentHint')}</p>
      <p className="cc-muted">{t('assistant.absentRestoreHint')}</p>
    </div>
  );
}

/** Only the ticks that differ from what is recorded go into 'lesson.start' (`steps.assistant`). */
function useAssistantStartContribution(context: ClassroomContext, value: StartTicks, enabled: boolean) {
  const q = useToday(enabled && value ? context.id : null);
  if (!enabled || !value) return { input: {}, ready: true };
  const recorded = new Set(q.data?.assistant?.id === value.studentId ? q.data.checked : []);
  const entries = Object.entries(value.ticks);
  const check = entries.filter(([id, on]) => on && !recorded.has(id)).map(([id]) => id);
  const uncheck = entries.filter(([id, on]) => !on && recorded.has(id)).map(([id]) => id);
  if (!check.length && !uncheck.length) return { input: {}, ready: Boolean(q.data) };
  return { input: { steps: { assistant: { studentId: value.studentId, check, uncheck } } }, ready: Boolean(q.data) };
}

export const assistantStartStep = startStep<StartTicks>({
  key: 'assistant',
  module: 'assistant',
  order: 20,
  title: 'assistant.startTitle',
  initial: () => null,
  Component: AssistantStartStep,
  useContribution: useAssistantStartContribution,
  // Today's assistant is shown on the step: loaded before Start for an offline start (D-190).
  useWarmup: (context, enabled) => void useToday(enabled ? context.id : null),
});

/** End Lesson step (optional): thank today's assistant. */
type ThanksValue = { thanked: boolean };
function AssistantThanksStep({ lesson, value, onChange }: { lesson: LessonState; value: ThanksValue; onChange: (v: ThanksValue) => void }) {
  const { t } = useI18n();
  const today = useLessonState(lesson.contextId).data?.data.assistant ?? null;
  if (!today?.assistant) return <p className="cc-muted">{t('assistant.nobody')}</p>;
  // The duties can still be ticked here (S14b, D-149): live commands, like on the board.
  const duties = today.responsibilities.length ? (
    <div className="cc-stack">
      <p className="cc-muted">{t('assistant.endTicksHint', { name: today.assistant.fullName })}</p>
      <DutyTicks today={today} isChecked={(id) => today.checked.includes(id)} onToggle={(id, checked) => void tickDuty(lesson, id, checked)} />
    </div>
  ) : null;
  if (today.thanked)
    return (
      <div className="cc-stack">
        <p>{t('assistant.alreadyThanked', { name: today.assistant.fullName })}</p>
        {duties}
      </div>
    );
  return (
    <div className="cc-stack">
      <div className="cc-row">
        <Avatar name={today.assistant.fullName} id={today.assistant.id} hue={today.assistant.avatarHue} initials={today.assistant.initials} />
        <Button size="big" aria-pressed={value.thanked} onPress={() => onChange({ thanked: !value.thanked })}>
          {value.thanked ? <IconCheck /> : <Mascot size={36} />}
          {t('assistant.thank', { name: today.assistant.fullName })}
        </Button>
        {value.thanked ? <span className="cc-muted">{t('assistant.thankSaved')}</span> : null}
      </div>
      {duties}
    </div>
  );
}

export const assistantEndStepUi = endStepUi<ThanksValue>({ key: 'assistantThanks', title: 'assistant.thanksTitle', initial: () => ({ thanked: false }), Component: AssistantThanksStep });
