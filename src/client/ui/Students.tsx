/**
 * Student-facing display components (CRD-1..3, CNT-6, RPT-5): Avatar, StudentCard, StudentGrid,
 * CounterBar, MetricCell. Designed for 18–20 cards on one 1920×1080 classroom screen; a compact
 * density kicks in automatically for larger classes (34+).
 */
import type { CSSProperties } from 'react';
import { isAway, type EffectiveAttendance } from '../../domain/attendance.ts';
import { avatarHue, initials as initialsOf } from '../../shared/text/turkish.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from './Button.tsx';
import { IconAlert, IconCheck, IconClock, IconDot, IconMinus, IconNote, IconPlus, IconUp, IconUserOff } from './icons.tsx';

export function Avatar({
  name,
  id,
  hue,
  initials,
  photoUrl,
  photoAllowed = false,
  size = 'md',
}: {
  name: string;
  id?: string;
  hue?: number;
  initials?: string;
  /** Shown only when photos are allowed by the admin media policy AND the student's consent (D-014). */
  photoUrl?: string | null;
  photoAllowed?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const h = hue ?? avatarHue(id ?? name);
  const style = { '--cc-avatar-hue': String(h) } as CSSProperties;
  return (
    <span className={`cc-avatar ${size === 'md' ? '' : `cc-avatar--${size}`}`} style={style} aria-hidden="true">
      {photoAllowed && photoUrl ? <img src={photoUrl} alt="" /> : (initials ?? initialsOf(name))}
    </span>
  );
}

/**
 * Visual level of an individual count (CNT-6): 0 neutral, 1 amber, 2 deeper amber, 3 red.
 * Always icon + text + pattern next to the number, never colour alone (UX-7).
 */
export type CountLevel = 0 | 1 | 2 | 3;

const LEVEL_KEYS = ['card.level.0', 'card.level.1', 'card.level.2', 'card.level.3'] as const;

export function LevelChip({ level }: { level: CountLevel }) {
  const { t } = useI18n();
  const icon = level === 0 ? <IconDot /> : level === 3 ? <IconAlert /> : <IconUp />;
  return (
    <span className="cc-level" data-level={level}>
      {icon}
      {t(LEVEL_KEYS[level])}
    </span>
  );
}

export interface StudentCardData {
  id: string;
  fullName: string;
  initials?: string;
  avatarHue?: number;
}

/**
 * Attendance status as icon + text + border pattern, never colour alone (UX-7, ATT-2).
 * `lessonOnly` marks a lesson exception ("this lesson").
 */
export function AttendanceChip({ status, lessonOnly = false }: { status: EffectiveAttendance; lessonOnly?: boolean }) {
  const { t } = useI18n();
  const icon = status === 'present' ? <IconCheck /> : status === 'absent' ? <IconUserOff /> : status === 'late' ? <IconClock /> : status === 'excused' ? <IconNote /> : <IconMinus />;
  return (
    <span className="cc-att-chip" data-status={status}>
      {icon}
      {t(`attendance.status.${status}`)}
      {lessonOnly ? <span className="cc-att-chip__scope">{t('attendance.thisLesson')}</span> : null}
    </span>
  );
}

export function StudentCard({
  student,
  weeklyCount,
  level,
  absent = false,
  attendance,
  onAdd,
  disabled = false,
  countLabel,
  periodLabel,
  addLabel,
  notice,
}: {
  student: StudentCardData;
  /** Counter values (S6). Omitted = no counter shown (never a fake zero). */
  weeklyCount?: number;
  level?: CountLevel;
  /** Accessible name of the count (default "{count} reminders this week"). */
  countLabel?: string;
  /** Short visible period text next to the count (default "this week"). */
  periodLabel?: string;
  /** Accessible name of the + button (default "Add a reminder for {name}"). */
  addLabel?: string;
  /** Short message shown on the card, e.g. the double-tap guard (announced politely). */
  notice?: string | null;
  absent?: boolean;
  /** Effective attendance for the lesson; absent/excused render the card as away. */
  attendance?: EffectiveAttendance;
  onAdd?: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const away = absent || (attendance !== undefined && isAway(attendance));
  return (
    <article className="cc-student-card" data-absent={away ? '' : undefined} aria-label={student.fullName}>
      <Avatar name={student.fullName} id={student.id} hue={student.avatarHue} initials={student.initials} />
      <div className="cc-student-card__name">{student.fullName}</div>
      <div className="cc-student-card__meta">
        {attendance !== undefined && attendance !== 'present' && attendance !== 'not_recorded' ? (
          <AttendanceChip status={attendance} />
        ) : absent ? (
          <span className="cc-chip">
            <IconUserOff />
            {t('card.absent')}
          </span>
        ) : null}
        {!away && weeklyCount !== undefined ? (
          <>
            <span className="cc-student-card__count" role="img" aria-label={countLabel ?? t('card.weeklyCount', { count: weeklyCount })} data-testid="student-count">
              {weeklyCount}
            </span>
            <span className="cc-muted cc-student-card__week" aria-hidden="true">
              {periodLabel ?? t('card.thisWeek')}
            </span>
            {level !== undefined ? <LevelChip level={level} /> : null}
          </>
        ) : null}
        {notice ? (
          <span className="cc-student-card__notice" role="status">
            {notice}
          </span>
        ) : null}
      </div>
      {onAdd && !away ? (
        <Button variant="primary" className="cc-student-card__add" aria-label={addLabel ?? t('card.add', { name: student.fullName })} onPress={onAdd} isDisabled={disabled}>
          <IconPlus />
        </Button>
      ) : null}
    </article>
  );
}

/** Grid of student cards; switches to a compact density above 24 students (CRD-3). */
export function StudentGrid({ children, count, label }: { children: React.ReactNode; count: number; label: string }) {
  return (
    <section className="cc-student-grid" data-density={count > 24 ? 'compact' : 'regular'} aria-label={label}>
      {children}
    </section>
  );
}

/**
 * N segments + a numeric "x / N" label (CNT-1/2). Values above N stay readable (e.g. 12 / 10).
 * `colour` is a counter colour key mapped to semantic tokens in the stylesheet (never raw colours);
 * `reached` adds a heavier outline (pattern, not colour alone).
 */
export function CounterBar({ value, max, label, colour = 'accent', reached = false }: { value: number; max: number; label: string; colour?: string; reached?: boolean }) {
  const segs = Array.from({ length: Math.max(1, max) }, (_, i) => i < value);
  return (
    <div
      className="cc-counterbar"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={`${value} / ${max}`}
      data-colour={colour}
      data-reached={reached ? '' : undefined}
    >
      <div className="cc-counterbar__segments" aria-hidden="true">
        {segs.map((on, i) => (
          <span key={i} className="cc-counterbar__seg" data-on={on ? '' : undefined} />
        ))}
      </div>
      <span className="cc-counterbar__label" aria-hidden="true">
        {value} / {max}
      </span>
    </div>
  );
}

/**
 * A metric value with optional denominator. `null` means NOT RECORDED and is shown differently from
 * zero (RPT-5).
 */
export function MetricCell({ value, denominator }: { value: number | null; denominator?: number | null }) {
  const { t } = useI18n();
  if (value === null) {
    return (
      <span className="cc-metric" data-state="not-recorded">
        — {t('metric.notRecorded')}
      </span>
    );
  }
  return (
    <span className="cc-metric" data-state="value">
      {value}
      {denominator !== undefined && denominator !== null ? <span className="cc-metric__den"> / {denominator}</span> : null}
    </span>
  );
}
