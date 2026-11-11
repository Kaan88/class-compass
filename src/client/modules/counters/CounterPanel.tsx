/**
 * Counters on the classroom dashboard (DSH-5, CNT-1..11, CRD-2, THM-5, UX-9/10/11):
 * - the main class bar of every bar counter ("Our English Time", "3 / 10 Turkish reminders", the
 *   number always visible), with a class-only + button;
 * - the student cards' weekly count, level and + button (through the student-card addon);
 * - when the bar reaches its limit: one calm overlay with the configured response (optional single
 *   mascot hop, no flashing, never naming or highlighting a student), then a quiet banner while the
 *   threshold stays reached.
 * Every tap is an outbox command applied optimistically, with an undo toast naming class and student.
 * A confirmed class reset can be undone on the card for 10 minutes, until the next tap (S22a, D-175).
 */
import { useEffect, useRef, useState } from 'react';
import type { CounterLessonState } from '../../../shared/contracts/counters.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { fillCounterText } from '../../../shared/counters.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { dismissToast, showUndoToast } from '../../lib/toast.ts';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { IconFlag, IconPlus, IconTally, IconUndo } from '../../ui/icons.tsx';
import { ThemeIllustration } from '../../ui/Mascot.tsx';
import { CounterBar } from '../../ui/Students.tsx';
import { classLabel } from '../lessons/labels.ts';
import { serverNow, useLessonState } from '../lessons/lessonClient.ts';
import type { ClassroomContext, DashboardSlot, StudentCardAddon } from '../types.ts';
import { canUndoReset, crossingKey, FRESH_CROSSING_MS, markShown, resetCounterBar, tapCounter, tapGuard, tapToastText, undoCounterReset, undoTap, wasShown } from './countersClient.ts';

type Translate = ReturnType<typeof useI18n>['t'];

let lastUndo: number | null = null;

/** Record one tap (optimistic + outbox) and offer undo. Returns false when the double-tap guard stopped it. */
function recordTap(context: ClassroomContext, lesson: LessonState, counter: CounterLessonState, student: { id: string; fullName: string } | null, t: Translate, locale: 'en' | 'tr'): boolean {
  const key = `${counter.id}:${student?.id ?? 'class'}`;
  if (!tapGuard.accept(key)) return false;
  const { crossed, sent } = tapCounter(context.id, lesson.id, counter, student?.id ?? null);
  const cls = classLabel(context, locale);
  const label = pickText(student ? counter.labels.individual : counter.labels.main, locale);
  if (lastUndo !== null) dismissToast(lastUndo);
  lastUndo = showUndoToast(
    tapToastText(t, { cls, label, studentName: student?.fullName ?? null, crossed }),
    async () => {
      tapGuard.forget(key);
      await undoTap(context.id, lesson.id, counter.id, student?.id ?? null, sent);
    },
    { scope: 'classroom' },
  );
  return true;
}

function resetBar(context: ClassroomContext, lesson: LessonState, counter: CounterLessonState) {
  void resetCounterBar(context.id, lesson.id, counter);
}

/**
 * Undo of a class reset (S22a, D-175), on the card itself (it works in the dock view too): shown for
 * 10 minutes after the reset and only until the next tap on this counter, which the hint says.
 */
function ResetUndo({ context, lesson, counter }: { context: ClassroomContext; lesson: LessonState; counter: CounterLessonState }) {
  const { t } = useI18n();
  const [, setTick] = useState(0);
  const until = counter.resetUndo?.until ?? null;
  useEffect(() => {
    if (until === null) return;
    const h = setTimeout(() => setTick((n) => n + 1), Math.max(0, until - serverNow()) + 50);
    return () => clearTimeout(h);
  }, [until]);
  if (!canUndoReset(counter)) return null;
  return (
    <div className="cc-counter__reset-undo" role="status" data-testid="counter-reset-undo">
      <span>
        {t('counter.resetDone')} <span className="cc-muted">{t('counter.resetUndoHint')}</span>
      </span>
      <Button className="cc-push-right" onPress={() => void undoCounterReset(context.id, lesson.id, counter)}>
        <IconUndo />
        {t('counter.resetUndo')}
      </Button>
    </div>
  );
}

const responseText = (c: CounterLessonState, locale: 'en' | 'tr') => (c.activeResponse ? fillCounterText(pickText(c.activeResponse.message, locale), { count: c.barValue, limit: c.barSegments }) : '');

