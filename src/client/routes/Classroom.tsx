/**
 * Classroom (UX-1, DSH-1..8, LES-1..4). Entering it engages classroom mode and the PIN lock on this
 * device (PIN-6). Only classroom-safe data is loaded here. The class switcher picks the class+subject
 * (with a "lesson in progress" mark); the banner always names the class and shows the live local
 * date and day in the class timezone. Each context shows its running lesson (resumed from the
 * server after a refresh, reopen or class switch — never a new one, LES-2), the Start Lesson flow,
 * the End Lesson flow or the summary of the lesson just ended.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LessonSummary } from '../../shared/contracts/lessons.ts';
import * as School from '../../shared/contracts/school.ts';
import { formatDate, type MessageKey } from '../../shared/i18n/index.ts';
import { call } from '../lib/api.ts';
import { setDisplay, useDisplay } from '../lib/display.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useOutboxStatus } from '../lib/outbox-client.ts';
import { useMe } from '../lib/session.ts';
import { classLabel, LessonDashboard } from '../modules/lessons/Dashboard.tsx';
import { EndLessonFlow, LessonSummaryView } from '../modules/lessons/EndLesson.tsx';
import { serverNow, useActiveLessons, useLessonState, useServerOffset } from '../modules/lessons/lessonClient.ts';
import { StartLessonFlow } from '../modules/lessons/StartLesson.tsx';
import { BigButton, Button, buttonClass } from '../ui/Button.tsx';
import { EmptyState, OutboxAttentionTray, OutboxSaveBadge, registerCommandDescription } from '../ui/Feedback.tsx';
import { Toggle } from '../ui/Fields.tsx';
import { IconLock, IconPlay } from '../ui/icons.tsx';
import { ClassBanner, ClassSwitcher } from '../ui/Layout.tsx';

const ACTIVE_KEY = 'cc.activeContext';
const readActive = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

/** Server time, re-read every 30 s so the date/day roll over at local midnight without a reload (DSH-2). */
function useNow(intervalMs = 30_000) {
  const offset = useServerOffset();
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    setNow(serverNow());
    const h = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs, offset]);
  return now;
}

const COMMAND_TEXT: Record<string, MessageKey> = {
  'lesson.start': 'command.lesson.start',
  'lesson.setStage': 'command.lesson.setStage',
  'lesson.timer.start': 'command.lesson.timer',
  'lesson.timer.pause': 'command.lesson.timer',
  'lesson.timer.reset': 'command.lesson.timer',
  'lesson.timer.set': 'command.lesson.timer',
  'lesson.end': 'command.lesson.end',
  'attendance.setDaily': 'command.attendance',
  'attendance.setLessonException': 'command.attendance',
  'attendance.markAllPresent': 'command.attendance',
};

type Mode = { kind: 'idle' } | { kind: 'starting' } | { kind: 'ending' } | { kind: 'summary'; lessonId: string; summary: LessonSummary | null };

export const classroomContextsKey = ['classroom', 'contexts'] as const;

