/**
 * Classroom board layout on the client (S14b, D-148): the teacher's stored layout for the class
 * (classroom access, read while locked), saving and resetting it (teacher access: only after the PIN),
 * and whether the layout editor is open on this device (and for which class+subject). The editor is
 * opened from the top bar's Display popover after the PIN dialog; the board of that class shows it
 * while `useLayoutEditing()` names its context.
 */
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { ClassroomLayout } from '../../../../shared/classroomLayout.ts';
import * as C from '../../../../shared/contracts/classroomLayout.ts';
import { call } from '../../../lib/api.ts';
import { queryClient } from '../../../lib/queryClient.ts';
import { lockNow } from '../../../lib/session.ts';

export const layoutKey = (contextId: string) => ['classroom', 'layout', contextId] as const;

export const useClassroomLayout = (contextId: string) =>
  useQuery({ queryKey: layoutKey(contextId), queryFn: () => call(C.classroomLayout, { contextId }), staleTime: 60_000 });

/** After a save or reset the answer is this class's layout; the other classes are read again. */
function applied(contextId: string, r: C.ClassroomLayoutResponse) {
  queryClient.setQueryData(layoutKey(contextId), r);
  void queryClient.invalidateQueries({ queryKey: ['classroom', 'layout'], predicate: (q) => q.queryKey[2] !== contextId });
  return r;
}

export const saveLayout = async (contextId: string, applyTo: C.LayoutScope, layout: ClassroomLayout) => applied(contextId, await call(C.saveClassroomLayout, { contextId, applyTo, layout }));
export const resetLayout = async (contextId: string, applyTo: C.LayoutScope) => applied(contextId, await call(C.resetClassroomLayout, { contextId, applyTo }));

// ---------------------------------------------------------------- editor open on this device
/**
 * The context whose layout is being edited on this device, or null. Opening the editor follows a PIN
 * unlock, so the unlock and the relock are one unit (PIN-1): the editor must be on screen for that
 * class shortly after `editing` is set, and stay on screen while it is set. Each mounted
 * `LayoutEditor` registers itself (`editorMounted`); whenever `editing` names a context that has no
 * mounted editor a tick later (the PIN was accepted while the window was too narrow, the lesson board
 * had gone, the editor was unmounted by another class or a narrow window), the editor is closed and
 * the teacher area locked again (`lockNow`).
 */
let editing: string | null = null;
const listeners = new Set<() => void>();
const editors = new Map<string, number>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const notify = () => listeners.forEach((l) => l());

/** Close the editor and lock the teacher area again (the editor is not, or no longer, on screen). */
function relock() {
  editing = null;
  notify();
  void lockNow(queryClient).catch(() => undefined);
}
/**
 * Check after the current tick (React has rendered the boards by then; React's development double
 * mount has settled) that the open editor is on screen; relock otherwise.
 */
function watch() {
  setTimeout(() => {
    if (editing !== null && !editors.get(editing)) relock();
  }, 0);
}
export function setLayoutEditing(contextId: string | null) {
  if (editing === contextId) return;
  editing = contextId;
  notify();
  if (contextId !== null) watch();
}
/** A `LayoutEditor` for `contextId` is on screen; the returned function says it has gone. */
export function editorMounted(contextId: string): () => void {
  editors.set(contextId, (editors.get(contextId) ?? 0) + 1);
  return () => {
    const n = (editors.get(contextId) ?? 1) - 1;
    if (n > 0) editors.set(contextId, n);
    else editors.delete(contextId);
    watch();
  };
}
export const isLayoutEditing = () => editing !== null;
export const useLayoutEditing = () => useSyncExternalStore(subscribe, () => editing, () => null);

/** Below 64rem the board is one column and the editor is not offered (D-148). */
export const EDITOR_MEDIA = '(min-width: 64rem)';
/** Whether the window is wide enough for the editor right now. */
export const isWideEnough = () => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(EDITOR_MEDIA).matches);
export function useWideEnough(): boolean {
  return useSyncExternalStore(
    (fn) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const m = window.matchMedia(EDITOR_MEDIA);
      m.addEventListener('change', fn);
      return () => m.removeEventListener('change', fn);
    },
    isWideEnough,
    () => true,
  );
}
