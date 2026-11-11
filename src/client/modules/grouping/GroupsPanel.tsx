/**
 * Groups on the classroom display (DSH-8, GRP-5..7, UX-8; redesigned in S13a, D-098):
 * - a small panel on the board shows whether groups are in use and opens the group screen; from the
 *   board's dock (S14b) the group screen opens directly;
 * - the full-screen group screen: the class's options as big buttons with their icon (Lions, Eagles,
 *   Dolphins, Tigers …), Shuffle (with undo), colour cards "Group N" + number icon + member count,
 *   the lesson timer, and moving students (S14c, D-150: `ui/StudentDnd.tsx`): drag a name onto
 *   another group or onto "Not in a group" (mouse, touch, keyboard), or tap a name and then
 *   "Move here". Moves apply to this lesson at once and play the `groupMove` sound; "Save to option"
 *   keeps them in the option for next time.
 * - Absent students are left out (GRP-5). Levels, option types, pair rules and notes are never sent
 *   to the classroom (GRP-7), so nothing here can show them. Names can be shown in Turkish-correct
 *   upper case (per class+subject setting).
 * Every write is an outbox command naming the lesson (UX-11, LES-4). Editing options, levels and pair
 * rules is in the teacher area (/teacher/grouping).
 */
import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as G from '../../../shared/contracts/grouping.ts';
import { UNPLACED, type DisplayGroup, type GroupingCommandPayload, type GroupingCommandType, type GroupingLessonState } from '../../../shared/contracts/grouping.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { getOutbox, type CommandInvalidation } from '../../lib/outbox-client.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { BigButton, Button } from '../../ui/Button.tsx';
import { Modal } from '../../ui/Dialog.tsx';
import { PanelHead } from '../../ui/Layout.tsx';
import { IconCheck, IconGroups, IconSwap, IconUndo, IconUsers, IconX } from '../../ui/icons.tsx';
import { GroupPicto, OptionPicto } from '../../ui/pictos.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { StudentDnd, StudentDropList } from '../../ui/StudentDnd.tsx';
import { LessonTimer } from '../lessons/LessonTimer.tsx';
import { lessonKey, useLessonState, type LessonQueryData } from '../lessons/lessonClient.ts';
import type { ClassroomContext, DashboardSlot, DashboardSlotProps, StudentCardAddon } from '../types.ts';
import { playEvent } from '../../themes/index.tsx';

const arrangementsKey = (contextId: string) => ['classroom', 'grouping', 'arrangements', contextId] as const;
/** Group card colours: the counter colour tokens, in this order (with the number and name, never colour alone). */
const COLOURS = ['accent', 'teal', 'plum', 'rust', 'leaf', 'berry'] as const;

/** Listed in the grouping manifest. */
export const groupingInvalidation: CommandInvalidation = {
  prefix: 'grouping.',
  keys: (op) => (op.contextId ? [lessonKey(op.contextId)] : [['classroom', 'lesson']]),
};

export async function sendGroupingCommand<T extends GroupingCommandType>(type: T, payload: GroupingCommandPayload<T>): Promise<string> {
  const p = payload as { contextId: string; lessonId: string };
  // Queued before anything is awaited, so it counts as pending at once (see sendCounterCommand).
  const queued = getOutbox().enqueue(type, payload, { contextId: p.contextId, lessonId: p.lessonId });
  await queryClient.cancelQueries({ queryKey: lessonKey(p.contextId) });
  return queued;
}

/**
 * Optimistic move in the cached lesson state, so the card changes at once (the poll confirms it).
 * `UNPLACED` (S14c) takes the student out of every group into "Not in a group".
 */
function patchMove(contextId: string, studentId: string, toGroupId: string) {
  queryClient.setQueryData<LessonQueryData>(lessonKey(contextId), (q) => {
    const g = q?.data.grouping;
    if (!q || !g) return q;
    const found = g.groups.flatMap((x) => x.members).find((m) => m.id === studentId) ?? g.notPlaced.find((m) => m.id === studentId);
    if (!found) return q;
    const plain = { id: found.id, fullName: found.fullName, initials: found.initials, avatarHue: found.avatarHue };
    const unplace = toGroupId === UNPLACED;
    const groups = g.groups.map((x) => ({ ...x, members: !unplace && x.id === toGroupId ? [...x.members.filter((m) => m.id !== studentId), { ...plain, role: null }] : x.members.filter((m) => m.id !== studentId) }));
    const rest = g.notPlaced.filter((m) => m.id !== studentId);
    const notPlaced = unplace ? [...rest, plain] : rest;
    return { etag: null, data: { ...q.data, grouping: { ...g, groups, notPlaced, notPlacedCount: notPlaced.length } } };
  });
}

