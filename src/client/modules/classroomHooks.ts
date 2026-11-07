/**
 * Classroom extension points left for S13b (feedback round 1b), registered from client manifests or
 * modules once they exist:
 * - top-bar slots: `quote` (centre, "quote of the day") and `weather` (right, beside the date and
 *   time). With nothing registered the slot is not rendered; a registered component that renders
 *   nothing leaves its slot hidden too (CSS `:empty`), so the top bar never shows a blank box;
 * - time's-up handlers: called once per finished run for the whole page (also with the group screen
 *   showing a second timer) when a lesson timer reaches 0 while the screen watches it
 *   (the same moment the theme tone plays). S13b adds the spoken / chime announcement here.
 * Nothing is registered in S13a: the slots and the hook exist, the features do not (ROADMAP S13b).
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
