/**
 * Classroom (UX-1, DSH-1..8, LES-1..4). Entering it engages classroom mode and the PIN lock on this
 * device (PIN-6). Only classroom-safe data is loaded here. The class switcher picks the class+subject
 * (with a "lesson in progress" mark); the banner always names the class and shows the live local
 * date and day in the class timezone. Each context shows its running lesson (resumed from the
 * server after a refresh, reopen or class switch — never a new one, LES-2), the Start Lesson flow,
 * the End Lesson flow or the summary of the lesson just ended.
 *
 * S13a: the screen is shown in the class's language (D-099: main language, or the second one when it
 * is on and picked on this device), with a top bar naming the class on the left, a quote-of-the-day
 * slot in the centre and the date/time + a weather slot on the right (S13b fills the slots; empty
 * slots are not rendered). The Compact / Normal / Large size control of D-103 was removed in S27c
 * (D-195): the board sizes the student cards itself (D-177).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LessonSummary } from '../../shared/contracts/lessons.ts';
import * as School from '../../shared/contracts/school.ts';
import { DEFAULT_THEME } from '../../shared/themes.ts';
import { formatDate, pickText, type MessageKey } from '../../shared/i18n/index.ts';
import { call } from '../lib/api.ts';
import { useClassLocale } from '../lib/classroomPrefs.ts';
import { setDisplay, useDisplay } from '../lib/display.ts';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import { useOutboxStatus } from '../lib/outbox-client.ts';
import { useMe } from '../lib/session.ts';
import { LessonBoard } from '../modules/lessons/board/Board.tsx';
import { classLabel } from '../modules/lessons/labels.ts';
import { EndLessonFlow, LessonSummaryView, type EndDraft } from '../modules/lessons/EndLesson.tsx';
import { serverNow, useActiveLessons, useLessonState, useServerOffset } from '../modules/lessons/lessonClient.ts';
import { emptyStartDraft, StartLessonFlow, type StartDraft } from '../modules/lessons/StartLesson.tsx';
import { FullscreenButton } from '../modules/lessons/fullscreen.tsx';
import { preloadTimeUp } from '../modules/lessons/timeUp.ts';
import { BigButton, Button, buttonClass } from '../ui/Button.tsx';
import { EmptyState, OutboxAttentionTray, OutboxSaveBadge, registerCommandDescription } from '../ui/Feedback.tsx';
import { Toggle } from '../ui/Fields.tsx';
import { IconCalendar, IconLock, IconPlay } from '../ui/icons.tsx';
import { ClassSwitcher } from '../ui/Layout.tsx';
import { ClassroomTopBar } from '../ui/ClassroomTopBar.tsx';

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
  'counter.tap': 'command.counter.tap',
  'counter.void': 'command.counter.void',
  'counter.resetLessonBar': 'command.counter.reset',
  'counter.undoReset': 'command.counter.undoReset',
  'secret.draw': 'command.secret.draw',
  'secret.redraw': 'command.secret.redraw',
  'secret.reveal': 'command.secret.reveal',
  'secret.recordOutcome': 'command.secret.outcome',
  'grouping.apply': 'command.grouping.apply',
  'grouping.clear': 'command.grouping.clear',
  'grouping.shuffle': 'command.grouping.shuffle',
  'grouping.restore': 'command.grouping.restore',
  'grouping.move': 'command.grouping.move',
  'grouping.saveToOption': 'command.grouping.saveToOption',
  'lesson.setTopics': 'command.lesson.setTopics',
  'lesson.setDisplay': 'command.lesson.setDisplay',
  'assistant.checkDuty': 'command.assistant.checkDuty',
  'lessonGoals.set': 'command.lessonGoals.set',
};

/**
 * Screen state per class+subject, including the drafts of the Start / End Lesson flows, so switching
 * away and back restores exactly what this class showed and nothing typed for one class can be sent
 * for another (LES-4).
 */
type Mode =
  | { kind: 'idle' }
  | { kind: 'starting'; draft: StartDraft }
  | { kind: 'ending'; lessonId: string; draft: EndDraft | null }
  | { kind: 'summary'; lessonId: string; summary: LessonSummary | null };

export const classroomContextsKey = ['classroom', 'contexts'] as const;

export function ClassroomPage() {
  const me = useMe();
  const { locale: own } = useI18n();
  const contexts = useQuery({ queryKey: classroomContextsKey, queryFn: () => call(School.myContexts, {}), enabled: Boolean(me?.hasPin) });
  const [activeId, setActiveId] = useState<string | null>(readActive);
  const list = useMemo(() => contexts.data?.contexts ?? [], [contexts.data]);
  const active = list.find((c) => c.id === activeId) ?? list[0] ?? null;
  // The classroom speaks the class's language (D-099), not the teacher's own preference.
  const [classLocale, setClassLocale] = useClassLocale(active?.classId ?? null, active);
  return (
    <I18nProvider locale={classLocale ?? own}>
      <ClassroomScreen contexts={contexts} list={list} active={active} setActiveId={setActiveId} onLocale={setClassLocale} />
    </I18nProvider>
  );
}

