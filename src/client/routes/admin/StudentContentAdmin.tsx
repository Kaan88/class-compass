/**
 * Admin → Modules: school-wide default badges (S13c item 4, D-122) and the kind words check (item 12,
 * D-123). An administrator archives a default badge for every class or restores it, and edits the
 * extra blocked / allowed words and the goal length limits. Teachers keep their own lists.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as A from '../../../shared/contracts/achievements.ts';
import * as T from '../../../shared/contracts/textChecks.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { BadgeArt } from '../../achievements/icons.tsx';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { TextArea, TextField } from '../../ui/Fields.tsx';

// Under the sensitive prefix (same as `ADMIN` in Admin.tsx), so the PIN lock purges them (PIN-3/PIN-6).
const DEFAULTS_KEY = [SENSITIVE, 'admin', 'achievementDefaults'];
const TEXT_KEY = [SENSITIVE, 'admin', 'textChecks'];

export function AchievementDefaultsSection() {
  const { t, locale } = useI18n();
  const run = useRun();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: DEFAULTS_KEY, queryFn: () => call(A.adminAchievementDefaults, {}) });
  const toggle = (achievementId: string, archived: boolean) =>
    void run(() => call(A.adminArchiveAchievementDefault, { achievementId, archived }), { success: t('save.saved') }).then((r) => r && qc.setQueryData(DEFAULTS_KEY, r));
  return (
    <section className="cc-card cc-stack" aria-labelledby="badge-defaults-title" data-testid="admin-badge-defaults">
      <h2 id="badge-defaults-title" className="cc-h2">
        {t('achievements.adminTitle')}
      </h2>
      <p className="cc-muted">{t('achievements.adminHint')}</p>
      {!q.data ? <p className="cc-muted">{t('common.loading')}</p> : null}
      <ul className="cc-stack">
        {(q.data?.definitions ?? []).map((d) => {
          const name = pickText(d.name, locale);
          return (
            <li key={d.id} className="cc-row">
              <BadgeArt icon={d.icon} tier={d.tier} size={32} locked={d.archived} />
              <span className="cc-stack">
                <strong>{name}</strong>
                <span className="cc-muted">{pickText(d.description, locale)}</span>
              </span>
              {d.archived ? <span className="cc-chip">{t('goals.schoolArchived')}</span> : null}
              <Button size="small" variant="ghost" className="cc-push-right" aria-label={`${d.archived ? t('goals.restore') : t('goals.archive')}: ${name}`} onPress={() => toggle(d.id, !d.archived)}>
                {d.archived ? t('goals.restore') : t('goals.archive')}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const lines = (s: string) =>
  s
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter(Boolean);

export function TextChecksAdminSection() {
  const { t } = useI18n();
  const run = useRun();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: TEXT_KEY, queryFn: () => call(T.adminTextChecks, {}) });
  const [block, setBlock] = useState('');
  const [allow, setAllow] = useState('');
  const [words, setWords] = useState('3');
  const [letters, setLetters] = useState('12');
  useEffect(() => {
    if (!q.data) return;
    setBlock(q.data.block.join('\n'));
    setAllow(q.data.allow.join('\n'));
    setWords(String(q.data.limits.minGoalWords));
    setLetters(String(q.data.limits.minGoalLetters));
  }, [q.data]);
  const save = () =>
    void run(() => call(T.setAdminTextChecks, { block: lines(block), allow: lines(allow), limits: { minGoalWords: Number(words), minGoalLetters: Number(letters) } }), { success: t('common.saved') }).then(
      (r) => r && qc.setQueryData(TEXT_KEY, r),
    );
  return (
    <section className="cc-card cc-stack" aria-labelledby="text-checks-admin-title" data-testid="admin-text-checks">
      <h2 id="text-checks-admin-title" className="cc-h2">
        {t('textCheck.adminTitle')}
      </h2>
      <p className="cc-muted">{t('textCheck.adminIntro')}</p>
      <div className="cc-row">
        <TextField label={t('textCheck.minGoalWords')} type="number" value={words} onChange={setWords} />
        <TextField label={t('textCheck.minGoalLetters')} type="number" value={letters} onChange={setLetters} />
      </div>
      <TextArea label={t('textCheck.adminBlock')} rows={4} value={block} onChange={setBlock} />
      <TextArea label={t('textCheck.adminAllow')} rows={4} value={allow} onChange={setAllow} />
      <div className="cc-row">
        <Button variant="primary" onPress={save} isDisabled={!q.data}>
          {t('common.save')}
        </Button>
      </div>
    </section>
  );
}