type ScreenMember = { id: string; name: string; fullName: string; initials: string; avatarHue: number; role: string | null };

const display = (name: string, upper: boolean) => (upper ? name.toLocaleUpperCase('tr-TR') : name);

/**
 * The group screen itself: options, Shuffle (with undo), the group cards and moving students. Shown in
 * its own full-screen dialog from the panel, or directly in the board's dock view (S14b), whose
 * dialog already has a Close button (`onClose` absent).
 */
function GroupScreenBody({ context, lesson, st, onClose }: { context: ClassroomContext; lesson: LessonState; st: GroupingLessonState; onClose?: () => void }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: arrangementsKey(context.id), queryFn: () => call(G.classroomArrangements, { contextId: context.id }) });
  const [picked, setPicked] = useState<string | null>(null);
  // Undo of the last Shuffle lives on the screen itself: the toast area is outside the modal (inert).
  const [undoTo, setUndoTo] = useState<string | null>(null);
  // Feedback shown on the screen (role=status), for the same reason.
  const [notice, setNotice] = useState<string | null>(null);
  const ref = { contextId: context.id, lessonId: lesson.id };
  const pickedName = picked ? [...st.groups.flatMap((g) => g.members), ...st.notPlaced].find((m) => m.id === picked)?.fullName : undefined;

  const choose = (templateId: string) => {
    setPicked(null);
    setUndoTo(null);
    void sendGroupingCommand('grouping.apply', { ...ref, templateId });
  };
  const shuffle = () => {
    setPicked(null);
    setUndoTo(st.groupingId);
    setNotice(t('grouping.toast.shuffled'));
    playEvent('groupShuffle');
    void sendGroupingCommand('grouping.shuffle', ref);
  };
  const undoShuffle = () => {
    if (!undoTo) return;
    setUndoTo(null);
    setNotice(null);
    playEvent('undo');
    void sendGroupingCommand('grouping.restore', { ...ref, groupingId: undoTo });
  };
  const move = useCallback(
    (studentId: string, toGroupId: string) => {
      setPicked(null);
      setUndoTo(null);
      patchMove(context.id, studentId, toGroupId);
      // Queued before anything is awaited (sendGroupingCommand), then the classroom hears the move.
      void sendGroupingCommand('grouping.move', { contextId: context.id, lessonId: lesson.id, studentId, toGroupId });
      playEvent('groupMove');
    },
    [context.id, lesson.id],
  );
  const saveToOption = () => {
    void sendGroupingCommand('grouping.saveToOption', ref);
    setNotice(t('grouping.toast.savedToOption'));
  };
  const asMember = (m: { id: string; fullName: string; initials: string; avatarHue: number; role?: DisplayGroup['members'][number]['role'] }): ScreenMember => ({
    id: m.id,
    name: display(m.fullName, st.upperCaseNames),
    fullName: m.fullName,
    initials: m.initials,
    avatarHue: m.avatarHue,
    role: m.role ? pickText(m.role, locale) : null,
  });
  const renderMember = (m: ScreenMember) => (
    <span className="cc-group-member">
      <Avatar name={m.fullName} id={m.id} hue={m.avatarHue} initials={m.initials} size="sm" />
      <span className="cc-group-member__name">{m.name}</span>
      {m.role ? <span className="cc-chip">{m.role}</span> : null}
    </span>
  );

  return (
      <div className="cc-group-screen" data-testid={onClose ? undefined : 'group-screen'}>
        <div className="cc-group-screen__bar">
          <div className="cc-row" role="group" aria-label={t('grouping.options')} data-testid="group-options">
            {(q.data?.arrangements ?? []).map((a) => (
              <Button key={a.id} size="big" className="cc-group-option" aria-pressed={a.id === st.arrangementId} onPress={() => choose(a.id)}>
                <OptionPicto icon={a.icon} size="1.9em" />
                <span>{pickText(a.name, locale)}</span>
              </Button>
            ))}
            {q.data && !q.data.arrangements.length ? <p className="cc-muted">{t('grouping.noArrangements')}</p> : null}
          </div>
          <div className="cc-row cc-push-right">
            {st.applied ? (
              <>
                <Button size="big" onPress={shuffle}>
                  <IconSwap />
                  {t('grouping.shuffle')}
                </Button>
                {undoTo ? (
                  <Button size="big" onPress={undoShuffle} data-testid="group-undo">
                    <IconUndo />
                    {t('grouping.undoShuffle')}
                  </Button>
                ) : null}
                <Button size="big" onPress={saveToOption}>
                  <IconCheck />
                  {t('grouping.saveToOption')}
                </Button>
                <Button size="big" onPress={() => void sendGroupingCommand('grouping.clear', ref)}>
                  <IconX />
                  {t('grouping.hide')}
                </Button>
              </>
            ) : null}
            {onClose ? (
              <Button size="big" variant="primary" onPress={onClose}>
                {t('common.close')}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="cc-group-screen__body">
          <div className="cc-stack cc-group-screen__groups">
            {st.applied ? (
              <>
                <div className="cc-group-screen__hint" data-picked={pickedName ? '' : undefined}>
                  <p className={pickedName ? 'cc-group-screen__picked' : 'cc-muted'} role="status" data-testid="group-move-hint">
                    {pickedName ? t('grouping.tapGroupFor', { name: pickedName }) : (notice ?? t('grouping.moveHint'))}
                  </p>
                  {pickedName ? (
                    <Button size="small" onPress={() => setPicked(null)} data-testid="group-cancel-move">
                      <IconX />
                      {t('common.cancel')}
                    </Button>
                  ) : null}
                </div>
                <StudentDnd picked={picked} onPick={setPicked} onMove={move}>
                  <ul className="cc-groups cc-groups--screen" aria-label={t('grouping.title')}>
                    {st.groups.map((g, i) => {
                      const name = pickText(g.name, locale);
                      return (
                        <li key={g.id} className="cc-group cc-group--colour" data-colour={COLOURS[i % COLOURS.length]} data-testid="group-card">
                          <div className="cc-group__head" aria-hidden="true">
                            <span className="cc-group__icon">
                              <GroupPicto icon={g.icon} size="2.4em" />
                            </span>
                            <span className="cc-group__name">{name}</span>
                            <span className="cc-group__count">{t('grouping.memberCount', { count: g.members.length })}</span>
                          </div>
                          <StudentDropList
                            id={g.id}
                            name={name}
                            label={t('grouping.groupLabel', { name, count: g.members.length })}
                            students={g.members.map(asMember)}
                            renderStudent={renderMember}
                            itemTestId="group-member"
                          />
                        </li>
                      );
                    })}
                  </ul>
                  {/* Always there while groups are shown: a drop here takes a student out of the groups (S14c). */}
                  <section className="cc-card cc-stack cc-group-unplaced" aria-labelledby="cc-not-placed" data-testid="group-unplaced">
                    <h3 id="cc-not-placed" className="cc-h2">
                      {t('grouping.unplaced')}
                    </h3>
                    <StudentDropList
                      id={UNPLACED}
                      name={t('grouping.unplaced')}
                      students={st.notPlaced.map(asMember)}
                      renderStudent={renderMember}
                      emptyText={t('grouping.unplacedEmpty')}
                      itemTestId="group-member"
                    />
                  </section>
                </StudentDnd>
                {st.excludedCount ? <p className="cc-muted">{t('grouping.excluded', { count: st.excludedCount })}</p> : null}
              </>
            ) : (
              <p className="cc-h2 cc-muted">{t('grouping.pickOption')}</p>
            )}
          </div>
          <div className="cc-group-screen__side">
            <LessonTimer lesson={lesson} compact />
          </div>
        </div>
      </div>
  );
}

function GroupScreen({ context, lesson, st, isOpen, onOpenChange }: { context: ClassroomContext; lesson: LessonState; st: GroupingLessonState; isOpen: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('grouping.title')} size="full" testId="group-screen">
      <GroupScreenBody context={context} lesson={lesson} st={st} onClose={() => onOpenChange(false)} />
    </Modal>
  );
}

