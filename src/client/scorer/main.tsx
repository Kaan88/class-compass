/**
 * Super Speakers scorer app entry (S12, SSP-4..7, D-128/D-129). A separate small bundle served at `/p`
 * (the scorer link page) and `/p/app` (the installed app's start URL, which never carries a token).
 *
 * The token arrives in the URL fragment (`/p#<token>`), which browsers never send to a server. It is
 * removed from the address bar at once, posted once to the rate-limited exchange endpoint and replaced
 * by a strict HttpOnly scorer cookie. The installed iPhone app has its own cookie store, so it pairs
 * with a 6-digit code instead (D-129). The service worker keeps only the app shell (D-134).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setDisplay } from '../lib/display.ts';
import '../styles/app.css';
import { installSoundUnlock, installThemeStyles } from '../themes/index.tsx';
import { browserMoveEnv, createQueueMover, hasQueueCookie } from './move.ts';
import { readScorerLocale, ScorerApp } from './ScorerApp.tsx';

installThemeStyles();
installSoundUnlock();
setDisplay({ locale: readScorerLocale() ?? 'en' });

const token = window.location.hash.slice(1);
if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search);
// Read before the app touches the cookie: was this page opened while awards waited here (D-157)?
const mover = createQueueMover(browserMoveEnv(), hasQueueCookie(document.cookie), token || null);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/scorer-sw.js', { scope: '/p' }).catch(() => undefined);
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 30_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ScorerApp token={token || null} installed={window.location.pathname === '/p/app'} mover={mover} />
    </QueryClientProvider>
  </StrictMode>,
);
