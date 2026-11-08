/**
 * Student text checks (S13c item 12, D-123): admin block/allow lists and goal limits, the words
 * teachers add for their classes, the optional "blocked words" notice (counts only, never the text)
 * and hiding a student entry from the student page (moderation; the words are not rewritten, GOL-5).
 */
import { z } from 'zod';
import { Ok, endpoint } from './define.ts';
import { Id } from './school.ts';

export const CheckWord = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .refine((w) => /^[\p{L}\p{N}' -]+$/u.test(w), 'Letters only');
const WordList = z.array(CheckWord).max(500);

export const TextLimitsSchema = z.object({ minGoalWords: z.number().int().min(1).max(10), minGoalLetters: z.number().int().min(4).max(60) });

export const AdminTextChecks = z.object({ limits: TextLimitsSchema, block: z.array(z.string()), allow: z.array(z.string()) });
export const adminTextChecks = endpoint({ method: 'GET', path: '/api/admin/text-checks', access: 'admin', input: z.object({}), output: AdminTextChecks });
export const setAdminTextChecks = endpoint({
  method: 'PUT',
  path: '/api/admin/text-checks',
  access: 'admin',
  input: z.object({ limits: TextLimitsSchema.optional(), block: WordList.optional(), allow: WordList.optional() }),
  output: AdminTextChecks,
});

/** Words the signed-in teacher blocks for the classes they teach. */
export const teacherTextWords = endpoint({ method: 'GET', path: '/api/teacher/text-check-words', access: 'teacher', input: z.object({}), output: z.object({ block: z.array(z.string()) }) });
export const setTeacherTextWords = endpoint({
  method: 'PUT',
  path: '/api/teacher/text-check-words',
  access: 'teacher',
  input: z.object({ block: WordList }),
  output: z.object({ block: z.array(z.string()) }),
});

/** The optional notice (default off): how many times each student tried to save blocked words. Counts only. */
export const blockedTextNotice = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/blocked-text',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({ enabled: z.boolean(), students: z.array(z.object({ id: z.string(), fullName: z.string(), count: z.number().int(), lastDate: z.string() })) }),
});
export const setBlockedTextNotice = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/blocked-text',
  access: 'teacher',
  input: z.object({ contextId: Id, enabled: z.boolean() }),
  output: z.object({ enabled: z.boolean() }),
});

export const HIDEABLE_KINDS = ['goal', 'entry', 'evidence'] as const;
/** Hide (or show again) a student's goal, entry or evidence on the student page; audited. */
export const hideStudentText = endpoint({
  method: 'PUT',
  path: '/api/teacher/student-text/:kind/:itemId/hidden',
  access: 'teacher',
  input: z.object({ kind: z.enum(HIDEABLE_KINDS), itemId: Id, hidden: z.boolean() }),
  output: Ok,
});