/** A compact card per group in the rail (icon, name, member count). */
function GroupChip({ group, colour }: { group: DisplayGroup; colour: string }) {
  const { t, locale } = useI18n();
  const name = pickText(group.name, locale);
  return (
    <li className="cc-group-chip" data-colour={colour} aria-label={t('grouping.groupLabel', { name, count: group.members.length })}>
      <GroupPicto icon={group.icon} size="1.6em" />
      <span>{name}</span>
      <span className="cc-group-chip__count">{t('grouping.memberCount', { count: group.members.length })}</span>
    </li>
  );
}

function GroupsSlot({ context, lesson, presentation }: DashboardSlotProps) {
  const { t } = useI18n();
  const st = useLessonState(context.id).data?.data.grouping ?? null;
  const [open, setOpen] = useState(false);
  if (!st) return null;
  // In the dock view (S14b) the group screen is the view: no second full-screen dialog over it.
  if (presentation === 'dock') return <GroupScreenBody context={context} lesson={lesson} st={st} />;
  return (
    <section className="cc-card cc-stack cc-groups-panel" aria-labelledby="cc-groups-title" data-testid="groups-panel">
      <PanelHead id="cc-groups-title" title={t('grouping.title')}>
        <BigButton variant={st.applied ? 'secondary' : 'primary'} onPress={() => setOpen(true)}>
          <IconUsers />
          {st.applied ? t('grouping.open') : t('grouping.choose')}
        </BigButton>
      </PanelHead>
      {st.applied ? (
        <ul className="cc-group-chips" aria-label={t('grouping.title')}>
          {st.groups.map((g, i) => (
            <GroupChip key={g.id} group={g} colour={COLOURS[i % COLOURS.length]!} />
          ))}
        </ul>
      ) : (
        <p className="cc-muted">{t('grouping.none')}</p>
      )}
      {open ? <GroupScreen context={context} lesson={lesson} st={st} isOpen={open} onOpenChange={setOpen} /> : null}
    </section>
  );
}

