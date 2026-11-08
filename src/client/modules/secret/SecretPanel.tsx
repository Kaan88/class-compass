/**
 * Secret Students on the classroom device (DSH-6, SEC-1..7, LES-3):
 * - dashboard panel: "Choose secret students" → "2 secret students chosen" with the mascot and NO
 *   names. The panel only knows counts from the polled lesson state, so it looks the same after a
 *   refresh or a class switch and never reveals who was chosen (SEC-3);
 * - End Lesson step: a calm reveal (names + avatars), Goal met / Still practising per student,
 *   optional note and celebration (the celebration hop respects the motion settings, THM-5).
 * - S13b (D-110): the reveal is a short show: 3-2-1 countdown, drum roll, the cards one by one with a
 *   sound each, then a fanfare; "Celebrate" plays the full-screen celebration. Reduced motion keeps
 *   the order without movement and replaces the loud cues with one soft chime at the end; with
 *   animations off the cards appear at once with that soft chime (`revealCue`; the sound switches
 *   still decide whether it plays). Skippable.
 * Every write is an outbox command naming the lesson (UX-11, LES-4).
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import * as S from '../../../shared/contracts/secret.ts';
import type { RevealedSelection, SecretCommandPayload, SecretCommandType, SecretReveal } from '../../../shared/contracts/secret.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { getOutbox, type CommandInvalidation } from '../../lib/outbox-client.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { commandErrorText } from '../../lib/errors.ts';
import { BigButton, Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { TextField, Toggle } from '../../ui/Fields.tsx';
import { IconCheck, IconSync, IconUndo } from '../../ui/icons.tsx';
import { motionMode, useThemeSound } from '../../themes/index.tsx';
import { celebrate as startCelebration } from '../../themes/Celebration.tsx';
import { revealCue, type RevealStep } from '../../themes/sequences.ts';
import { useDisplay } from '../../lib/display.ts';
import { Mascot, ThemeIllustration } from '../../ui/Mascot.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { awaitCommand, lessonKey, useLessonState } from '../lessons/lessonClient.ts';
import { endStepUi, type ClassroomContext, type DashboardSlot } from '../types.ts';

export const secretKey = (lessonId: string) => ['classroom', 'secret', lessonId] as const;

/** Listed in the Secret Students manifest. */
export const secretInvalidation: CommandInvalidation = {
  prefix: 'secret.',
  keys: (op) => [...(op.contextId ? [lessonKey(op.contextId)] : [['classroom', 'lesson']]), ...(op.lessonId ? [secretKey(op.lessonId)] : [])],
};

export async function sendSecretCommand<T extends SecretCommandType>(type: T, payload: SecretCommandPayload<T>): Promise<string> {
  const p = payload as { contextId: string; lessonId: string };
  await queryClient.cancelQueries({ queryKey: lessonKey(p.contextId) });
  return getOutbox().enqueue(type, payload, { contextId: p.contextId, lessonId: p.lessonId });
}

