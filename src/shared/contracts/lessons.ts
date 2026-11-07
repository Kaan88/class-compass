/**
 * Lesson lifecycle, routines and attendance contracts (S5: LES-1..4, DSH-1..8, RTN-1..3, ATT-1/2,
 * ACC-8/9). Classroom-safe reads are `classroom`; anything with notes, history or settings is
 * `teacher` (PIN-gated in classroom mode). Classroom writes are commands (see LessonCommands).
 */
import { z } from 'zod';
import { ATTENDANCE_STATUSES, MAX_STAGES, MAX_TIMER_MS } from '../lessons.ts';
import { LocalizedText, Ok, endpoint } from './define.ts';
import { CountersLessonState } from './counters.ts';
import { Id, IsoDate, RequiredLocalizedText } from './school.ts';

export const AttendanceStatus = z.enum(ATTENDANCE_STATUSES);
export const EffectiveAttendance = z.enum([...ATTENDANCE_STATUSES, 'not_recorded']);
const Note = z.string().trim().max(300);

export const RoutineStage = z.object({ id: z.string(), name: LocalizedText });
export const Timer = z.object({ durationMs: z.number().int(), startedAt: z.number().int().nullable(), remainingMs: z.number().int(), running: z.boolean() });
export const Reflection = z.object({ rating: z.number().int().min(1).max(4).nullable(), note: z.string().max(500).nullable() });

/** The lesson as every classroom device sees it (no notes, no identities beyond the roster). */
export const LessonState = z.object({
  id: z.string(),
  contextId: z.string(),
  status: z.enum(['active', 'ended', 'abandoned']),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  localDate: z.string(),
  version: z.number().int(),
  className: z.string(),
  subjectName: LocalizedText,
  routine: z.object({ templateId: z.string().nullable(), name: LocalizedText, stages: z.array(RoutineStage) }),
  stageIndex: z.number().int(),
  timer: Timer,
  /** End Lesson steps contributed by the enabled modules, in order (LES-3). 'reflection' is core. */
  endSteps: z.array(z.string()),
});
export type LessonState = z.infer<typeof LessonState>;

export const Today = z.object({ localDate: z.string(), weekday: z.number().int(), timezone: z.string() });

/**
 * Polled every 5 s while the classroom is visible. Answers 304 when `If-None-Match` equals the
 * current ETag (lesson version + attendance stamp + local date). `lesson` is null when no lesson is
 * active today; a lesson left active on an earlier day is not resumed (it is abandoned when the next
 * lesson starts).
 */
export const getLessonState = endpoint({
  method: 'GET',
  path: '/api/classroom/contexts/:contextId/lesson',
  access: 'classroom',
  input: z.object({ contextId: Id }),
  output: z.object({
    lesson: LessonState.nullable(),
    today: Today,
    serverNow: z.number(),
    attendanceStamp: z.string(),
    /** Counter bars and weekly counts for the running lesson; null without a lesson or with Counters off (S6). */
    counters: CountersLessonState.nullable(),
  }),
});

/** Which of my contexts have a lesson in progress (class switcher indicator, LES-4). */
export const activeLessons = endpoint({
  method: 'GET',
  path: '/api/classroom/lessons/active',
  access: 'classroom',
  input: z.object({}),
  output: z.object({ lessons: z.array(z.object({ contextId: z.string(), lessonId: z.string(), startedAt: z.number(), stageIndex: z.number().int(), stageCount: z.number().int() })) }),
});

export const RoutineTemplate = z.object({
  id: z.string(),
  builtIn: z.boolean(),
  /** null = for all of the teacher's classes; otherwise only for this class+subject. */
  contextId: z.string().nullable(),
  name: LocalizedText,
  stages: z.array(RoutineStage),
  archived: z.boolean(),
});
export type RoutineTemplate = z.infer<typeof RoutineTemplate>;

/** Routines usable when starting a lesson in this context, and the context's default (RTN-2). */
export const lessonRoutines = endpoint({
  method: 'GET',
  path: '/api/classroom/contexts/:contextId/routines',
  access: 'classroom',
  input: z.object({ contextId: Id }),
  output: z.object({ enabled: z.boolean(), defaultTemplateId: z.string(), templates: z.array(RoutineTemplate) }),
});

