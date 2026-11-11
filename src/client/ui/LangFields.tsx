/**
 * Label fields that follow the class language (S13a, D-099; CONVENTIONS "class language"): one text
 * field per language switched on for the class(es) being edited, main language first. A language that
 * is off is not shown, but its stored text is kept untouched (it comes back when the language is on
 * again). When an enabled language is empty while another has text, the field says "Needs
 * translation" (the classroom then shows the other language as a fallback).
 * S20d (D-172): every teacher-editable class-facing label editor uses it (lesson topics, assistant
 * duties, achievements, routines and their stages, counter labels and responses, homework statuses,
 * goal categories, ready-made goals and outcomes, arrangement, group and role names). Field labels
 * name the language in the teacher's interface language ("Stage 1 (Turkish)").
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { needsTranslation, studentPageLanguage, unionLocales, type ClassLanguage, type ClassLocale } from '../../shared/classLanguage.ts';
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
    // Labels a class's student pages show (S13b2, D-117) need their languages too, even when the class itself has that language off.
    return unionLocales([...(picked as ClassLanguage[]), ...picked.map((c) => studentPageLanguage(c))]);
  }, [q.data, key]);
}

export function LangFields({
  label,
  value,
  onChange,
  locales,
  testId,
  description,
  autoFocus,
}: {
  label: string;
  value: LocalizedTextValue;
  onChange: (v: LocalizedTextValue) => void;
  locales: readonly ClassLocale[];
  testId?: string | undefined;
  /** A hint under the first (main language) field. */
  description?: string | undefined;
  autoFocus?: boolean | undefined;
}) {
  const { t } = useI18n();
  const missing = needsTranslation(value, { mainLanguage: locales[0] ?? 'en', secondLanguageEnabled: locales.length > 1 });
  return (
    <div className="cc-langfields" data-testid={testId}>
      {locales.map((l, i) => (
        <div key={l} className="cc-langfields__one" data-lang={l}>
          <TextField
            label={t(l === 'en' ? 'language.field.en' : 'language.field.tr', { label })}
            value={value[l] ?? ''}
            onChange={(v) => onChange({ ...value, [l]: v })}
            {...(i === 0 && description ? { description } : {})}
            {...(i === 0 && autoFocus ? { autoFocus } : {})}
          />
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