/** The calm response overlay: shown once per crossing on this device, only while the crossing is fresh (D-059). */
function ThresholdOverlay({ lesson, counter, onReset }: { lesson: LessonState; counter: CounterLessonState; onReset: () => void }) {
  const { t, locale } = useI18n();
  const key = counter.crossingSeq !== null ? crossingKey(lesson.id, counter.id, counter.crossingSeq) : null;
  const fresh = counter.crossedAt !== null && serverNow() - counter.crossedAt < FRESH_CROSSING_MS;
  const [openKey, setOpenKey] = useState<string | null>(null);
  useEffect(() => {
    if (key && counter.reached && fresh && !wasShown(key)) {
      markShown(key); // never replayed after a refresh or by a later poll
      setOpenKey(key);
    }
  }, [key, counter.reached, fresh]);
  const open = openKey !== null && openKey === key && counter.reached;
  const response = counter.activeResponse;
  const title = response ? pickText(response.label, locale) : t('counter.limitReached');
  return (
    <Modal isOpen={open} onOpenChange={(v) => (v ? null : setOpenKey(null))} title={title}>
      <div className="cc-threshold__overlay" data-testid="threshold-overlay">
        {response?.mascot ? <ThemeIllustration name="threshold" width={220} motion="threshold" /> : null}
        <p className="cc-threshold__message">{response ? responseText(counter, locale) : t('counter.limitReachedBody', { label: pickText(counter.labels.main, locale) })}</p>
      </div>
      <DialogActions>
        {response?.kind === 'class_reset' ? (
          <Button
            onPress={() => {
              setOpenKey(null);
              onReset();
            }}
          >
            <IconUndo />
            {t('counter.reset')}
          </Button>
        ) : null}
        <Button variant="primary" onPress={() => setOpenKey(null)}>
          {t('counter.backToLesson')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

/**
 * A class reset always asks first (UX-10, DAT-5, D-061), and can then be undone for 10 minutes until
 * the next tap (D-175). It is a classroom action: the dialog names only the class and the counter.
 */
function ConfirmReset({ isOpen, onOpenChange, context, counter, onConfirm }: { isOpen: boolean; onOpenChange: (v: boolean) => void; context: ClassroomContext; counter: CounterLessonState; onConfirm: () => void }) {
  const { t, locale } = useI18n();
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('counter.resetConfirmTitle')} role="alertdialog">
      <p>{t('counter.resetConfirmBody', { cls: classLabel(context, locale), label: pickText(counter.labels.main, locale) })}</p>
      <DialogActions>
        <Button variant="primary" onPress={() => onOpenChange(false)}>
          {t('counter.resetKeep')}
        </Button>
        <Button
          variant="danger"
          onPress={() => {
            onOpenChange(false);
            onConfirm();
          }}
        >
          <IconUndo />
          {t('counter.resetConfirm')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

function CounterCard({ context, lesson, counter }: { context: ClassroomContext; lesson: LessonState; counter: CounterLessonState }) {
  const { t, locale } = useI18n();
  const [notice, setNotice] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  const main = pickText(counter.labels.main, locale);
  const supportingTemplate = pickText(counter.labels.supporting, locale);
  const supporting = supportingTemplate ? fillCounterText(supportingTemplate, { count: counter.barValue, limit: counter.barSegments }) : `${counter.barValue} / ${counter.barSegments}`;
  const id = `cc-counter-${counter.id}`;
  return (
    <section className="cc-card cc-counter" aria-labelledby={id} data-testid="counter-bar" data-counter-id={counter.id}>
      <div className="cc-counter__head">
        <h2 id={id} className="cc-counter__title">
          {main}
        </h2>
        <span className="cc-counter__supporting" data-testid="counter-supporting">
          {supporting}
        </span>
      </div>
      <div className="cc-counter__row">
        <CounterBar value={counter.barValue} max={counter.barSegments} label={main} colour={counter.colour} reached={counter.reached} />
        <Button
          size="big"
          aria-label={t('counter.addClass', { label: main })}
          onPress={() => {
            if (!recordTap(context, lesson, counter, null, t, locale)) {
              setNotice(true);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => setNotice(false), 2500);
            }
          }}
        >
          <IconPlus />
          {t('counter.class')}
        </Button>
      </div>
      {notice ? (
        <p className="cc-muted" role="status">
          {t('counter.alreadyCounted')}
        </p>
      ) : null}
      {counter.reached ? (
        <div className="cc-threshold" data-testid="threshold-banner">
          <IconFlag />
          <span>
            {counter.activeResponse ? `${pickText(counter.activeResponse.label, locale)}: ${responseText(counter, locale)}` : t('counter.limitReachedBody', { label: main })}
          </span>
          {counter.activeResponse?.kind === 'class_reset' ? (
            <Button className="cc-push-right" onPress={() => setConfirming(true)}>
              <IconUndo />
              {t('counter.reset')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ResetUndo context={context} lesson={lesson} counter={counter} />
      <ThresholdOverlay lesson={lesson} counter={counter} onReset={() => setConfirming(true)} />
      <ConfirmReset isOpen={confirming && counter.reached} onOpenChange={setConfirming} context={context} counter={counter} onConfirm={() => resetBar(context, lesson, counter)} />
    </section>
  );
}

/** Dashboard slot: one card per counter with a class bar (scope lesson or both). */
function CountersSlot({ context, lesson }: { context: ClassroomContext; lesson: LessonState }) {
  const q = useLessonState(context.id);
  const list = (q.data?.data.counters?.counters ?? []).filter((c) => c.scope !== 'student');
  if (list.length === 0) return null;
  return (
    <div className="cc-counter-panel">
      {list.map((c) => (
        <CounterCard key={c.id} context={context} lesson={lesson} counter={c} />
      ))}
    </div>
  );
}

/** Dock badge: the first class bar as "3 / 10" (the number the class sees on the bar anyway). */
function useCountersBadge(context: ClassroomContext) {
  const q = useLessonState(context.id);
  const bar = (q.data?.data.counters?.counters ?? []).find((c) => c.scope !== 'student');
  return bar ? `${bar.barValue} / ${bar.barSegments}` : null;
}

export const countersDashboardSlot: DashboardSlot = {
  key: 'counters',
  module: 'counters',
  order: 10,
  dock: { Icon: IconTally, label: 'module.counters', useBadge: useCountersBadge },
  Component: CountersSlot,
};

// ---------------------------------------------------------------- student cards
const PICK_KEY = 'cc.cardCounter.';
const readPick = (contextId: string) => {
  try {
    return localStorage.getItem(PICK_KEY + contextId);
  } catch {
    return null;
  }
};

function useCounterCards(context: ClassroomContext, lesson: LessonState, enabled: boolean) {
  const { t, locale } = useI18n();
  const q = useLessonState(enabled ? context.id : null);
  const [picked, setPicked] = useState<string | null>(() => readPick(context.id));
  const [notices, setNotices] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((h) => clearTimeout(h));
  }, []);
  if (!enabled) return null;
  // The per-student reminder boxes on the cards are on unless the class+subject hides them (S14a, D-143).
  if (q.data?.data.counters?.showReminderBoxes === false) return null;
  const list = (q.data?.data.counters?.counters ?? []).filter((c) => c.scope !== 'lesson');
  if (list.length === 0) return null;
  const counter = list.find((c) => c.id === picked) ?? list.find((c) => c.kind === 'english_reminders') ?? list[0]!;
  const individual = pickText(counter.labels.individual, locale) || pickText(counter.labels.main, locale);
  const period = counter.resetPeriod === 'week' ? t('card.thisWeek') : counter.resetPeriod === 'term' ? t('counter.period.term') : t('counter.period.total');
  const byStudent = new Map(counter.students.map((s) => [s.studentId, s]));

  const pick = (id: string) => {
    setPicked(id);
    try {
      localStorage.setItem(PICK_KEY + context.id, id);
    } catch {
      /* per-tab only */
    }
  };
  const showNotice = (studentId: string) => {
    setNotices((n) => ({ ...n, [studentId]: Date.now() }));
    const old = timers.current.get(studentId);
    if (old) clearTimeout(old);
    timers.current.set(
      studentId,
      setTimeout(() => setNotices(({ [studentId]: _gone, ...rest }) => rest), 2500),
    );
  };

  const header =
    list.length > 1 ? (
      <div className="cc-counter-picker" role="group" aria-label={t('counter.pickerLabel')}>
        <span className="cc-muted">{t('counter.picker')}</span>
        {list.map((c) => (
          <Button key={c.id} size="small" aria-pressed={c.id === counter.id} onPress={() => pick(c.id)}>
            {pickText(c.labels.individual, locale) || pickText(c.labels.main, locale)}
          </Button>
        ))}
      </div>
    ) : null;

  return {
    header,
    cardProps: (studentId: string, fullName: string) => {
      const s = byStudent.get(studentId);
      const count = s?.count ?? 0;
      return {
        weeklyCount: count,
        level: (s?.level ?? 0) as 0 | 1 | 2 | 3,
        periodLabel: period,
        countLabel: t('counter.cardCount', { label: individual, count, period }),
        addLabel: t('counter.addFor', { label: individual, name: fullName }),
        notice: notices[studentId] ? t('counter.alreadyCounted') : null,
        onAdd: () => {
          if (!recordTap(context, lesson, counter, { id: studentId, fullName }, t, locale)) showNotice(studentId);
        },
      };
    },
  };
}

export const countersCardAddon: StudentCardAddon = { key: 'counters', module: 'counters', useAddon: useCounterCards };
