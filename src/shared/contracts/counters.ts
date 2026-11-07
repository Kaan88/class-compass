/**
 * Counter contracts (S6: CNT-1..12, CRD-2, D-003, D-004, D-057…D-060). Classroom-safe data rides on
 * the polled lesson state (`CountersLessonState`); taps, undo and class resets are commands
 * (`CounterCommands`); settings and history are `teacher` endpoints (PIN-gated in classroom mode).
 * Threshold information never names or identifies the student whose tap completed the bar (CNT-9).
 */
import { z } from 'zod';
import { COUNTER_COLOURS, COUNTER_KINDS, COUNTER_SCOPES, MAX_RESPONSES, MAX_SEGMENTS, RESET_PERIODS, RESPONSE_KINDS, validThresholds } from '../counters.ts';
import { LocalizedText, endpoint } from './define.ts';
import { Id, IsoDate, RequiredLocalizedText } from './school.ts';

export const CounterKind = z.enum(COUNTER_KINDS);
export const CounterScope = z.enum(COUNTER_SCOPES);
export const ResetPeriod = z.enum(RESET_PERIODS);
export const ResponseKind = z.enum(RESPONSE_KINDS);
export const CounterColour = z.enum(COUNTER_COLOURS);

export const CounterLabels = z.object({ main: LocalizedText, supporting: LocalizedText, individual: LocalizedText });
const CounterLabelsInput = z.object({ main: RequiredLocalizedText, supporting: LocalizedText, individual: RequiredLocalizedText });

export const ThresholdResponse = z.object({ id: z.string(), label: LocalizedText, message: LocalizedText, mascot: z.boolean(), kind: ResponseKind });
export type ThresholdResponse = z.infer<typeof ThresholdResponse>;
const ThresholdResponseInput = z.object({
  id: z.string().regex(/^[\w-]{1,64}$/).optional(),
  label: RequiredLocalizedText,
  message: LocalizedText,
  mascot: z.boolean().default(false),
  kind: ResponseKind,
});

/** Ascending visual levels for individual counts: up to three (amber, deeper amber, red). */
export const Thresholds = z.array(z.number().int().min(1).max(999)).max(3).refine(validThresholds, 'Levels must go up, e.g. 2, 4, 6');
const Segments = z.number().int().min(1).max(MAX_SEGMENTS);

/** Full counter settings (teacher area). */
export const CounterConfig = z.object({
  id: z.string(),
  contextId: z.string(),
  kind: CounterKind,
  labels: CounterLabels,
  scope: CounterScope,
  barSegments: z.number().int(),
  resetPeriod: ResetPeriod,
  thresholds: z.array(z.number().int()),
  responses: z.array(ThresholdResponse),
  activeResponseId: z.string().nullable(),
  colour: CounterColour,
  archived: z.boolean(),
  createdAt: z.number(),
});
export type CounterConfig = z.infer<typeof CounterConfig>;

export const CounterStudentCount = z.object({
  studentId: z.string(),
  /** Live events in the counter's current period (week / term / ever). */
  count: z.number().int(),
  /** 0 neutral, 1 amber, 2 deeper amber, 3 red (supplementary to the number, CNT-6). */
  level: z.number().int().min(0).max(3),
});

/**
 * One counter as the classroom sees it during a lesson. `crossingSeq` is the open crossing (null
 * when the bar is below the limit), `crossingCount` how many crossings this lesson has had. There is
 * deliberately no event or student id here (CNT-9).
 */
export const CounterLessonState = z.object({
  id: z.string(),
  kind: CounterKind,
  labels: CounterLabels,
  scope: CounterScope,
  barSegments: z.number().int(),
  colour: CounterColour,
  resetPeriod: ResetPeriod,
  thresholds: z.array(z.number().int()),
  /** Live events of this lesson (CNT-8). */
  lessonTotal: z.number().int(),
  /** Live events since the last class reset (= lessonTotal when never reset). Drives the bar. */
  barValue: z.number().int(),
  reached: z.boolean(),
  crossingSeq: z.number().int().nullable(),
  crossingCount: z.number().int(),
  crossedAt: z.number().nullable(),
  activeResponse: ThresholdResponse.nullable(),
  /** First and last local day of the current counting period; null for "never resets". */
  period: z.object({ from: z.string(), to: z.string() }).nullable(),
  students: z.array(CounterStudentCount),
});
export type CounterLessonState = z.infer<typeof CounterLessonState>;

export const CountersLessonState = z.object({
  /** Current week in the class timezone (D-003). */
  weekStart: z.string(),
  weekEnd: z.string(),
  counters: z.array(CounterLessonState),
  /** Per class+subject (S13a): show the English-reminder boxes on student cards (hidden by default). */
  showReminderBoxes: z.boolean(),
});
export type CountersLessonState = z.infer<typeof CountersLessonState>;

