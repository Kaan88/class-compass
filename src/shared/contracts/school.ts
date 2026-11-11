/**
 * School structure contracts (S2): settings, years/terms, subjects, classes, teaching contexts,
 * module policies (admin) and the teacher's own contexts and per-context module settings.
 */
import { z } from 'zod';
import { isIsoDate, isValidTimeZone } from '../dates.ts';
import { Empty, Ok, LocalizedText, endpoint, pii } from './define.ts';

export const Id = z.string().min(1).max(64);
export const IsoDate = z.string().refine(isIsoDate, 'Expected a date YYYY-MM-DD');
export const TimeZone = z.string().refine(isValidTimeZone, 'Unknown timezone');
export const RequiredLocalizedText = LocalizedText.refine((t) => Boolean(t.en?.trim() || t.tr?.trim()), 'Name required (English or Turkish)');

import { CONTEXT_MODULES, MEDIA_MODULES, MODULE_KEYS } from '../modules.ts';
import { THEME_KEYS, THEME_SLUG } from '../themes.ts';
import { TIME_UP_SOUNDS } from '../classDisplay.ts';
// Module and theme keys live in the shared catalogues (D-069, D-070); re-exported for existing imports.
export { CONTEXT_MODULES, DEFAULT_AVAILABILITY, MEDIA_MODULES, MODULE_KEYS, type ContextModule, type MediaModule, type ModuleKey } from '../modules.ts';
export const ContextModuleKey = z.enum(CONTEXT_MODULES);
export const ModuleKeySchema = z.enum(MODULE_KEYS);

/**
 * A theme key (D-070, D-158): a built-in key or the slug of an imported theme package. The contract
 * only checks the shape; the server checks that it is usable (`assertThemeUsable`: built-in or
 * enabled) before writing it, for classes and the Super Speakers board.
 */
export const Theme = z.union([z.enum(THEME_KEYS), z.string().regex(THEME_SLUG)]).meta(pii('none'));
export const Locale = z.enum(['en', 'tr']);

export const TimeUpSound = z.enum(TIME_UP_SOUNDS);
export const SoundVolume = z.number().int().min(0).max(100);

/** Query-string boolean ('true'/'false') or JSON boolean. */
export const QueryBool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

// ---------------------------------------------------------------- settings
export const SchoolSettings = z.object({
  schoolName: z.string().meta(pii('none')),
  timezone: z.string(),
  weekStartsOn: z.number().int(),
  defaultLocale: Locale,
  emailResetEnabled: z.boolean(),
  /** Classroom weather (S13b, D-106). */
  weatherEnabled: z.boolean(),
  weatherLabel: z.string().meta(pii('label')),
  weatherLatitude: z.number(),
  weatherLongitude: z.number(),
});
export const getSettings = endpoint({
  method: 'GET',
  path: '/api/admin/settings',
  access: 'admin',
  input: Empty,
  output: SchoolSettings,
  mcp: { scope: 'school:read', tool: 'school_settings', readOnly: true, description: 'The school settings: name, timezone, first day of the week, default language and the classroom weather place. No personal data.' },
});
export const updateSettings = endpoint({
  method: 'PATCH',
  path: '/api/admin/settings',
  access: 'admin',
  input: z.object({
    schoolName: z.string().trim().min(1).max(120).optional(),
    timezone: TimeZone.optional(),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
    defaultLocale: Locale.optional(),
    weatherEnabled: z.boolean().optional(),
    weatherLabel: z.string().trim().min(1).max(80).optional(),
    weatherLatitude: z.number().min(-90).max(90).optional(),
    weatherLongitude: z.number().min(-180).max(180).optional(),
  }),
  output: SchoolSettings,
  mcp: { scope: 'settings:admin', tool: 'update_school_settings', readOnly: false, description: 'Administrators: changes school settings (name, timezone, first day of the week, default language, classroom weather on/off and its place). Send only the fields to change. The AI tools switches are not here: they are a human decision on Admin → AI tools. Returns the settings.' },
});

