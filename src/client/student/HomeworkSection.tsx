/**
 * The student's own homework in one subject with the teacher's status, read-only (S10, HW-4: no mark = not checked).
 * S13 usability: only the open and most recent items are shown first (the server sends the newest due
 * date first); older ones wait behind "Show older homework". Each status chip has an icon and a tint by
 * its kind, and its text, so the status never depends on colour alone. Dates use full day and month
 * names ("Friday 9 October", "9 Ekim Cuma").
 */
import { useState } from 'react';
import type { StudentHomeworkSection } from '../../shared/contracts/goals.ts';
import { formatDate, pickText, type Locale } from '../../shared/i18n/index.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { IconAlert, IconCheck, IconClock, IconDot, IconMinus } from '../ui/icons.tsx';

const dayText = (date: string, locale: Locale) => formatDate(Date.parse(`${date}T12:00:00Z`), locale, 'UTC', { weekday: 'long', day: 'numeric', month: 'long' });

/** Items shown before "Show older homework" (more when more are still open). */
export const HOMEWORK_FIRST = 4;

type Tone = 'success' | 'warning' | 'info' | 'plain';
const STATUS_LOOK: Record<string, { tone: Tone; Icon: () => React.JSX.Element }> = {
  completed: { tone: 'success', Icon: IconCheck },
  partly_completed: { tone: 'info', Icon: IconMinus },
  submitted_late: { tone: 'warning', Icon: IconClock },
  missing: { tone: 'warning', Icon: IconAlert },
  excused: { tone: 'info', Icon: IconDot },
  not_checked: { tone: 'plain', Icon: IconClock },
  other: { tone: 'plain', Icon: IconDot },
};

/** Today in the device's own calendar, as 'YYYY-MM-DD'. */
function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** How many items to show before "Show older": every item not yet due, and at least HOMEWORK_FIRST. */
export function homeworkVisibleCount(assignments: Array<{ dueOn: string }>, today: string): number {
  const open = assignments.filter((a) => a.dueOn >= today).length;
  return Math.max(HOMEWORK_FIRST, open);
}

export function HomeworkSection({ data, subjectId, titleId }: { data: StudentHomeworkSection; subjectId: string; titleId?: string }) {
  const { t, locale } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const first = homeworkVisibleCount(data.assignments, localToday());
  const shown = showAll ? data.assignments : data.assignments.slice(0, first);
  const older = data.assignments.length - first;
  return (
    <section className="cc-stack" aria-labelledby={titleId ?? `homework-${subjectId}`} data-testid="student-homework">
      {titleId ? null : (
        <h3 id={`homework-${subjectId}`} className="cc-h2">
          {t('student.myHomework')}
        </h3>
      )}
      {data.assignments.length === 0 ? <p className="cc-muted">{t('student.noHomework')}</p> : null}
      <ul className="cc-stack">
        {shown.map((a) => {
          const kind = a.status?.kind ?? 'not_checked';
          const look = STATUS_LOOK[kind] ?? STATUS_LOOK.other!;
          return (
            <li key={a.id} className="cc-card cc-stack" data-testid="student-homework-item">
              <strong>{a.title}</strong>
              {a.details ? <p>{a.details}</p> : null}
              <div className="cc-row">
                <span className="cc-chip">{t('homework.dueOn', { date: dayText(a.dueOn, locale) })}</span>
                <span className={look.tone === 'plain' ? 'cc-chip' : `cc-chip cc-chip--${look.tone}`} data-status-kind={kind}>
                  <look.Icon />
                  {a.status ? pickText(a.status.label, locale) || a.status.key : t('student.notChecked')}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {older > 0 ? (
        <div>
          <Button onPress={() => setShowAll((v) => !v)} aria-expanded={showAll} data-testid="student-homework-older">
            {showAll ? t('student.homeworkFewer') : t('student.homeworkOlder', { count: older })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
