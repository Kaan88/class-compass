/**
 * Achievements on the classroom screen (S13c items 5 and 7, D-122):
 * - "Give a badge": choose students (or the whole class, or S25a (D-185) one of the groups shown in
 *   this lesson: one tap ticks its members), choose a badge the teacher gives by hand,
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
import { showToast, showUndoToast } from '../../lib/toast.ts';
import { celebrate } from '../../themes/Celebration.tsx';
import { playEvent } from '../../themes/index.tsx';
import { BigButton, Button } from '../../ui/Button.tsx';
import { IconCheck, IconStar, IconTrophy } from '../../ui/icons.tsx';
import { GroupPicto } from '../../ui/pictos.tsx';
import { PanelHead } from '../../ui/Layout.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { awaitCommand, useLessonRoster, useLessonState } from '../lessons/lessonClient.ts';
import { endStepUi, type ClassroomContext, type DashboardSlot, type DashboardSlotProps, type StudentCardAddon } from '../types.ts';
import '../../../shared/i18n/areas/classroomCards.ts';

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

function useClassroomAchievements(contextId: string, lessonId?: string, enabled = true) {
  return useQuery({ queryKey: achievementsKey(contextId, lessonId), queryFn: () => call(classroomAchievements, { contextId, ...(lessonId ? { lessonId } : {}) }), refetchInterval: 30_000, enabled });
}

type Moment = { badgeId: string; studentIds: string[]; names: string[]; awardIds: string[] };

/** Up to three names are said in the celebration and the undo note; more are counted. */
const NAMED_MAX = 3;

/** How long the moment waits for the server's list of awarded students before showing the chosen ones. */
const MOMENT_WAIT_MS = 2500;

