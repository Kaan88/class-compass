/**
 * Achievements on the classroom screen (S13c items 5 and 7, D-122):
 * - "Give a badge": choose students (or the whole class), choose a badge the teacher gives by hand,
 *   and it is saved through the outbox ('achievements.award', no PIN, works offline). When the teacher
 *   leaves "Celebrate on the display" ticked, a full-screen moment then shows the badge and the names
 *   of the students who were awarded (not those who already had it); unticked, it is given quietly.
 * - This lesson's badges can be undone for 10 minutes ('achievements.undo'); later, removing one is a
 *   PIN-gated revoke in the teacher area.
 * - End Lesson "Well done!" (optional per class): the automatic badges earned during the lesson.
 * Classroom data is badge names and student names only: no levels, no counts that compare students.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AchievementTier } from '../../../shared/achievements.ts';
import { classroomAchievements } from '../../../shared/contracts/achievements.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { BadgeArt } from '../../achievements/icons.tsx';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { getOutbox, type CommandInvalidation } from '../../lib/outbox-client.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { showToast } from '../../lib/toast.ts';
import { celebrate } from '../../themes/Celebration.tsx';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { awaitCommand, useLessonRoster } from '../lessons/lessonClient.ts';
import { endStepUi, type ClassroomContext, type DashboardSlot } from '../types.ts';

export const achievementsKey = (contextId: string, lessonId?: string) => ['classroom', 'achievements', contextId, lessonId ?? null] as const;

/** Listed in the manifest: awards and undo refresh the classroom badge list. */
export const achievementsInvalidation: CommandInvalidation = {
  prefix: 'achievements.',
  keys: (op) => [op.contextId ? ['classroom', 'achievements', op.contextId] : ['classroom', 'achievements']],
};

const TIER_KEY: Record<AchievementTier, 'achievements.tier.bronze' | 'achievements.tier.silver' | 'achievements.tier.gold' | 'achievements.tier.none'> = {
  bronze: 'achievements.tier.bronze',
  silver: 'achievements.tier.silver',
  gold: 'achievements.tier.gold',
  none: 'achievements.tier.none',
};

function useClassroomAchievements(contextId: string, lessonId?: string) {
  return useQuery({ queryKey: achievementsKey(contextId, lessonId), queryFn: () => call(classroomAchievements, { contextId, ...(lessonId ? { lessonId } : {}) }), refetchInterval: 30_000 });
}

type Moment = { badgeId: string; studentIds: string[]; names: string[] };

/** How long the moment waits for the server's list of awarded students before showing the chosen ones. */
const MOMENT_WAIT_MS = 2500;