// ---------------------------------------------------------------- years & terms
export const Term = z.object({ id: z.string(), schoolYearId: z.string(), name: LocalizedText, startsOn: z.string(), endsOn: z.string() });
export const SchoolYear = z.object({
  id: z.string(),
  name: z.string().meta(pii('label')),
  startsOn: z.string(),
  endsOn: z.string(),
  archived: z.boolean(),
  terms: z.array(Term),
});
export const listYears = endpoint({
  method: 'GET',
  path: '/api/admin/years',
  access: 'admin',
  input: Empty,
  output: z.object({ years: z.array(SchoolYear) }),
  mcp: { scope: 'school:read', tool: 'list_years', readOnly: true, description: 'Administrators: the school years with their terms (names and dates) and whether each is archived (read-only). No personal data.' },
});
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

// ---------------------------------------------------------------- school holiday calendar (S25b, D-186)
/** At most this many closures per school year (a year has a few dozen at most). */
export const MAX_CLOSURES_PER_YEAR = 120;
/** A named range of days without school (inclusive dates inside the year). `schoolDays` = Monday–Friday days it takes off. */
export const Closure = z.object({ id: z.string(), schoolYearId: z.string(), name: LocalizedText, startsOn: z.string(), endsOn: z.string(), schoolDays: z.number().int() });
export type Closure = z.infer<typeof Closure>;
const ClosureName = RequiredLocalizedText.refine((t) => (t.en ?? '').length <= 120 && (t.tr ?? '').length <= 120, 'Name too long');
export const listClosures = endpoint({
  method: 'GET',
  path: '/api/admin/years/:yearId/closures',
  access: 'admin',
  input: z.object({ yearId: Id }),
  output: z.object({ closures: z.array(Closure), archived: z.boolean() }),
});
export const createClosure = endpoint({
  method: 'POST',
  path: '/api/admin/years/:yearId/closures',
  access: 'admin',
  input: z.object({ yearId: Id, name: ClosureName, startsOn: IsoDate, endsOn: IsoDate }),
  output: Closure,
});
export const updateClosure = endpoint({
  method: 'PATCH',
  path: '/api/admin/closures/:closureId',
  access: 'admin',
  input: z.object({ closureId: Id, name: ClosureName.optional(), startsOn: IsoDate.optional(), endsOn: IsoDate.optional() }),
  output: Closure,
});
export const deleteClosure = endpoint({ method: 'DELETE', path: '/api/admin/closures/:closureId', access: 'admin', input: z.object({ closureId: Id }), output: Ok });
/**
 * "Add Turkish public holidays for this school year": the built-in fixed-date national holidays that
 * fall inside the year, each a one-day closure; a date already covered by a closure is skipped, so it
 * can be pressed again. Religious holidays move every year and are never added here.
 */
export const addPublicHolidays = endpoint({
  method: 'POST',
  path: '/api/admin/years/:yearId/closures/public-holidays',
  access: 'admin',
  input: z.object({ yearId: Id }),
  output: z.object({ added: z.number().int(), skipped: z.number().int() }),
});

