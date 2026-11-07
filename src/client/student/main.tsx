/**
 * Personal student page entry (S10: STU-1..8, UX-2..4). A separate small bundle served at `/s`.
 *
 * The token arrives in the URL fragment (`/s#<token>`), which browsers never send to a server. It is
 * removed from the address bar at once (`replaceState`, before anything renders), posted once to the
 * rate-limited exchange endpoint, and replaced by a strict HttpOnly cookie. Only a refused link (401)
 * shows "this link no longer works"; a busy (429) or unreachable server offers "try again". Reloads and bookmarks of
 * `/s` keep working through the cookie; the token is never stored in the page.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setDisplay } from '../lib/display.ts';
import '../styles/app.css';
import { installThemeStyles } from '../themes/index.tsx';
import { readStudentLocale, StudentApp } from './StudentApp.tsx';

installThemeStyles();
setDisplay({ locale: readStudentLocale() });

const token = window.location.hash.slice(1);
// The fragment leaves the address bar at once; the token stays in this page's memory only, so a
// busy or unreachable server can be retried without the link (StudentApp).
if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 30_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <StudentApp token={token || null} />
    </QueryClientProvider>
  </StrictMode>,
);
