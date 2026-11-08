/**
 * Help (user documentation): the bundled guides, read-only, in the interface language of the signed-in
 * account by default, with a switch to the other language. `/help?guide=<id>&lang=<en|tr>`.
 * The guides are generic and use the fictional demo school only, so the page holds nothing
 * sensitive; it still needs a signed-in account like the rest of the app.
 */
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { Locale } from '../../shared/i18n/index.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useMe } from '../lib/session.ts';
import { Button } from '../ui/Button.tsx';
import { GUIDE_IDS, GUIDE_TITLE_KEYS, isGuideId, type GuideId } from './guides.ts';
import { GuideView, type GuideLinkHandler } from './GuideView.tsx';

interface HelpSearch {
  guide?: string | undefined;
  lang?: Locale | undefined;
}

export function HelpPage() {
  const { t } = useI18n();
  const me = useMe();
  const search = useSearch({ strict: false }) as HelpSearch;
  const navigate = useNavigate();
  const role = me?.role ?? 'teacher';
  const fallback: GuideId = role === 'admin' ? 'admin' : 'teacher';
  const guide: GuideId = isGuideId(search.guide) ? search.guide : fallback;
  const lang: Locale = search.lang ?? me?.locale ?? 'en';
  const links: GuideLinkHandler = {
    href: (g, anchor) => `/help?guide=${g}&lang=${lang}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`,
    open: (g, anchor) => void navigate({ to: '/help', search: { guide: g, lang }, ...(anchor ? { hash: anchor } : {}) }),
  };
  const anchor = typeof window !== 'undefined' && window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : null;
  return (
    <div className="cc-help">
      <nav className="cc-topbar" aria-label={t('help.nav')}>
        <span className="cc-topbar__title">{t('help.title')}</span>
        <div className="cc-nav">
          <Link to={role === 'admin' ? '/admin' : '/teacher'}>{t('help.backToApp')}</Link>
        </div>
        <div className="cc-segmented" role="group" aria-label={t('help.language')}>
          {(['en', 'tr'] as const).map((l) => (
            <Button key={l} size="small" aria-pressed={l === lang} lang={l} onPress={() => void navigate({ to: '/help', search: { guide, lang: l } })}>
              {t(l === 'en' ? 'language.en' : 'language.tr')}
            </Button>
          ))}
        </div>
      </nav>
      <div className="cc-page cc-help__layout">
        <nav className="cc-help__toc" aria-label={t('help.guides')}>
          <ul>
            {GUIDE_IDS.map((g) => (
              <li key={g}>
                <Link to="/help" search={{ guide: g, lang }} aria-current={g === guide ? 'page' : undefined}>
                  {t(GUIDE_TITLE_KEYS[g])}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="cc-help__main" data-testid="help-page">
          <GuideView key={`${lang}/${guide}`} guide={guide} locale={lang} anchor={anchor} links={links} />
        </main>
      </div>
    </div>
  );
}