export function ClassroomPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const navigate = useNavigate();
  const display = useDisplay();
  const now = useNow();
  const qc = useQueryClient();
  const contexts = useQuery({ queryKey: classroomContextsKey, queryFn: () => call(School.myContexts, {}), enabled: Boolean(me?.hasPin) });
  const [activeId, setActiveId] = useState<string | null>(readActive);
  const list = useMemo(() => contexts.data?.contexts ?? [], [contexts.data]);
  const active = list.find((c) => c.id === activeId) ?? list[0] ?? null;

  const activeLessons = useActiveLessons(Boolean(me?.hasPin));
  const inProgress = useMemo(() => new Set((activeLessons.data?.lessons ?? []).map((l) => l.contextId)), [activeLessons.data]);
  const lessonQ = useLessonState(active?.id ?? null);
  const lesson = lessonQ.data?.data.lesson ?? null;
  // Per-class screen state, so switching away and back keeps each class where it was (LES-4).
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const mode: Mode = (active && modes[active.id]) || { kind: 'idle' };
  const setMode = (id: string, m: Mode) => setModes((all) => ({ ...all, [id]: m }));

  useEffect(() => {
    if (!active) return;
    setDisplay({ theme: active.theme, classAnimations: active.animationsEnabled, classSounds: active.soundsEnabled });
  }, [active]);
  useEffect(() => () => setDisplay({ theme: 'classroom', classAnimations: true, classSounds: true }), []);

  // The needs-attention tray names the class of every refused command (LES-4).
  useEffect(() => {
    const labels = new Map(list.map((c) => [c.id, classLabel(c, locale)]));
    for (const [type, key] of Object.entries(COMMAND_TEXT)) {
      registerCommandDescription(type, (op) => t('command.inClass', { cls: (op.contextId ? labels.get(op.contextId) : undefined) ?? t('command.unknownClass'), action: t(key) }));
    }
  }, [list, locale, t]);

  // Polling pauses while this device has unsent commands; read the lesson again once they are out.
  const outbox = useOutboxStatus();
  useEffect(() => {
    if (outbox.pending === 0) void qc.invalidateQueries({ queryKey: ['classroom', 'lesson'] });
  }, [outbox.pending, qc]);

  const switchTo = (id: string) => {
    setActiveId(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* per-tab only */
    }
  };

  if (!me) return null;
  if (!me.hasPin) {
    return (
      <main className="cc-page">
        <EmptyState
          title={t('classroom.needPin.title')}
          body={t('classroom.needPin.body')}
          action={
            <Link to="/teacher/profile" className={buttonClass('primary', 'big')}>
              {t('classroom.needPin.action')}
            </Link>
          }
        />
      </main>
    );
  }

  const body = () => {
    if (!active) return null;
    if (mode.kind === 'summary') {
      return <LessonSummaryView lessonId={mode.lessonId} timezone={active.timezone} initial={mode.summary} onDone={() => setMode(active.id, { kind: 'idle' })} />;
    }
    if (lessonQ.isLoading) return <p>{t('common.loading')}</p>;
    if (lesson && mode.kind === 'ending') {
      return (
        <EndLessonFlow
          context={active}
          lesson={lesson}
          onCancel={() => setMode(active.id, { kind: 'idle' })}
          onEnded={(summary) => setMode(active.id, { kind: 'summary', lessonId: lesson.id, summary })}
        />
      );
    }
    if (lesson) return <LessonDashboard context={active} lesson={lesson} onEnd={() => setMode(active.id, { kind: 'ending' })} />;
    if (mode.kind === 'starting') {
      return (
        <StartLessonFlow
          context={active}
          onCancel={() => setMode(active.id, { kind: 'idle' })}
          onStarted={async () => {
            // Show the dashboard only once the lesson is read back from the server (no flash of "no lesson").
            await qc.refetchQueries({ queryKey: ['classroom', 'lesson', active.id] });
            setMode(active.id, { kind: 'idle' });
            void qc.invalidateQueries({ queryKey: ['classroom', 'lessons'] });
          }}
        />
      );
    }
    return (
      <section className="cc-card cc-stack" data-testid="no-lesson">
        <p className="cc-h2">{t('lesson.noneRunning', { cls: classLabel(active, locale) })}</p>
        <div>
          <BigButton variant="primary" onPress={() => setMode(active.id, { kind: 'starting' })}>
            <IconPlay />
            {t('lesson.start')}
          </BigButton>
        </div>
        {list.length > 1 ? <p className="cc-muted">{t('lesson.pickAnother')}</p> : null}
      </section>
    );
  };

  return (
    <div data-testid="classroom-shell">
      <div className="cc-topbar">
        <span className="cc-topbar__title">{t('app.name')}</span>
        <OutboxSaveBadge />
        <Toggle label={t('classroom.sounds')} isSelected={display.deviceSounds} onChange={(v) => setDisplay({ deviceSounds: v })} />
        <Button onPress={() => void navigate({ to: '/teacher' })}>
          <IconLock />
          {t('classroom.teacherArea')}
        </Button>
      </div>
      <main className="cc-page cc-page--wide cc-stack">
        {contexts.isLoading ? <p>{t('common.loading')}</p> : null}
        {contexts.isSuccess && list.length === 0 ? <EmptyState title={t('classroom.noClasses.title')} body={t('classroom.noClasses.body')} /> : null}
        {active ? (
          <>
            {list.length > 1 ? <ClassSwitcher contexts={list} activeId={active.id} onSwitch={switchTo} inProgress={inProgress} /> : null}
            <ClassBanner
              className={active.className}
              subjectName={active.subjectName}
              dayLabel={formatDate(now, locale, active.timezone, { weekday: 'long' })}
              dateLabel={formatDate(now, locale, active.timezone, { day: 'numeric', month: 'long', year: 'numeric' })}
            />
            <OutboxAttentionTray />
            {body()}
          </>
        ) : null}
      </main>
    </div>
  );
}
