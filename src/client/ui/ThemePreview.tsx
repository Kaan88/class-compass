import { useSyncExternalStore } from 'react';
import { themeLabelKey as sharedThemeLabelKey, type BuiltinThemeKey, type ThemeKey } from '../../shared/themes.ts';
import type { MessageKey } from '../../shared/i18n/index.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useAvailableThemes } from '../themes/custom.tsx';
import { pickerThemes, ThemeProvider, themeOf, useThemeLabels, useThemeName } from '../themes/index.tsx';
import { customThemesVersion, subscribeCustomThemes } from '../themes/registry.ts';
import { Button } from './Button.tsx';
import { Alert } from './Feedback.tsx';
import { IconCheck } from './icons.tsx';
import { Mascot, ThemeDecoration, ThemeIllustration } from './Mascot.tsx';
import { CounterBar, StudentCard } from './Students.tsx';

/** i18n key of a built-in theme's name (every built-in theme has one, test-enforced). Imported themes: `useThemeName`. */
export const themeLabelKey = (th: BuiltinThemeKey): MessageKey => sharedThemeLabelKey(th);

/**
 * The name of a class theme (built-in or imported) in the interface language; `switchedOff`: an
 * imported theme that is not enabled now (its key, marked as switched off).
 */
export function ThemeNameLabel({ theme, switchedOff = false }: { theme: ThemeKey; switchedOff?: boolean }) {
  const { t } = useI18n();
  useAvailableThemes();
  const name = useThemeName(theme);
  return <>{switchedOff ? t('themes.off.label', { key: theme }) : name}</>;
}

/** Fictional sample student used only in previews. */
const SAMPLE = { id: 'sample-student-1', fullName: 'Ada Yıldız' };

/** Live preview of a class theme: same controls and meanings in every theme (THM-3). */
export function ThemePreview({ theme, compact = false }: { theme: ThemeKey; compact?: boolean }) {
  const { t } = useI18n();
  useSyncExternalStore(subscribeCustomThemes, customThemesVersion, customThemesVersion);
  const def = themeOf(theme);
  const labels = useThemeLabels(def);
  return (
    <ThemeProvider theme={def.key} className="cc-preview" testId={`theme-preview-${def.key}`}>
      <ThemeDecoration size={compact ? 90 : 140} />
      <div className="cc-row">
        <Mascot size={compact ? 48 : 72} pose={compact ? 'idle' : 'cheer'} />
        <div>
          <strong>{labels.name}</strong>
          {compact ? null : <p className="cc-muted" style={{ margin: 0 }}>{labels.description}</p>}
        </div>
      </div>
      {compact ? null : (
        <div className="cc-stack" style={{ marginTop: '0.75rem' }}>
          <ThemeIllustration name="startLesson" width={200} />
          <CounterBar value={3} max={10} label={t('catalog.sampleCounter')} />
          <StudentCard student={SAMPLE} weeklyCount={2} level={1} onAdd={() => undefined} />
          <div className="cc-row">
            <Button variant="primary">{t('catalog.samplePrimary')}</Button>
            <Button>{t('catalog.sampleSecondary')}</Button>
          </div>
        </div>
      )}
    </ThemeProvider>
  );
}

/**
 * Theme choice as a radio group; each option shows a small live preview. Lists every built-in theme
 * and the school's enabled imported themes (S14g, D-158). `switchedOff`: `value` is an imported theme
 * that is not enabled now; no option is checked and a note says the default is shown until it is
 * enabled again (choosing an option replaces it).
 */
export function ThemePicker({ value, onChange, label, switchedOff = false }: { value: ThemeKey; onChange: (t: ThemeKey) => void; label: string; switchedOff?: boolean }) {
  const { t } = useI18n();
  useAvailableThemes();
  useSyncExternalStore(subscribeCustomThemes, customThemesVersion, customThemesVersion);
  return (
    <div className="cc-field">
      <span className="cc-field__label" id="theme-picker-label">
        {label}
      </span>
      {switchedOff ? (
        <div data-testid="theme-picker-off">
          <Alert kind="warning">{t('themes.off.picker', { key: value })}</Alert>
        </div>
      ) : null}
      <div role="radiogroup" aria-labelledby="theme-picker-label" className="cc-swatch-row cc-theme-grid">
        {pickerThemes().map((def) => (
          <button
            key={def.key}
            type="button"
            role="radio"
            aria-checked={value === def.key}
            className="cc-theme-option"
            onClick={() => onChange(def.key)}
            data-testid={`theme-option-${def.key}`}
          >
            {/* The name is inside the preview tile once; the chosen one also says "Chosen" (not colour only). */}
            <ThemePreview theme={def.key} compact />
            {value === def.key ? (
              <span className="cc-theme-option__chosen">
                <IconCheck />
                {t('theme.chosen')}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
