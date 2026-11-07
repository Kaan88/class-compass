/**
 * Homework contracts (S8: HW-1..4, ATT-1, DSH-8, RPT-5, D-074, D-075).
 *
 * - An assignment belongs to one class+subject (teaching context). Statuses are a per-assignment
 *   snapshot of the context's status list (HW-2): editable labels, the six defaults plus custom ones.
 * - A student without a mark is NOT CHECKED. "Not checked" is never "Missing" (HW-4, RPT-5).
 * - Attendance is shown next to homework in the checking grid but read from the attendance tables;
 *   homework never stores or changes attendance (ATT-1).
 * - Checking is teacher-area (PIN-gated) by default. A class+subject may allow it on the classroom
 *   screen (`checkingInClassroom`); the classroom grid then never shows private notes (D-075).
 */
import { z } from 'zod';
import { ATTENDANCE_STATUSES } from '../lessons.ts';
import { LocalizedText, endpoint } from './define.ts';
import { Id, IsoDate, RequiredLocalizedText } from './school.ts';

/** What a status means for counting (reports, outstanding list). */
export const HOMEWORK_STATUS_KINDS = ['not_checked', 'completed', 'partly_completed', 'missing', 'submitted_late', 'excused', 'other'] as const;
export const HomeworkStatusKind = z.enum(HOMEWORK_STATUS_KINDS);
export type HomeworkStatusKind = z.infer<typeof HomeworkStatusKind>;
export const NOT_CHECKED = 'not_checked';
export const MAX_STATUSES = 12;

export const HomeworkStatusDef = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,30}$/),
  label: LocalizedText,
  kind: HomeworkStatusKind,
});
export type HomeworkStatusDef = z.infer<typeof HomeworkStatusDef>;

/** HW-2 defaults (EN + TR). */
export const DEFAULT_HOMEWORK_STATUSES: HomeworkStatusDef[] = [
  { key: 'not_checked', kind: 'not_checked', label: { en: 'Not checked', tr: 'Kontrol edilmedi' } },
  { key: 'completed', kind: 'completed', label: { en: 'Completed', tr: 'Tamamlandı' } },
  { key: 'partly_completed', kind: 'partly_completed', label: { en: 'Partly completed', tr: 'Kısmen tamamlandı' } },
  { key: 'missing', kind: 'missing', label: { en: 'Missing', tr: 'Yapılmadı' } },
  { key: 'submitted_late', kind: 'submitted_late', label: { en: 'Submitted late', tr: 'Geç teslim' } },
  { key: 'excused', kind: 'excused', label: { en: 'Excused', tr: 'Muaf' } },
];

/** A status list must start with "not checked" (kind and key) and have unique keys. */
export const HomeworkStatusSet = z
  .array(HomeworkStatusDef)
  .min(2)
  .max(MAX_STATUSES)
  .refine((xs) => xs[0]?.key === NOT_CHECKED && xs[0]?.kind === 'not_checked', 'The first status must be "not checked"')
  .refine((xs) => new Set(xs.map((x) => x.key)).size === xs.length, 'Status keys must be unique')
  .refine((xs) => xs.filter((x) => x.kind === 'not_checked').length === 1, 'Only one status can mean "not checked"');

export const HomeworkSettings = z.object({ statuses: HomeworkStatusSet, checkingInClassroom: z.boolean() });
export type HomeworkSettings = z.infer<typeof HomeworkSettings>;

export const HomeworkCounts = z.object({
  /** Students expected (enrolled on the due date, plus anyone already marked). */
  total: z.number().int(),
  /** Count per status key; `not_checked` includes every student without a mark. */
  byStatus: z.record(z.string(), z.number().int()),
});

export const HomeworkAssignment = z.object({
  id: z.string(),
  contextId: z.string(),
  title: z.string(),
  details: z.string().nullable(),
  assignedOn: z.string(),
  dueOn: z.string(),
  /** Private teacher note. */
  notes: z.string().nullable(),
  statuses: z.array(HomeworkStatusDef),
  archived: z.boolean(),
  updatedAt: z.number(),
  counts: HomeworkCounts,
});
export type HomeworkAssignment = z.infer<typeof HomeworkAssignment>;

