/**
 * Groups on the classroom display (DSH-8, GRP-5..7, UX-8; redesigned in S13a, D-098):
 * - a small panel in the dashboard rail shows whether groups are in use and opens the group screen;
 * - the full-screen group screen: the class's options as big buttons with their icon (Lions, Eagles,
 *   Dolphins, Tigers …), Shuffle (with undo), colour cards "Group N" + number icon + member count,
 *   the lesson timer, and moving students by tap (tap a student, then the group) or drag and drop.
 *   Moves apply to this lesson at once; "Save to option" keeps them in the option for next time.
 * - Absent students are left out (GRP-5). Levels, option types, pair rules and notes are never sent
 *   to the classroom (GRP-7), so nothing here can show them. Names can be shown in Turkish-correct
 *   upper case (per class+subject setting).
 * Every write is an outbox command naming the lesson (UX-11, LES-4). Editing options, levels and pair
 * rules is in the teacher area (/teacher/grouping).
 */
import { useState, type DragEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as G from '../../../shared/contracts/grouping.ts';
import type { DisplayGroup, GroupingCommandPayload, GroupingCommandType, GroupingLessonState } from '../../../shared/contracts/grouping.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { getOutbox, type CommandInvalidation } from '../../lib/outbox-client.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { BigButton, Button } from '../../ui/Button.tsx';
import { Modal } from '../../ui/Dialog.tsx';
import { IconCheck, IconSwap, IconUndo, IconUsers, IconX } from '../../ui/icons.tsx';
import { GroupPicto, OptionPicto } from '../../ui/pictos.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { LessonTimer } from '../lessons/LessonTimer.tsx';
import { lessonKey, useLessonState, type LessonQueryData } from '../lessons/lessonClient.ts';
import type { ClassroomContext, DashboardSlot } from '../types.ts';

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
  await queryClient.cancelQueries({ queryKey: lessonKey(p.contextId) });
  return getOutbox().enqueue(type, payload, { contextId: p.contextId, lessonId: p.lessonId });
}

/** Optimistic move in the cached lesson state, so the card changes at once (the poll confirms it). */
function patchMove(contextId: string, studentId: string, toGroupId: string) {
  queryClient.setQueryData<LessonQueryData>(lessonKey(contextId), (q) => {
    const g = q?.data.grouping;
    if (!q || !g) return q;
    const member = g.groups.flatMap((x) => x.members).find((m) => m.id === studentId) ?? (g.notPlaced.find((m) => m.id === studentId) ? { ...g.notPlaced.find((m) => m.id === studentId)!, role: null } : null);
    if (!member) return q;
    const groups = g.groups.map((x) => ({ ...x, members: x.id === toGroupId ? [...x.members.filter((m) => m.id !== studentId), { ...member, role: null }] : x.members.filter((m) => m.id !== studentId) }));
    const notPlaced = g.notPlaced.filter((m) => m.id !== studentId);
    return { etag: null, data: { ...q.data, grouping: { ...g, groups, notPlaced, notPlacedCount: notPlaced.length } } };
  });
}

const display = (name: string, upper: boolean) => (upper ? name.toLocaleUpperCase('tr-TR') : name);

