import { useEffect } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import * as Auth from '../../shared/contracts/auth.ts';
import { call } from '../lib/api.ts';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import { setDisplay, useDisplay } from '../lib/display.ts';
import { useMe } from '../lib/session.ts';
import { signedOutLocale, useStoredSignedOutLocale } from '../lib/signedOutLocale.ts';
import { buttonClass } from '../ui/Button.tsx';
import { EmptyState, Toaster } from '../ui/Feedback.tsx';
import { ManualCopyDialog } from '../ui/Dialog.tsx';
import { ThemeBackdrop } from '../ui/Mascot.tsx';
import { CelebrationLayer } from '../themes/Celebration.tsx';
import { ThemeAmbient } from '../themes/Ambient.tsx';
import { ThemeScene } from '../themes/Scene.tsx';
import { FrameDocumentFlags } from '../ui/Frame.tsx';
import { AvatarDirectoryProvider } from '../avatars/AvatarDirectory.tsx';

/**
 * Root layout: language and text size come from the signed-in teacher's own preferences (UX-4,
 * THM-6) — never from a device-wide setting — so two teachers never affect each other. Signed out
 * (the sign-in pages), the language is this device's choice on the sign-in card, else a Turkish
 * browser, else the school's default language for new accounts (D-025).
 */
export function RootLayout() {
  const me = useMe();
  const stored = useStoredSignedOutLocale();
  const signInInfo = useQuery({ queryKey: ['public', 'reset-available'], queryFn: () => call(Auth.passwordResetAvailable, {}), staleTime: 60_000, enabled: !me && !stored });
  const locale = me?.locale ?? stored ?? signedOutLocale(signInInfo.data?.defaultLocale);
  const textScale = me?.textScale ?? 100;
  const classScreen = useDisplay().classScreen;
  useEffect(() => {
    setDisplay({ locale, textScale });
  }, [locale, textScale]);
  return (
    <I18nProvider locale={locale}>
      {/* Theme layers, back to front (S17a, D-166): scene, tile pattern, ambient; then the page. The scene
          and the ambient layer belong to the classroom screen only (S17b, D-168). */}
      {classScreen ? <ThemeScene documentFlag /> : null}
      <ThemeBackdrop />
      {classScreen ? <ThemeAmbient /> : null}
      <FrameDocumentFlags />
      <AvatarDirectoryProvider enabled={me?.role === 'teacher'}>
        <Outlet />
      </AvatarDirectoryProvider>
      <Toaster />
      <ManualCopyDialog />
      <CelebrationLayer />
    </I18nProvider>
  );
}

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <main className="cc-page">
      <EmptyState
        title={t('notFound.title')}
        action={
          <Link to="/" className={buttonClass('primary')}>
            {t('notFound.home')}
          </Link>
        }
      />
    </main>
  );
}