// ---------------------------------------------------------------- commands (POST /api/commands)
const LessonRef = { contextId: Id, lessonId: Id };
export const CounterCommands = {
  /** One tap. `studentId` omitted = class-only tap (lesson-scope counters). */
  'counter.tap': z.object({ ...LessonRef, counterId: Id, studentId: Id.optional() }),
  /** Undo/correction: voids the event (never deletes it, CNT-4). Idempotent. */
  'counter.void': z.object({ ...LessonRef, eventId: Id }),
  /** Only when the active threshold response is "class reset" (D-058). */
  'counter.resetLessonBar': z.object({ ...LessonRef, counterId: Id }),
} as const;
export type CounterCommandType = keyof typeof CounterCommands;
export type CounterCommandPayload<T extends CounterCommandType> = z.input<(typeof CounterCommands)[T]>;

export const TapResult = z.object({
  eventId: z.string(),
  lessonTotal: z.number().int(),
  barValue: z.number().int(),
  reached: z.boolean(),
  /** A new crossing opened with this tap (the response fires once, D-004). */
  fired: z.boolean(),
  studentCount: z.number().int().nullable(),
});

// ---------------------------------------------------------------- teacher settings
export const listCounters = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/counters',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({ englishSubject: z.boolean(), enabled: z.boolean(), counters: z.array(CounterConfig) }),
});

export const createCounter = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/counters',
  access: 'teacher',
  input: z.object({
    contextId: Id,
    name: RequiredLocalizedText,
    scope: CounterScope,
    barSegments: Segments.default(10),
    resetPeriod: ResetPeriod.default('week'),
    colour: CounterColour.default('accent'),
    thresholds: Thresholds.default([]),
    responses: z.array(ThresholdResponseInput).max(MAX_RESPONSES).default([]),
    activeResponseId: z.string().max(64).nullable().default(null),
  }),
  output: CounterConfig,
});

/** Adds the English reminder preset to any of the teacher's contexts (CNT-1, CNT-12). */
export const createEnglishPreset = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/counters/english-preset',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: CounterConfig,
});

export const updateCounter = endpoint({
  method: 'PATCH',
  path: '/api/teacher/counters/:counterId',
  access: 'teacher',
  input: z.object({
    counterId: Id,
    labels: CounterLabelsInput.optional(),
    scope: CounterScope.optional(),
    barSegments: Segments.optional(),
    resetPeriod: ResetPeriod.optional(),
    thresholds: Thresholds.optional(),
    /** Replaces the whole list; keep `id` to keep the active choice. */
    responses: z.array(ThresholdResponseInput).max(MAX_RESPONSES).optional(),
    activeResponseId: z.string().max(64).nullable().optional(),
    colour: CounterColour.optional(),
  }),
  output: CounterConfig,
});

export const archiveCounter = endpoint({ method: 'POST', path: '/api/teacher/counters/:counterId/archive', access: 'teacher', input: z.object({ counterId: Id }), output: CounterConfig });
export const unarchiveCounter = endpoint({ method: 'POST', path: '/api/teacher/counters/:counterId/unarchive', access: 'teacher', input: z.object({ counterId: Id }), output: CounterConfig });

/**
 * Weekly history of one counter (CNT-7): per student live counts per week, newest first, with the
 * explicit week range and timezone. `lessons` is how many lessons of the class+subject took place
 * that week (denominator, RPT-5); `voided` how many taps were undone. No scores (RPT-5).
 */
export const counterHistory = endpoint({
  method: 'GET',
  path: '/api/teacher/counters/:counterId/history',
  access: 'teacher',
  input: z.object({ counterId: Id, weeks: z.coerce.number().int().min(1).max(53).default(8), until: IsoDate.optional() }),
  output: z.object({
    counter: z.object({ id: z.string(), labels: CounterLabels, archived: z.boolean(), resetPeriod: ResetPeriod, thresholds: z.array(z.number().int()) }),
    timezone: z.string(),
    weekStartsOn: z.number().int(),
    students: z.array(z.object({ id: z.string(), fullName: z.string(), initials: z.string(), avatarHue: z.number().int() })),
    weeks: z.array(
      z.object({
        weekStart: z.string(),
        weekEnd: z.string(),
        lessons: z.number().int(),
        total: z.number().int(),
        classOnly: z.number().int(),
        voided: z.number().int(),
        counts: z.record(z.string(), z.number().int()),
        /** Students enrolled in the class on at least one day of this week (RPT-5: "not enrolled" is not 0). */
        enrolled: z.array(z.string()),
        /** Individual labels the taps of this week were recorded under (DAT-6). */
        labelsUsed: z.array(LocalizedText),
      }),
    ),
  }),
});

