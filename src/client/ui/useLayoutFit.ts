/**
 * Run a synchronous layout fit before paint and again whenever its answer may change (S29 review,
 * D-200): when the element's width changes, when the fonts have loaded (and whenever a later font
 * load finishes), and when the page's display settings change at the same width (the theme, the
 * teacher's text size, the language: `<html>`'s `data-theme`, `data-text`, `lang` and
 * `--cc-text-scale`). A change in the element's height alone does not run the fit again: the fit
 * itself changes the height, so that would loop.
 */
import { useLayoutEffect, type DependencyList, type RefObject } from 'react';

/** What a fit depends on beyond the element's own width: the display settings on `<html>`. */
function displayKey(): string {
  const html = document.documentElement;
  return [html.dataset.theme, html.dataset.text, html.lang, html.style.getPropertyValue('--cc-text-scale')].join('|');
}

export function useLayoutFit<T extends HTMLElement>(ref: RefObject<T | null>, fit: (el: T) => void, deps: DependencyList): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fit(el);
    let width = el.clientWidth;
    let key = displayKey();
    let alive = true;
    const again = () => {
      if (!alive) return;
      width = el.clientWidth;
      key = displayKey();
      fit(el);
    };
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    void fonts?.ready.then(again);
    fonts?.addEventListener?.('loadingdone', again);
    const mo =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            if (displayKey() !== key) again();
          });
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-text', 'lang', 'style'] });
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (el.clientWidth !== width) again();
          });
    ro?.observe(el);
    return () => {
      alive = false;
      fonts?.removeEventListener?.('loadingdone', again);
      mo?.disconnect();
      ro?.disconnect();
    };
    // The caller names what the fit depends on.
  }, deps);
}