export const HOMEWORK_VIEWS = ['day', 'week', 'month'] as const;
export const HomeworkView = z.enum(HOMEWORK_VIEWS);
export const HomeworkDateField = z.enum(['due', 'assigned']);

/** Daily / weekly / monthly lists (HW-1) by due date or assigned date, in the class timezone. */
export const listHomework = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/homework',
  access: 'teacher',
  input: z.object({ contextId: Id, view: HomeworkView.default('week'), date: IsoDate.optional(), by: HomeworkDateField.default('due'), includeArchived: z.enum(['0', '1']).optional() }),
  output: z.object({
    today: z.string(),
    timezone: z.string(),
    range: z.object({ view: HomeworkView, by: HomeworkDateField, from: z.string(), to: z.string() }),
    assignments: z.array(HomeworkAssignment),
  }),
});

const Title = z.string().trim().min(1).max(200);
const Details = z.string().trim().max(2000).nullable().optional();
const Notes = z.string().trim().max(1000).nullable().optional();

export const createHomework = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/homework',
  access: 'teacher',
  input: z.object({ contextId: Id, title: Title, details: Details, assignedOn: IsoDate.optional(), dueOn: IsoDate, notes: Notes }),
  output: HomeworkAssignment,
});
export const updateHomework = endpoint({
  method: 'PATCH',
  path: '/api/teacher/homework/:assignmentId',
  access: 'teacher',
  input: z.object({ assignmentId: Id, title: Title.optional(), details: Details, assignedOn: IsoDate.optional(), dueOn: IsoDate.optional(), notes: Notes }),
  output: HomeworkAssignment,
});
/** Archive (or restore); marks are kept (CFG-2, DAT-5). */
export const archiveHomework = endpoint({
  method: 'POST',
  path: '/api/teacher/homework/:assignmentId/archive',
  access: 'teacher',
  input: z.object({ assignmentId: Id, archived: z.boolean() }),
  output: HomeworkAssignment,
});

const CheckStudent = z.object({ id: z.string(), fullName: z.string(), initials: z.string(), avatarHue: z.number().int() });
export const EffectiveAttendanceValue = z.enum([...ATTENDANCE_STATUSES, 'not_recorded']);

const checkRow = z.object({
  student: CheckStudent,
  /** The status key; `not_checked` when there is no mark. */
  status: z.string(),
  /** false = no mark yet (shown as "Not checked", never as "Missing"). */
  reviewed: z.boolean(),
  updatedAt: z.number().nullable(),
  /** Daily attendance on the due date, from the attendance tables (ATT-1); null when Attendance is off. */
  attendance: EffectiveAttendanceValue.nullable(),
  /** false when the student left the class but already had a mark. */
  enrolled: z.boolean(),
});
/** The checking grid as the teacher area shows it (with private notes). */
export const HomeworkCheck = z.object({
  assignment: HomeworkAssignment,
  attendanceDate: z.string(),
  attendanceEnabled: z.boolean(),
  rows: z.array(checkRow.extend({ note: z.string().nullable() })),
});
export type HomeworkCheck = z.infer<typeof HomeworkCheck>;

/** Classroom grid (only when the class allows checking in the classroom): no notes at all. */
export const ClassroomHomeworkCheck = z.object({
  assignment: HomeworkAssignment.omit({ notes: true }),
  attendanceDate: z.string(),
  attendanceEnabled: z.boolean(),
  rows: z.array(checkRow),
});
export type ClassroomHomeworkCheck = z.infer<typeof ClassroomHomeworkCheck>;

const MarkChange = z.object({ studentId: Id, status: z.string().min(1).max(30), note: z.string().trim().max(300).nullable().optional() });
const BatchId = z.string().uuid();
const MarkResult = z.object({ batchId: z.string(), changed: z.number().int(), replayed: z.boolean() });

