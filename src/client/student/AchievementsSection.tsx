/**
 * "My badges" on the student page (S13c item 6, D-121, D-122): earned badges large (newest first, with
 * the date and who gave it), the badges still to earn as silhouettes with how to earn them and a
 * progress bar with its text ("2 of 3"), and the optional private level path. Nothing compares the
 * student with anyone else. New badges are celebrated once (reduced motion: a still message only);
 * then the page tells the server they were seen.
 * S13 usability: only the newest earned badges are shown first (the rest behind "Show all my badges");
 * every card, earned or still to earn, shows its tier word and what it is for, so two badges with the
 * same name (one family of tiers) and an earned tier next to the next tier
 * ("On a roll" Bronze earned, Silver next) are told apart.
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
export const LOCKED_FIRST = 4;
/** Earned badges shown before "Show all my badges" (newest first). */
export const EARNED_FIRST = 4;

/** Celebrations already shown this visit (StrictMode and re-renders must not repeat them). */
const celebrated = new Set<string>();

/**
 * New achievements are celebrated when the page opens, on any screen (S14d: the achievements are now
 * behind a tile, D-151), once per visit; then the page tells the server they were seen.
 */
export function useCelebrateNewAchievements(items: ReadonlyArray<{ subjectId: string; data: StudentAchievementsSection }>) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const fresh = items.flatMap(({ subjectId, data }) => data.earned.filter((b) => b.isNew && !celebrated.has(`${subjectId}:${b.id}`)).map((b) => ({ subjectId, b })));
  const sent = useRef(false);
  useEffect(() => {
    if (!fresh.length) return;
    for (const { subjectId, b } of fresh) celebrated.add(`${subjectId}:${b.id}`);
    const first = fresh[0]!.b;
    celebrate(fresh.length === 1 ? t('achievements.newBadge', { name: pickText(first.name, locale) }) : t('achievements.newBadges', { count: fresh.length }));
    if (!sent.current) {
      sent.current = true;
      void call(studentSeenAchievements, {}).then(() => qc.invalidateQueries({ queryKey: STUDENT_PAGE_KEY }));
    }
  }, [fresh, t, locale, qc]);
}

export function AchievementsSection({ data, subjectId, titleId }: { data: StudentAchievementsSection; subjectId: string; titleId?: string }) {
  const { t, locale } = useI18n();
  // Every badge still to earn is shown (a student who has not started sees what to work towards):
  // the closest first, then the rest behind "Show all".
  const ratio = (b: (typeof data.locked)[number]) => (b.progress ? b.progress.current / b.progress.target : 0);
  const locked = [...data.locked].sort((a, b) => ratio(b) - ratio(a));
  const [showAll, setShowAll] = useState(false);
  const [showEarned, setShowEarned] = useState(false);
  const next = showAll ? locked : locked.slice(0, LOCKED_FIRST);
  // New badges always stay in view, even when there are more than EARNED_FIRST.
  const earned = showEarned ? data.earned : data.earned.filter((b, i) => i < EARNED_FIRST || b.isNew);
  return (
    <section className="cc-stack" aria-labelledby={titleId ?? `badges-${subjectId}`} data-testid="student-achievements">
      {titleId ? null : (
        <h3 id={`badges-${subjectId}`} className="cc-h2">
          {t('achievements.myBadges')}
        </h3>
      )}
      {data.level ? (
        <p className="cc-card cc-row cc-level" data-testid="student-level">
          <strong>{pickText(data.level.name, locale)}</strong>
          <span className="cc-muted">{data.level.nextAt !== null ? t('achievements.levelNext', { points: data.level.points, next: data.level.nextAt }) : t('achievements.levelTop', { points: data.level.points })}</span>
        </p>
      ) : null}
      {data.earned.length === 0 ? <p className="cc-muted">{t('achievements.noneYet')}</p> : null}
      <ul className="cc-badge-list">
        {earned.map((b) => (
          <li key={b.id} className="cc-badge cc-badge--earned" data-testid="student-badge" data-new={b.isNew || undefined}>
            <BadgeArt icon={b.icon} tier={b.tier} size={72} />
            <span className="cc-stack cc-badge__text">
              <strong>{pickText(b.name, locale)}</strong>
              <span className="cc-muted">{t(TIER_KEY[b.tier])}</span>
              <span className="cc-muted">{pickText(b.description, locale)}</span>
              <span className="cc-muted" data-testid="student-badge-date">
                {t('achievements.earnedOn', { date: whenText(b.awardedAt, locale) })}
              </span>
              {b.by ? <span className="cc-muted">{t('achievements.givenBy', { name: b.by })}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {data.earned.length > earned.length || showEarned ? (
        <div>
          <Button onPress={() => setShowEarned((v) => !v)} aria-expanded={showEarned} data-testid="student-badges-earned-all">
            {showEarned ? t('achievements.showFewer') : t('achievements.showAllEarned', { count: data.earned.length })}
          </Button>
        </div>
      ) : null}
      {locked.length ? (
        <>
          {titleId ? <h2 className="cc-h3">{t('achievements.almostThere')}</h2> : <h4 className="cc-h3">{t('achievements.almostThere')}</h4>}
          <ul className="cc-badge-list">
            {next.map((b) => {
              const p = b.progress;
              const label = p ? t('achievements.progress', { current: p.current, target: p.target }) : null;
              return (
                <li key={b.id} className="cc-badge cc-badge--locked" data-testid="student-badge-locked">
                  <BadgeArt icon={b.icon} tier={b.tier} size={44} locked />
                  <span className="cc-stack cc-badge__text">
                    <strong>{pickText(b.name, locale)}</strong>
                    <span className="cc-muted">{t(TIER_KEY[b.tier])}</span>
                    <span className="cc-muted">{pickText(b.description, locale)}</span>
                    {p && label ? (
                      <span className="cc-badge__progress">
                        <progress className="cc-progress" value={p.current} max={p.target} aria-label={`${pickText(b.name, locale)}: ${label}`} />
                        <span className="cc-badge__count">{label}</span>
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {locked.length > LOCKED_FIRST ? (
            <Button onPress={() => setShowAll((v) => !v)} aria-expanded={showAll} data-testid="student-badges-all">
              {showAll ? t('achievements.showFewer') : t('achievements.showAll', { count: locked.length })}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
