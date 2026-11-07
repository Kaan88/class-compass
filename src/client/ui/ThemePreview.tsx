import { themeLabelKey as sharedThemeLabelKey, type ThemeKey } from '../../shared/themes.ts';
import type { MessageKey } from '../../shared/i18n/index.ts';
import { useI18n } from '../lib/i18n.tsx';
import { THEME_LIST, THEMES, ThemeProvider } from '../themes/index.tsx';
import { Button } from './Button.tsx';
import { Mascot, ThemeDecoration, ThemeIllustration } from './Mascot.tsx';
import { CounterBar, StudentCard } from './Students.tsx';

/** i18n key of a theme's name (every registered theme has one, test-enforced). */
export const themeLabelKey = (th: ThemeKey): MessageKey => sharedThemeLabelKey(th);

/** Fictional sample student used only in previews. */
const SAMPLE = { id: 'sample-student-1', fullName: 'Ada Yıldız' };

/** Live preview of a class theme: same controls and meanings in every theme (THM-3). */
export function ThemePreview({ theme, compact = false }: { theme: ThemeKey; compact?: boolean }) {
  const { t } = useI18n();
  const def = THEMES[theme];
  return (
    <ThemeProvider theme={theme} className="cc-preview" testId={`theme-preview-${theme}`}>
      <ThemeDecoration size={compact ? 90 : 140} />
      <div className="cc-row">
        <Mascot size={compact ? 48 : 72} pose={compact ? 'idle' : 'cheer'} />
        <div>
          <strong>{t(def.labelKey)}</strong>
          {compact ? null : <p className="cc-muted" style={{ margin: 0 }}>{t(def.descriptionKey)}</p>}
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

/** Theme choice as a radio group; each option shows a small live preview. Lists every registered theme. */
export function ThemePicker({ value, onChange, label }: { value: ThemeKey; onChange: (t: ThemeKey) => void; label: string }) {
  const { t } = useI18n();
  return (
    <div className="cc-field">
      <span className="cc-field__label" id="theme-picker-label">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby="theme-picker-label" className="cc-swatch-row">
        {THEME_LIST.map((def) => (
          <button
            key={def.key}
            type="button"
            role="radio"
            aria-checked={value === def.key}
            className="cc-theme-option"
            onClick={() => onChange(def.key)}
            data-testid={`theme-option-${def.key}`}
          >
            <ThemePreview theme={def.key} compact />
            <span>
              {value === def.key ? '✓ ' : ''}
              {t(def.labelKey)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
