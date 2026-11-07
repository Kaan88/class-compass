/**
 * Lesson routines (RTN-1/2). Pure data + helpers, shared by server and client.
 * Stage names are teacher-editable `{en, tr}` labels; stage ids keep identity across reorders and
 * renames so a template edit never changes what a running lesson's snapshot refers to.
 */
import type { LocalizedTextValue } from '../shared/contracts/define.ts';
import { DEFAULT_ROUTINE_ID, MAX_STAGES } from '../shared/lessons.ts';

export { DEFAULT_ROUTINE_ID, MAX_STAGES };

export interface RoutineStage {
  id: string;
  name: LocalizedTextValue;
}

/** The built-in default routine is not a database row: every teacher can use or copy it (RTN-1). */
export const DEFAULT_ROUTINE_NAME: LocalizedTextValue = { en: 'Default routine', tr: 'Varsayılan rutin' };
export const DEFAULT_ROUTINE_STAGES: readonly RoutineStage[] = [
  { id: 'greeting', name: { en: 'Greeting', tr: 'Selamlaşma' } },
  { id: 'date-weather', name: { en: 'Date and weather', tr: 'Tarih ve hava durumu' } },
  { id: 'assistant', name: { en: 'Assistant', tr: 'Günün yardımcısı' } },
  { id: 'learning-goal', name: { en: 'Learning goal', tr: 'Öğrenme hedefi' } },
  { id: 'activities', name: { en: 'Activities', tr: 'Etkinlikler' } },
  { id: 'reflection', name: { en: 'Reflection', tr: 'Değerlendirme' } },
];

/** Clamp a stage index into a routine of `count` stages (an empty routine has index 0). */
export const clampStage = (index: number, count: number) => (count <= 0 ? 0 : Math.min(Math.max(0, Math.trunc(index)), count - 1));
