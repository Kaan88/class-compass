/**
 * Daily Assistant contracts (S7: AST-1..6, DSH-3, LES-1, D-063, D-065, D-066).
 * The assistant of a day and the announced weekly schedule are classroom-safe (names only); plan
 * editing, swaps, overrides, responsibilities and history are teacher-area (PIN-gated).
 */
import { z } from 'zod';
import { LocalizedText, endpoint } from './define.ts';
import { Id, IsoDate, RequiredLocalizedText } from './school.ts';

export const ASSISTANT_STATUS_VALUES = ['planned', 'confirmed', 'replaced_absent', 'swapped', 'override'] as const;
export const AssistantStatus = z.enum(ASSISTANT_STATUS_VALUES);
export const DEFAULT_SCHOOL_DAYS = [1, 2, 3, 4, 5] as const;

const AssistantStudent = z.object({ id: z.string(), fullName: z.string(), initials: z.string(), avatarHue: z.number().int() });
export type AssistantStudent = z.infer<typeof AssistantStudent>;
export const Responsibility = z.object({ id: z.string(), label: LocalizedText });

/** Today's assistant as the classroom shows it (dashboard panel, Start Lesson step). */
export const AssistantToday = z.object({
  localDate: z.string(),
  /** false on a day that is not a school day for this class+subject (no assistant). */
  schoolDay: z.boolean(),
  assistant: AssistantStudent.nullable(),
  responsibilities: z.array(Responsibility),
  thanked: z.boolean(),
});
export type AssistantToday = z.infer<typeof AssistantToday>;

export const todayAssistant = endpoint({
  method: 'GET',
  path: '/api/classroom/contexts/:contextId/assistant/today',
  access: 'classroom',
  input: z.object({ contextId: Id }),
  output: AssistantToday,
});

/** The weekly schedule as it may be shown on the classroom display (D-066): days and names only. */
export const assistantWeek = endpoint({
  method: 'GET',
  path: '/api/classroom/contexts/:contextId/assistant/week',
  access: 'classroom',
  input: z.object({ contextId: Id, weekStart: IsoDate.optional() }),
  output: z.object({
    weekStart: z.string(),
    announced: z.boolean(),
    days: z.array(z.object({ date: z.string(), weekday: z.number().int(), assistant: AssistantStudent.nullable() })),
    responsibilities: z.array(Responsibility),
  }),
});

// ---------------------------------------------------------------- teacher area
export const PlanDay = z.object({
  date: z.string(),
  weekday: z.number().int(),
  assignmentId: z.string().nullable(),
  planned: AssistantStudent.nullable(),
  actual: AssistantStudent.nullable(),
  /** actual ?? planned */
  assistant: AssistantStudent.nullable(),
  status: AssistantStatus.nullable(),
  reason: z.string().nullable(),
  /** before today: history, read-only */
  past: z.boolean(),
  today: z.boolean(),
});
export const AssistantPlan = z.object({
  contextId: z.string(),
  weekStart: z.string(),
  today: z.string(),
  schoolDays: z.array(z.number().int()),
  plan: z.object({ generatedAt: z.number(), announcedAt: z.number().nullable() }).nullable(),
  days: z.array(PlanDay),
  /** Students who can be chosen for an override (classroom-safe fields), sorted by name. */
  roster: z.array(AssistantStudent),
});
export type AssistantPlan = z.infer<typeof AssistantPlan>;

const WeekInput = z.object({ contextId: Id, weekStart: IsoDate.optional() });
export const getAssistantPlan = endpoint({ method: 'GET', path: '/api/teacher/contexts/:contextId/assistant/plan', access: 'teacher', input: WeekInput, output: AssistantPlan });
/** Creates the week's plan once; when it exists it is returned unchanged (never regenerated silently). */
export const generateAssistantPlan = endpoint({ method: 'POST', path: '/api/teacher/contexts/:contextId/assistant/plan', access: 'teacher', input: WeekInput, output: AssistantPlan });
/** Re-plans only future, unchanged days of an UNANNOUNCED plan; needs `confirm: true`. */
export const regenerateAssistantPlan = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/assistant/plan/regenerate',
  access: 'teacher',
  input: z.object({ contextId: Id, weekStart: IsoDate, confirm: z.literal(true) }),
  output: AssistantPlan,
});
export const announceAssistantPlan = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/assistant/plan/announce',
  access: 'teacher',
  input: z.object({ contextId: Id, weekStart: IsoDate }),
  output: AssistantPlan,
});
export const swapAssistants = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/assistant/swap',
  access: 'teacher',
  input: z.object({ contextId: Id, dateA: IsoDate, dateB: IsoDate }),
  output: AssistantPlan,
});
export const overrideAssistant = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/assistant/override',
  access: 'teacher',
  input: z.object({ contextId: Id, date: IsoDate, studentId: Id, reason: z.string().trim().max(200).nullable().optional() }),
  output: AssistantPlan,
});

export const AssistantSettings = z.object({ schoolDays: z.array(z.number().int().min(0).max(6)).min(1).max(7) });
export const getAssistantSettings = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/assistant/settings',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: AssistantSettings.extend({ responsibilities: z.array(Responsibility) }),
});
export const setAssistantSettings = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/assistant/settings',
  access: 'teacher',
  input: z.object({
    contextId: Id,
    schoolDays: AssistantSettings.shape.schoolDays.optional(),
    /** Replaces the list: kept ids are updated and reordered, missing ones archived (never deleted). */
    responsibilities: z.array(z.object({ id: Id.optional(), label: RequiredLocalizedText })).max(12).optional(),
  }),
  output: AssistantSettings.extend({ responsibilities: z.array(Responsibility) }),
});

/** Cumulative history (AST-5): planned vs actual per day and turns per student this school year. */
export const assistantHistory = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/assistant/history',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({
    students: z.array(z.object({ student: AssistantStudent, turns: z.number().int(), missed: z.number().int(), lastDate: z.string().nullable(), nextDate: z.string().nullable() })),
    days: z.array(z.object({ date: z.string(), planned: AssistantStudent.nullable(), actual: AssistantStudent.nullable(), status: AssistantStatus, reason: z.string().nullable(), thanked: z.boolean() })),
  }),
});

/** End Lesson step 'assistantThanks' (optional): thank today's assistant. */
export const AssistantEndStepInput = z.object({ thanked: z.boolean().default(false) });
