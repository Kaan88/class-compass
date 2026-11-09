/**
 * Sentence starters in the teacher's Goals → library tab and in Admin → Modules → Goals (S14d, D-152).
 * - Teacher: the built-in starters and the teacher's own, grouped by where students see them. Own
 *   starters are archived for everyone; a default is hidden for this teacher's classes only, and one
 *   the school archived shows "Archived by the school" (D-116). A new starter needs `___` where the
 *   student writes; the server also checks its words with a sample word in the blank.
 * - Admin: every built-in starter with Archive / Restore for the whole school.
 */
import { useState } from 'react';
import * as G from '../../../shared/contracts/goals.ts';
import type { Category, Starter, StarterKind } from '../../../shared/contracts/goals.ts';
import { pickText, type MessageKey } from '../../../shared/i18n/index.ts';
import { STARTER_KINDS } from '../../../shared/text/starters.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { Button } from '../../ui/Button.tsx';
import { Select, TextField } from '../../ui/Fields.tsx';
import { IconArchive, IconPlus, IconUndo } from '../../ui/icons.tsx';

const kindKey = (k: StarterKind) => `goals.starters.kind.${k}` as MessageKey;
const localized = (en: string, tr: string) => ({ ...(en.trim() ? { en: en.trim() } : {}), ...(tr.trim() ? { tr: tr.trim() } : {}) });

export function TeacherStarters({
  contextId,
  starters,
  categories,
  showArchived,
  run,
}: {
  contextId: string;
  starters: readonly Starter[];
  categories: readonly Category[];
  showArchived: boolean;
  /** Runs the change with the page's toast and refresh; resolves to a falsy value on failure. */
  run: (fn: () => Promise<unknown>) => Promise<unknown>;
}) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<StarterKind>('goal');
  const [categoryId, setCategoryId] = useState('');
  const [en, setEn] = useState('');
  const [tr, setTr] = useState('');
  const liveCats = categories.filter((c) => !c.archived);
  const catName = (id: string | null) => pickText(categories.find((c) => c.id === id)?.name, locale);
  const shown = starters.filter((s) => showArchived || !s.archived);
  return (
    <section className="cc-card cc-stack" aria-labelledby="goals-starters" data-testid="library-starters">
      <h3 id="goals-starters" className="cc-h2">
        {t('goals.starters.title')}
      </h3>
      <p className="cc-muted">{t('goals.starters.hint')}</p>
      {STARTER_KINDS.map((k) => {
        const list = shown.filter((s) => s.kind === k);
        return (
          <div key={k} className="cc-stack">
            <h4 className="cc-h3">{t(kindKey(k))}</h4>
            {list.length === 0 ? <p className="cc-muted">{t('goals.starters.none')}</p> : null}
            <ul className="cc-stack">
              {list.map((s) => {
                const text = pickText(s.text, locale);
                return (
                  <li key={s.id} className="cc-row" data-testid="library-starter">
                    <span>{text}</span>
                    {s.categoryId ? <span className="cc-chip">{catName(s.categoryId)}</span> : null}
                    <span className="cc-chip">{s.custom ? t('goals.custom') : t('goals.default')}</span>
                    {s.archived && !s.schoolArchived ? <span className="cc-chip">{t('goals.archived')}</span> : null}
                    {s.schoolArchived ? (
                      <span className="cc-chip">{t('goals.schoolArchived')}</span>
                    ) : (
                      <Button size="small" variant="ghost" aria-label={`${s.archived ? t('goals.restore') : t('goals.archive')}: ${text}`} onPress={() => void run(() => call(G.updateStarter, { starterId: s.id, archived: !s.archived }))}>
                        {s.archived ? <IconUndo /> : <IconArchive />}
                        {s.archived ? t('goals.restore') : t('goals.archive')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className="cc-stack cc-starters__new" role="group" aria-labelledby="goals-new-starter">
        <h4 id="goals-new-starter" className="cc-h3">
          {t('goals.starters.new')}
        </h4>
        <Select label={t('goals.starters.kind')} items={STARTER_KINDS.map((k) => ({ id: k, label: t(kindKey(k)) }))} value={kind} onChange={(v) => setKind(v as StarterKind)} />
        <Select label={t('goals.starters.category')} items={[{ id: '', label: t('goals.starters.anyCategory') }, ...liveCats.map((c) => ({ id: c.id, label: pickText(c.name, locale) }))]} value={categoryId} onChange={setCategoryId} />
        <div className="cc-row">
          <TextField label={t('goals.starters.textEn')} value={en} onChange={setEn} maxLength={200} />
          <TextField label={t('goals.starters.textTr')} value={tr} onChange={setTr} maxLength={200} />
        </div>
        <div>
          <Button
            isDisabled={!en.trim() && !tr.trim()}
            onPress={() =>
              void run(() => call(G.createStarter, { contextId, kind, categoryId: categoryId || null, text: localized(en, tr) })).then((r) => {
                if (r) {
                  setEn('');
                  setTr('');
                }
              })
            }
          >
            <IconPlus />
            {t('goals.starters.add')}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Admin → Modules → Goals: the built-in starters, archived or restored for the whole school (D-116). */
export function AdminStarters({ starters, toggle }: { starters: readonly Starter[]; toggle: (id: string, archived: boolean) => void }) {
  const { t, locale } = useI18n();
  return (
    <section className="cc-card cc-stack" aria-labelledby="starter-defaults-title" data-testid="admin-starter-defaults">
      <h2 id="starter-defaults-title" className="cc-h2">
        {t('goals.adminStartersTitle')}
      </h2>
      <p className="cc-muted">{t('goals.adminStartersHint')}</p>
      {STARTER_KINDS.map((k) => (
        <div key={k} className="cc-stack">
          <h3 className="cc-h3">{t(kindKey(k))}</h3>
          <ul className="cc-stack cc-admin-list">
            {starters
              .filter((s) => s.kind === k)
              .map((s) => {
                const text = pickText(s.text, locale);
                return (
                  <li key={s.id} className="cc-admin-list__row">
                    <span className="cc-admin-list__text">
                      <span>{text}</span>
                      {s.archived ? <span className="cc-chip">{t('goals.schoolArchived')}</span> : null}
                    </span>
                    <Button size="small" className="cc-admin-list__action" aria-label={`${s.archived ? t('goals.restore') : t('goals.archive')}: ${text}`} onPress={() => toggle(s.id, !s.archived)}>
                      {s.archived ? t('goals.restore') : t('goals.archive')}
                    </Button>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </section>
  );
}
