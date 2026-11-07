/**
 * Homework on the classroom display (DSH-8, HW-1, D-075):
 * - the current assignments (due from today to a week ahead, or set today): title, details and dates.
 *   No per-student statuses and no private notes are shown here;
 * - "Check" opens the checking grid only when the class allows checking in the classroom
 *   (`checkingInClassroom`); by default checking happens in the teacher area (/teacher/homework).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as H from '../../../shared/contracts/homework.ts';
import type { ClassroomHomeworkCheck } from '../../../shared/contracts/homework.ts';
import { formatDate, type Locale } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { DialogActions, Modal } from '../../ui/Dialog.tsx';
import { IconBook, IconCheck } from '../../ui/icons.tsx';
import type { ClassroomContext, DashboardSlot } from '../types.ts';
import { CheckGrid, type CheckActions } from './CheckGrid.tsx';

const currentKey = (contextId: string) => ['classroom', 'homework', 'current', contextId] as const;
const checkKey = (assignmentId: string) => ['classroom', 'homework', 'check', assignmentId] as const;

/** 'YYYY-MM-DD' as "Tue 10 Nov". */
export const dayText = (date: string, locale: Locale) => formatDate(Date.parse(`${date}T12:00:00Z`), locale, 'UTC', { weekday: 'short', day: 'numeric', month: 'short' });

function CheckDialog({ assignmentId, contextId, onClose }: { assignmentId: string; contextId: string; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: checkKey(assignmentId), queryFn: () => call(H.classroomHomeworkCheck, { assignmentId }) });
  const actions: CheckActions = {
    set: (batchId, changes) => call(H.classroomSetHomeworkMarks, { assignmentId, batchId, changes: changes.map(({ studentId, status }) => ({ studentId, status })) }),
    remaining: (batchId, status) => call(H.classroomMarkRemainingHomework, { assignmentId, batchId, status }),
    undo: (batchId) => call(H.classroomUndoHomeworkMarks, { assignmentId, batchId }),
  };
  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} size="wide" title={q.data ? t('homework.checkTitle', { title: q.data.assignment.title }) : t('homework.check')}>
      {q.data ? (
        <CheckGrid
          check={q.data}
          actions={actions}
          withNotes={false}
          scope="classroom"
          onCheck={(c) => {
            qc.setQueryData(checkKey(assignmentId), c as ClassroomHomeworkCheck);
            void qc.invalidateQueries({ queryKey: currentKey(contextId) });
          }}
        />
      ) : (
        <p className="cc-muted">{q.isError ? t('homework.checkUnavailable') : t('common.loading')}</p>
      )}
      <DialogActions>
        <Button onPress={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Modal>
  );
}

function HomeworkSlot({ context }: { context: ClassroomContext }) {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: currentKey(context.id), queryFn: () => call(H.classroomHomework, { contextId: context.id }) });
  const [checking, setChecking] = useState<string | null>(null);
  if (!q.data) return null;
  const { assignments, checkingInClassroom, today } = q.data;
  return (
    <section className="cc-card cc-stack" aria-labelledby="cc-homework-title" data-testid="homework-panel">
      <h2 id="cc-homework-title" className="cc-h2">
        <IconBook /> {t('homework.title')}
      </h2>
      {assignments.length ? (
        <ul className="cc-stack">
          {assignments.map((a) => (
            <li key={a.id} className="cc-stack">
              <div className="cc-row">
                <strong>{a.title}</strong>
                <span className="cc-chip">{a.dueOn === today ? t('homework.dueToday') : t('homework.dueOn', { date: dayText(a.dueOn, locale) })}</span>
                {checkingInClassroom ? (
                  <Button className="cc-push-right" onPress={() => setChecking(a.id)}>
                    <IconCheck />
                    {t('homework.checkThis', { title: a.title })}
                  </Button>
                ) : null}
              </div>
              {a.details ? <p className="cc-muted">{a.details}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="cc-muted">{t('homework.noneCurrent')}</p>
      )}
      {checking ? <CheckDialog assignmentId={checking} contextId={context.id} onClose={() => setChecking(null)} /> : null}
    </section>
  );
}

export const homeworkDashboardSlot: DashboardSlot = { key: 'homework', module: 'homework', order: 70, Component: HomeworkSlot };