/** Dock badge: how many groups are in use ("4"), nothing while no groups are shown. */
function useGroupsBadge(context: ClassroomContext) {
  const st = useLessonState(context.id).data?.data.grouping ?? null;
  return st?.applied ? String(st.groups.length) : null;
}

export const groupsDashboardSlot: DashboardSlot = {
  key: 'groups',
  module: 'grouping',
  order: 60,
  dock: { Icon: IconGroups, label: 'grouping.title', useBadge: useGroupsBadge },
  Component: GroupsSlot,
};

/** The number of a group in the lesson: the "Group N" icon's number, else its place on the group screen. */
export const groupNumberOf = (group: DisplayGroup, index: number): number => Number(/^g(\d+)$/u.exec(group.icon)?.[1] ?? index + 1);

/**
 * S22c (D-177): the student's group number on each classroom student card while groups are shown in
 * this lesson (an icon and the number, read out as "In group 3"), so the class finds its group without
 * opening the group screen. Students in no group show nothing; nothing while the module is off.
 */
function useGroupCards(context: ClassroomContext, _lesson: LessonState, enabled: boolean) {
  const { t } = useI18n();
  const st = useLessonState(enabled ? context.id : null).data?.data.grouping ?? null;
  if (!enabled || !st?.applied || st.groups.length === 0) return null;
  const numbers = new Map<string, number>();
  st.groups.forEach((g, i) => {
    for (const m of g.members) numbers.set(m.id, groupNumberOf(g, i));
  });
  return {
    cardProps: (studentId: string) => {
      const n = numbers.get(studentId);
      return n === undefined ? {} : { marks: [{ key: 'group', Icon: IconGroups, value: String(n), label: t('grouping.cardGroup', { n }) }] };
    },
  };
}

export const groupsCardAddon: StudentCardAddon = { key: 'groups', module: 'grouping', useAddon: useGroupCards };
