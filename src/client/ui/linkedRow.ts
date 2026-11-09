/**
 * A teacher page opened from a link that names a student (a notification's Open, S14i): the student's
 * row is marked (`aria-current="true"` with an outline, `[data-linked]` in app.css) and scrolled into
 * view once. Pages that have a natural selection (a class, a dialog) preselect it themselves; this is
 * for lists where the student is one row among many.
 */
import { useCallback, useRef } from 'react';

export interface LinkedRowProps {
  'data-linked'?: 'true';
  'aria-current'?: 'true';
  ref?: (el: HTMLElement | null) => void;
}

export function useLinkedRow(linkedId: string | undefined): (id: string) => LinkedRowProps {
  const scrolled = useRef(false);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el || scrolled.current) return;
    scrolled.current = true;
    el.scrollIntoView?.({ block: 'center' });
  }, []);
  return (id: string) => (linkedId && id === linkedId ? { 'data-linked': 'true', 'aria-current': 'true', ref } : {});
}
