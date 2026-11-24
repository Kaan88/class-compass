/**
 * The teacher home's notices about forgotten lessons (S37, D-218), at the top of the page:
 *
 * - a lesson that may be forgotten (old enough and quiet for a while): "Your lesson in 3-A English is
 *   still running since 10:05", when it ends by itself if nothing happens in it, End lesson (opens End
 *   Lesson for that class in the classroom) and Still teaching (a classroom command that counts as
 *   activity; the banner goes at once and comes back only after another quiet spell);
 * - a lesson that ended by itself: "… ended by itself … Anything you did not finish in End Lesson was
 *   left empty." with Got it, which dismisses it for good (stored per lesson on the server, so on
 *   every device).
 *
 * Words and an icon carry the state, never colour alone; buttons are touch targets; nothing moves.
 * Times are shown in the class's timezone.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import * as L from '../../../shared/contracts/lessons.ts';
import { formatDate } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { getOutbox } from '../../lib/outbox-client.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { useRun } from '../../lib/useRun.ts';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { IconClock, IconStop } from '../../ui/icons.tsx';
import { classLabel } from './labels.ts';

export const LESSON_NOTICES_KEY = ['sensitive', 'lessonNotices'] as const;

export function LessonNotices() {
  const { t, locale } = useI18n();
  const run = useRun();
  const qc = useQueryClient();
  // A background poll (never keeps an unlock alive): the reminder appears while the page stays open.
  const q = useQuery({ queryKey: LESSON_NOTICES_KEY, queryFn: () => call(L.lessonNotices, {}), refetchInterval: 60_000 });
  const data = q.data;
  if (!data || (!data.running.length && !data.autoEnded.length)) return null;
  const time = (at: number, tz: string) => formatDate(at, locale, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return (
    <section className="cc-stack cc-lesson-notices" aria-label={t('lessonNotice.region')} data-testid="lesson-notices">
      {data.running.map((n) => (
        <div key={n.lessonId} className="cc-alert cc-alert--warning cc-lesson-notice" role="status" data-testid="lesson-notice-running">
          <IconClock />
          <div className="cc-stack cc-lesson-notice__body">
            <p className="cc-lesson-notice__text">{t('lessonNotice.running', { cls: classLabel(n, locale), time: time(n.startedAt, n.timezone) })}</p>
            <p className="cc-lesson-notice__sub">{t('lessonNotice.runningAutoEnd', { time: time(n.autoEndAt, n.timezone) })}</p>
            <div className="cc-row">
              <Link to="/classroom" search={{ endLesson: n.contextId }} className={buttonClass('primary')}>
                {t('lessonNotice.endNow')}
              </Link>
              <Button
                onPress={() => {
                  void getOutbox().enqueue('lesson.stillTeaching', { contextId: n.contextId, lessonId: n.lessonId }, { contextId: n.contextId, lessonId: n.lessonId });
                  qc.setQueryData<L.LessonNotices>(LESSON_NOTICES_KEY, (d) => (d ? { ...d, running: d.running.filter((x) => x.lessonId !== n.lessonId) } : d));
                }}
              >
                {t('lessonNotice.stillTeaching')}
              </Button>
            </div>
          </div>
        </div>
      ))}
      {data.autoEnded.map((n) => (
        <div key={n.lessonId} className="cc-alert cc-lesson-notice" role="status" data-testid="lesson-notice-auto-ended">
          <IconStop />
          <div className="cc-stack cc-lesson-notice__body">
            <p className="cc-lesson-notice__text">
              {t('lessonNotice.autoEnded', {
                cls: classLabel(n, locale),
                date: formatDate(n.startedAt, locale, n.timezone, { weekday: 'long', day: 'numeric', month: 'long' }),
                time: time(n.endedAt, n.timezone),
              })}
            </p>
            <div>
              <Button
                onPress={async () => {
                  const done = await run(() => call(L.dismissLessonNotice, { lessonId: n.lessonId }));
                  // Gone at once; the next read agrees.
                  if (done) qc.setQueryData<L.LessonNotices>(LESSON_NOTICES_KEY, (d) => (d ? { ...d, autoEnded: d.autoEnded.filter((x) => x.lessonId !== n.lessonId) } : d));
                }}
              >
                {t('lessonNotice.gotIt')}
              </Button>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
