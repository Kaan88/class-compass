import { useSyncExternalStore } from 'react';
import { clearManualCopy } from './clipboard.ts';

/**
 * Toast queue (UX-9). Undo toasts stay 8 seconds by default.
 *
 * - At most MAX_VISIBLE toasts are shown; when a new one arrives the oldest toast WITHOUT an undo is
 *   dropped first. A toast whose undo is still available is never evicted (its 8 s window must hold,
 *   UX-9), so the list may briefly exceed the limit when several undo toasts are open.
 * - Toasts are sensitive by default: `clearSensitiveToasts()` (called whenever the teacher area locks
 *   or the device returns to the classroom view) removes every toast except those raised with
 *   `scope: 'classroom'`, so nothing from the teacher area stays on the classroom display (PIN-3).
 */
export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  durationMs: number;
  undo?: (() => void | Promise<void>) | undefined;
  /** 'classroom' = safe to keep on the classroom display; anything else is cleared on lock. */
  scope: 'classroom' | 'sensitive';
  createdAt: number;
}

export const UNDO_MS = 8000;
/** How long a plain note stays: shorter on the classroom display, where it covers what the class sees. */
export const NOTE_MS = 4000;
export const CLASSROOM_NOTE_MS = 2500;
export const MAX_VISIBLE = 3;
let toasts: Toast[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function forget(id: number) {
  const h = timers.get(id);
  if (h !== undefined) clearTimeout(h);
  timers.delete(id);
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  forget(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Keep the list short, but never drop a toast whose undo is still available. */
function evict(list: Toast[]): Toast[] {
  const out = [...list];
  while (out.length > MAX_VISIBLE) {
    const i = out.findIndex((t) => !t.undo);
    if (i < 0) break;
    forget(out[i]!.id);
    out.splice(i, 1);
  }
  return out;
}

export function showToast(t: { message: string; kind?: Toast['kind']; durationMs?: number; undo?: Toast['undo']; scope?: Toast['scope'] }): number {
  const id = nextId++;
  const toast: Toast = {
    id,
    message: t.message,
    kind: t.kind ?? 'info',
    durationMs: t.durationMs ?? (t.undo ? UNDO_MS : t.scope === 'classroom' && t.kind !== 'error' ? CLASSROOM_NOTE_MS : NOTE_MS),
    undo: t.undo,
    scope: t.scope ?? 'sensitive',
    createdAt: Date.now(),
  };
  toasts = evict([...toasts, toast]);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), toast.durationMs),
  );
  emit();
  return id;
}

/** Shows "message [Undo]" for 8 s; the undo callback runs at most once. */
export function showUndoToast(message: string, undo: () => void | Promise<void>, opts: { durationMs?: number; scope?: Toast['scope'] } = {}) {
  let used = false;
  return showToast({
    message,
    durationMs: opts.durationMs ?? UNDO_MS,
    ...(opts.scope ? { scope: opts.scope } : {}),
    undo: async () => {
      if (used) return;
      used = true;
      await undo();
    },
  });
}

/** Lock / return to the classroom: drop every toast that is not classroom-safe (PIN-3). */
export function clearSensitiveToasts() {
  clearManualCopy(); // a student link shown for copying is sensitive too
  const keep = toasts.filter((t) => t.scope === 'classroom');
  if (keep.length === toasts.length) return;
  for (const t of toasts) if (t.scope !== 'classroom') forget(t.id);
  toasts = keep;
  emit();
}

/** Sign-out: drop everything. */
export function clearAllToasts() {
  clearManualCopy();
  if (toasts.length === 0) return;
  for (const t of toasts) forget(t.id);
  toasts = [];
  emit();
}

export const currentToasts = () => toasts;

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => toasts,
    () => toasts,
  );
}
