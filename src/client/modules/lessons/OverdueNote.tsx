/**
 * The board's note about a lesson that may be forgotten (S37, D-218): "This lesson is still running.
 * If nothing happens in it, it ends by itself at 12:35." with Still teaching. It floats above the
 * dock at the right (the notes of the toaster are at the left), so it takes no height from the
 * student grid and covers neither Attendance nor End lesson. Still teaching (`StillTeachingButton`)
 * counts as activity and is sent now or not at all, never queued: offline it is disabled with a reason
 * beside it, a failed press says why, and on success the note goes away.
 */
import { useRef } from 'react';
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { formatDate } from '../../../shared/i18n/index.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { useAboveDock } from '../../ui/Feedback.tsx';
import { IconClock } from '../../ui/icons.tsx';
import { patchLesson } from './lessonClient.ts';
import { StillTeachingButton } from './StillTeachingButton.tsx';

export function OverdueNote({ lesson, timezone }: { lesson: LessonState; timezone: string }) {
  const { t, locale } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useAboveDock(ref, true);
  const time = formatDate(lesson.autoEndAt, locale, timezone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return (
    <div ref={ref} className="cc-overdue-note" role="status" data-testid="lesson-overdue-note">
      <IconClock />
      <span className="cc-overdue-note__text">{t('lessonNotice.board', { time })}</span>
      <StillTeachingButton contextId={lesson.contextId} lessonId={lesson.id} onDone={() => patchLesson(lesson.contextId, (l) => ({ ...l, overdue: false }))} />
    </div>
  );
}
