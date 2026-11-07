/**
 * Secret Students contracts (S7: SEC-1..7, LES-3, DSH-6, D-007, D-010, D-062, D-064).
 *
 * SECRECY (SEC-3): before the reveal, nothing a client receives may depend on WHO was selected.
 * The classroom state carries only counts; draw/redraw results carry only counts; the reveal and
 * the outcome commands are the first answers that name students.
 */
import { z } from 'zod';
import { endpoint } from './define.ts';
import { Id } from './school.ts';

export const SECRET_OUTCOME_VALUES = ['goal_met', 'still_practising', 'not_assessed'] as const;
export const SecretOutcome = z.enum(SECRET_OUTCOME_VALUES);
export const SecretShortfall = z.enum(['NOT_ENOUGH_ELIGIBLE', 'NO_ELIGIBLE']);
export const SECRET_DEFAULT_COUNT = 2;
export const SECRET_MAX_COUNT = 10;

/** Part of the polled lesson state. Never contains ids or names (SEC-3). */
export const SecretLessonState = z.object({
  roundExists: z.boolean(),
  requestedCount: z.number().int(),
  /** Number chosen at draw time; it does not change when a chosen student is silently replaced. */
  selectedCount: z.number().int(),
  shortfall: SecretShortfall.nullable(),
  revealed: z.boolean(),
  /** How many students the next draw asks for (the class setting). */
  configuredCount: z.number().int(),
});
export type SecretLessonState = z.infer<typeof SecretLessonState>;

/** Result of 'secret.draw' / 'secret.redraw': counts only. */
export const SecretDrawResult = z.object({
  roundId: z.string(),
  created: z.boolean(),
  requestedCount: z.number().int(),
  selectedCount: z.number().int(),
  shortfall: SecretShortfall.nullable(),
});
export type SecretDrawResult = z.infer<typeof SecretDrawResult>;

const RevealStudent = z.object({ id: z.string(), fullName: z.string(), initials: z.string(), avatarHue: z.number().int() });
export const RevealedSelection = z.object({
  selectionId: z.string(),
  student: RevealStudent,
  outcome: SecretOutcome.nullable(),
  note: z.string().nullable(),
  celebration: z.boolean(),
  /** Set when this student replaced a chosen student who was marked absent (D-007). */
  replacedSelectionId: z.string().nullable(),
});
export type RevealedSelection = z.infer<typeof RevealedSelection>;

/** The reveal (End Lesson). Students withdrawn because they were absent are listed separately. */
export const SecretReveal = z.object({
  roundId: z.string(),
  requestedCount: z.number().int(),
  selectedCount: z.number().int(),
  shortfall: SecretShortfall.nullable(),
  revealedAt: z.number(),
  selections: z.array(RevealedSelection),
  /** Chosen, then marked absent and withdrawn ("replaced – was absent"); replacedBy null = nobody left to choose. */
  absent: z.array(z.object({ selectionId: z.string(), student: RevealStudent, replacedBy: z.string().nullable() })),
});
export type SecretReveal = z.infer<typeof SecretReveal>;

const LessonRef = { contextId: Id, lessonId: Id };
export const SecretCommands = {
  /** Idempotent: a lesson has one live round; drawing again returns it unchanged (LES-2, SEC-4). */
  'secret.draw': z.object(LessonRef),
  /** Explicit, confirmed redraw: old selections are withdrawn (audited), a new round is drawn. */
  'secret.redraw': z.object({ ...LessonRef, confirm: z.literal(true) }),
  /** End Lesson only: reveal the round of the active lesson (returns names). */
  'secret.reveal': z.object(LessonRef),
  'secret.recordOutcome': z.object({
    ...LessonRef,
    selectionId: Id,
    outcome: SecretOutcome,
    note: z.string().trim().max(300).nullable().optional(),
    celebration: z.boolean().optional(),
  }),
} as const;
export type SecretCommandType = keyof typeof SecretCommands;
export type SecretCommandPayload<T extends SecretCommandType> = z.input<(typeof SecretCommands)[T]>;

/** End Lesson step input (key 'secretStudents'): outcomes may also be sent here; the step reveals if needed. */
export const SecretEndStepInput = z.object({
  outcomes: z
    .array(z.object({ selectionId: Id, outcome: SecretOutcome, note: z.string().trim().max(300).nullable().optional(), celebration: z.boolean().optional() }))
    .max(50)
    .optional(),
});

/**
 * Today's reveal of a lesson, for the End Lesson screen after a refresh and the summary (classroom).
 * Before the reveal it carries counts only (`reveal` null); lessons of earlier days are teacher-area
 * history (like D-055).
 */
export const lessonSecret = endpoint({
  method: 'GET',
  path: '/api/classroom/lessons/:lessonId/secret',
  access: 'classroom',
  input: z.object({ lessonId: Id }),
  output: z.object({ state: SecretLessonState, reveal: SecretReveal.nullable() }),
});

// ---------------------------------------------------------------- teacher area (PIN-gated)
export const SecretSettings = z.object({ count: z.number().int().min(1).max(SECRET_MAX_COUNT) });
export const getSecretSettings = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/secret/settings',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: SecretSettings,
});
export const setSecretSettings = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/secret/settings',
  access: 'teacher',
  input: z.object({ contextId: Id, count: z.number().int().min(1).max(SECRET_MAX_COUNT) }),
  output: SecretSettings,
});

/**
 * Selection and outcome history (SEC-6, RPT fairness later). Only revealed selections are shown;
 * sealed (lesson running) and abandoned selections are never shown as "selected" (D-010), even
 * though the rotation still counts abandoned ones (D-062), so nothing here hints at who they were.
 */
export const secretHistory = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/secret/history',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({
    students: z.array(
      z.object({
        student: RevealStudent,
        revealed: z.number().int(),
        goalMet: z.number().int(),
        stillPractising: z.number().int(),
        notAssessed: z.number().int(),
        lastRevealedDate: z.string().nullable(),
      }),
    ),
    rounds: z.array(
      z.object({
        roundId: z.string(),
        lessonId: z.string(),
        localDate: z.string(),
        requestedCount: z.number().int(),
        selectedCount: z.number().int(),
        shortfall: SecretShortfall.nullable(),
        state: z.enum(['sealed', 'revealed', 'abandoned', 'withdrawn']),
        selections: z.array(RevealedSelection),
        absent: z.array(z.object({ student: RevealStudent, replaced: z.boolean() })),
      }),
    ),
  }),
});
