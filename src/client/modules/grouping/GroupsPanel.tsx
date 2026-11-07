/**
 * Groups on the classroom display (DSH-8, GRP-5..7, UX-8):
 * - the groups in use come from the polled lesson state: child-friendly names with an icon, avatars,
 *   names and optional roles. Levels, the arrangement type, pair rules and notes are never sent to
 *   the classroom (GRP-7), so this panel cannot show them;
 * - "Choose groups" → tap an arrangement (two taps): absent students are left out for this lesson
 *   only and the saved arrangement is not changed (GRP-5);
 * - "Hide groups" takes them off the display.
 * Writes are outbox commands naming the lesson (UX-11, LES-4). Editing arrangements, levels and pair
 * rules is in the teacher area (/teacher/grouping).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as G from '../../../shared/contracts/grouping.ts';
import type { DisplayGroup, GroupingCommandPayload, GroupingCommandType } from '../../../shared/contracts/grouping.ts';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { getOutbox, type CommandInvalidation } from '../../lib/outbox-client.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { showToast } from '../../lib/toast.ts';
import { BigButton, Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { IconUsers, IconX } from '../../ui/icons.tsx';
import { Avatar } from '../../ui/Students.tsx';
import { lessonKey, useLessonState } from '../lessons/lessonClient.ts';
import type { ClassroomContext, DashboardSlot } from '../types.ts';

const arrangementsKey = (contextId: string) => ['classroom', 'grouping', 'arrangements', contextId] as const;

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

/** One group card: icon + name, then each member with avatar, name and role (GRP-6). */
export function GroupCard({ group }: { group: DisplayGroup }) {
  const { t, locale } = useI18n();
  const name = pickText(group.name, locale);
  return (
    <li className="cc-group" aria-label={t('grouping.groupLabel', { name, count: group.members.length })}>
      <div className="cc-group__head">
        <span className="cc-group__icon" aria-hidden="true">
          {group.icon}
        </span>
        <span className="cc-group__name">{name}</span>
      </div>
      <ul className="cc-group__members">
        {group.members.map((m) => (
          <li key={m.id} className="cc-row">
            <Avatar name={m.fullName} id={m.id} hue={m.avatarHue} initials={m.initials} size="sm" />
            <span>{m.fullName}</span>
            {m.role ? <span className="cc-chip">{pickText(m.role, locale)}</span> : null}
          </li>
        ))}
      </ul>
    </li>
  );
}

function ChooseDialog({ context, lesson, current, isOpen, onOpenChange }: { context: ClassroomContext; lesson: LessonState; current: string | null; isOpen: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: arrangementsKey(context.id), queryFn: () => call(G.classroomArrangements, { contextId: context.id }), enabled: isOpen });
  const choose = async (templateId: string) => {
    onOpenChange(false);
    await sendGroupingCommand('grouping.apply', { contextId: context.id, lessonId: lesson.id, templateId });
    showToast({ message: t('grouping.toast.applied', { className: context.className }), kind: 'success', scope: 'classroom' });
  };
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('grouping.chooseTitle')}>
      <p className="cc-muted">{t('grouping.chooseHint')}</p>
      {q.data ? (
        q.data.arrangements.length ? (
          <ul className="cc-stack" aria-label={t('grouping.arrangements')}>
            {q.data.arrangements.map((a) => (
              <li key={a.id}>
                <BigButton variant={a.id === current ? 'primary' : 'secondary'} aria-pressed={a.id === current} onPress={() => void choose(a.id)}>
                  <IconUsers />
                  {pickText(a.name, locale)}
                  <span className="cc-muted">{t('grouping.groupCount', { count: a.groupCount })}</span>
                </BigButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cc-muted">{t('grouping.noArrangements')}</p>
        )
      ) : (
        <p className="cc-muted">{t('common.loading')}</p>
      )}
      <DialogActions>
        <Button onPress={() => onOpenChange(false)}>{t('common.close')}</Button>
      </DialogActions>
    </Modal>
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
        <div className="cc-row cc-push-right">
          <Button onPress={() => setOpen(true)}>
            <IconUsers />
            {st.applied ? t('grouping.change') : t('grouping.choose')}
          </Button>
          {st.applied ? (
            <Button onPress={() => void sendGroupingCommand('grouping.clear', { contextId: context.id, lessonId: lesson.id })}>
              <IconX />
              {t('grouping.hide')}
            </Button>
          ) : null}
        </div>
      </div>
      {st.applied ? (
        <>
          <ul className="cc-groups" aria-label={t('grouping.title')}>
            {st.groups.map((g) => (
              <GroupCard key={g.id} group={g} />
            ))}
          </ul>
          {st.excludedCount ? <p className="cc-muted">{t('grouping.excluded', { count: st.excludedCount })}</p> : null}
          {st.notPlacedCount ? <p className="cc-muted">{t('grouping.notPlaced', { count: st.notPlacedCount })}</p> : null}
          {st.unsatisfiedCount ? <p className="cc-muted">{t('grouping.unsatisfiedCount', { count: st.unsatisfiedCount })}</p> : null}
        </>
      ) : (
        <p className="cc-muted">{t('grouping.none')}</p>
      )}
      <ChooseDialog context={context} lesson={lesson} current={st.arrangementId} isOpen={open} onOpenChange={setOpen} />
    </section>
  );
}

export const groupsDashboardSlot: DashboardSlot = { key: 'grouping', module: 'grouping', order: 60, Component: GroupsSlot };

