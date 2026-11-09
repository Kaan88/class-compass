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
/** The context whose layout is being edited on this device, or null. */
let editing: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function setLayoutEditing(contextId: string | null) {
  if (editing === contextId) return;
  editing = contextId;
  listeners.forEach((l) => l());
}
export const isLayoutEditing = () => editing !== null;
export const useLayoutEditing = () => useSyncExternalStore(subscribe, () => editing, () => null);

/** Below 64rem the board is one column and the editor is not offered (D-148). */
export const EDITOR_MEDIA = '(min-width: 64rem)';
export function useWideEnough(): boolean {
  return useSyncExternalStore(
    (fn) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const m = window.matchMedia(EDITOR_MEDIA);
      m.addEventListener('change', fn);
      return () => m.removeEventListener('change', fn);
    },
    () => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(EDITOR_MEDIA).matches),
    () => true,
  );
}
