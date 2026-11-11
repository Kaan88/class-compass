// First: the strings the student page never shows (S23a, D-182).
import '../shared/i18n/areas/staff.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { onAuthProblem } from './lib/api.ts';
import { setDisplay } from './lib/display.ts';
import { getOutbox } from './lib/outbox-client.ts';
import { registerAppWorker } from './lib/appWorker.ts';
import { installOfflineClassroom } from './lib/offlineClassroom.ts';
import { installClientModules } from './modules/registry.ts';
import { purgeSensitive, queryClient } from './lib/queryClient.ts';
import { markLocked, ME_KEY, resetSignedOut } from './lib/session.ts';
import { clearAllToasts } from './lib/toast.ts';
import { router } from './router.tsx';
import { PUBLIC_PATHS } from './routes/guards.ts';
import './styles/app.css';
import { installSoundUnlock, installThemeStyles } from './themes/index.tsx';

// Theme tokens are generated from the theme registry (D-070) before anything renders.
installThemeStyles();
installSoundUnlock();
setDisplay({});

// Any 423 from the API swaps sensitive areas to the lock screen and purges sensitive data (PIN-3);
// any 401 sends the user to sign in.
onAuthProblem((code) => {
  if (code === 'PIN_REQUIRED') {
    markLocked(queryClient);
    return;
  }
  if (code === 'MUST_CHANGE_PASSWORD') {
    // The server refuses everything but the password change until the temporary password is replaced.
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
    if (router.state.location.pathname !== '/change-password') void router.navigate({ to: '/change-password' });
    return;
  }
  resetSignedOut(queryClient);
  clearAllToasts();
  const loc = router.state.location;
  if (!PUBLIC_PATHS.includes(loc.pathname)) void router.navigate({ to: '/login', search: { next: loc.href } });
});

// Restored from the back/forward cache: never trust what is on screen, re-run the guards (PIN-8).
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    purgeSensitive(queryClient);
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
    void router.invalidate();
  }
});

// Module manifests: register their outbox refreshes, then start the outbox so commands queued
// before a reload are sent (UX-11).
installClientModules();
const outbox = getOutbox();

// Offline cold start (S26b, D-190): the classroom's last data is kept on this device, and the app's
// service worker keeps the page and its files of this build.
installOfflineClassroom(queryClient);
registerAppWorker({ pending: () => outbox.getStatus().pending, online: () => outbox.getStatus().online, subscribe: (fn) => void outbox.subscribe(fn) });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