// ---------------------------------------------------------------- dashboard panel (DSH-6)
function SecretSlot({ context, lesson }: { context: ClassroomContext; lesson: LessonState }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useLessonState(context.id);
  const st = q.data?.data.secret ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRedraw, setConfirmRedraw] = useState(false);
  if (!st) return null;

  const run = async (type: 'secret.draw' | 'secret.redraw') => {
    setBusy(true);
    setError(null);
    try {
      const payload = type === 'secret.redraw' ? { contextId: context.id, lessonId: lesson.id, confirm: true as const } : { contextId: context.id, lessonId: lesson.id };
      const opId = await sendSecretCommand(type, payload);
      await awaitCommand(opId);
      await qc.refetchQueries({ queryKey: lessonKey(context.id) });
    } catch (err) {
      setError(commandErrorText(t, { code: 'CONFLICT', reason: err instanceof Error ? err.message : undefined }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cc-card cc-stack cc-secret" aria-labelledby="cc-secret-title" data-testid="secret-panel">
      <h2 id="cc-secret-title" className="cc-h2">
        {t('secret.title')}
      </h2>
      {!st.roundExists ? (
        <>
          <p className="cc-muted">{t('secret.intro', { count: st.configuredCount })}</p>
          <div>
            <BigButton variant="primary" onPress={() => void run('secret.draw')} isDisabled={busy}>
              <Mascot size={40} />
              {busy ? t('secret.choosing') : t('secret.choose')}
            </BigButton>
          </div>
        </>
      ) : (
        <div className="cc-secret__chosen">
          <Mascot size={72} label={t('secret.mascot')} />
          <div className="cc-stack" style={{ gap: '0.4rem' }}>
            <p className="cc-secret__count" role="status" data-testid="secret-count">
              {st.revealed ? t('secret.revealedCount', { count: st.selectedCount }) : t('secret.chosenCount', { count: st.selectedCount })}
            </p>
            {st.shortfall ? <p className="cc-muted">{st.shortfall === 'NO_ELIGIBLE' ? t('secret.shortfall.none') : t('secret.shortfall.some', { count: st.selectedCount, requested: st.requestedCount })}</p> : null}
            {!st.revealed ? <p className="cc-muted">{t('secret.revealAtEnd')}</p> : null}
          </div>
          {!st.revealed ? (
            <Button className="cc-push-right" onPress={() => setConfirmRedraw(true)} isDisabled={busy}>
              <IconSync />
              {t('secret.redraw')}
            </Button>
          ) : null}
        </div>
      )}
      {error ? <Alert>{error}</Alert> : null}
      <Modal isOpen={confirmRedraw} onOpenChange={setConfirmRedraw} title={t('secret.redrawTitle')} role="alertdialog">
        <p>{t('secret.redrawBody')}</p>
        <DialogActions>
          <Button onPress={() => setConfirmRedraw(false)}>{t('secret.redrawKeep')}</Button>
          <Button
            variant="danger"
            onPress={() => {
              setConfirmRedraw(false);
              void run('secret.redraw');
            }}
          >
            {t('secret.redrawConfirm')}
          </Button>
        </DialogActions>
      </Modal>
    </section>
  );
}

export const secretDashboardSlot: DashboardSlot = { key: 'secret', module: 'secretStudents', order: 30, Component: SecretSlot };

// ---------------------------------------------------------------- End Lesson: reveal + outcomes (SEC-5)
type SecretStepValue = Record<string, never>;

function SelectionCard({ lesson, sel, index }: { lesson: LessonState; sel: RevealedSelection; index: number }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [note, setNote] = useState(sel.note ?? '');
  const [celebrate, setCelebrate] = useState(0);
  const send = (patch: { outcome?: S.RevealedSelection['outcome']; note?: string | null; celebration?: boolean }) => {
    const outcome = patch.outcome ?? sel.outcome ?? 'not_assessed';
    // Optimistic: show the choice right away; the outbox sends it once (UX-10/11).
    qc.setQueryData(secretKey(lesson.id), (d: { reveal: SecretReveal | null } | undefined) =>
      d?.reveal ? { ...d, reveal: { ...d.reveal, selections: d.reveal.selections.map((x) => (x.selectionId === sel.selectionId ? { ...x, outcome, ...(patch.note !== undefined ? { note: patch.note } : {}), ...(patch.celebration !== undefined ? { celebration: patch.celebration } : {}) } : x)) } } : d,
    );
    void sendSecretCommand('secret.recordOutcome', {
      contextId: lesson.contextId,
      lessonId: lesson.id,
      selectionId: sel.selectionId,
      outcome,
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.celebration !== undefined ? { celebration: patch.celebration } : {}),
    });
  };
  const outcomes = ['goal_met', 'still_practising'] as const;
  return (
    <li className="cc-reveal__card" style={{ animationDelay: `${index * 400}ms` }} data-testid="secret-reveal-card">
      <div className="cc-row">
        <Avatar name={sel.student.fullName} id={sel.student.id} hue={sel.student.avatarHue} initials={sel.student.initials} size="lg" />
        <span className="cc-reveal__name">{sel.student.fullName}</span>
        {sel.replacedSelectionId ? <span className="cc-muted">{t('secret.replacement')}</span> : null}
      </div>
      <div className="cc-row" role="radiogroup" aria-label={t('secret.outcomeFor', { name: sel.student.fullName })}>
        {outcomes.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={sel.outcome === o} className="cc-reveal__outcome" onClick={() => send({ outcome: o })}>
            {sel.outcome === o ? <IconCheck /> : null}
            <span>{t(`secret.outcome.${o}`)}</span>
          </button>
        ))}
      </div>
      <TextField label={t('secret.note')} value={note} onChange={setNote} onBlur={() => note !== (sel.note ?? '') && send({ note: note.trim() ? note.trim() : null })} maxLength={300} />
      <Toggle
        label={t('secret.celebrate', { name: sel.student.fullName })}
        isSelected={sel.celebration}
        onChange={(v) => {
          send({ celebration: v });
          if (v) {
            setCelebrate((n) => n + 1);
            // Full-screen celebration; sounds only when the class and this device allow them (THM-5).
            startCelebration(t('secret.wellDone', { name: sel.student.fullName }));
          }
        }}
      />
      {sel.celebration ? (
        <div className="cc-reveal__celebration" role="status">
          <ThemeIllustration key={celebrate} name="celebration" width={110} motion={celebrate > 0 ? 'celebrate' : undefined} />
          <span>{t('secret.wellDone', { name: sel.student.fullName })}</span>
        </div>
      ) : null}
    </li>
  );
}

