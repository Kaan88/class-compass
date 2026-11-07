/**
 * Student-facing display components (CRD-1..3, CNT-6, RPT-5): Avatar, StudentCard, StudentGrid,
 * CounterBar, MetricCell. Designed for 18–20 cards on one 1920×1080 classroom screen; a compact
 * density kicks in automatically for larger classes (34+).
 */
import type { CSSProperties } from 'react';
import { avatarHue, initials as initialsOf } from '../../shared/text/turkish.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from './Button.tsx';
import { IconAlert, IconDot, IconPlus, IconUp, IconUserOff } from './icons.tsx';

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

/** 0 = within limits, 1 = near the threshold, 2 = threshold reached. Icon + text + pattern (UX-7). */
export type CountLevel = 0 | 1 | 2;

export function LevelChip({ level }: { level: CountLevel }) {
  const { t } = useI18n();
  const icon = level === 0 ? <IconDot /> : level === 1 ? <IconUp /> : <IconAlert />;
  return (
    <span className="cc-level" data-level={level}>
      {icon}
      {t(level === 0 ? 'card.level.0' : level === 1 ? 'card.level.1' : 'card.level.2')}
    </span>
  );
}

export interface StudentCardData {
  id: string;
  fullName: string;
  initials?: string;
  avatarHue?: number;
}

export function StudentCard({
  student,
  weeklyCount,
  level,
  absent = false,
  onAdd,
  disabled = false,
}: {
  student: StudentCardData;
  weeklyCount: number;
  level: CountLevel;
  absent?: boolean;
  onAdd?: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <article className="cc-student-card" data-absent={absent ? '' : undefined} aria-label={student.fullName}>
      <Avatar name={student.fullName} id={student.id} hue={student.avatarHue} initials={student.initials} />
      <div className="cc-student-card__name">{student.fullName}</div>
      <div className="cc-student-card__meta">
        {absent ? (
          <span className="cc-chip">
            <IconUserOff />
            {t('card.absent')}
          </span>
        ) : (
          <>
            <span className="cc-student-card__count" aria-label={t('card.weeklyCount', { count: weeklyCount })}>
              {weeklyCount}
            </span>
            <span className="cc-muted cc-student-card__week" aria-hidden="true">
              {t('card.thisWeek')}
            </span>
            <LevelChip level={level} />
          </>
        )}
      </div>
      {onAdd && !absent ? (
        <Button variant="primary" className="cc-student-card__add" aria-label={t('card.add', { name: student.fullName })} onPress={onAdd} isDisabled={disabled}>
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

/** N segments + a numeric "x / N" label (CNT-1/2). Values above N stay readable (e.g. 12 / 10). */
export function CounterBar({ value, max, label }: { value: number; max: number; label: string }) {
  const segs = Array.from({ length: Math.max(1, max) }, (_, i) => i < value);
  return (
    <div className="cc-counterbar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} / ${max}`}>
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