function GroupScreen({ context, lesson, st, isOpen, onOpenChange }: { context: ClassroomContext; lesson: LessonState; st: GroupingLessonState; isOpen: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: arrangementsKey(context.id), queryFn: () => call(G.classroomArrangements, { contextId: context.id }), enabled: isOpen });
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
    void sendGroupingCommand('grouping.shuffle', ref);
  };
  const undoShuffle = () => {
    if (!undoTo) return;
    setUndoTo(null);
    setNotice(null);
    void sendGroupingCommand('grouping.restore', { ...ref, groupingId: undoTo });
  };
  const move = (studentId: string, toGroupId: string) => {
    setPicked(null);
    setUndoTo(null);
    patchMove(context.id, studentId, toGroupId);
    void sendGroupingCommand('grouping.move', { ...ref, studentId, toGroupId });
  };
  const saveToOption = () => {
    void sendGroupingCommand('grouping.saveToOption', ref);
    setNotice(t('grouping.toast.savedToOption'));
  };
  const onDrop = (groupId: string) => (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) move(id, groupId);
  };
  const memberButton = (m: { id: string; fullName: string; initials: string; avatarHue: number }, extra?: string | null) => (
    <Button
      size="small"
      className="cc-group-member"
      aria-pressed={picked === m.id}
      onPress={() => setPicked(picked === m.id ? null : m.id)}
    >
      {/* Spoken as "Move <name>"; no aria-label, so the visible name stays part of the button name (axe). */}
      <span className="cc-visually-hidden">{t('grouping.movePrefix')} </span>
      <span
        className="cc-group-member__drag"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', m.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        data-testid="group-member"
        data-student-id={m.id}
      >
        <Avatar name={m.fullName} id={m.id} hue={m.avatarHue} initials={m.initials} size="sm" />
        <span className="cc-group-member__name">{display(m.fullName, st.upperCaseNames)}</span>
        {extra ? <span className="cc-chip">{extra}</span> : null}
      </span>
    </Button>
  );

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('grouping.title')} size="full" testId="group-screen">
      <div className="cc-group-screen">
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
            <Button size="big" variant="primary" onPress={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
          </div>
        </div>
        <div className="cc-group-screen__body">
          <div className="cc-stack cc-group-screen__groups">
            {st.applied ? (
              <>
                <p className="cc-muted" role="status" data-testid="group-move-hint">
                  {pickedName ? t('grouping.tapGroupFor', { name: pickedName }) : (notice ?? t('grouping.moveHint'))}
                </p>
                <ul className="cc-groups cc-groups--screen" aria-label={t('grouping.title')}>
                  {st.groups.map((g, i) => (
                    <li
                      key={g.id}
                      className="cc-group cc-group--colour"
                      data-colour={COLOURS[i % COLOURS.length]}
                      aria-label={t('grouping.groupLabel', { name: pickText(g.name, locale), count: g.members.length })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={onDrop(g.id)}
                      data-testid="group-card"
                    >
                      <div className="cc-group__head">
                        <span className="cc-group__icon">
                          <GroupPicto icon={g.icon} size="2.4em" />
                        </span>
                        <span className="cc-group__name">{pickText(g.name, locale)}</span>
                        <span className="cc-group__count">{t('grouping.memberCount', { count: g.members.length })}</span>
                      </div>
                      <ul className="cc-group__members">
                        {g.members.map((m) => (
                          <li key={m.id}>{memberButton(m, m.role ? pickText(m.role, locale) : null)}</li>
                        ))}
                      </ul>
                      {picked && !g.members.some((m) => m.id === picked) ? (
                        <Button size="small" variant="primary" onPress={() => move(picked, g.id)} className="cc-group__here">
                          {t('grouping.moveHere', { group: pickText(g.name, locale) })}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {st.notPlaced.length ? (
                  <section className="cc-card cc-stack" aria-labelledby="cc-not-placed">
                    <h3 id="cc-not-placed" className="cc-h2">
                      {t('grouping.unplaced')}
                    </h3>
                    <ul className="cc-row">
                      {st.notPlaced.map((m) => (
                        <li key={m.id}>{memberButton(m)}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
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
      <span className="cc-muted">{group.members.length}</span>
    </li>
  );
}

function GroupsSlot({ context, lesson }: { context: ClassroomContext; lesson: LessonState }) {
  const { t } = useI18n();
  const st = useLessonState(context.id).data?.data.grouping ?? null;
  const [open, setOpen] = useState(false);
  if (!st) return null;
  return (
    <section className="cc-card cc-stack cc-groups-panel" aria-labelledby="cc-groups-title" data-testid="groups-panel">
      <div className="cc-row">
        <h2 id="cc-groups-title" className="cc-h2">
          {t('grouping.title')}
        </h2>
        <BigButton variant={st.applied ? 'secondary' : 'primary'} className="cc-push-right" onPress={() => setOpen(true)}>
          <IconUsers />
          {st.applied ? t('grouping.open') : t('grouping.choose')}
        </BigButton>
      </div>
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

export const groupsDashboardSlot: DashboardSlot = { key: 'grouping', module: 'grouping', order: 60, Component: GroupsSlot };
