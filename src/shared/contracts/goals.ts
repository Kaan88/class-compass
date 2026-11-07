/**
 * Goals, reflections and evidence (S10: GOL-1..6, STU-2, STU-8, DAT-6, RPT-5, D-014).
 *
 * - Goals belong to one student and one subject. Teachers create them in the teacher area; students
 *   choose presets or write their own through their personal link.
 * - Student self-assessments (confidence 1–5) are goal entries; teacher outcomes are separate
 *   assessments (GOL-3). Students read outcomes and feedback but never write them (GOL-5).
 * - Private teacher notes are only in the teacher's detail response; no student response type has a
 *   field for them (GOL-6).
 * - Web links are http/https only, shown with rel="noopener noreferrer" and never fetched for a
 *   preview. Photo and audio evidence follow the admin media flags (D-014).
 */
import { z } from 'zod';
import { LocalizedText, Ok, endpoint } from './define.ts';
import { Id, IsoDate, QueryBool, RequiredLocalizedText, Theme } from './school.ts';

export const GOAL_STATUSES = ['active', 'achieved', 'archived'] as const;
export const GoalStatus = z.enum(GOAL_STATUSES);
export type GoalStatus = z.infer<typeof GoalStatus>;
export const AuthorType = z.enum(['teacher', 'student']);
export const GOAL_ENTRY_KINDS = ['progress', 'reflection', 'note', 'self_assessment'] as const;
export const GoalEntryKind = z.enum(GOAL_ENTRY_KINDS);
/** What a student may write on a goal (teachers write progress updates). */
export const STUDENT_ENTRY_KINDS = ['reflection', 'note', 'self_assessment'] as const;
export const StudentEntryKind = z.enum(STUDENT_ENTRY_KINDS);
export const EVIDENCE_KINDS = ['text', 'link', 'file', 'audio'] as const;
export const EvidenceKind = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

/** Teacher outcomes (GOL-2/3). The labels are configurable per class+subject (module config). */
export const GOAL_OUTCOMES = ['not_yet', 'developing', 'secure', 'exceeded'] as const;
export const GoalOutcome = z.enum(GOAL_OUTCOMES);
export type GoalOutcome = z.infer<typeof GoalOutcome>;
export const OutcomeDef = z.object({ key: GoalOutcome, label: LocalizedText });
export type OutcomeDef = z.infer<typeof OutcomeDef>;
export const OutcomeSet = z
  .array(OutcomeDef)
  .length(GOAL_OUTCOMES.length)
  .refine((xs) => GOAL_OUTCOMES.every((k) => xs.some((x) => x.key === k)), 'Every outcome needs a label')
  .refine((xs) => xs.every((x) => Boolean(x.label.en?.trim() || x.label.tr?.trim())), 'Every outcome needs a label');
export const DEFAULT_GOAL_OUTCOMES: OutcomeDef[] = [
  { key: 'not_yet', label: { en: 'Not yet', tr: 'Henüz değil' } },
  { key: 'developing', label: { en: 'Developing', tr: 'Gelişiyor' } },
  { key: 'secure', label: { en: 'Secure', tr: 'Sağlam' } },
  { key: 'exceeded', label: { en: 'Beyond the goal', tr: 'Hedefin ötesinde' } },
];

export const MAX_PRACTICE_CHOICES = 6;
export const GoalText = z.string().trim().min(1).max(500);
export const PracticeChoices = z.array(z.string().trim().min(1).max(120)).max(MAX_PRACTICE_CHOICES);
export const EntryBody = z.string().trim().min(1).max(2000);
export const Confidence = z.number().int().min(1).max(5);

/**
 * A web link students may add as evidence: http or https, with a host, without user name or password
 * (so "javascript:", "data:" and look-alike credentials links are refused). Never fetched by the server.
 */
export function isSafeHttpUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return false;
  }
  return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0 && !u.username && !u.password;
}
export const SafeUrl = z.string().trim().min(1).max(2000).refine(isSafeHttpUrl, 'Only http and https links');

// ---------------------------------------------------------------- DTOs
export const Category = z.object({
  id: z.string(),
  name: LocalizedText,
  /** null = a default category for every subject. */
  subjectId: z.string().nullable(),
  /** Made by a teacher (editable by that teacher). */
  custom: z.boolean(),
  archived: z.boolean(),
});
export type Category = z.infer<typeof Category>;

