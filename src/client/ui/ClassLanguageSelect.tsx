/** The class language mode (S13a, D-099) as one choice: English only, Turkish only, or both with a main language. */
import { CLASS_LANGUAGE_MODES, languageOfMode, modeOf, type ClassLanguage } from '../../shared/classLanguage.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Select } from './Fields.tsx';

const MODE_KEYS = { en: 'classLanguage.mode.en', tr: 'classLanguage.mode.tr', 'en+tr': 'classLanguage.mode.en+tr', 'tr+en': 'classLanguage.mode.tr+en' } as const;

export function ClassLanguageSelect({ value, onChange, isDisabled }: { value: ClassLanguage; onChange: (v: ClassLanguage) => void; isDisabled?: boolean }) {
  const { t } = useI18n();
  return (
    <Select
      label={t('classLanguage.label')}
      description={t('classLanguage.hint')}
      value={modeOf(value)}
      onChange={(v) => onChange(languageOfMode(v as (typeof CLASS_LANGUAGE_MODES)[number]))}
      items={CLASS_LANGUAGE_MODES.map((m) => ({ id: m, label: t(MODE_KEYS[m]) }))}
      disabled={isDisabled}
    />
  );
}

const SAME = 'same';

/**
 * The student pages' own language mode (S13b2, D-117): "Same as the class" (null) or one of the four
 * modes, e.g. an English-only classroom with Turkish-only student pages.
 */
export function StudentPageLanguageSelect({
  value,
  onChange,
  isDisabled,
}: {
  value: ClassLanguage | null;
  onChange: (v: ClassLanguage | null) => void;
  isDisabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Select
      label={t('classLanguage.studentPages')}
      description={t('classLanguage.studentPagesHint')}
      value={value ? modeOf(value) : SAME}
      onChange={(v) => onChange(v === SAME ? null : languageOfMode(v as (typeof CLASS_LANGUAGE_MODES)[number]))}
      items={[{ id: SAME, label: t('classLanguage.sameAsClass') }, ...CLASS_LANGUAGE_MODES.map((m) => ({ id: m, label: t(MODE_KEYS[m]) }))]}
      disabled={isDisabled}
    />
  );
}

/** The override stored on a class (null = same as the class). */
export const studentPageOverride = (c: { studentPageMainLanguage: 'en' | 'tr' | null; studentPageSecondLanguageEnabled: boolean | null }): ClassLanguage | null =>
  c.studentPageMainLanguage ? { mainLanguage: c.studentPageMainLanguage, secondLanguageEnabled: c.studentPageSecondLanguageEnabled ?? false } : null;