// ---------------------------------------------------------------- subjects
export const Subject = z.object({ id: z.string(), name: LocalizedText, archived: z.boolean() });
export const listSubjects = endpoint({
  method: 'GET',
  path: '/api/admin/subjects',
  access: 'admin',
  input: z.object({ includeArchived: QueryBool.optional() }),
  output: z.object({ subjects: z.array(Subject) }),
  mcp: { scope: 'school:read', tool: 'list_subjects', readOnly: true, description: 'Administrators: the subjects with their English and Turkish names (archived ones with includeArchived "true"). No personal data.' },
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
/** Student-page language (S13b2, D-117): null = the same as the class, otherwise its own mode. */
export const StudentPageLanguageInput = z.object({ mainLanguage: Locale, secondLanguageEnabled: z.boolean() }).nullable();
export const SchoolClass = z.object({
  id: z.string(),
  schoolYearId: z.string(),
  name: z.string().meta(pii('label')),
  grade: z.number().int().nullable(),
  /**
   * The class's chosen theme as stored (D-158): the admin editor sends it back unchanged, so saving
   * other fields never replaces an imported theme that is switched off for now.
   */
  theme: Theme,
  /** False while `theme` is an imported theme that is not enabled (screens then show the default theme). */
  themeAvailable: z.boolean(),
  timezone: z.string().nullable(),
  soundsEnabled: z.boolean(),
  animationsEnabled: z.boolean(),
  /** Class language mode (S13a, D-099). */
  mainLanguage: Locale,
  secondLanguageEnabled: z.boolean(),
  /** Student-page override (S13b2, D-117): null = the student pages follow the class mode. */
  studentPageMainLanguage: Locale.nullable(),
  studentPageSecondLanguageEnabled: z.boolean().nullable(),
  /** S13b (D-105, D-107): sound volume 0–100, quote of the day, time's-up announcement. */
  soundVolume: z.number().int(),
  quoteEnabled: z.boolean(),
  timeUpSound: TimeUpSound,
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
  mcp: { scope: 'school:read', tool: 'list_classes', readOnly: true, description: 'Administrators: the classes (name, grade, theme, languages, display settings, number of students), optionally of one school year. No student names.' },
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
    mainLanguage: Locale.optional(),
    secondLanguageEnabled: z.boolean().optional(),
    studentPage: StudentPageLanguageInput.optional(),
    soundVolume: SoundVolume.optional(),
    quoteEnabled: z.boolean().optional(),
    timeUpSound: TimeUpSound.optional(),
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
    mainLanguage: Locale.optional(),
    secondLanguageEnabled: z.boolean().optional(),
    studentPage: StudentPageLanguageInput.optional(),
    soundVolume: SoundVolume.optional(),
    quoteEnabled: z.boolean().optional(),
    timeUpSound: TimeUpSound.optional(),
  }),
  output: SchoolClass,
});
export const archiveClass = endpoint({ method: 'POST', path: '/api/admin/classes/:classId/archive', access: 'admin', input: z.object({ classId: Id }), output: SchoolClass });
export const unarchiveClass = endpoint({ method: 'POST', path: '/api/admin/classes/:classId/unarchive', access: 'admin', input: z.object({ classId: Id }), output: SchoolClass });

// ---------------------------------------------------------------- teaching contexts (admin)
export const TeachingContextAdmin = z.object({
  id: z.string(),
  teacherId: z.string(),
  teacherName: z.string().meta(pii('staffName')),
  classId: z.string(),
  className: z.string().meta(pii('label')),
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
  mcp: { scope: 'school:read', tool: 'list_teaching_assignments', readOnly: true, description: 'Administrators: who teaches which subject in which class (teaching assignments = class+subjects, with context ids for the report tools), optionally filtered; ended ones with includeEnded "true". Teacher names are included; no student data.' },
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
  mcp: { scope: 'school:read', tool: 'module_policies', readOnly: true, description: 'Administrators: which modules the school makes available to teachers. No personal data.' },
});
export const setModulePolicy = endpoint({
  method: 'PUT',
  path: '/api/admin/module-policies/:module',
  access: 'admin',
  input: z.object({ module: ModuleKeySchema, availability: z.enum(['enabled', 'disabled']) }),
  output: ModulePolicy,
  mcp: { scope: 'settings:admin', tool: 'set_module_policy', readOnly: false, description: 'Administrators: makes a module available to every teacher or not (disabled modules keep their data). Returns the policy.' },
});

