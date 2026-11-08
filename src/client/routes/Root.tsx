import { useEffect } from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import { I18nProvider, useI18n } from '../lib/i18n.tsx';
import { setDisplay } from '../lib/display.ts';
import { useMe } from '../lib/session.ts';
import { buttonClass } from '../ui/Button.tsx';
import { EmptyState, Toaster } from '../ui/Feedback.tsx';
import { ManualCopyDialog } from '../ui/Dialog.tsx';
import { ThemeBackdrop } from '../ui/Mascot.tsx';
import { CelebrationLayer } from '../themes/Celebration.tsx';
import { AvatarDirectoryProvider } from '../avatars/AvatarDirectory.tsx';

/**
 * Root layout: language and text size come from the signed-in teacher's own preferences (UX-4,
 * THM-6) — never from a device-wide setting — so two teachers never affect each other.
 */
export function RootLayout() {
  const me = useMe();
  const locale = me?.locale ?? 'en';
  const textScale = me?.textScale ?? 100;
  useEffect(() => {
    setDisplay({ locale, textScale });
  }, [locale, textScale]);
  return (
    <I18nProvider locale={locale}>
      <ThemeBackdrop />
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