export const Preset = z.object({ id: z.string(), categoryId: z.string(), text: LocalizedText, custom: z.boolean(), archived: z.boolean() });
export type Preset = z.infer<typeof Preset>;

export const GoalEntry = z.object({
  id: z.string(),
  kind: GoalEntryKind,
  authorType: AuthorType,
  body: z.string(),
  /** Student self-assessment only (GOL-3). */
  confidence: z.number().int().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type GoalEntry = z.infer<typeof GoalEntry>;

export const Assessment = z.object({ id: z.string(), outcome: GoalOutcome, createdAt: z.number() });
export type Assessment = z.infer<typeof Assessment>;

export const Goal = z.object({
  id: z.string(),
  subjectId: z.string(),
  category: z.object({
    id: z.string(),
    /** The category's current name. */
    name: LocalizedText,
    /** The name when the goal was set (DAT-6): history stays understandable after a rename. */
    nameAtCreation: LocalizedText,
  }),
  authorType: AuthorType,
  presetId: z.string().nullable(),
  /** A preset goal's text in both languages as it was chosen (DAT-6); null for goals written by hand. */
  presetText: LocalizedText.nullable(),
  text: z.string(),
  practiceChoices: z.array(z.string()),
  reviewOn: z.string().nullable(),
  status: GoalStatus,
  createdAt: z.number(),
  updatedAt: z.number(),
  entries: z.array(GoalEntry),
  /** Teacher outcomes, newest first (read-only for students). */
  assessments: z.array(Assessment),
});
export type Goal = z.infer<typeof Goal>;

export const Feedback = z.object({ id: z.string(), goalId: z.string().nullable(), body: z.string(), teacherName: z.string(), createdAt: z.number(), updatedAt: z.number() });
export type Feedback = z.infer<typeof Feedback>;

export const EvidenceFile = z.object({ id: z.string(), mime: z.string(), name: z.string().nullable(), size: z.number().int(), hasThumbnail: z.boolean() });
export const Evidence = z.object({
  id: z.string(),
  goalId: z.string().nullable(),
  kind: EvidenceKind,
  body: z.string().nullable(),
  url: z.string().nullable(),
  file: EvidenceFile.nullable(),
  authorType: AuthorType,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Evidence = z.infer<typeof Evidence>;

export const PrivateNote = z.object({ id: z.string(), body: z.string(), createdAt: z.number(), updatedAt: z.number() });
export type PrivateNote = z.infer<typeof PrivateNote>;

export const GoalLibrary = z.object({ categories: z.array(Category), presets: z.array(Preset), outcomes: z.array(OutcomeDef) });
export type GoalLibrary = z.infer<typeof GoalLibrary>;

const StudentSummary = z.object({ id: z.string(), fullName: z.string(), initials: z.string(), avatarHue: z.number().int() });

// ---------------------------------------------------------------- teacher area (PIN-gated)
export const GoalsOverviewRow = StudentSummary.extend({
  activeGoals: z.number().int(),
  achievedGoals: z.number().int(),
  evidence: z.number().int(),
  /** Latest student self-assessment (1–5), null when the student has not recorded one (RPT-5). */
  lastConfidence: z.number().int().nullable(),
  /** Latest goal, entry or evidence, null when nothing was recorded. */
  lastActivityAt: z.number().nullable(),
});
export const goalsOverview = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/goals',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({ contextId: z.string(), className: z.string(), subjectName: LocalizedText, enabled: z.boolean(), students: z.array(GoalsOverviewRow) }),
});

export const TeacherStudentGoals = z.object({
  student: StudentSummary,
  subjectId: z.string(),
  goals: z.array(Goal),
  evidence: z.array(Evidence),
  feedback: z.array(Feedback),
  /** The signed-in teacher's own private notes (GOL-6). Never part of any student response. */
  privateNotes: z.array(PrivateNote),
  library: GoalLibrary,
  media: z.object({ photos: z.boolean(), audio: z.boolean(), documents: z.boolean() }),
});
export type TeacherStudentGoals = z.infer<typeof TeacherStudentGoals>;
export const teacherStudentGoals = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/students/:studentId/goals',
  access: 'teacher',
  input: z.object({ contextId: Id, studentId: Id }),
  output: TeacherStudentGoals,
});

