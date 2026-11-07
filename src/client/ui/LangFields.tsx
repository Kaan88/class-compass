/**
 * Label fields that follow the class language (S13a, D-099; CONVENTIONS "class language"): one text
 * field per language switched on for the class(es) being edited, main language first. A language that
 * is off is not shown, but its stored text is kept untouched (it comes back when the language is on
 * again). When an enabled language is empty while another has text, the field says "Needs
 * translation" (the classroom then shows the other language as a fallback).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { needsTranslation, unionLocales, type ClassLanguage, type ClassLocale } from '../../shared/classLanguage.ts';
import type { LocalizedTextValue } from '../../shared/contracts/define.ts';
import * as School from '../../shared/contracts/school.ts';
import { call } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { TextField } from './Fields.tsx';

/** Languages to edit for these class+subjects (all of the teacher's classes when none is given). */
export function useEditorLocales(contextIds?: readonly (string | null | undefined)[]): ClassLocale[] {
  const q = useQuery({ queryKey: ['classroom', 'contexts'], queryFn: () => call(School.myContexts, {}) });
  const key = (contextIds ?? []).join(',');
  return useMemo(() => {
    const all = q.data?.contexts ?? [];
    const wanted = (contextIds ?? []).filter(Boolean) as string[];
    const picked = wanted.length ? all.filter((c) => wanted.includes(c.id)) : all;
    if (!picked.length) return ['en', 'tr'];
    return unionLocales(picked as ClassLanguage[]);
  }, [q.data, key]);
}

export function LangFields({
  label,
  value,
  onChange,
  locales,
  testId,
}: {
  label: string;
  value: LocalizedTextValue;
  onChange: (v: LocalizedTextValue) => void;
  locales: readonly ClassLocale[];
  testId?: string;
}) {
  const { t } = useI18n();
  const missing = needsTranslation(value, { mainLanguage: locales[0] ?? 'en', secondLanguageEnabled: locales.length > 1 });
  return (
    <div className="cc-langfields" data-testid={testId}>
      {locales.map((l) => (
        <div key={l} className="cc-langfields__one">
          <TextField label={`${label} (${t(l === 'en' ? 'language.en' : 'language.tr')})`} value={value[l] ?? ''} onChange={(v) => onChange({ ...value, [l]: v })} />
          {missing.includes(l) ? (
            <span className="cc-chip cc-chip--warning" data-testid="needs-translation">
              {t('language.needsTranslation')}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
