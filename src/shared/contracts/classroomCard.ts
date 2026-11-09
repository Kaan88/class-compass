/**
 * The classroom student card (S14e2, D-154): tapping a name on the classroom screen opens a small card
 * with POSITIVE things only, readable by the class on the display. `classroom` access (works while the
 * teacher area is locked), own class+subject and a student in the class today only.
 *
 * `ClassroomCardItem` is an allow-list: a module adds an item through its server manifest's
 * `classroomCard`, and its key and shape must be a member of this union. Allowed: recent achievements,
 * the student's own Super Speakers points this week (never a rank), days as the class assistant this
 * term, and the per-student counters only while the reminder boxes are on (they are on the card
 * already). Never: attendance, homework, goals or any student text, levels, Secret Student data,
 * notes, ranks or comparisons with classmates.
 */
import { z } from 'zod';
import { CounterColour, CounterLabels } from './counters.ts';
import { BadgeIconKey, Tier } from './achievements.ts';
import { LocalizedText, endpoint } from './define.ts';
import { Id } from './school.ts';

export const ClassroomCardItem = z.discriminatedUnion('key', [
  z.object({
    key: z.literal('achievements'),
    data: z.object({
      /** The most recent awards in this class+subject, newest first. */
      items: z.array(z.object({ id: z.string(), name: LocalizedText, icon: BadgeIconKey, tier: Tier, awardedOn: z.string() })),
    }),
  }),
  /** The student's own Super Speakers points this week (no rank, no other student). */
  z.object({ key: z.literal('superSpeakers'), data: z.object({ points: z.number().int().min(1) }) }),
  /** Days the student was the class assistant in this class+subject this term, up to today. */
  z.object({ key: z.literal('assistant'), data: z.object({ days: z.number().int().min(1) }) }),
  /** Only while the reminder boxes are on (the same counts the card already shows). */
  z.object({
    key: z.literal('counters'),
    data: z.object({ counters: z.array(z.object({ id: z.string(), labels: CounterLabels, colour: CounterColour, count: z.number().int().min(0) })) }),
  }),
]);
export type ClassroomCardItem = z.infer<typeof ClassroomCardItem>;
export type ClassroomCardKey = ClassroomCardItem['key'];

export const ClassroomCard = z.object({
  /** Classroom-safe display fields only (CRD-1). */
  student: z.object({ id: z.string(), fullName: z.string(), initials: z.string(), avatarHue: z.number().int() }),
  items: z.array(ClassroomCardItem),
});
export type ClassroomCard = z.infer<typeof ClassroomCard>;

export const classroomStudentCard = endpoint({
  method: 'GET',
  path: '/api/classroom/contexts/:contextId/students/:studentId/card',
  access: 'classroom',
  input: z.object({ contextId: Id, studentId: Id }),
  output: ClassroomCard,
});
