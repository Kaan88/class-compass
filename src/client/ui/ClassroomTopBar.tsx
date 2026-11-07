/**
 * Classroom top bar (S13a, owner feedback 2026-11-07): the class name + subject on the left (always,
 * LES-4), the quote-of-the-day slot in the centre, the day, date and time + the weather slot on the
 * right; then the device controls (class language when the class has two, size, save state, sounds,
 * teacher area). The quote and weather slots are filled by S13b (`registerTopBarSlot`); while nothing
 * is registered they are not rendered at all.
 */
import type { ReactNode } from 'react';
import { pickText } from '../../shared/i18n/index.ts';
import { classLocales } from '../../shared/classLanguage.ts';
import { DENSITIES, type Density } from '../lib/classroomPrefs.ts';
import { useI18n } from '../lib/i18n.tsx';
import { topBarSlots, type TopBarSlotKey } from '../modules/classroomHooks.ts';
import type { ClassroomContext } from '../modules/types.ts';
import { Button } from './Button.tsx';

const SIZE_KEYS = { compact: 'classroom.size.compact', normal: 'classroom.size.normal', large: 'classroom.size.large' } as const;

function Slot({ slot, context }: { slot: TopBarSlotKey; context: ClassroomContext }) {
  const { locale } = useI18n();
  const list = topBarSlots(slot);
  if (!list.length) return null;
  return (
    <div className={`cc-topbar__slot cc-topbar__slot--${slot}`} data-testid={`topbar-${slot}`}>
      {list.map(({ key, Component }) => (
        <Component key={key} context={context} locale={locale} />
      ))}
    </div>
  );
}

export function ClassroomTopBar({
  context,
  dayLabel,
  dateLabel,
  timeLabel,
  density,
  onDensity,
  onLocale,
  tools,
}: {
  context: (ClassroomContext & { mainLanguage: 'en' | 'tr'; secondLanguageEnabled: boolean }) | null;
  dayLabel: string;
  dateLabel: string;
  timeLabel: string;
  density: Density;
  onDensity: (d: Density) => void;
  onLocale: (l: 'en' | 'tr') => void;
  tools: ReactNode;
}) {
  const { t, locale } = useI18n();
  const langs = context ? classLocales(context) : [];
  return (
    <header className="cc-topbar cc-classroom-bar" aria-label={t('classroom.activeClass')}>
      <div className="cc-classroom-bar__class">
        {context ? (
          <>
            <span className="cc-classroom-bar__name" data-testid="class-banner-class">
              {context.className}
            </span>
            <span className="cc-classroom-bar__subject" data-testid="class-banner-subject">
              {pickText(context.subjectName, locale)}
            </span>
          </>
        ) : (
          <span className="cc-classroom-bar__name">{t('app.name')}</span>
        )}
      </div>
      {context ? <Slot slot="quote" context={context} /> : null}
      {context ? (
        <div className="cc-classroom-bar__when">
          <time className="cc-classroom-bar__date" data-testid="topbar-date">
            <span>{dayLabel}</span> <span>{dateLabel}</span>
          </time>
          <span className="cc-classroom-bar__time" data-testid="topbar-time">
            {timeLabel}
          </span>
          <Slot slot="weather" context={context} />
        </div>
      ) : null}
      <div className="cc-classroom-bar__tools">
        {langs.length > 1 ? (
          <div className="cc-segmented" role="group" aria-label={t('classroom.language')} data-testid="class-language-switch">
            {langs.map((l) => (
              <Button key={l} size="small" aria-pressed={l === locale} onPress={() => onLocale(l)} lang={l}>
                {t(l === 'en' ? 'language.en' : 'language.tr')}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="cc-segmented" role="group" aria-label={t('classroom.size')} data-testid="density-control">
          {DENSITIES.map((d) => (
            <Button key={d} size="small" aria-pressed={d === density} onPress={() => onDensity(d)}>
              {t(SIZE_KEYS[d])}
            </Button>
          ))}
        </div>
        {tools}
      </div>
    </header>
  );
}