function SecretRevealStep({ lesson }: { lesson: LessonState; value: SecretStepValue; onChange: (v: SecretStepValue) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const st = useLessonState(lesson.contextId).data?.data.secret ?? null;
  const data = useQuery({ queryKey: secretKey(lesson.id), queryFn: () => call(S.lessonSecret, { lessonId: lesson.id }), enabled: Boolean(st?.revealed) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reveal = data.data?.reveal ?? null;
  const [show, setShow] = useState<{ phase: 'countdown' | 'drumroll' | 'cards' | 'done'; count: number; shown: number } | null>(null);
  const display = useDisplay();
  const playSoundNow = useThemeSound();
  const mode = motionMode(display);
  const cue = (step: RevealStep) => {
    const event = revealCue(mode, step);
    if (event) playSoundNow(event);
  };
  const playRef = useRef(cue);
  playRef.current = cue;
  const total = reveal?.selections.length ?? 0;
  // The reveal show (S13b): runs once, right after this screen revealed the round.
  useEffect(() => {
    if (!show || show.phase === 'done') return;
    const step = (next: typeof show, ms: number) => setTimeout(() => setShow(next), ms);
    let h: ReturnType<typeof setTimeout>;
    if (show.phase === 'countdown') {
      playRef.current('countdown');
      h = show.count > 1 ? step({ ...show, count: show.count - 1 }, 650) : step({ ...show, phase: 'drumroll' }, 650);
    } else if (show.phase === 'drumroll') {
      playRef.current('drumroll');
      h = step({ ...show, phase: 'cards', shown: 0 }, 1300);
    } else if (show.shown < total) {
      h = setTimeout(() => {
        playRef.current('card');
        setShow({ ...show, shown: show.shown + 1 });
      }, show.shown === 0 ? 0 : 600);
    } else {
      playRef.current('end');
      h = step({ ...show, phase: 'done' }, 0);
    }
    return () => clearTimeout(h);
  }, [show, total]);

  if (!st || !st.roundExists) return <p className="cc-muted">{t('secret.noneThisLesson')}</p>;
  const doReveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const opId = await sendSecretCommand('secret.reveal', { contextId: lesson.contextId, lessonId: lesson.id });
      const result = (await awaitCommand(opId)) as SecretReveal;
      qc.setQueryData(secretKey(lesson.id), { state: { ...st, revealed: true }, reveal: result });
      if (motionMode(display) === 'none') {
        setShow(null);
        playRef.current('end');
      } else setShow({ phase: 'countdown', count: 3, shown: 0 });
      void qc.invalidateQueries({ queryKey: lessonKey(lesson.contextId) });
    } catch (err) {
      setError(commandErrorText(t, { code: 'CONFLICT', reason: err instanceof Error ? err.message : undefined }));
    } finally {
      setBusy(false);
    }
  };
  if (!reveal) {
    return (
      <div className="cc-stack">
        <div className="cc-row">
          <Mascot size={72} />
          <p className="cc-secret__count">{t('secret.chosenCount', { count: st.selectedCount })}</p>
        </div>
        <div>
          <BigButton variant="primary" onPress={() => void doReveal()} isDisabled={busy || st.revealed}>
            {busy || st.revealed ? t('secret.revealing') : t('secret.reveal')}
          </BigButton>
        </div>
        {error ? <Alert>{error}</Alert> : null}
      </div>
    );
  }
  const inShow = show !== null && show.phase !== 'done';
  if (show && (show.phase === 'countdown' || show.phase === 'drumroll')) {
    return (
      <div className="cc-stack cc-reveal" data-testid="secret-reveal">
        <div className="cc-reveal__show" data-reduced={motionMode(display) === 'reduced' ? '' : undefined}>
          <Mascot size={96} pose={show.phase === 'drumroll' ? 'thinking' : 'idle'} />
          <p className="cc-reveal__countdown" role="status" aria-live="polite" data-testid="secret-countdown">
            {show.phase === 'countdown' ? show.count : t('secret.drumroll')}
          </p>
        </div>
        <div>
          <Button onPress={() => setShow({ phase: 'done', count: 0, shown: total })}>{t('secret.skipShow')}</Button>
        </div>
      </div>
    );
  }
  const visible = inShow ? reveal.selections.slice(0, show.shown) : reveal.selections;
  return (
    <div className="cc-stack cc-reveal" data-testid="secret-reveal">
      {reveal.selections.length === 0 ? <p className="cc-muted">{t('secret.shortfall.none')}</p> : <p className="cc-h2">{t('secret.revealIntro', { count: reveal.selections.length })}</p>}
      <ul className="cc-reveal__list">
        {visible.map((sel, i) => (
          <SelectionCard key={sel.selectionId} lesson={lesson} sel={sel} index={inShow ? 0 : i} />
        ))}
      </ul>
      {reveal.absent.length ? (
        <ul className="cc-stack cc-reveal__absent">
          {reveal.absent.map((a) => (
            <li key={a.selectionId} className="cc-row">
              <IconUndo />
              <span>{a.replacedBy ? t('secret.absentReplaced', { name: a.student.fullName }) : t('secret.absentNotReplaced', { name: a.student.fullName })}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export const secretEndStepUi = endStepUi<SecretStepValue>({ key: 'secretStudents', title: 'secret.endTitle', initial: () => ({}) as SecretStepValue, Component: SecretRevealStep });
