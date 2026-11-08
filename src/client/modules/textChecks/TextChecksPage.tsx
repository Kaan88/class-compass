/**
 * Kind words check in the teacher area (S13c item 12, D-123): the words this teacher blocks for their
 * classes, and the optional notice of how many times students tried to save blocked words (counts
 * only: the words they typed are never stored).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as School from '../../../shared/contracts/school.ts';
import * as T from '../../../shared/contracts/textChecks.ts';
import { pickText } from '../../../shared/i18n/index.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { useRun } from '../../lib/useRun.ts';
import { Button } from '../../ui/Button.tsx';
import { Select, Toggle } from '../../ui/Fields.tsx';

const WORDS_KEY = [SENSITIVE, 'teacher', 'textWords'] as const;
const noticeKey = (contextId: string) => [SENSITIVE, 'teacher', 'blockedText', contextId] as const;

/** One word per line (or comma-separated). */
export const parseWords = (s: string) => [...new Set(s.split(/[\n,]+/u).map((w) => w.trim()).filter((w) => w.length >= 2))];

function Words() {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: WORDS_KEY, queryFn: () => call(T.teacherTextWords, {}) });
  const [text, setText] = useState('');
  useEffect(() => {
    if (q.data) setText(q.data.block.join('\n'));
  }, [q.data]);
  return (
    <section className="cc-card cc-stack">
      <h2 className="cc-h2">{t('textCheck.teacherWords')}</h2>
      <p className="cc-muted">{t('textCheck.teacherWordsHint')}</p>
      <label className="cc-field">
        <span className="cc-field__label">{t('textCheck.wordsLabel')}</span>
        <textarea className="cc-input" rows={5} value={text} onChange={(e) => setText(e.target.value)} data-testid="text-words" />
      </label>
      <div>
        <Button variant="primary" onPress={() => void run(() => call(T.setTeacherTextWords, { block: parseWords(text) }), { success: t('common.saved'), invalidate: [WORDS_KEY] })}>
          {t('common.save')}
        </Button>
      </div>
    </section>
  );
}

function Notice({ contextId }: { contextId: string }) {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: noticeKey(contextId), queryFn: () => call(T.blockedTextNotice, { contextId }) });
  if (!q.data) return <p className="cc-muted">{t('common.loading')}</p>;
  return (
    <section className="cc-card cc-stack">
      <Toggle
        label={t('textCheck.notice')}
        description={t('textCheck.noticeHint')}
        isSelected={q.data.enabled}
        onChange={(v) => void run(() => call(T.setBlockedTextNotice, { contextId, enabled: v }), { invalidate: [noticeKey(contextId)] })}
      />
      {q.data.enabled ? (
        q.data.students.length ? (
          <ul className="cc-stack">
            {q.data.students.map((s) => (
              <li key={s.id}>{t('textCheck.noticeRow', { name: s.fullName, count: s.count, date: s.lastDate })}</li>
            ))}
          </ul>
        ) : (
          <p className="cc-muted">{t('textCheck.noticeNone')}</p>
        )
      ) : null}
    </section>
  );
}

export function TextChecksPage() {
  const { t, locale } = useI18n();
  const contexts = useQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => call(School.myContexts, {}) });
  const list = contexts.data?.contexts ?? [];
  const [picked, setPicked] = useState('');
  const ctx = list.find((c) => c.id === picked) ?? list[0];
  return (
    <main className="cc-page cc-stack" data-testid="text-checks-page">
      <h1 className="cc-h1">{t('teacher.textChecks')}</h1>
      <p className="cc-muted">{t('textCheck.teacherIntro')}</p>
      <Words />
      {ctx ? (
        <>
          <Select label={t('teacher.chooseClass')} items={list.map((c) => ({ id: c.id, label: `${c.className} · ${pickText(c.subjectName, locale)}` }))} value={ctx.id} onChange={setPicked} />
          <Notice key={ctx.id} contextId={ctx.id} />
        </>
      ) : null}
    </main>
  );
}