export const teacherCreateGoal = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/students/:studentId/goals',
  access: 'teacher',
  input: z.object({ contextId: Id, studentId: Id, categoryId: Id, presetId: Id.optional(), text: GoalText.optional(), practiceChoices: PracticeChoices.optional(), reviewOn: IsoDate.nullable().optional() }),
  output: Goal,
});
export const teacherUpdateGoal = endpoint({
  method: 'PATCH',
  path: '/api/teacher/goals/:goalId',
  access: 'teacher',
  input: z.object({ goalId: Id, text: GoalText.optional(), practiceChoices: PracticeChoices.optional(), reviewOn: IsoDate.nullable().optional(), status: GoalStatus.optional(), categoryId: Id.optional() }),
  output: Goal,
});
export const teacherAddProgress = endpoint({
  method: 'POST',
  path: '/api/teacher/goals/:goalId/progress',
  access: 'teacher',
  input: z.object({ goalId: Id, body: EntryBody }),
  output: Goal,
});
export const teacherAssessGoal = endpoint({
  method: 'POST',
  path: '/api/teacher/goals/:goalId/assessments',
  access: 'teacher',
  input: z.object({ goalId: Id, outcome: GoalOutcome }),
  output: Goal,
});
export const teacherAddFeedback = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/students/:studentId/feedback',
  access: 'teacher',
  input: z.object({ contextId: Id, studentId: Id, goalId: Id.optional(), body: EntryBody }),
  output: Feedback,
});
export const teacherDeleteFeedback = endpoint({ method: 'DELETE', path: '/api/teacher/feedback/:feedbackId', access: 'teacher', input: z.object({ feedbackId: Id }), output: Ok });
export const teacherAddPrivateNote = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/students/:studentId/private-notes',
  access: 'teacher',
  input: z.object({ contextId: Id, studentId: Id, body: EntryBody }),
  output: PrivateNote,
});
export const teacherDeletePrivateNote = endpoint({ method: 'DELETE', path: '/api/teacher/private-notes/:noteId', access: 'teacher', input: z.object({ noteId: Id }), output: Ok });

export const goalLibrary = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/goal-library',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: GoalLibrary,
});
export const createCategory = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/goal-categories',
  access: 'teacher',
  input: z.object({ contextId: Id, name: RequiredLocalizedText }),
  output: Category,
});
export const updateCategory = endpoint({
  method: 'PATCH',
  path: '/api/teacher/goal-categories/:categoryId',
  access: 'teacher',
  input: z.object({ categoryId: Id, name: RequiredLocalizedText.optional(), archived: z.boolean().optional() }),
  output: Category,
});
export const createPreset = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/goal-presets',
  access: 'teacher',
  input: z.object({ contextId: Id, categoryId: Id, text: RequiredLocalizedText }),
  output: Preset,
});
export const updatePreset = endpoint({
  method: 'PATCH',
  path: '/api/teacher/goal-presets/:presetId',
  access: 'teacher',
  input: z.object({ presetId: Id, text: RequiredLocalizedText.optional(), archived: z.boolean().optional() }),
  output: Preset,
});
export const goalSettings = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/goals/settings',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({ outcomes: z.array(OutcomeDef) }),
});
export const setGoalSettings = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/goals/settings',
  access: 'teacher',
  input: z.object({ contextId: Id, outcomes: OutcomeSet }),
  output: z.object({ outcomes: z.array(OutcomeDef) }),
});

// ---------------------------------------------------------------- student page (personal link, STU-2)
export const StudentGoalsSection = z.object({
  goals: z.array(Goal),
  evidence: z.array(Evidence),
  feedback: z.array(Feedback),
  categories: z.array(Category),
  presets: z.array(Preset),
  outcomes: z.array(OutcomeDef),
  /** The student may add goals, reflections and evidence here (module on, class not archived). */
  canWrite: z.boolean(),
});
export type StudentGoalsSection = z.infer<typeof StudentGoalsSection>;

export const StudentHomeworkSection = z.object({
  assignments: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      details: z.string().nullable(),
      assignedOn: z.string(),
      dueOn: z.string(),
      /** The teacher's status for this student; null = not checked yet (never "missing", HW-4). */
      status: z.object({ key: z.string(), label: LocalizedText, kind: z.string() }).nullable(),
    }),
  ),
});
export type StudentHomeworkSection = z.infer<typeof StudentHomeworkSection>;

/**
 * Student page sections contributed by module manifests (`studentPage`). The output is a union of
 * known section shapes, so it stays an allow-list: a new module adds its section here.
 */
export const StudentPageSection = z.discriminatedUnion('key', [
  z.object({ key: z.literal('goals'), data: StudentGoalsSection }),
  z.object({ key: z.literal('homework'), data: StudentHomeworkSection }),
]);
export type StudentPageSection = z.infer<typeof StudentPageSection>;

