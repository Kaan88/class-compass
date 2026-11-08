/**
 * "My badges" on the student page (S13c item 6, D-121, D-122): earned badges large (newest first, with
 * the date and who gave it), the badges still to earn as silhouettes with how to earn them and a
 * progress bar with its text ("2 of 3"), and the optional private level path. Nothing compares the
 * student with anyone else. New badges are celebrated once (reduced motion: a still message only);
 * then the page tells the server they were seen.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AchievementTier } from '../../shared/achievements.ts';
import { studentSeenAchievements, type StudentAchievementsSection } from '../../shared/contracts/achievements.ts';
import { pickText } from '../../shared/i18n/index.ts';
import { BadgeArt } from '../achievements/icons.tsx';
import { call } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { whenText } from '../modules/goals/shared.tsx';
import { celebrate } from '../themes/Celebration.tsx';
import { Button } from '../ui/Button.tsx';
import { STUDENT_PAGE_KEY } from './keys.ts';

const TIER_KEY: Record<AchievementTier, 'achievements.tier.bronze' | 'achievements.tier.silver' | 'achievements.tier.gold' | 'achievements.tier.none'> = {
  bronze: 'achievements.tier.bronze',
  silver: 'achievements.tier.silver',
  gold: 'achievements.tier.gold',
  none: 'achievements.tier.none',
};

/** Locked badges shown before "Show all". */
const LOCKED_FIRST = 6;

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
  // Every badge still to earn is shown (a student who has not started sees what to work towards):
  // the closest first, then the rest behind "Show all".
  const ratio = (b: (typeof data.locked)[number]) => (b.progress ? b.progress.current / b.progress.target : 0);
  const locked = [...data.locked].sort((a, b) => ratio(b) - ratio(a));
  const [showAll, setShowAll] = useState(false);
  const next = showAll ? locked : locked.slice(0, LOCKED_FIRST);
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
          <li key={b.id} className="cc-badge cc-badge--earned" data-testid="student-badge" data-new={b.isNew || undefined}>
            <BadgeArt icon={b.icon} tier={b.tier} size={72} />
            <span className="cc-stack cc-badge__text">
              <strong>{pickText(b.name, locale)}</strong>
              <span className="cc-muted">{t(TIER_KEY[b.tier])}</span>
              <span className="cc-muted" data-testid="student-badge-date">
                {t('achievements.earnedOn', { date: whenText(b.awardedAt, locale) })}
              </span>
              {b.by ? <span className="cc-muted">{t('achievements.givenBy', { name: b.by })}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {locked.length ? (
        <>
          <h4 className="cc-h3">{t('achievements.almostThere')}</h4>
          <ul className="cc-badge-list">
            {next.map((b) => {
              const p = b.progress;
              const label = p ? t('achievements.progress', { current: p.current, target: p.target }) : null;
              return (
                <li key={b.id} className="cc-badge cc-badge--locked" data-testid="student-badge-locked">
                  <BadgeArt icon={b.icon} tier={b.tier} size={44} locked />
                  <span className="cc-stack cc-badge__text">
                    <strong>{pickText(b.name, locale)}</strong>
                    <span className="cc-muted">{pickText(b.description, locale)}</span>
                    {p && label ? (
                      <span className="cc-badge__progress">
                        <progress className="cc-progress" value={p.current} max={p.target} aria-label={`${pickText(b.name, locale)}: ${label}`} />
                        <span>{label}</span>
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {locked.length > LOCKED_FIRST ? (
            <Button onPress={() => setShowAll((v) => !v)} data-testid="student-badges-all">
              {showAll ? t('achievements.showFewer') : t('achievements.showAll', { count: locked.length })}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