function ClassroomScreen({
  contexts,
  list,
  active,
  setActiveId,
  onLocale,
}: {
  contexts: { isLoading: boolean; isSuccess: boolean; data?: { timeUpClip: boolean } | undefined };
  list: School.MyContext[];
  active: School.MyContext | null;
  setActiveId: (id: string) => void;
  onLocale: (l: 'en' | 'tr') => void;
}) {
  const { t, locale } = useI18n();
  const me = useMe();
  const navigate = useNavigate();
  const display = useDisplay();
  const now = useNow();
  const qc = useQueryClient();

  const activeLessons = useActiveLessons(Boolean(me?.hasPin));
  const inProgress = useMemo(() => new Set((activeLessons.data?.lessons ?? []).map((l) => l.contextId)), [activeLessons.data]);
  const lessonQ = useLessonState(active?.id ?? null);
  const lesson = lessonQ.data?.data.lesson ?? null;
  const closure = lessonQ.data?.data.today.closure ?? null;
  // Per-class screen state, so switching away and back keeps each class where it was (LES-4).
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const mode: Mode = (active && modes[active.id]) || { kind: 'idle' };
  const setMode = (id: string, m: Mode) => setModes((all) => ({ ...all, [id]: m }));
  /** Update a flow draft of one class; ignored once that class has left the flow. */
  const updateMode = (id: string, fn: (m: Mode) => Mode) => setModes((all) => ({ ...all, [id]: fn(all[id] ?? { kind: 'idle' }) }));

  useEffect(() => {
    if (!active) return;
    const hasClip = contexts.data?.timeUpClip ?? false;
    setDisplay({ theme: active.theme, classAnimations: active.animationsEnabled, classSounds: active.soundsEnabled, soundVolume: active.soundVolume, timeUpSound: active.timeUpSound, timeUpClip: hasClip });
    preloadTimeUp(active.timeUpSound, hasClip);
  }, [active, contexts.data?.timeUpClip]);
  // The theme's scene and ambient layer are drawn only while the classroom screen shows (S17b, D-168).
  useEffect(() => {
    setDisplay({ classScreen: true });
    return () => setDisplay({ theme: DEFAULT_THEME, classAnimations: true, classSounds: true, soundVolume: 80, classScreen: false });
  }, []);

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
            <Link to="/teacher/$page" params={{ page: 'profile' }} className={buttonClass('primary', 'big')}>
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
      const contextId = active.id;
      return (
        <EndLessonFlow
          key={`${contextId}:${lesson.id}`}
          context={active}
          lesson={lesson}
          draft={mode.lessonId === lesson.id ? mode.draft : null}
          onDraft={(fn) => updateMode(contextId, (m) => (m.kind === 'ending' && m.lessonId === lesson.id ? { ...m, draft: fn(m.draft) } : m))}
          onCancel={() => setMode(active.id, { kind: 'idle' })}
          onEnded={(summary) => setMode(active.id, { kind: 'summary', lessonId: lesson.id, summary })}
        />
      );
    }
    if (lesson) return <LessonBoard key={active.id} context={active} lesson={lesson} onEnd={() => setMode(active.id, { kind: 'ending', lessonId: lesson.id, draft: null })} />;
    if (mode.kind === 'starting') {
      const contextId = active.id;
      return (
        <StartLessonFlow
          key={contextId}
          context={active}
          draft={mode.draft}
          onDraft={(fn) => updateMode(contextId, (m) => (m.kind === 'starting' ? { ...m, draft: fn(m.draft) } : m))}
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
        {closure ? (
          // A school holiday (D-186): a calm note; starting a (make-up) lesson stays possible.
          <p className="cc-closure-note" data-testid="closure-note">
            <IconCalendar />
            <span>{t('lesson.closureNote', { name: pickText(closure.name, locale) })}</span>
          </p>
        ) : null}
        <div>
          <BigButton variant="primary" onPress={() => setMode(active.id, { kind: 'starting', draft: emptyStartDraft() })}>
            <IconPlay />
            {t('lesson.start')}
          </BigButton>
        </div>
        {list.length > 1 ? <p className="cc-muted">{t('lesson.pickAnother')}</p> : null}
      </section>
    );
  };

  // Full screen while a lesson runs; Leave full screen whenever the page is in full screen, in any mode
  // (S18, D-167); hidden where the browser has none.
  const lessonRunning = Boolean(lesson && active) && mode.kind !== 'summary';
  const tools = (
    <>
      <OutboxSaveBadge />
      <FullscreenButton canEnter={lessonRunning} />
      <Button onPress={() => void navigate({ to: '/teacher' })}>
        <IconLock />
        {t('classroom.teacherArea')}
      </Button>
    </>
  );

  return (
    <div data-testid="classroom-shell" className="cc-classroom" lang={locale}>
      <ClassroomTopBar
        context={active}
        dayLabel={active ? formatDate(now, locale, active.timezone, { weekday: 'long' }) : ''}
        dateLabel={active ? formatDate(now, locale, active.timezone, { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
        timeLabel={active ? formatDate(now, locale, active.timezone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : ''}
        onLocale={onLocale}
        settings={<Toggle label={t('classroom.sounds')} isSelected={display.deviceSounds} onChange={(v) => setDisplay({ deviceSounds: v })} />}
        // Customise layout (S14b, D-148): only while the board of a running lesson is on screen.
        canCustomise={Boolean(lesson && active) && mode.kind !== 'ending' && mode.kind !== 'summary'}
        tools={tools}
      />
      <main className="cc-page cc-page--wide cc-stack cc-classroom__main">
        {contexts.isLoading ? <p>{t('common.loading')}</p> : null}
        {contexts.isSuccess && list.length === 0 ? <EmptyState title={t('classroom.noClasses.title')} body={t('classroom.noClasses.body')} /> : null}
        {active ? (
          <>
            {list.length > 1 ? <ClassSwitcher contexts={list} activeId={active.id} onSwitch={switchTo} inProgress={inProgress} /> : null}
            <OutboxAttentionTray />
            {body()}
          </>
        ) : null}
      </main>
    </div>
  );
}
