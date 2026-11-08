/**
 * Help inside the small entries (student page, Super Speakers scorer app): one guide in the page's
 * language, with a button back. Loaded with a dynamic import so these bundles stay small. Links to
 * other guides open them here.
 */
import { useState } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import type { GuideId } from './guides.ts';
import { GuideView } from './GuideView.tsx';

export default function HelpPanel({ guide: first, onClose }: { guide: GuideId; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [guide, setGuide] = useState<GuideId>(first);
  return (
    <section className="cc-card cc-stack cc-help-panel" aria-label={t('help.title')} data-testid="help-panel">
      <div>
        <Button onPress={onClose}>{t('help.close')}</Button>
      </div>
      <GuideView guide={guide} locale={locale} links={{ href: () => '#', open: (g) => setGuide(g) }} />
      <div>
        <Button onPress={onClose}>{t('help.close')}</Button>
      </div>
    </section>
  );
}
