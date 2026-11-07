import { useSyncExternalStore } from 'react';

/** Toast queue (UX-9). Undo toasts stay 8 seconds by default. */
export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  durationMs: number;
  undo?: (() => void | Promise<void>) | undefined;
  createdAt: number;
}

export const UNDO_MS = 8000;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function showToast(t: { message: string; kind?: Toast['kind']; durationMs?: number; undo?: Toast['undo'] }): number {
  const id = nextId++;
  const toast: Toast = { id, message: t.message, kind: t.kind ?? 'info', durationMs: t.durationMs ?? (t.undo ? UNDO_MS : 4000), undo: t.undo, createdAt: Date.now() };
  toasts = [...toasts.slice(-2), toast];
  emit();
  setTimeout(() => dismissToast(id), toast.durationMs);
  return id;
}

/** Shows "message [Undo]" for 8 s; the undo callback runs at most once. */
export function showUndoToast(message: string, undo: () => void | Promise<void>, durationMs = UNDO_MS) {
  let used = false;
  return showToast({
    message,
    durationMs,
    undo: async () => {
      if (used) return;
      used = true;
      await undo();
    },
  });
}

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
