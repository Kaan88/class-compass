/**
 * Core End Lesson step screen: a short reflection (LES-3). Kept apart from EndLesson.tsx so the
 * lessons manifest can list it without importing the flow that reads the registry.
 */
import type { LessonState } from '../../../shared/contracts/lessons.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { TextField } from '../../ui/Fields.tsx';
import { IconFace } from '../../ui/icons.tsx';
import { endStepUi } from '../types.ts';

export type ReflectionValue = { rating: number | null; note: string };
const RATINGS = [1, 2, 3, 4] as const;

function ReflectionStep({ value, onChange }: { lesson: LessonState; value: ReflectionValue; onChange: (v: ReflectionValue) => void }) {
  const { t } = useI18n();
  return (
    <div className="cc-stack">
      <div className="cc-reflect" role="radiogroup" aria-label={t('reflection.question')}>
        {RATINGS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value.rating === r}
            className="cc-reflect__option"
            onClick={() => onChange({ ...value, rating: value.rating === r ? null : r })}
          >
            <IconFace level={r} />
            <span>{t(`reflection.rating.${r}`)}</span>
          </button>
        ))}
      </div>
      <TextField label={t('reflection.note')} description={t('reflection.noteHint')} value={value.note} onChange={(note) => onChange({ ...value, note })} maxLength={500} />
    </div>
  );
}

export const reflectionStepUi = endStepUi<ReflectionValue>({ key: 'reflection', title: 'reflection.title', initial: () => ({ rating: null, note: '' }), Component: ReflectionStep });
