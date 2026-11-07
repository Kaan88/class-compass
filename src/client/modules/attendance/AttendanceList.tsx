/**
 * Quick attendance (LES-1, ATT-2, UX-7/8): one big button per student; each tap cycles
 * present → absent → late → excused. The state is text + icon + border pattern, never colour only.
 */
import type { EffectiveAttendance } from '../../../domain/attendance.ts';
import { countAttendance } from '../../../domain/attendance.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { AttendanceChip, Avatar } from '../../ui/Students.tsx';

export interface AttendanceEntry {
  id: string;
  fullName: string;
  initials: string;
  avatarHue: number;
  status: EffectiveAttendance;
  lessonOnly?: boolean;
}

export function AttendanceList({ students, onTap, label, disabled = false }: { students: AttendanceEntry[]; onTap: (id: string) => void; label: string; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <section className="cc-att-grid" aria-label={label} data-density={students.length > 24 ? 'compact' : 'regular'}>
      {students.map((s) => (
        <Button
          key={s.id}
          className="cc-att-item"
          data-status={s.status}
          isDisabled={disabled}
          aria-label={t('attendance.tapToChange', { name: s.fullName, status: t(`attendance.status.${s.status}`) })}
          onPress={() => onTap(s.id)}
        >
          <Avatar name={s.fullName} id={s.id} hue={s.avatarHue} initials={s.initials} size="sm" />
          <span className="cc-att-item__name">{s.fullName}</span>
          <AttendanceChip status={s.status} lessonOnly={s.lessonOnly ?? false} />
        </Button>
      ))}
    </section>
  );
}

/** "17 present · 1 absent · 1 late" — counts as text (RPT-5: not recorded shown separately). */
export function AttendanceCountsLine({ statuses }: { statuses: EffectiveAttendance[] }) {
  const { t } = useI18n();
  const c = countAttendance(statuses);
  const parts = (['present', 'absent', 'late', 'excused', 'not_recorded'] as const).filter((k) => c[k] > 0).map((k) => `${c[k]} ${t(`attendance.status.${k}`)}`);
  return (
    <p className="cc-att-counts" role="status" aria-live="polite" data-testid="attendance-counts">
      {parts.join(' · ')}
    </p>
  );
}
