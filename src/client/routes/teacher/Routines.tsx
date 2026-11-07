/**
 * Routine templates (RTN-1/2, CFG-3), teacher area: create, rename, reorder/add/remove/rename
 * stages, choose the default routine per class+subject. A running lesson keeps the routine it
 * started with; edits apply from the next lesson.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_ROUTINE_ID, MAX_STAGES } from '../../../domain/routines.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import * as L from '../../../shared/contracts/lessons.ts';
import * as School from '../../../shared/contracts/school.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { Alert, EmptyState } from '../../ui/Feedback.tsx';
import { Select, TextField } from '../../ui/Fields.tsx';
import { IconArchive, IconChevronDown, IconChevronUp, IconCopy, IconPlus, IconX } from '../../ui/icons.tsx';

const ROUTINES_KEY = [SENSITIVE, 'teacher', 'routines'] as const;
const CONTEXTS_KEY = ['classroom', 'contexts'] as const;

type Template = L.RoutineTemplate;
interface DraftStage {
  key: string;
  id?: string | undefined;
  en: string;
  tr: string;
}
interface Draft {
  id: string | null;
  en: string;
  tr: string;
  contextId: string;
  stages: DraftStage[];
}

let draftSeq = 0;
const draftOf = (t: Template, asNew = false): Draft => ({
  id: asNew ? null : t.id,
  en: t.name.en ?? '',
  tr: t.name.tr ?? '',
  contextId: t.contextId ?? '',
  stages: t.stages.map((s) => ({ key: `s${draftSeq++}`, id: s.id, en: s.name.en ?? '', tr: s.name.tr ?? '' })),
});
const text = (en: string, tr: string): LocalizedTextValue => ({ ...(en.trim() ? { en: en.trim() } : {}), ...(tr.trim() ? { tr: tr.trim() } : {}) });

function Editor({ draft, onChange, onSave, onCancel, contexts }: { draft: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void; contexts: Array<{ id: string; label: string }> }) {
  const { t } = useI18n();
  const move = (i: number, by: number) => {
    const stages = [...draft.stages];
    const [s] = stages.splice(i, 1);
    stages.splice(i + by, 0, s!);
    onChange({ ...draft, stages });
  };
  const setStage = (i: number, patch: Partial<DraftStage>) => onChange({ ...draft, stages: draft.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const valid = Boolean(draft.en.trim() || draft.tr.trim()) && draft.stages.length > 0 && draft.stages.every((s) => s.en.trim() || s.tr.trim());
  return (
    <form
      className="cc-card cc-stack"
      aria-label={t('routines.editor')}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave();
      }}
    >
      <div className="cc-row" style={{ alignItems: 'flex-start' }}>
        <TextField label={t('common.nameEn')} value={draft.en} onChange={(en) => onChange({ ...draft, en })} />
        <TextField label={t('common.nameTr')} value={draft.tr} onChange={(tr) => onChange({ ...draft, tr })} />
        <Select
          label={t('routines.scope')}
          value={draft.contextId}
          onChange={(contextId) => onChange({ ...draft, contextId })}
          items={[{ id: '', label: t('routines.allClasses') }, ...contexts]}
        />
      </div>
      <h3 className="cc-h2">{t('routines.stages')}</h3>
      <ol className="cc-stage-list">
        {draft.stages.map((s, i) => (
          <li key={s.key} className="cc-row">
            <span className="cc-stage-list__num" aria-hidden="true">
              {i + 1}
            </span>
            <TextField label={t('routines.stageEn', { n: i + 1 })} value={s.en} onChange={(en) => setStage(i, { en })} />
            <TextField label={t('routines.stageTr', { n: i + 1 })} value={s.tr} onChange={(tr) => setStage(i, { tr })} />
            <Button size="small" aria-label={t('routines.moveUp', { n: i + 1 })} isDisabled={i === 0} onPress={() => move(i, -1)}>
              <IconChevronUp />
            </Button>
            <Button size="small" aria-label={t('routines.moveDown', { n: i + 1 })} isDisabled={i === draft.stages.length - 1} onPress={() => move(i, 1)}>
              <IconChevronDown />
            </Button>
            <Button size="small" aria-label={t('routines.removeStage', { n: i + 1 })} isDisabled={draft.stages.length <= 1} onPress={() => onChange({ ...draft, stages: draft.stages.filter((_, j) => j !== i) })}>
              <IconX />
            </Button>
          </li>
        ))}
      </ol>
      <div>
        <Button isDisabled={draft.stages.length >= MAX_STAGES} onPress={() => onChange({ ...draft, stages: [...draft.stages, { key: `s${draftSeq++}`, en: '', tr: '' }] })}>
          <IconPlus />
          {t('routines.addStage')}
        </Button>
      </div>
      {!valid ? <p className="cc-field__hint">{t('routines.needNames')}</p> : null}
      <div className="cc-dialog__actions">
        <Button onPress={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" isDisabled={!valid}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

export function RoutinesPage() {
  const { t, locale } = useI18n();
  const run = useRun();
  const list = useQuery({ queryKey: ROUTINES_KEY, queryFn: () => call(L.listRoutineTemplates, {}) });
  const contexts = useQuery({ queryKey: CONTEXTS_KEY, queryFn: () => call(School.myContexts, {}) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const ctxItems = (contexts.data?.contexts ?? []).map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }));
  const templates = list.data?.templates ?? [];
  const usableIn = (contextId: string) => templates.filter((x) => !x.archived && (x.contextId === null || x.contextId === contextId));

  const save = async () => {
    if (!draft) return;
    const body = { name: text(draft.en, draft.tr), contextId: draft.contextId || null, stages: draft.stages.map((s) => ({ ...(s.id ? { id: s.id } : {}), name: text(s.en, s.tr) })) };
    const ok = await run(() => (draft.id ? call(L.updateRoutineTemplate, { templateId: draft.id, ...body }) : call(L.createRoutineTemplate, body)), {
      success: t('routines.saved'),
      invalidate: [ROUTINES_KEY, ['classroom', 'routines']],
    });
    if (ok) setDraft(null);
  };

  return (
    <main className="cc-page cc-stack" data-testid="routines-page">
      <h1 className="cc-h1">{t('routines.title')}</h1>
      <Alert kind="warning">{t('routines.snapshotHint')}</Alert>

      <section className="cc-card cc-stack" aria-labelledby="routines-defaults">
        <h2 id="routines-defaults" className="cc-h2">
          {t('routines.defaults')}
        </h2>
        {ctxItems.length === 0 ? <EmptyState title={t('classroom.noClasses.title')} mascot={false} /> : null}
        {ctxItems.map((c) => (
          <Select
            key={c.id}
            label={c.label}
            value={list.data?.defaults.find((d) => d.contextId === c.id)?.templateId ?? DEFAULT_ROUTINE_ID}
            onChange={(templateId) => void run(() => call(L.setContextRoutine, { contextId: c.id, templateId }), { success: t('save.saved'), invalidate: [ROUTINES_KEY, ['classroom', 'routines']] })}
            items={usableIn(c.id).map((x) => ({ id: x.id, label: pickText(x.name, locale) }))}
          />
        ))}
      </section>

      <section className="cc-stack" aria-labelledby="routines-mine">
        <div className="cc-row">
          <h2 id="routines-mine" className="cc-h2">
            {t('routines.mine')}
          </h2>
          <Button variant="primary" onPress={() => setDraft({ id: null, en: '', tr: '', contextId: '', stages: [{ key: `s${draftSeq++}`, en: '', tr: '' }] })}>
            <IconPlus />
            {t('routines.new')}
          </Button>
        </div>
        {draft && draft.id === null ? <Editor draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setDraft(null)} contexts={ctxItems} /> : null}
        {templates
          .filter((x) => !x.archived)
          .map((x) =>
            draft?.id === x.id ? (
              <Editor key={x.id} draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setDraft(null)} contexts={ctxItems} />
            ) : (
              <article key={x.id} className="cc-card cc-stack" aria-label={pickText(x.name, locale)}>
                <div className="cc-row">
                  <h3 className="cc-h2">{pickText(x.name, locale)}</h3>
                  <span className="cc-chip">{x.builtIn ? t('routines.builtIn') : x.contextId ? (ctxItems.find((c) => c.id === x.contextId)?.label ?? '—') : t('routines.allClasses')}</span>
                </div>
                <ol className="cc-stage-preview">
                  {x.stages.map((s) => (
                    <li key={s.id}>{pickText(s.name, locale)}</li>
                  ))}
                </ol>
                <div className="cc-row">
                  {x.builtIn ? null : <Button onPress={() => setDraft(draftOf(x))}>{t('common.edit')}</Button>}
                  <Button
                    onPress={() => {
                      const d = draftOf(x, true);
                      setDraft({ ...d, en: d.en ? t('routines.copyOf', { name: d.en }) : '', tr: d.tr ? t('routines.copyOf', { name: d.tr }) : '' });
                    }}
                  >
                    <IconCopy />
                    {t('routines.copy')}
                  </Button>
                  {x.builtIn ? null : (
                    <Button onPress={() => void run(() => call(L.archiveRoutineTemplate, { templateId: x.id }), { success: t('routines.archived'), invalidate: [ROUTINES_KEY, ['classroom', 'routines']] })}>
                      <IconArchive />
                      {t('common.archive')}
                    </Button>
                  )}
                </div>
              </article>
            ),
          )}
      </section>
    </main>
  );
}