export const LessonStudent = z.object({
  id: z.string(),
  fullName: z.string(),
  initials: z.string(),
  avatarHue: z.number().int(),
  daily: AttendanceStatus.nullable(),
  exception: AttendanceStatus.nullable(),
  effective: EffectiveAttendance,
});
/**
 * Roster for the classroom (start screen and dashboard) with attendance for `date` (default today)
 * and, with `lessonId`, that lesson's exceptions. Notes are never included (classroom display).
 * Statuses are null/not_recorded when the attendance module is off for the context.
 */
export const lessonRoster = endpoint({
  method: 'GET',
  path: '/api/classroom/contexts/:contextId/roster',
  access: 'classroom',
  input: z.object({ contextId: Id, lessonId: Id.optional() }),
  output: z.object({ localDate: z.string(), attendanceEnabled: z.boolean(), students: z.array(LessonStudent) }),
});

export const AttendanceCounts = z.object({ present: z.number().int(), absent: z.number().int(), late: z.number().int(), excused: z.number().int(), not_recorded: z.number().int() });
export const LessonSummary = z.object({
  id: z.string(),
  contextId: z.string(),
  status: z.enum(['active', 'ended', 'abandoned']),
  className: z.string(),
  subjectName: LocalizedText,
  localDate: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  routineName: LocalizedText,
  stageCount: z.number().int(),
  stageReached: z.number().int(),
  attendance: AttendanceCounts.nullable(),
  reflection: Reflection.nullable(),
});
export type LessonSummary = z.infer<typeof LessonSummary>;
export const lessonSummary = endpoint({
  method: 'GET',
  path: '/api/classroom/lessons/:lessonId/summary',
  access: 'classroom',
  input: z.object({ lessonId: Id }),
  output: LessonSummary,
});

// ---------------------------------------------------------------- commands (POST /api/commands)
const LessonRef = { contextId: Id, lessonId: Id };
const Stages = z.array(z.object({ id: z.string().max(64).optional(), name: RequiredLocalizedText })).min(1).max(MAX_STAGES);

/**
 * Payload schemas of the lesson/attendance commands, shared by the client (outbox) and the server
 * (defineCommand). Every command names the context and, once a lesson exists, the lesson the
 * device believed was active; the server refuses a mismatch with WRONG_LESSON (LES-4).
 */
export const LessonCommands = {
  'lesson.start': z.object({
    contextId: Id,
    /** A template id, DEFAULT_ROUTINE_ID, or omitted for the context default. */
    routineTemplateId: z.string().max(64).optional(),
    /**
     * Daily attendance the teacher changed on the start screen (LES-1). `expected` is the daily
     * status the screen showed; when given, the entry is only written if the record is still the
     * same, so a colleague's newer record is never overwritten silently (ACC-8, D-053).
     */
    attendance: z.array(z.object({ studentId: Id, status: AttendanceStatus, expected: AttendanceStatus.nullable().optional() })).max(200).optional(),
    /** Everyone who still has no daily record when the command runs becomes present (like markAllPresent). */
    othersPresent: z.boolean().optional(),
  }),
  'lesson.setStage': z.object({ ...LessonRef, stageIndex: z.number().int().min(0).max(MAX_STAGES) }),
  'lesson.timer.start': z.object(LessonRef),
  'lesson.timer.pause': z.object(LessonRef),
  'lesson.timer.reset': z.object(LessonRef),
  'lesson.timer.set': z.object({ ...LessonRef, durationMs: z.number().int().min(1000).max(MAX_TIMER_MS) }),
  'lesson.end': z.object({ ...LessonRef, steps: z.record(z.string(), z.unknown()).default({}) }),
  'attendance.setDaily': z.object({ ...LessonRef, studentId: Id, status: AttendanceStatus.nullable() }),
  'attendance.setLessonException': z.object({ ...LessonRef, studentId: Id, status: AttendanceStatus.nullable() }),
  'attendance.markAllPresent': z.object(LessonRef),
} as const;
export type LessonCommandType = keyof typeof LessonCommands;
export type LessonCommandPayload<T extends LessonCommandType> = z.input<(typeof LessonCommands)[T]>;

/** Result of 'lesson.start': `started: false` + LESSON_ALREADY_ACTIVE means "resume this one" (LES-2). */
export const StartLessonResult = z.object({
  started: z.boolean(),
  reason: z.literal('LESSON_ALREADY_ACTIVE').optional(),
  lessonId: z.string(),
  /** Start-screen entries not written because the record changed in the meantime (D-053). */
  attendanceKept: z.number().int().optional(),
});

