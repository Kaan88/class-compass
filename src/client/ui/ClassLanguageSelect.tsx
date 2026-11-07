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
