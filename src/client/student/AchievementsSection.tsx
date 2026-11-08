/**
 * "My badges" on the student page (S13c item 6, D-121, D-122): earned badges (newest first), the next
 * ones with gentle progress ("2 of 3"), and the optional private level path. Nothing compares the
 * student with anyone else. New badges are celebrated once (reduced motion: a still message only);
 * then the page tells the server they were seen.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AchievementTier } from '../../shared/achievements.ts';
import { studentSeenAchievements, type StudentAchievementsSection } from '../../shared/contracts/achievements.ts';
import { pickText } from '../../shared/i18n/index.ts';
import { BadgeArt } from '../achievements/icons.tsx';
import { call } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { celebrate } from '../themes/Celebration.tsx';
import { STUDENT_PAGE_KEY } from './keys.ts';

const TIER_KEY: Record<AchievementTier, 'achievements.tier.bronze' | 'achievements.tier.silver' | 'achievements.tier.gold' | 'achievements.tier.none'> = {
  bronze: 'achievements.tier.bronze',
  silver: 'achievements.tier.silver',
  gold: 'achievements.tier.gold',
  none: 'achievements.tier.none',
};

/** Celebrations already shown this visit (StrictMode and re-renders must not repeat them). */
const celebrated = new Set<string>();

export function AchievementsSection({ data, subjectId }: { data: StudentAchievementsSection; subjectId: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const fresh = data.earned.filter((b) => b.isNew && !celebrated.has(`${subjectId}:${b.id}`));
  const sent = useRef(false);
  useEffect(() => {
    if (!fresh.length) return;
    for (const b of fresh) celebrated.add(`${subjectId}:${b.id}`);
    const first = fresh[0]!;
    celebrate(fresh.length === 1 ? t('achievements.newBadge', { name: pickText(first.name, locale) }) : t('achievements.newBadges', { count: fresh.length }));
    if (!sent.current) {
      sent.current = true;
      void call(studentSeenAchievements, {}).then(() => qc.invalidateQueries({ queryKey: STUDENT_PAGE_KEY }));
    }
  }, [fresh, t, locale, qc, subjectId]);
  const next = data.locked
    .filter((b) => b.progress && b.progress.current > 0)
    .sort((a, b) => b.progress!.current / b.progress!.target - a.progress!.current / a.progress!.target)
    .slice(0, 6);
  return (
    <section className="cc-stack" aria-labelledby={`badges-${subjectId}`} data-testid="student-achievements">
      <h3 id={`badges-${subjectId}`} className="cc-h2">
        {t('achievements.myBadges')}
      </h3>
      {data.level ? (
        <p className="cc-card cc-row cc-level" data-testid="student-level">
          <strong>{pickText(data.level.name, locale)}</strong>
          <span className="cc-muted">{data.level.nextAt !== null ? t('achievements.levelNext', { points: data.level.points, next: data.level.nextAt }) : t('achievements.levelTop', { points: data.level.points })}</span>
        </p>
      ) : null}
      {data.earned.length === 0 ? <p className="cc-muted">{t('achievements.noneYet')}</p> : null}
      <ul className="cc-badge-list">
        {data.earned.map((b) => (
          <li key={b.id} className="cc-badge" data-testid="student-badge" data-new={b.isNew || undefined}>
            <BadgeArt icon={b.icon} tier={b.tier} size={56} />
            <span className="cc-stack cc-badge__text">
              <strong>{pickText(b.name, locale)}</strong>
              <span className="cc-muted">{t(TIER_KEY[b.tier])}</span>
              {b.by ? <span className="cc-muted">{t('achievements.givenBy', { name: b.by })}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {next.length ? (
        <>
          <h4 className="cc-h3">{t('achievements.almostThere')}</h4>
          <ul className="cc-badge-list">
            {next.map((b) => (
              <li key={b.id} className="cc-badge cc-badge--locked">
                <BadgeArt icon={b.icon} tier={b.tier} size={44} locked />
                <span className="cc-stack cc-badge__text">
                  <strong>{pickText(b.name, locale)}</strong>
                  <span className="cc-muted">{pickText(b.description, locale)}</span>
                  <span>{t('achievements.progress', { current: b.progress!.current, target: b.progress!.target })}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