/** The core End Lesson step (LES-3): how did the lesson go? */
export const ReflectionStepInput = z.object({ rating: z.number().int().min(1).max(4).nullable().default(null), note: z.string().trim().max(500).nullable().default(null) });

// ---------------------------------------------------------------- routine templates (teacher)
export const listRoutineTemplates = endpoint({
  method: 'GET',
  path: '/api/teacher/routines',
  access: 'teacher',
  input: z.object({}),
  output: z.object({
    templates: z.array(RoutineTemplate),
    /** Default template per context (DEFAULT_ROUTINE_ID when none chosen). */
    defaults: z.array(z.object({ contextId: z.string(), templateId: z.string() })),
  }),
});
export const createRoutineTemplate = endpoint({
  method: 'POST',
  path: '/api/teacher/routines',
  access: 'teacher',
  input: z.object({ name: RequiredLocalizedText, contextId: Id.nullable().default(null), stages: Stages.optional() }),
  output: RoutineTemplate,
});
export const updateRoutineTemplate = endpoint({
  method: 'PATCH',
  path: '/api/teacher/routines/:templateId',
  access: 'teacher',
  /** `stages` replaces the whole list: reorder, add, remove and rename in one save (RTN-2). */
  input: z.object({ templateId: Id, name: RequiredLocalizedText.optional(), contextId: Id.nullable().optional(), stages: Stages.optional() }),
  output: RoutineTemplate,
});
export const archiveRoutineTemplate = endpoint({
  method: 'POST',
  path: '/api/teacher/routines/:templateId/archive',
  access: 'teacher',
  input: z.object({ templateId: Id }),
  output: RoutineTemplate,
});
export const setContextRoutine = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/routine',
  access: 'teacher',
  input: z.object({ contextId: Id, templateId: z.string().min(1).max(64) }),
  output: Ok,
});

// ---------------------------------------------------------------- attendance (teacher area)
export const DailyRow = z.object({
  studentId: z.string(),
  fullName: z.string(),
  initials: z.string(),
  avatarHue: z.number().int(),
  status: AttendanceStatus.nullable(),
  note: z.string().nullable(),
  recordedByName: z.string().nullable(),
  updatedAt: z.number().nullable(),
});
export const TeacherLesson = z.object({
  id: z.string(),
  contextId: z.string(),
  subjectName: LocalizedText,
  status: z.enum(['active', 'ended', 'abandoned']),
  startedAt: z.number(),
  exceptions: z.array(z.object({ studentId: z.string(), status: AttendanceStatus, note: z.string().nullable() })),
});
export const getClassAttendance = endpoint({
  method: 'GET',
  path: '/api/teacher/classes/:classId/attendance',
  access: 'teacher',
  input: z.object({ classId: Id, date: IsoDate.optional() }),
  output: z.object({ classId: z.string(), className: z.string(), date: z.string(), today: z.string(), students: z.array(DailyRow), lessons: z.array(TeacherLesson) }),
});
export const setClassAttendance = endpoint({
  method: 'PUT',
  path: '/api/teacher/classes/:classId/attendance',
  access: 'teacher',
  input: z.object({ classId: Id, date: IsoDate, studentId: Id, status: AttendanceStatus.nullable(), note: Note.nullable().optional() }),
  output: DailyRow,
});
export const setLessonExceptionTeacher = endpoint({
  method: 'PUT',
  path: '/api/teacher/lessons/:lessonId/exceptions',
  access: 'teacher',
  input: z.object({ lessonId: Id, studentId: Id, status: AttendanceStatus.nullable(), note: Note.nullable().optional() }),
  output: Ok,
});
export const attendanceHistory = endpoint({
  method: 'GET',
  path: '/api/teacher/classes/:classId/attendance/history',
  access: 'teacher',
  input: z.object({ classId: Id, from: IsoDate.optional(), to: IsoDate.optional(), date: IsoDate.optional() }),
  output: z.object({
    from: z.string(),
    to: z.string(),
    /** Days that have any daily record, newest first, with the class size on that day. */
    days: z.array(AttendanceCounts.extend({ date: z.string() })),
    /** Who changed attendance on `date` (ACC-9), newest first. */
    changes: z.array(
      z.object({
        at: z.number(),
        actorName: z.string().nullable(),
        studentName: z.string().nullable(),
        kind: z.enum(['daily', 'exception']),
        before: AttendanceStatus.nullable(),
        after: AttendanceStatus.nullable(),
      }),
    ),
  }),
});
