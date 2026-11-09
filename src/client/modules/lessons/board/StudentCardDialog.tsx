/**
 * The classroom student card (S14e2, D-154): tapping a name on the classroom board opens this small
 * card. The class can see it, so it shows POSITIVE things only, from
 * `GET /api/classroom/contexts/:contextId/students/:studentId/card` (`classroom` access, works while
 * the teacher area is locked): recent achievements, the student's own Super Speakers points this week
 * (never a rank), days as the daily assistant this term and, while the reminder boxes are on, the
 * counts the card already shows. There is deliberately NO link to the full statistics here: those
 * are teacher-only and open from a name in the teacher area.
 */
import { useQuery } from '@tanstack/react-query';
import { BadgeArt } from '../../../achievements/icons.tsx';
import { classroomStudentCard, type ClassroomCardItem } from '../../../../shared/contracts/classroomCard.ts';
import { formatDay, pickText, type MessageKey } from '../../../../shared/i18n/index.ts';
import { call } from '../../../lib/api.ts';
import { errorText } from '../../../lib/errors.ts';
import { useI18n } from '../../../lib/i18n.tsx';
import { Modal } from '../../../ui/Dialog.tsx';
import { Alert } from '../../../ui/Feedback.tsx';
import { Avatar } from '../../../ui/Students.tsx';

export const classroomCardKey = (contextId: string, studentId: string) => ['classroom', 'studentCard', contextId, studentId] as const;

function CardItem({ item }: { item: ClassroomCardItem }) {
  const { t, locale } = useI18n();
  switch (item.key) {
    case 'achievements':
      return (
        <section className="cc-class-card__item" aria-labelledby="class-card-achievements">
          <h3 className="cc-h3" id="class-card-achievements">
            {t('classroomCard.achievements')}
          </h3>
          <ul className="cc-class-card__badges">
            {item.data.items.map((a) => (
              <li key={a.id}>
                <BadgeArt icon={a.icon} tier={a.tier} size={44} />
                <span>
                  <strong>{pickText(a.name, locale)}</strong>
                  <span className="cc-muted">
                    {/* The tier as a word too, never the badge's shape alone (D-124). */}
                    {`${t(`achievements.tier.${a.tier}` as MessageKey)} · ${formatDay(a.awardedOn, locale)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      );
    case 'superSpeakers':
      return (
        <section className="cc-class-card__item">
          <h3 className="cc-h3">{t('classroomCard.speakers')}</h3>
          <p className="cc-class-card__big">{t('classroomCard.points', { count: item.data.points })}</p>
        </section>
      );
    case 'assistant':
      return (
        <section className="cc-class-card__item">
          <h3 className="cc-h3">{t('classroomCard.assistant')}</h3>
          <p className="cc-class-card__big">{t('classroomCard.assistantDays', { count: item.data.days })}</p>
        </section>
      );
    case 'counters':
      return (
        <section className="cc-class-card__item" aria-labelledby="class-card-counters">
          <h3 className="cc-h3" id="class-card-counters">
            {t('classroomCard.counters')}
          </h3>
          <ul className="cc-class-card__counts">
            {item.data.counters.map((c) => (
              <li key={c.id} data-colour={c.colour}>
                <span>{pickText(c.labels.individual, locale) || pickText(c.labels.main, locale)}</span>
                <strong>{c.count}</strong>
              </li>
            ))}
          </ul>
        </section>
      );
  }
}

export function StudentCardDialog({ contextId, student, onClose }: { contextId: string; student: { id: string; fullName: string; initials?: string; avatarHue?: number }; onClose: () => void }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: classroomCardKey(contextId, student.id), queryFn: () => call(classroomStudentCard, { contextId, studentId: student.id }), staleTime: 0 });
  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} title={student.fullName} testId="classroom-student-card" closeButton>
      <div className="cc-class-card">
        <Avatar name={student.fullName} id={student.id} hue={student.avatarHue} initials={student.initials} size="lg" />
        <div className="cc-stack">
          {q.error ? <Alert>{errorText(t, q.error)}</Alert> : null}
          {q.isLoading ? <p className="cc-muted">{t('common.loading')}</p> : null}
          {q.data && !q.data.items.length ? <p className="cc-class-card__big">{t('classroomCard.empty')}</p> : null}
          {q.data?.items.map((item) => <CardItem key={item.key} item={item} />)}
        </div>
      </div>
    </Modal>
  );
}
