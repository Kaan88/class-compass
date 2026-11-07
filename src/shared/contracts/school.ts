/**
 * School structure contracts (S2): settings, years/terms, subjects, classes, teaching contexts,
 * module policies (admin) and the teacher's own contexts and per-context module settings.
 */
import { z } from 'zod';
import { isIsoDate, isValidTimeZone } from '../dates.ts';
import { Empty, Ok, LocalizedText, endpoint } from './define.ts';

export const Id = z.string().min(1).max(64);
export const IsoDate = z.string().refine(isIsoDate, 'Expected a date YYYY-MM-DD');
export const TimeZone = z.string().refine(isValidTimeZone, 'Unknown timezone');
export const RequiredLocalizedText = LocalizedText.refine((t) => Boolean(t.en?.trim() || t.tr?.trim()), 'Name required (English or Turkish)');

import { CONTEXT_MODULES, MEDIA_MODULES, MODULE_KEYS } from '../modules.ts';
import { THEME_KEYS } from '../themes.ts';
// Module and theme keys live in the shared catalogues (D-069, D-070); re-exported for existing imports.
export { CONTEXT_MODULES, DEFAULT_AVAILABILITY, MEDIA_MODULES, MODULE_KEYS, type ContextModule, type MediaModule, type ModuleKey } from '../modules.ts';
export const ContextModuleKey = z.enum(CONTEXT_MODULES);
export const ModuleKeySchema = z.enum(MODULE_KEYS);

/** A class theme: any key of the shared theme registry (D-070). */
export const Theme = z.enum(THEME_KEYS);
export const Locale = z.enum(['en', 'tr']);

/** Query-string boolean ('true'/'false') or JSON boolean. */
export const QueryBool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

// ---------------------------------------------------------------- settings
export const SchoolSettings = z.object({
  schoolName: z.string(),
  timezone: z.string(),
  weekStartsOn: z.number().int(),
  defaultLocale: Locale,
  emailResetEnabled: z.boolean(),
});
export const getSettings = endpoint({ method: 'GET', path: '/api/admin/settings', access: 'admin', input: Empty, output: SchoolSettings });
export const updateSettings = endpoint({
  method: 'PATCH',
  path: '/api/admin/settings',
  access: 'admin',
  input: z.object({
    schoolName: z.string().trim().min(1).max(120).optional(),
    timezone: TimeZone.optional(),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
    defaultLocale: Locale.optional(),
  }),
  output: SchoolSettings,
});

// ---------------------------------------------------------------- years & terms
export const Term = z.object({ id: z.string(), schoolYearId: z.string(), name: LocalizedText, startsOn: z.string(), endsOn: z.string() });
export const SchoolYear = z.object({
  id: z.string(),
  name: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  archived: z.boolean(),
  terms: z.array(Term),
});
export const listYears = endpoint({ method: 'GET', path: '/api/admin/years', access: 'admin', input: Empty, output: z.object({ years: z.array(SchoolYear) }) });
export const createYear = endpoint({
  method: 'POST',
  path: '/api/admin/years',
  access: 'admin',
  input: z.object({ name: z.string().trim().min(1).max(40), startsOn: IsoDate, endsOn: IsoDate }),
  output: SchoolYear,
});
export const updateYear = endpoint({
  method: 'PATCH',
  path: '/api/admin/years/:yearId',
  access: 'admin',
  input: z.object({ yearId: Id, name: z.string().trim().min(1).max(40).optional(), startsOn: IsoDate.optional(), endsOn: IsoDate.optional() }),
  output: SchoolYear,
});
export const archiveYear = endpoint({ method: 'POST', path: '/api/admin/years/:yearId/archive', access: 'admin', input: z.object({ yearId: Id }), output: SchoolYear });
export const unarchiveYear = endpoint({ method: 'POST', path: '/api/admin/years/:yearId/unarchive', access: 'admin', input: z.object({ yearId: Id }), output: SchoolYear });
export const createTerm = endpoint({
  method: 'POST',
  path: '/api/admin/years/:yearId/terms',
  access: 'admin',
  input: z.object({ yearId: Id, name: RequiredLocalizedText, startsOn: IsoDate, endsOn: IsoDate }),
  output: Term,
});
export const updateTerm = endpoint({
  method: 'PATCH',
  path: '/api/admin/terms/:termId',
  access: 'admin',
  input: z.object({ termId: Id, name: RequiredLocalizedText.optional(), startsOn: IsoDate.optional(), endsOn: IsoDate.optional() }),
  output: Term,
});
export const deleteTerm = endpoint({ method: 'DELETE', path: '/api/admin/terms/:termId', access: 'admin', input: z.object({ termId: Id }), output: Ok });

// ---------------------------------------------------------------- subjects
export const Subject = z.object({ id: z.string(), name: LocalizedText, archived: z.boolean() });
export const listSubjects = endpoint({
  method: 'GET',
  path: '/api/admin/subjects',
  access: 'admin',
  input: z.object({ includeArchived: QueryBool.optional() }),
  output: z.object({ subjects: z.array(Subject) }),
});
export const createSubject = endpoint({ method: 'POST', path: '/api/admin/subjects', access: 'admin', input: z.object({ name: RequiredLocalizedText }), output: Subject });
export const updateSubject = endpoint({
  method: 'PATCH',
  path: '/api/admin/subjects/:subjectId',
  access: 'admin',
  input: z.object({ subjectId: Id, name: RequiredLocalizedText }),
  output: Subject,
});
export const archiveSubject = endpoint({ method: 'POST', path: '/api/admin/subjects/:subjectId/archive', access: 'admin', input: z.object({ subjectId: Id }), output: Subject });
export const unarchiveSubject = endpoint({ method: 'POST', path: '/api/admin/subjects/:subjectId/unarchive', access: 'admin', input: z.object({ subjectId: Id }), output: Subject });

