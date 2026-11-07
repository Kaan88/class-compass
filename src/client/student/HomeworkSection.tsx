/** The student's own homework in one subject with the teacher's status, read-only (S10, HW-4: no mark = not checked). */
import type { StudentHomeworkSection } from '../../shared/contracts/goals.ts';
import { formatDate, pickText, type Locale } from '../../shared/i18n/index.ts';
import { useI18n } from '../lib/i18n.tsx';

const dayText = (date: string, locale: Locale) => formatDate(Date.parse(`${date}T12:00:00Z`), locale, 'UTC', { weekday: 'short', day: 'numeric', month: 'short' });

export function HomeworkSection({ data, subjectId }: { data: StudentHomeworkSection; subjectId: string }) {
  const { t, locale } = useI18n();
  return (
    <section className="cc-stack" aria-labelledby={`homework-${subjectId}`} data-testid="student-homework">
      <h3 id={`homework-${subjectId}`} className="cc-h2">
        {t('student.myHomework')}
      </h3>
      {data.assignments.length === 0 ? <p className="cc-muted">{t('student.noHomework')}</p> : null}
      <ul className="cc-stack">
        {data.assignments.map((a) => (
          <li key={a.id} className="cc-card cc-stack">
            <strong>{a.title}</strong>
            {a.details ? <p>{a.details}</p> : null}
            <div className="cc-row">
              <span className="cc-chip">{t('homework.dueOn', { date: dayText(a.dueOn, locale) })}</span>
              <span className="cc-chip" data-status-kind={a.status?.kind ?? 'not_checked'}>
                {a.status ? pickText(a.status.label, locale) || a.status.key : t('student.notChecked')}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