function AchievementsSlot({ context, lesson, presentation }: DashboardSlotProps) {
  const { t, locale } = useI18n();
  // In the board's full-screen dock view the toasts are under the (inert) page: notes and Undo are
  // shown in the panel instead (S14b, D-148). The panel's own list of this lesson's awards has Undo.
  const [note, setNote] = useState<{ text: string; kind: 'info' | 'success' | 'error' } | null>(null);
  const inView = presentation === 'dock';
  const notify = (message: string, kind: 'info' | 'success' | 'error', scope?: 'classroom') => {
    if (inView) setNote({ text: message, kind });
    else showToast({ message, kind, ...(scope ? { scope } : {}) });
  };
  const q = useClassroomAchievements(context.id, lesson.id);
  const roster = useLessonRoster(context.id, lesson.id).data?.students ?? [];
  const groups = useLessonGroups(context.id, roster);
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
  /** A group is ticked when every member is; a tap ticks them all, or unticks them when all were. */
  const groupPicked = (ids: readonly string[]) => ids.every((id) => picked.includes(id));
  const toggleGroup = (ids: readonly string[]) => setPicked((p) => (groupPicked(ids) ? p.filter((x) => !ids.includes(x)) : [...p, ...ids.filter((x) => !p.includes(x))]));

  const give = async () => {
    if (!badgeId || !picked.length) return;
    const studentIds = [...picked];
    const withMoment = celebrateOn;
    // A quiet award gets its own short cue; a celebrated one plays the celebration's fanfare (D-145).
    if (!withMoment) playEvent('achievementGiven');
    const opId = await getOutbox().enqueue('achievements.award', { contextId: context.id, lessonId: lesson.id, achievementId: badgeId, studentIds }, { contextId: context.id, lessonId: lesson.id });
    setOpen(false);
    setPicked([]);
    const saved = awaitCommand(opId).then((r) => {
      void queryClient.invalidateQueries({ queryKey: ['classroom', 'achievements', context.id] });
      return r as { studentIds?: string[]; awardIds?: string[] } | undefined;
    });
    saved.catch(() => notify(t('achievements.awardFailed'), 'error', 'classroom'));
    // The moment names only the students who were actually awarded (not those who already had the
    // badge). While offline the server's answer may not come quickly: then the chosen students are shown.
    const answer = await Promise.race([saved.catch(() => null), new Promise<'later'>((res) => setTimeout(() => res('later'), MOMENT_WAIT_MS))]);
    if (answer === null) return;
    const awarded = answer !== 'later' && answer?.studentIds ? answer.studentIds : studentIds;
    const awardIds = answer !== 'later' && answer?.awardIds ? answer.awardIds : [];
    if (!awarded.length) {
      notify(t('achievements.alreadyHad'), 'info', 'classroom');
      return;
    }
    if (!withMoment) {
      // A quiet award (item 7: the moment is optional): a small note, with Undo once the server has it.
      offerUndo(badgeId, awarded, awardIds);
      return;
    }
    setMoment({ badgeId, studentIds: awarded, names: awarded.map(nameOf), awardIds });
    celebrate(celebrationText(badgeId, awarded.map(nameOf)));
  };

  /** "Well done, Ilgın Çetin! New badge: Kind helper" (names only for a few students). */
  const celebrationText = (id: string, names: string[]) => {
    const b = badgeOf(id);
    if (!b) return null;
    const name = pickText(b.name, locale);
    return names.length && names.length <= NAMED_MAX ? t('achievements.celebrateNamed', { names: names.join(', '), name }) : t('achievements.celebrateMessage', { name });
  };

  /**
   * The Undo of a badge just given is offered in a note at the bottom of the screen (always in view),
   * besides the list on the panel (10 minutes).
   */
  const offerUndo = (id: string, studentIds: string[], awardIds: string[]) => {
    const b = badgeOf(id);
    const who = studentIds.length <= NAMED_MAX ? studentIds.map(nameOf).join(', ') : t('achievements.studentCount', { count: studentIds.length });
    const message = t('achievements.givenTo', { badge: b ? pickText(b.name, locale) : '', who });
    if (inView) setNote({ text: message, kind: 'success' });
    else if (awardIds.length) showUndoToast(message, () => undo(awardIds), { scope: 'classroom' });
    else showToast({ message, kind: 'success', scope: 'classroom' });
  };

  const closeMoment = () => {
    if (moment) offerUndo(moment.badgeId, moment.studentIds, moment.awardIds);
    setMoment(null);
  };

  const undo = (awardIds: string[]) => {
    void getOutbox()
      .enqueue('achievements.undo', { contextId: context.id, lessonId: lesson.id, awardIds }, { contextId: context.id, lessonId: lesson.id })
      .then((opId) => awaitCommand(opId))
      .then(() => {
        notify(t('achievements.undone'), 'success');
        return queryClient.invalidateQueries({ queryKey: ['classroom', 'achievements', context.id] });
      })
      .catch(() => notify(t('achievements.undoFailed'), 'error'));
  };

  const undoable = data.lessonAwards.filter((a) => a.undoable);
  const mBadge = moment ? badgeOf(moment.badgeId) : undefined;
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-achievements-title" data-testid="achievements-panel">
      <PanelHead id="cc-achievements-title" title={t('achievements.title')}>
        <BigButton variant="primary" onPress={() => setOpen(true)} isDisabled={!data.badges.length} data-testid="achievements-give">
          <IconStar />
          {t('achievements.give')}
        </BigButton>
      </PanelHead>
      {inView ? (
        <p className={note?.kind === 'error' ? 'cc-field__error' : 'cc-muted'} role="status" data-testid="achievements-note">
          {note?.text ?? ''}
        </p>
      ) : null}
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
          <label className="cc-tick cc-tick--choice">
            <input type="checkbox" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? roster.map((s) => s.id) : [])} data-testid="achievements-whole-class" />
            <span>{t('achievements.wholeClass')}</span>
          </label>
          {groups.length ? (
            <div className="cc-stack cc-achievements-groups" role="group" aria-labelledby="cc-achievements-groups-title" data-testid="achievements-groups">
              <span id="cc-achievements-groups-title" className="cc-muted">
                {t('achievements.groupsTitle')}
              </span>
              <div className="cc-achievements-groups__list">
                {groups.map((g) => (
                  <Button key={g.id} aria-pressed={groupPicked(g.memberIds)} onPress={() => toggleGroup(g.memberIds)} data-testid="achievements-group">
                    {groupPicked(g.memberIds) ? <IconCheck /> : null}
                    <GroupPicto icon={g.icon} size="1.4em" />
                    <span>{pickText(g.name, locale)}</span>
                    <span className="cc-muted">{t('achievements.groupMembers', { count: g.memberIds.length })}</span>
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="cc-achievements-students">
            {roster.map((s) => (
              <label key={s.id} className="cc-tick cc-tick--choice">
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
      <Modal isOpen={moment !== null} onOpenChange={(v) => (v ? null : closeMoment())} title={t('achievements.celebrateTitle')} size="full" testId="achievements-moment">
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
          <Button onPress={() => (moment ? celebrate(celebrationText(moment.badgeId, moment.names)) : undefined)}>{t('achievements.celebrateAgain')}</Button>
          <Button variant="primary" onPress={closeMoment} data-testid="achievements-moment-close">
            {t('common.close')}
          </Button>
        </DialogActions>
      </Modal>
    </section>
  );
}

/**
 * S25a (D-185): the groups shown in this lesson (the grouping module's lesson groups in the polled lesson
 * state: a saved option the teacher applied, shuffled or changed by hand), as a shortcut in the award
 * dialog. Only members on the lesson roster count; a group with none is left out. Nothing while no
 * groups are shown or the grouping module is off (the lesson state then has no groups). Classroom-safe:
 * group names, icons and members only, as on the group screen (GRP-7).
 */
function useLessonGroups(contextId: string, roster: readonly { id: string }[]) {
  const st = useLessonState(contextId).data?.data.grouping ?? null;
  if (!st?.applied) return [];
  const here = new Set(roster.map((s) => s.id));
  return st.groups.map((g) => ({ id: g.id, name: g.name, icon: g.icon, memberIds: g.members.map((m) => m.id).filter((id) => here.has(id)) })).filter((g) => g.memberIds.length > 0);
}

export const achievementsDashboardSlot: DashboardSlot = { key: 'achievements', module: 'achievements', order: 130, dock: { Icon: IconTrophy, label: 'achievements.title' }, Component: AchievementsSlot };

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

/**
 * S22c (D-177): this lesson's achievements on each classroom student card: a trophy and the number of
 * achievements the student was given in this lesson ("2 achievements this lesson"). Only what was
 * given in class (the lesson's manual awards, the list the panel's Undo uses); automatic achievements
 * are kept for the End Lesson "Well done!" moment or come quietly, so they are not counted here.
 * Nothing on a card without one (never a zero) and nothing while the module is off.
 */
function useAchievementCards(context: ClassroomContext, lesson: LessonState, enabled: boolean) {
  const { t } = useI18n();
  const q = useClassroomAchievements(context.id, lesson.id, enabled);
  if (!enabled || !q.data?.enabled) return null;
  const counts = new Map<string, number>();
  for (const a of q.data.lessonAwards) counts.set(a.studentId, (counts.get(a.studentId) ?? 0) + 1);
  if (counts.size === 0) return null;
  return {
    cardProps: (studentId: string) => {
      const n = counts.get(studentId);
      return n ? { marks: [{ key: 'achievements', Icon: IconTrophy, value: String(n), label: t('achievements.cardCount', { count: n }) }] } : {};
    },
  };
}

export const achievementsCardAddon: StudentCardAddon = { key: 'achievements', module: 'achievements', useAddon: useAchievementCards };