// ---------------------------------------------------------------- classes
export const SchoolClass = z.object({
  id: z.string(),
  schoolYearId: z.string(),
  name: z.string(),
  grade: z.number().int().nullable(),
  theme: Theme,
  timezone: z.string().nullable(),
  soundsEnabled: z.boolean(),
  animationsEnabled: z.boolean(),
  archived: z.boolean(),
  yearArchived: z.boolean(),
  studentCount: z.number().int(),
});
const ClassFields = {
  name: z.string().trim().min(1).max(40),
  grade: z.number().int().min(0).max(12).nullable(),
  theme: Theme,
  timezone: TimeZone.nullable(),
  soundsEnabled: z.boolean(),
  animationsEnabled: z.boolean(),
};
export const listClasses = endpoint({
  method: 'GET',
  path: '/api/admin/classes',
  access: 'admin',
  input: z.object({ yearId: Id.optional(), includeArchived: QueryBool.optional() }),
  output: z.object({ classes: z.array(SchoolClass) }),
});
export const createClass = endpoint({
  method: 'POST',
  path: '/api/admin/classes',
  access: 'admin',
  input: z.object({
    schoolYearId: Id,
    name: ClassFields.name,
    grade: ClassFields.grade.optional(),
    theme: Theme.optional(),
    timezone: ClassFields.timezone.optional(),
    soundsEnabled: z.boolean().optional(),
    animationsEnabled: z.boolean().optional(),
  }),
  output: SchoolClass,
});
export const updateClass = endpoint({
  method: 'PATCH',
  path: '/api/admin/classes/:classId',
  access: 'admin',
  input: z.object({
    classId: Id,
    name: ClassFields.name.optional(),
    grade: ClassFields.grade.optional(),
    theme: Theme.optional(),
    timezone: ClassFields.timezone.optional(),
    soundsEnabled: z.boolean().optional(),
    animationsEnabled: z.boolean().optional(),
  }),
  output: SchoolClass,
});
export const archiveClass = endpoint({ method: 'POST', path: '/api/admin/classes/:classId/archive', access: 'admin', input: z.object({ classId: Id }), output: SchoolClass });
export const unarchiveClass = endpoint({ method: 'POST', path: '/api/admin/classes/:classId/unarchive', access: 'admin', input: z.object({ classId: Id }), output: SchoolClass });

// ---------------------------------------------------------------- teaching contexts (admin)
export const TeachingContextAdmin = z.object({
  id: z.string(),
  teacherId: z.string(),
  teacherName: z.string(),
  classId: z.string(),
  className: z.string(),
  subjectId: z.string(),
  subjectName: LocalizedText,
  activeFrom: z.number(),
  endedAt: z.number().nullable(),
});
export const listTeachingContexts = endpoint({
  method: 'GET',
  path: '/api/admin/teaching-contexts',
  access: 'admin',
  input: z.object({ classId: Id.optional(), teacherId: Id.optional(), includeEnded: QueryBool.optional() }),
  output: z.object({ contexts: z.array(TeachingContextAdmin) }),
});
export const assignTeachingContext = endpoint({
  method: 'POST',
  path: '/api/admin/teaching-contexts',
  access: 'admin',
  input: z.object({ teacherId: Id, classId: Id, subjectId: Id }),
  output: TeachingContextAdmin,
});
export const endTeachingContext = endpoint({
  method: 'POST',
  path: '/api/admin/teaching-contexts/:contextId/end',
  access: 'admin',
  input: z.object({ contextId: Id }),
  output: TeachingContextAdmin,
});

// ---------------------------------------------------------------- module policies (admin)
export const ModulePolicy = z.object({ module: ModuleKeySchema, availability: z.enum(['enabled', 'disabled']), adminOnly: z.boolean() });
export const getModulePolicies = endpoint({
  method: 'GET',
  path: '/api/admin/module-policies',
  access: 'admin',
  input: Empty,
  output: z.object({ policies: z.array(ModulePolicy) }),
});
export const setModulePolicy = endpoint({
  method: 'PUT',
  path: '/api/admin/module-policies/:module',
  access: 'admin',
  input: z.object({ module: ModuleKeySchema, availability: z.enum(['enabled', 'disabled']) }),
  output: ModulePolicy,
});

// ---------------------------------------------------------------- teacher: own contexts & modules
/** Classroom-safe summary: names and display settings only. */
export const MyContext = z.object({
  id: z.string(),
  classId: z.string(),
  className: z.string(),
  subjectId: z.string(),
  subjectName: LocalizedText,
  theme: Theme,
  timezone: z.string(),
  soundsEnabled: z.boolean(),
  animationsEnabled: z.boolean(),
  modules: z.record(ContextModuleKey, z.boolean()),
});
export const myContexts = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts',
  access: 'classroom',
  input: Empty,
  output: z.object({ contexts: z.array(MyContext), media: z.record(z.enum(MEDIA_MODULES), z.boolean()) }),
});

export const ContextModuleSetting = z.object({
  module: ContextModuleKey,
  /** Admin allows it globally. */
  available: z.boolean(),
  /** Teacher's own switch for this context. */
  enabled: z.boolean(),
  /** available && enabled */
  effective: z.boolean(),
  config: z.record(z.string(), z.unknown()).nullable(),
});
export const getContextModules = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/modules',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({ modules: z.array(ContextModuleSetting) }),
});
export const setContextModule = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/modules/:module',
  access: 'teacher',
  input: z.object({ contextId: Id, module: ContextModuleKey, enabled: z.boolean(), config: z.record(z.string(), z.unknown()).nullable().optional() }),
  output: ContextModuleSetting,
});
