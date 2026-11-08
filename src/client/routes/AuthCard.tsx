/** The card that frames the sign-in, reset, invite and email-link screens. */
import type { ReactNode } from 'react';
import { translate } from '../../shared/i18n/index.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useMe } from '../lib/session.ts';
import { chooseSignedOutLocale } from '../lib/signedOutLocale.ts';
import { Button } from '../ui/Button.tsx';
import { Mascot, ThemeDecoration } from '../ui/Mascot.tsx';

/**
 * Signed out, the card offers English | Türkçe (remembered on this device, lib/signedOutLocale.ts).
 * Signed in (the forced password change) the account's own language applies (UX-4), so no switch;
 * the invite form passes `languageSwitch={false}` because it is shown in the invited account's language.
 */
export function AuthCard({ title, children, languageSwitch = true }: { title: string; children: ReactNode; languageSwitch?: boolean }) {
  const { t, locale } = useI18n();
  const me = useMe();
  return (
    <main className="cc-page" style={{ maxWidth: '32rem', position: 'relative' }}>
      <div className="cc-card cc-stack" style={{ position: 'relative', overflow: 'hidden', marginTop: '3rem' }}>
        <ThemeDecoration size={160} />
        {languageSwitch && !me ? (
          <div className="cc-row cc-segmented cc-auth__lang" role="group" aria-label={t('language.label')} data-testid="auth-language">
            {(['en', 'tr'] as const).map((l) => (
              <Button key={l} size="small" aria-pressed={l === locale} lang={l} onPress={() => chooseSignedOutLocale(l)}>
                {translate(l, l === 'en' ? 'language.en' : 'language.tr')}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="cc-row">
          <Mascot size={72} />
          <div>
            <p className="cc-muted" style={{ margin: 0, fontWeight: 700 }}>
              {t('app.name')}
            </p>
            <h1 className="cc-h1">{title}</h1>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