// ---------------------------------------------------------------- teacher: own contexts & modules
/** Classroom-safe summary: names and display settings only. */
export const MyContext = z.object({
  id: z.string(),
  classId: z.string(),
  className: z.string().meta(pii('label')),
  subjectId: z.string(),
  subjectName: LocalizedText,
  /** The theme the screens show: the chosen one, or the default while an imported choice is switched off (D-158). */
  theme: Theme,
  /** The class's chosen theme as stored; differs from `theme` only while that imported theme is not enabled. */
  chosenTheme: Theme,
  timezone: z.string(),
  soundsEnabled: z.boolean(),
  animationsEnabled: z.boolean(),
  /** Class language mode (S13a, D-099): what the classroom display and the label editors use. */
  mainLanguage: Locale,
  secondLanguageEnabled: z.boolean(),
  /** Student-page override (S13b2, D-117); null = same as the class. Label editors also offer its languages. */
  studentPageMainLanguage: Locale.nullable(),
  studentPageSecondLanguageEnabled: z.boolean().nullable(),
  /** S13b: sound volume, quote of the day, time's-up announcement (D-105, D-107). */
  soundVolume: z.number().int(),
  quoteEnabled: z.boolean(),
  timeUpSound: TimeUpSound,
  modules: z.record(ContextModuleKey, z.boolean()),
});
export type MyContext = z.infer<typeof MyContext>;
export const myContexts = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts',
  access: 'classroom',
  input: Empty,
  output: z.object({
    contexts: z.array(MyContext),
    media: z.record(z.enum(MEDIA_MODULES), z.boolean()),
    /**
     * Class+subject modules the administrator allows school-wide (S14e3): a teacher page whose module
     * is off everywhere says whether the teacher can switch it on or the administrator turned it off.
     */
    available: z.record(ContextModuleKey, z.boolean()),
    /** The signed-in teacher has recorded a time's-up clip (S13b, D-107). */
    timeUpClip: z.boolean(),
  }),
  mcp: { scope: 'classes:read', tool: 'list_my_classes', readOnly: true, description: 'Start here. The signed-in teacher\'s class+subjects: contextId (used by most tools), class and subject names, the class language and display settings, and which modules are on in each. No student data.' },
});

/** Display settings a teacher of the class may change (S13b, D-105): theme, sounds, motion, quote, time's up. */
export const ClassDisplay = z.object({
  classId: z.string(),
  theme: Theme,
  soundsEnabled: z.boolean(),
  soundVolume: z.number().int(),
  animationsEnabled: z.boolean(),
  quoteEnabled: z.boolean(),
  timeUpSound: TimeUpSound,
});
export type ClassDisplay = z.infer<typeof ClassDisplay>;
export const setClassDisplay = endpoint({
  method: 'PUT',
  path: '/api/teacher/classes/:classId/display',
  access: 'teacher',
  input: z.object({
    classId: Id,
    theme: Theme.optional(),
    soundsEnabled: z.boolean().optional(),
    soundVolume: SoundVolume.optional(),
    animationsEnabled: z.boolean().optional(),
    quoteEnabled: z.boolean().optional(),
    timeUpSound: TimeUpSound.optional(),
  }),
  output: ClassDisplay,
});

/**
 * Class language mode set by a teacher of the class (S13a, D-099; admins use updateClass). Shared by
 * every teacher of the class, audited; label data in a language switched off is kept.
 */
export const setClassLanguage = endpoint({
  method: 'PUT',
  path: '/api/teacher/classes/:classId/language',
  access: 'teacher',
  input: z.object({ classId: Id, mainLanguage: Locale, secondLanguageEnabled: z.boolean(), studentPage: StudentPageLanguageInput.optional() }),
  output: z.object({
    classId: z.string(),
    mainLanguage: Locale,
    secondLanguageEnabled: z.boolean(),
    studentPageMainLanguage: Locale.nullable(),
    studentPageSecondLanguageEnabled: z.boolean().nullable(),
  }),
});

export const ContextModuleSetting = z.object({
  module: ContextModuleKey,
  /** Admin allows it globally. */
  available: z.boolean(),
  /** Teacher's own switch for this context. */
  enabled: z.boolean(),
  /** available && enabled */
  effective: z.boolean(),
  config: z.record(z.string(), z.unknown()).nullable().meta(pii('teacherText')),
});
export const getContextModules = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/modules',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({ modules: z.array(ContextModuleSetting) }),
  mcp: { scope: 'classes:read', tool: 'class_modules', readOnly: true, description: 'The modules of one class+subject: available school-wide, switched on by the teacher, and their small settings. No student data.' },
});
export const setContextModule = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/modules/:module',
  access: 'teacher',
  input: z.object({ contextId: Id, module: ContextModuleKey, enabled: z.boolean(), config: z.record(z.string(), z.unknown()).nullable().optional() }),
  output: ContextModuleSetting,
  mcp: { scope: 'settings:write', tool: 'set_class_module', readOnly: false, description: 'Switches a module on or off for one of your class+subjects, optionally with its settings (the same as Class settings; data of a module that is off is kept). Returns the module\'s setting.' },
});
