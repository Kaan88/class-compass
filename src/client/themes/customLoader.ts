/**
 * Loads the imported theme a page shows (S14g, D-158), split from `custom.tsx` in S26c (D-191): every
 * entry (classroom, student page, board, scorer) loads this small loader through `installThemeStyles`,
 * while the code that checks a package again and builds its theme (`custom.tsx`: the package schema,
 * the SVG sanitiser, the art) is a lazy chunk fetched only when a page really shows an imported theme.
 * The teacher and admin pickers and Admin → Themes import `custom.tsx` directly, as before.
 */
import { publicCustomTheme } from '../../shared/contracts/themes.ts';
import { isThemeKey, isThemeSlug } from '../../shared/themes.ts';
import { callConditional } from '../lib/api.ts';
import { getCustomTheme } from './registry.ts';

const pending = new Set<string>();
/** ETag of each package this loader registered, for the conditional re-check. */
const etags = new Map<string, string>();
/** When each key was last fetched or checked (successfully or not). */
const checkedAt = new Map<string, number>();
let lastKey: string | null = null;

/** A shown package is re-checked at most this often (a replaced package then appears without a reload). */
export const THEME_RECHECK_MS = 30_000;

/**
 * Makes sure the imported theme the page shows is registered and current (D-158). Built-in keys are
 * skipped. A key that is not registered yet is fetched; one that is registered is re-checked with a
 * conditional GET (ETag, 304 when unchanged) at most every `THEME_RECHECK_MS`, so a package the
 * administrator replaced reaches open screens. A key the server did not have (404: a draft, a disabled
 * or deleted theme) is tried again after the same interval, or at once when the display switches to
 * another key and back. Until then, and for those, `themeOf` shows the default theme.
 */
export async function loadThemePackage(key: string | null | undefined, now: number = Date.now()): Promise<void> {
  if (!key) return;
  if (key !== lastKey) {
    // The display moved to another theme (a built-in one too): earlier "not found" answers may be stale.
    if (lastKey !== null && !getCustomTheme(lastKey)) checkedAt.delete(lastKey);
    if (!getCustomTheme(key)) checkedAt.delete(key);
    lastKey = key;
  }
  if (isThemeKey(key) || !isThemeSlug(key) || pending.has(key)) return;
  const last = checkedAt.get(key);
  if (last !== undefined && now - last < THEME_RECHECK_MS) return;
  const known = getCustomTheme(key);
  // A package registered by a picker (useAvailableThemes) has no ETag here: the first check fetches it.
  const etag = known ? (etags.get(key) ?? null) : null;
  pending.add(key);
  checkedAt.set(key, now);
  try {
    const r = await callConditional(publicCustomTheme, { key }, etag);
    if (r.notModified) return;
    // S26c (D-191): the package code is a lazy chunk (the student page budget, D-151).
    const { registerThemePackage } = await import('./custom.tsx');
    if (registerThemePackage(r.data, 'enabled') && r.etag) etags.set(key, r.etag);
  } catch {
    // Not found or offline: keep what is registered (screens fall back to the default for unknown keys).
  } finally {
    pending.delete(key);
  }
}

/** Forgets what the loader knows (tests). */
export function resetThemeLoader(): void {
  pending.clear();
  etags.clear();
  checkedAt.clear();
  lastKey = null;
}
