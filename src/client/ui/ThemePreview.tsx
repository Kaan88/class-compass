import type { MessageKey } from '../../shared/i18n/index.ts';
import { THEMES, type ThemeName } from '../lib/display.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from './Button.tsx';
import { Mascot, ThemeDecoration } from './Mascot.tsx';
import { CounterBar, StudentCard } from './Students.tsx';

export const themeLabelKey = (th: ThemeName): MessageKey => (th === 'explorer' ? 'theme.explorer' : th === 'animals' ? 'theme.animals' : 'theme.classroom');

/** Fictional sample student used only in previews. */
const SAMPLE = { id: 'sample-student-1', fullName: 'Ada Yıldız' };

/** Live preview of a class theme: same controls and meanings in every theme (THM-3). */
export function ThemePreview({ theme, compact = false }: { theme: ThemeName; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="cc-preview" data-theme={theme} data-testid={`theme-preview-${theme}`}>
      <ThemeDecoration theme={theme} size={compact ? 90 : 140} />
      <div className="cc-row">
        <Mascot theme={theme} size={compact ? 48 : 72} />
        <strong>{t(themeLabelKey(theme))}</strong>
      </div>
      {compact ? null : (
        <div className="cc-stack" style={{ marginTop: '0.75rem' }}>
          <CounterBar value={3} max={10} label={t('catalog.sampleCounter')} />
          <StudentCard student={SAMPLE} weeklyCount={2} level={1} onAdd={() => undefined} />
          <div className="cc-row">
            <Button variant="primary">{t('catalog.samplePrimary')}</Button>
            <Button>{t('catalog.sampleSecondary')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Theme choice as a radio group; each option shows a small live preview. */
export function ThemePicker({ value, onChange, label }: { value: ThemeName; onChange: (t: ThemeName) => void; label: string }) {
  const { t } = useI18n();
  return (
    <div className="cc-field">
      <span className="cc-field__label" id="theme-picker-label">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby="theme-picker-label" className="cc-swatch-row">
        {THEMES.map((th) => (
          <button
            key={th}
            type="button"
            role="radio"
            aria-checked={value === th}
            className="cc-theme-option"
            onClick={() => onChange(th)}
            data-testid={`theme-option-${th}`}
          >
            <ThemePreview theme={th} compact />
            <span>
              {value === th ? '✓ ' : ''}
              {t(themeLabelKey(th))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
