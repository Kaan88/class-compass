/**
 * Super Speakers board entry (S12, SSP-2/3/8, D-128, D-134): `/board#<display token>`. The token
 * leaves the address bar at once, is posted once to the exchange endpoint and replaced by a strict
 * HttpOnly board cookie; reloads of `/board` keep working through the cookie.
 */
// First: the strings the student page never shows (S23a, D-182).
import '../../shared/i18n/areas/staff.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setDisplay } from '../lib/display.ts';
import '../styles/app.css';
import { installSoundUnlock, installThemeStyles } from '../themes/index.tsx';
import { BoardApp } from './BoardApp.tsx';

installThemeStyles();
installSoundUnlock();
// Board sounds and celebrations stay off until the board settings say otherwise (D-134).
setDisplay({ classSounds: false });

const token = window.location.hash.slice(1);
if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BoardApp token={token || null} />
  </StrictMode>,
);
