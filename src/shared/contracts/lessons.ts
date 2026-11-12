/**
 * Lesson lifecycle, routines and attendance contracts (S5: LES-1..4, DSH-1..8, RTN-1..3, ATT-1/2,
 * ACC-8/9). Classroom-safe reads are `classroom`; anything with notes, history or settings is
 * `teacher` (PIN-gated in classroom mode). Classroom writes are commands (see LessonCommands).
 */
import { z } from 'zod';
import { ATTENDANCE_STATUSES, MAX_LESSON_TOPICS, MAX_STAGES, MAX_TIMER_MS, TOPIC_ICONS } from '../lessons.ts';
import { LocalizedText, Ok, endpoint, pii } from './define.ts';
import { AssistantToday } from './assistant.ts';
import { CountersLessonState } from './counters.ts';
import { GroupingLessonState } from './grouping.ts';
import { LessonGoalState } from './lessonGoals.ts';
import { SecretLessonState } from './secret.ts';
import { Id, IsoDate, RequiredLocalizedText } from './school.ts';

export const AttendanceStatus = z.enum(ATTENDANCE_STATUSES);
export const EffectiveAttendance = z.enum([...ATTENDANCE_STATUSES, 'not_recorded']);
const Note = z.string().trim().max(300);

export const RoutineStage = z.object({ id: z.string(), name: LocalizedText });
export const Timer = z.object({ durationMs: z.number().int(), startedAt: z.number().int().nullable(), remainingMs: z.number().int(), running: z.boolean() });
/** A lesson topic (S13a, D-101): a skill category as it was when chosen (name + icon snapshot, DAT-6). */
export const LessonTopic = z.object({ id: z.string(), name: LocalizedText, icon: z.enum(TOPIC_ICONS).nullable() });
export type LessonTopic = z.infer<typeof LessonTopic>;
export const TopicIds = z.array(Id).max(MAX_LESSON_TOPICS).meta(pii('none'));
export const Reflection = z.object({ rating: z.number().int().min(1).max(4).nullable(), note: z.string().max(500).nullable().meta(pii('teacherText')) });

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
  /** Today's topic(s) (S13a); empty = none set (the display hides the topic). */
  topics: z.array(LessonTopic),
  /** Per-lesson display choices (S13a): null = the class default. */
  display: z.object({ assistantVisible: z.boolean().nullable() }),
  /** End Lesson steps contributed by the enabled modules, in order (LES-3). 'reflection' is core. */
  endSteps: z.array(z.string()),
});
export type LessonState = z.infer<typeof LessonState>;

/**
 * Today in the class timezone. `closure`: today is a day without school on the holiday calendar (S25b,
 * D-186); the classroom shows a calm note and a lesson can still be started (a make-up lesson).
 */
export const Today = z.object({ localDate: z.string(), weekday: z.number().int(), timezone: z.string(), closure: z.object({ name: LocalizedText }).nullable() });

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
    /** Secret Students of the running lesson: counts only, never who (SEC-3); null when off or no lesson. */
    secret: SecretLessonState.nullable(),
    /** Today's assistant (AST-1, DSH-3); null when the Assistant module is off. */
    assistant: AssistantToday.nullable(),
    /** The groups in use in the running lesson (DSH-8): names, members, roles; never levels or rules (GRP-7). Null when off or no lesson. */
    grouping: GroupingLessonState.nullable(),
    /** The running lesson's goal (S25d, D-188); null when the Lesson goals module is off or no lesson runs. */
    lessonGoal: LessonGoalState.nullable(),
  }),
});

/** Which of my contexts have a lesson in progress (class switcher indicator, LES-4). */
export const activeLessons = endpoint({
  method: 'GET',
  path: '/api/classroom/lessons/active',
  access: 'classroom',
  input: z.object({}),
  output: z.object({ lessons: z.array(z.object({ contextId: z.string(), lessonId: z.string(), startedAt: z.number(), stageIndex: z.number().int(), stageCount: z.number().int() })) }),
  mcp: { scope: 'classes:read', tool: 'active_lessons', readOnly: true, description: 'Lessons running now in your class+subjects (lessonId, start time, routine stage). Needed for classroom_command. No student data.' },
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
  fullName: z.string().meta(pii('studentName')),
  initials: z.string().meta(pii('studentInitials')),
  avatarHue: z.number().int(),
  /** Card photo (CRD-1): only when photos are on and consent is recorded (D-014). */
  photoUrl: z.string().nullable().optional().meta(pii('file')),
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
  mcp: { scope: 'classes:read', tool: 'class_roster', readOnly: true, description: 'The students in one of your classes today (ids and names) with today\'s attendance (daily status, the lesson\'s exception with lessonId, and the effective status). Withheld: photos, numbers, levels, notes.' },
});

export const AttendanceCounts = z.object({ present: z.number().int(), absent: z.number().int(), late: z.number().int(), excused: z.number().int(), not_recorded: z.number().int() });
export const LessonSummary = z.object({
  id: z.string(),
  contextId: z.string(),
  status: z.enum(['active', 'ended', 'abandoned']),
  className: z.string().meta(pii('label')),
  subjectName: LocalizedText,
  localDate: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  routineName: LocalizedText,
  stageCount: z.number().int(),
  stageReached: z.number().int(),
  attendance: AttendanceCounts.nullable(),
  reflection: Reflection.nullable(),
  /** Today's goal and the class's answer (S28a, D-197): null without a goal or while Lesson goals is off. */
  lessonGoal: LessonGoalState.nullable(),
});
export type LessonSummary = z.infer<typeof LessonSummary>;
export const lessonSummary = endpoint({
  method: 'GET',
  path: '/api/classroom/lessons/:lessonId/summary',
  access: 'classroom',
  input: z.object({ lessonId: Id }),
  output: LessonSummary,
  mcp: { scope: 'reports:read', tool: 'lesson_summary', readOnly: true, description: 'One lesson of yours: class, subject, date, routine and how far it got, attendance counts, your own end-of-lesson reflection (rating and note) and, when Lesson goals is on, the goal sentence of the lesson with the answer of the class. Counts only for students.' },
});

