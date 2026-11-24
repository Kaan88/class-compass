/**
 * The public privacy page (S32, D-209): `/privacy`, readable without an account. It shows the Privacy
 * guide (docs/guides/<lang>/privacy.md), the same text Help lists, in English or Turkish. A sign-in
 * provider's consent screen and a parent can both be pointed at it.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Locale } from '../../shared/i18n/index.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useMe } from '../lib/session.ts';
import { Button } from '../ui/Button.tsx';
import { GuideView, type GuideLinkHandler } from './GuideView.tsx';

// The page stands alone: a link to another guide (Help needs an account) is not followed from here.
const NO_LINKS: GuideLinkHandler = { href: () => '#', open: () => undefined };

export function PrivacyPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const [lang, setLang] = useState<Locale>(locale);
  return (
    <div className="cc-help" lang={lang}>
      <nav className="cc-topbar" aria-label={t('help.nav')}>
        <span className="cc-topbar__title">{t('app.name')}</span>
        <div className="cc-nav">{me ? <Link to="/">{t('help.backToApp')}</Link> : <Link to="/login" search={{ next: undefined, mode: undefined }}>{t('auth.signIn')}</Link>}</div>
        <div className="cc-segmented" role="group" aria-label={t('help.language')}>
          {(['en', 'tr'] as const).map((l) => (
            <Button key={l} size="small" aria-pressed={l === lang} lang={l} onPress={() => setLang(l)}>
              {t(l === 'en' ? 'language.en' : 'language.tr')}
            </Button>
          ))}
        </div>
      </nav>
      <main className="cc-page cc-help__main" data-testid="privacy-page">
        <GuideView key={lang} guide="privacy" locale={lang} links={NO_LINKS} />
      </main>
    </div>
  );
}