/** Individual corrections and "mark selected as …" (HW-4). `batchId` (client UUID) makes retries harmless. */
export const setHomeworkMarks = endpoint({
  method: 'POST',
  path: '/api/teacher/homework/:assignmentId/marks',
  access: 'teacher',
  input: z.object({ assignmentId: Id, batchId: BatchId.optional(), changes: z.array(MarkChange).min(1).max(200) }),
  output: MarkResult.extend({ check: HomeworkCheck }),
});
/** "Mark all remaining as …": every student still NOT CHECKED gets `status` (HW-4). */
export const markRemainingHomework = endpoint({
  method: 'POST',
  path: '/api/teacher/homework/:assignmentId/marks/remaining',
  access: 'teacher',
  input: z.object({ assignmentId: Id, batchId: BatchId.optional(), status: z.string().min(1).max(30) }),
  output: MarkResult.extend({ check: HomeworkCheck }),
});
/** Undo one batch (UX-9): restores each student's previous mark unless it was changed again since. */
export const undoHomeworkMarks = endpoint({
  method: 'POST',
  path: '/api/teacher/homework/:assignmentId/marks/undo',
  access: 'teacher',
  input: z.object({ assignmentId: Id, batchId: BatchId }),
  output: z.object({ undone: z.number().int(), skipped: z.number().int(), check: HomeworkCheck }),
});
export const homeworkCheck = endpoint({
  method: 'GET',
  path: '/api/teacher/homework/:assignmentId/check',
  access: 'teacher',
  input: z.object({ assignmentId: Id }),
  output: HomeworkCheck,
});

/** Outstanding work (HW-1, RPT-5): due assignments with students marked missing/partly, and how many are still not checked. */
export const outstandingHomework = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/homework/outstanding',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({
    today: z.string(),
    items: z.array(
      z.object({
        assignment: z.object({ id: z.string(), title: z.string(), dueOn: z.string() }),
        statuses: z.array(HomeworkStatusDef),
        students: z.array(z.object({ student: CheckStudent, status: z.string() })),
        notChecked: z.number().int(),
        total: z.number().int(),
      }),
    ),
  }),
});

export const getHomeworkSettings = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/homework/settings',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: HomeworkSettings,
});
export const setHomeworkSettings = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/homework/settings',
  access: 'teacher',
  input: z.object({
    contextId: Id,
    statuses: z.array(HomeworkStatusDef.extend({ label: RequiredLocalizedText })).optional(),
    checkingInClassroom: z.boolean().optional(),
  }),
  output: HomeworkSettings,
});

// ---------------------------------------------------------------- classroom (display-safe)
/** The homework panel (DSH-8): current assignments, no per-student statuses, no notes. */
export const classroomHomework = endpoint({
  method: 'GET',
  path: '/api/classroom/contexts/:contextId/homework/current',
  access: 'classroom',
  input: z.object({ contextId: Id }),
  output: z.object({
    today: z.string(),
    checkingInClassroom: z.boolean(),
    assignments: z.array(z.object({ id: z.string(), title: z.string(), details: z.string().nullable(), assignedOn: z.string(), dueOn: z.string() })),
  }),
});
/** Classroom checking (only with `checkingInClassroom`; otherwise 403 CHECKING_TEACHER_ONLY). */
export const classroomHomeworkCheck = endpoint({
  method: 'GET',
  path: '/api/classroom/homework/:assignmentId/check',
  access: 'classroom',
  input: z.object({ assignmentId: Id }),
  output: ClassroomHomeworkCheck,
});
const ClassroomMarkChange = MarkChange.omit({ note: true });
export const classroomSetHomeworkMarks = endpoint({
  method: 'POST',
  path: '/api/classroom/homework/:assignmentId/marks',
  access: 'classroom',
  input: z.object({ assignmentId: Id, batchId: BatchId.optional(), changes: z.array(ClassroomMarkChange).min(1).max(200) }),
  output: MarkResult.extend({ check: ClassroomHomeworkCheck }),
});
export const classroomMarkRemainingHomework = endpoint({
  method: 'POST',
  path: '/api/classroom/homework/:assignmentId/marks/remaining',
  access: 'classroom',
  input: z.object({ assignmentId: Id, batchId: BatchId.optional(), status: z.string().min(1).max(30) }),
  output: MarkResult.extend({ check: ClassroomHomeworkCheck }),
});
export const classroomUndoHomeworkMarks = endpoint({
  method: 'POST',
  path: '/api/classroom/homework/:assignmentId/marks/undo',
  access: 'classroom',
  input: z.object({ assignmentId: Id, batchId: BatchId }),
  output: z.object({ undone: z.number().int(), skipped: z.number().int(), check: ClassroomHomeworkCheck }),
});