export const StudentPage = z.object({
  student: z.object({ fullName: z.string(), initials: z.string(), avatarHue: z.number().int() }),
  className: z.string().nullable(),
  theme: Theme,
  media: z.object({ photos: z.boolean(), audio: z.boolean(), documents: z.boolean() }),
  subjects: z.array(z.object({ subjectId: z.string(), name: LocalizedText, sections: z.array(StudentPageSection) })),
});
export type StudentPage = z.infer<typeof StudentPage>;

/** Everything the student may see (their own permitted records only; studentId from the session). */
export const studentPage = endpoint({ method: 'GET', path: '/api/student/page', access: 'student', input: z.object({}), output: StudentPage });

export const studentCreateGoal = endpoint({
  method: 'POST',
  path: '/api/student/goals',
  access: 'student',
  input: z.object({ subjectId: Id, categoryId: Id.optional(), presetId: Id.optional(), text: GoalText.optional(), practiceChoices: PracticeChoices.optional() }),
  output: Goal,
});
export const studentUpdateGoal = endpoint({
  method: 'PATCH',
  path: '/api/student/goals/:goalId',
  access: 'student',
  input: z.object({ goalId: Id, text: GoalText.optional(), practiceChoices: PracticeChoices.optional(), status: z.enum(['active', 'achieved']).optional() }),
  output: Goal,
});
export const studentDeleteGoal = endpoint({ method: 'DELETE', path: '/api/student/goals/:goalId', access: 'student', input: z.object({ goalId: Id }), output: Ok });

export const studentAddEntry = endpoint({
  method: 'POST',
  path: '/api/student/goals/:goalId/entries',
  access: 'student',
  input: z.object({ goalId: Id, kind: StudentEntryKind, body: EntryBody, confidence: Confidence.optional() }),
  output: Goal,
});
export const studentUpdateEntry = endpoint({
  method: 'PATCH',
  path: '/api/student/entries/:entryId',
  access: 'student',
  input: z.object({ entryId: Id, body: EntryBody.optional(), confidence: Confidence.optional() }),
  output: Goal,
});
export const studentDeleteEntry = endpoint({ method: 'DELETE', path: '/api/student/entries/:entryId', access: 'student', input: z.object({ entryId: Id }), output: Ok });

export const studentAddEvidence = endpoint({
  method: 'POST',
  path: '/api/student/evidence',
  access: 'student',
  input: z.object({ subjectId: Id, goalId: Id.optional(), kind: EvidenceKind, body: z.string().trim().max(2000).optional(), url: SafeUrl.optional(), fileId: Id.optional() }),
  output: Evidence,
});
export const studentUpdateEvidence = endpoint({
  method: 'PATCH',
  path: '/api/student/evidence/:evidenceId',
  access: 'student',
  input: z.object({ evidenceId: Id, body: z.string().trim().max(2000).nullable().optional(), goalId: Id.nullable().optional() }),
  output: Evidence,
});
export const studentDeleteEvidence = endpoint({ method: 'DELETE', path: '/api/student/evidence/:evidenceId', access: 'student', input: z.object({ evidenceId: Id }), output: Ok });

/** Evidence upload kinds a student may send (multipart field `file`); photos/audio need the media flags (D-014). */
export const STUDENT_UPLOAD_KINDS = ['document', 'image', 'audio'] as const;
export const studentUploadFile = endpoint({
  method: 'POST',
  path: '/api/student/files',
  access: 'student',
  input: z.object({ kind: z.enum(STUDENT_UPLOAD_KINDS) }),
  output: EvidenceFile.extend({ kind: z.enum(STUDENT_UPLOAD_KINDS) }),
});
/** A file the student owns and can see (evidence on their page); 404 for anything else (STU-4, STU-8). */
export const studentGetFile = endpoint({
  method: 'GET',
  path: '/api/student/files/:fileId',
  access: 'student',
  input: z.object({ fileId: Id, thumb: QueryBool.optional() }),
  output: z.unknown(),
});
export const studentFileUrl = (fileId: string, thumb = false) => `/api/student/files/${encodeURIComponent(fileId)}${thumb ? '?thumb=true' : ''}`;
export const teacherFileUrl = (fileId: string, thumb = false) => `/api/files/${encodeURIComponent(fileId)}${thumb ? '?thumb=true' : ''}`;
