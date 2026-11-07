/**
 * Daily Assistant on the classroom device (DSH-3, LES-1, LES-3, AST-1/2/6):
 * - dashboard panel: today's assistant with avatar, name and responsibilities, and this week's
 *   helpers (the classroom-safe weekly schedule, D-066);
 * - Start Lesson step: who helps today;
 * - End Lesson step (optional): thank today's assistant.
 * Plan editing, swaps, overrides and history live in the teacher area (/teacher/assistant).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as A from '../../../shared/contracts/assistant.ts';
import type { AssistantToday } from '../../../shared/contracts/assistant.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { formatDate, pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { IconCalendar, IconCheck } from '../../ui/icons.tsx';
import { Mascot } from '../../ui/Mascot.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { useLessonState } from '../lessons/lessonClient.ts';
import { endStepUi, type ClassroomContext, type DashboardSlot, type StartStep } from '../types.ts';

/** A local calendar date ('YYYY-MM-DD') as a weekday + day label. */
export const dayLabel = (date: string, locale: 'en' | 'tr', opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  formatDate(Date.parse(`${date}T12:00:00Z`), locale, 'UTC', opts);

function TodayCard({ today }: { today: AssistantToday }) {
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
      {today.responsibilities.length ? (
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

function AssistantSlot({ context }: { context: ClassroomContext; lesson: LessonState }) {
  const { t } = useI18n();
  const today = useLessonState(context.id).data?.data.assistant ?? null;
  const [weekOpen, setWeekOpen] = useState(false);
  if (!today) return null;
  return (
    <section className="cc-card cc-stack cc-assistant" aria-labelledby="cc-assistant-title" data-testid="assistant-panel">
      <div className="cc-row">
        <h2 id="cc-assistant-title" className="cc-h2">
          {t('assistant.title')}
        </h2>
        <Button size="small" className="cc-push-right" onPress={() => setWeekOpen(true)}>
          <IconCalendar />
          {t('assistant.thisWeek')}
        </Button>
      </div>
      <TodayCard today={today} />
      <WeekDialog context={context} isOpen={weekOpen} onOpenChange={setWeekOpen} />
    </section>
  );
}

export const assistantDashboardSlot: DashboardSlot = { key: 'assistant', module: 'assistant', order: 20, Component: AssistantSlot };

/** Start Lesson step (LES-1): show today's assistant. */
function AssistantStartStep({ context }: { context: ClassroomContext }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['classroom', 'assistant', 'today', context.id], queryFn: () => call(A.todayAssistant, { contextId: context.id }) });
  return (
    <div className="cc-stack">
      {q.data ? <TodayCard today={q.data} /> : <p className="cc-muted">{t('common.loading')}</p>}
      <p className="cc-muted">{t('assistant.absentHint')}</p>
      <p className="cc-muted">{t('assistant.absentRestoreHint')}</p>
    </div>
  );
}

export const assistantStartStep: StartStep = { key: 'assistant', module: 'assistant', order: 10, title: 'assistant.startTitle', Component: AssistantStartStep };

/** End Lesson step (optional): thank today's assistant. */
type ThanksValue = { thanked: boolean };
function AssistantThanksStep({ lesson, value, onChange }: { lesson: LessonState; value: ThanksValue; onChange: (v: ThanksValue) => void }) {
  const { t } = useI18n();
  const today = useLessonState(lesson.contextId).data?.data.assistant ?? null;
  if (!today?.assistant) return <p className="cc-muted">{t('assistant.nobody')}</p>;
  if (today.thanked) return <p>{t('assistant.alreadyThanked', { name: today.assistant.fullName })}</p>;
  return (
    <div className="cc-row">
      <Avatar name={today.assistant.fullName} id={today.assistant.id} hue={today.assistant.avatarHue} initials={today.assistant.initials} />
      <Button size="big" aria-pressed={value.thanked} onPress={() => onChange({ thanked: !value.thanked })}>
        {value.thanked ? <IconCheck /> : <Mascot size={36} />}
        {t('assistant.thank', { name: today.assistant.fullName })}
      </Button>
      {value.thanked ? <span className="cc-muted">{t('assistant.thankSaved')}</span> : null}
    </div>
  );
}

export const assistantEndStepUi = endStepUi<ThanksValue>({ key: 'assistantThanks', title: 'assistant.thanksTitle', initial: () => ({ thanked: false }), Component: AssistantThanksStep });