// ---------------------------------------------------------------- lesson preferences (S18, D-167)

/**
 * The teacher's own lesson preferences (per account, user setting `lessons.fullscreen`): whether Start
 * lesson enters full screen and End lesson leaves it. Read on the classroom board (`classroom`, works
 * while the teacher area is locked; nothing about students), changed on the teacher's profile page
 * (`teacher`, PIN-gated in classroom mode). No `mcp` field: a device preference, not school data.
 */
export const LessonPrefs = z.object({ fullscreen: z.boolean() }).strict();
export type LessonPrefs = z.infer<typeof LessonPrefs>;
export const getLessonPrefs = endpoint({ method: 'GET', path: '/api/classroom/lesson-prefs', access: 'classroom', input: z.object({}), output: LessonPrefs });
export const setLessonPrefs = endpoint({ method: 'PUT', path: '/api/teacher/lesson-prefs', access: 'teacher', input: LessonPrefs, output: LessonPrefs });

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
    /** Today's topic(s) (S13a): omitted = the weekly plan's topics for today; [] = no topic. */
    topicIds: TopicIds.optional(),
    /**
     * Inputs of the module Start Lesson steps (S14b, D-149), by step key (the server's `startSteps`
     * registry, e.g. `assistant`: the duties ticked on the start screen). Each step validates its own.
     */
    steps: z.record(z.string().max(64), z.unknown()).optional(),
  }),
  'lesson.setStage': z.object({ ...LessonRef, stageIndex: z.number().int().min(0).max(MAX_STAGES) }),
  'lesson.timer.start': z.object(LessonRef),
  'lesson.timer.pause': z.object(LessonRef),
  'lesson.timer.reset': z.object(LessonRef),
  'lesson.timer.set': z.object({ ...LessonRef, durationMs: z.number().int().min(1000).max(MAX_TIMER_MS) }),
  'lesson.end': z.object({ ...LessonRef, steps: z.record(z.string(), z.unknown()).default({}) }),
  /** Change today's topic(s) during the lesson (S13a, classroom-safe). */
  'lesson.setTopics': z.object({ ...LessonRef, topicIds: TopicIds }),
  /** Per-lesson display choices (S13a): show or hide the assistant panel (null = class default). */
  'lesson.setDisplay': z.object({ ...LessonRef, assistantVisible: z.boolean().nullable() }),
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
  /**
   * Duty changes (ticks and unticks) from the start screen that were not recorded because today's
   * assistant changed in the meantime (attendance moved the turn, S14b, D-149).
   */
  dutiesDropped: z.number().int().optional(),
  /** Duty changes from the start screen left out because the responsibility was removed meanwhile (D-149). */
  dutiesSkipped: z.number().int().optional(),
});
/** What a Start Lesson step may report back in the start result (S14b). */
export type StartStepNotes = { dutiesDropped?: number; dutiesSkipped?: number };

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
  mcp: { scope: 'classes:read', tool: 'list_routines', readOnly: true, description: 'Your lesson routines (named stages such as Warm-up, Main task, Plenary) and which one each class+subject uses by default. No student data.' },
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
        actorName: z.string().nullable().meta(pii('staffName')),
        studentName: z.string().nullable().meta(pii('studentName')),
        kind: z.enum(['daily', 'exception']),
        before: AttendanceStatus.nullable(),
        after: AttendanceStatus.nullable(),
      }),
    ),
  }),
  mcp: { scope: 'reports:read', tool: 'attendance_history', readOnly: true, description: 'Daily attendance counts of one class over a period (present, absent, late, excused, not recorded; "not recorded" is never zero), and with `date` who changed attendance that day. Use classId from list_my_classes.' },
});

// ---------------------------------------------------------------- lesson topics (S13a, D-101)
/** Topics to choose from on the classroom screen (names + icons only) and the weekly plan's topics for today. */
export const classroomTopics = endpoint({
  method: 'GET',
  path: '/api/classroom/contexts/:contextId/topics',
  access: 'classroom',
  input: z.object({ contextId: Id }),
  output: z.object({ topics: z.array(LessonTopic), plannedToday: z.array(z.string()), weekday: z.number().int() }),
});

/** Weekly topic plan: ISO weekday '1'…'7' → topic ids (optional; at most MAX_LESSON_TOPICS per day). */
export const TopicPlan = z.partialRecord(z.enum(['1', '2', '3', '4', '5', '6', '7']), TopicIds);
export type TopicPlan = z.infer<typeof TopicPlan>;
export const getTopicPlan = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/topic-plan',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({ topics: z.array(LessonTopic), plan: TopicPlan }),
  mcp: { scope: 'classes:read', tool: 'get_topic_plan', readOnly: true, description: 'The lesson topics of one class+subject (the goal categories, with ids and icons) and the weekly plan: ISO weekday "1" (Monday) … "7" → topic ids. No student data.' },
});
export const setTopicPlan = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/topic-plan',
  access: 'teacher',
  input: z.object({ contextId: Id, plan: TopicPlan }),
  output: z.object({ topics: z.array(LessonTopic), plan: TopicPlan }),
  mcp: { scope: 'settings:write', tool: 'set_topic_plan', readOnly: false, description: 'Replaces the weekly topic plan of one of your class+subjects: ISO weekday "1"…"7" → existing topic ids (see get_topic_plan; a few per day at most). Returns the plan.' },
});
