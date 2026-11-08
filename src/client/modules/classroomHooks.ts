/**
 * Classroom extension points (S13a), registered from client manifests:
 * - top-bar slots: `quote` (centre, "quote of the day") and `weather` (right, beside the date and
 *   time). With nothing registered the slot is not rendered; a registered component that renders
 *   nothing leaves its slot hidden too (CSS `:empty`), so the top bar never shows a blank box;
 * - time's-up handlers: called once per finished run for the whole page (also with the group screen
 *   showing a second timer) when a lesson timer reaches 0 while the screen watches it
 *   (the moment the class's time's-up announcement plays, modules/lessons/timeUp.ts).
 * S13b registers the quote and the weather (modules/core/topBar.tsx).
 */
import type { ComponentType } from 'react';
import type { LessonState } from '../../shared/contracts/lessons.ts';
import type { DisplayState } from '../lib/display.ts';
import type { ClassroomContext } from './types.ts';

export type TopBarSlotKey = 'quote' | 'weather';
export interface TopBarSlot {
  key: string;
  slot: TopBarSlotKey;
  order: number;
  Component: ComponentType<{ context: ClassroomContext; locale: 'en' | 'tr' }>;
}

const slots: TopBarSlot[] = [];
export function registerTopBarSlot(s: TopBarSlot): void {
  if (slots.some((x) => x.key === s.key)) throw new Error(`Duplicate top-bar slot ${s.key}`);
  slots.push(s);
  slots.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}
export const topBarSlots = (slot: TopBarSlotKey): readonly TopBarSlot[] => slots.filter((s) => s.slot === slot);

export interface TimeUpEvent {
  lesson: LessonState;
  /** Class + device sound switches at that moment (a handler must stay silent when sounds are off). */
  display: DisplayState;
  locale: 'en' | 'tr';
}
export type TimeUpHandler = (e: TimeUpEvent) => void;

const timeUpHandlers = new Set<TimeUpHandler>();
/** Returns an unregister function. */
export function onTimeUp(handler: TimeUpHandler): () => void {
  timeUpHandlers.add(handler);
  return () => timeUpHandlers.delete(handler);
}
export function emitTimeUp(e: TimeUpEvent): void {
  for (const h of timeUpHandlers) {
    try {
      h(e);
    } catch {
      /* a failing handler must never break the timer */
    }
  }
}