function AchievementsSlot({ context, lesson }: { context: ClassroomContext; lesson: LessonState }) {
  const { t, locale } = useI18n();
  const q = useClassroomAchievements(context.id, lesson.id);
  const roster = useLessonRoster(context.id, lesson.id).data?.students ?? [];
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [badgeId, setBadgeId] = useState<string | null>(null);
  const [moment, setMoment] = useState<Moment | null>(null);
  const [celebrateOn, setCelebrateOn] = useState(true);
  const data = q.data;
  if (!data?.enabled) return null;
  const badgeOf = (id: string) => data.badges.find((b) => b.id === id);
  const nameOf = (id: string) => roster.find((s) => s.id === id)?.fullName ?? '';
  const allPicked = roster.length > 0 && picked.length === roster.length;

  const give = async () => {
    if (!badgeId || !picked.length) return;
    const studentIds = [...picked];
    const withMoment = celebrateOn;
    const opId = await getOutbox().enqueue('achievements.award', { contextId: context.id, lessonId: lesson.id, achievementId: badgeId, studentIds }, { contextId: context.id, lessonId: lesson.id });
    setOpen(false);
    setPicked([]);
    const b = badgeOf(badgeId);
    const saved = awaitCommand(opId).then((r) => {
      void queryClient.invalidateQueries({ queryKey: ['classroom', 'achievements', context.id] });
      return r as { studentIds?: string[] } | undefined;
    });
    saved.catch(() => showToast({ message: t('achievements.awardFailed'), kind: 'error', scope: 'classroom' }));
    if (!withMoment) {
      // A quiet award (item 7: the moment is optional): a small note only.
      showToast({ message: t('achievements.givenQuietly', { count: studentIds.length }), kind: 'success', scope: 'classroom' });
      return;
    }
    // The moment names only the students who were actually awarded (not those who already had the
    // badge). While offline the server's answer may not come quickly: then the chosen students are shown.
    const answer = await Promise.race([saved.catch(() => null), new Promise<'later'>((res) => setTimeout(() => res('later'), MOMENT_WAIT_MS))]);
    if (answer === null) return;
    const awarded = answer !== 'later' && answer?.studentIds ? answer.studentIds : studentIds;
    if (!awarded.length) {
      showToast({ message: t('achievements.alreadyHad'), kind: 'info', scope: 'classroom' });
      return;
    }
    setMoment({ badgeId, studentIds: awarded, names: awarded.map(nameOf) });
    celebrate(b ? t('achievements.celebrateMessage', { name: pickText(b.name, locale) }) : null);
  };

  const undo = (awardIds: string[]) => {
    void getOutbox()
      .enqueue('achievements.undo', { contextId: context.id, lessonId: lesson.id, awardIds }, { contextId: context.id, lessonId: lesson.id })
      .then((opId) => awaitCommand(opId))
      .then(() => {
        showToast({ message: t('achievements.undone'), kind: 'success' });
        return queryClient.invalidateQueries({ queryKey: ['classroom', 'achievements', context.id] });
      })
      .catch(() => showToast({ message: t('achievements.undoFailed'), kind: 'error' }));
  };

  const undoable = data.lessonAwards.filter((a) => a.undoable);
  const mBadge = moment ? badgeOf(moment.badgeId) : undefined;
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-achievements-title" data-testid="achievements-panel">
      <div className="cc-row">
        <h2 id="cc-achievements-title" className="cc-h2">
          {t('achievements.title')}
        </h2>
        <Button variant="primary" className="cc-push-right" onPress={() => setOpen(true)} isDisabled={!data.badges.length} data-testid="achievements-give">
          {t('achievements.give')}
        </Button>
      </div>
      {undoable.length ? (
        <ul className="cc-stack" aria-label={t('achievements.thisLesson')}>
          {undoable.map((a) => {
            const b = badgeOf(a.achievementId);
            return (
              <li key={a.id} className="cc-row">
                <span>
                  {nameOf(a.studentId)}: {b ? pickText(b.name, locale) : ''}
                </span>
                <Button size="small" className="cc-push-right" onPress={() => undo([a.id])} data-testid="achievements-undo">
                  {t('achievements.undo')}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Modal isOpen={open} onOpenChange={setOpen} title={t('achievements.give')} size="wide" testId="achievements-dialog">
        <fieldset className="cc-stack">
          <legend className="cc-h3">{t('achievements.chooseStudents')}</legend>
          <label className="cc-tick">
            <input type="checkbox" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? roster.map((s) => s.id) : [])} data-testid="achievements-whole-class" />
            <span>{t('achievements.wholeClass')}</span>
          </label>
          <div className="cc-achievements-students">
            {roster.map((s) => (
              <label key={s.id} className="cc-tick">
                <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} data-testid="achievements-student" />
                <Avatar name={s.fullName} id={s.id} hue={s.avatarHue} initials={s.initials} size="sm" />
                <span>{s.fullName}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="cc-stack">
          <legend className="cc-h3">{t('achievements.chooseBadge')}</legend>
          <div className="cc-badge-picker" role="radiogroup" aria-label={t('achievements.chooseBadge')}>
            {data.badges.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={badgeId === b.id} className="cc-badge-choice" onClick={() => setBadgeId(b.id)} data-testid="achievements-badge">
                <BadgeArt icon={b.icon} tier={b.tier} size={48} />
                <span className="cc-stack">
                  <strong>{pickText(b.name, locale)}</strong>
                  <span className="cc-muted">{t(TIER_KEY[b.tier])}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="cc-tick">
          <input type="checkbox" checked={celebrateOn} onChange={(e) => setCelebrateOn(e.target.checked)} data-testid="achievements-celebrate" />
          <span>{t('achievements.celebrateOnDisplay')}</span>
        </label>
        <DialogActions>
          <Button onPress={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" isDisabled={!badgeId || !picked.length} onPress={() => void give()} data-testid="achievements-confirm">
            {t('achievements.giveCount', { count: picked.length })}
          </Button>
        </DialogActions>
      </Modal>
      <Modal isOpen={moment !== null} onOpenChange={(v) => (v ? null : setMoment(null))} title={t('achievements.celebrateTitle')} size="full" testId="achievements-moment">
        {moment && mBadge ? (
          <div className="cc-stack cc-achievement-moment">
            <BadgeArt icon={mBadge.icon} tier={mBadge.tier} size={200} />
            <p className="cc-achievement-moment__badge">{pickText(mBadge.name, locale)}</p>
            <p className="cc-muted">{t(TIER_KEY[mBadge.tier])}</p>
            {moment.studentIds.length <= 6 ? (
              <div className="cc-row cc-achievement-moment__avatars" aria-hidden="true">
                {moment.studentIds.map((id) => {
                  const st = roster.find((x) => x.id === id);
                  return st ? <Avatar key={id} name={st.fullName} id={st.id} hue={st.avatarHue} initials={st.initials} size="lg" /> : null;
                })}
              </div>
            ) : null}
            <p className="cc-achievement-moment__names" data-testid="achievements-moment-names">
              {moment.names.join(', ')}
            </p>
          </div>
        ) : null}
        <DialogActions>
          <Button onPress={() => celebrate(mBadge ? t('achievements.celebrateMessage', { name: pickText(mBadge.name, locale) }) : null)}>{t('achievements.celebrateAgain')}</Button>
          <Button variant="primary" onPress={() => setMoment(null)} data-testid="achievements-moment-close">
            {t('common.close')}
          </Button>
        </DialogActions>
      </Modal>
    </section>
  );
}

export const achievementsDashboardSlot: DashboardSlot = { key: 'achievements', module: 'achievements', order: 130, Component: AchievementsSlot };

/** End Lesson "Well done!" (item 7): only shown when the class chose it; nothing is saved. */
function WellDoneStep({ lesson }: { lesson: LessonState }) {
  const { t, locale } = useI18n();
  const q = useClassroomAchievements(lesson.contextId, lesson.id);
  const list = q.data?.wellDone ?? [];
  if (!list.length) return <p className="cc-muted">{t('achievements.wellDoneNone')}</p>;
  return (
    <ul className="cc-badge-list" data-testid="achievements-well-done">
      {list.map((w) => (
        <li key={`${w.studentId}:${w.badge.id}`} className="cc-badge">
          <BadgeArt icon={w.badge.icon} tier={w.badge.tier} size={44} />
          <span className="cc-stack cc-badge__text">
            <strong>{w.fullName}</strong>
            <span>{pickText(w.badge.name, locale)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export const achievementsEndStepUi = endStepUi<Record<string, never>>({ key: 'achievementsWellDone', title: 'achievements.wellDoneTitle', initial: () => ({}), Component: WellDoneStep });
