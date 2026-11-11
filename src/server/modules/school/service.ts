/**
 * School structure (DAT-1, ACC-2/5/12, CFG-1/2): settings, years/terms, subjects, classes, teaching
 * contexts, module policies. Every change is audited in the same transaction (DAT-5, ACC-9).
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/school.ts';
import { CONTEXT_MODULES, MEDIA_MODULES, type ContextModule, type ModuleKey } from '../../../shared/contracts/school.ts';
import { contextDefaultOn, isSchoolModule } from '../../../shared/modules.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import { compareNames, foldForSearch, normaliseName } from '../../../shared/text/turkish.ts';
import { DEFAULT_SOUND_VOLUME } from '../../../shared/classDisplay.ts';
import { tx, type Db } from '../../db/client.ts';
import {
  classes,
  contextModules,
  enrolments,
  modulePolicies,
  schoolClosures,
  schoolSettings,
  schoolYears,
  students,
  subjects,
  teachingContexts,
  terms,
  users,
} from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { AppDeps, RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { emailResetEnabled } from '../../lib/mailer.ts';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.ts';
import { contextModuleStates, getAvailability, mediaRecord, validateModuleConfig, type ContextModuleState } from './modules.ts';
import { DEFAULT_THEME } from '../../../shared/themes.ts';
import { assertThemeUsable, effectiveTheme, isThemeUsable } from '../themes/service.ts';
import {
  assertClassWritable,
  assertOwnsContext,
  assertTeachesClass,
  assertYearWritable,
  enrolmentActiveOn,
  getClass,
  getSchoolSettings,
  getYear,
  todayFor,
  type ClassRow,
  type ContextRow,
} from './policy.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;

const cleanText = (t: LocalizedTextValue): LocalizedTextValue => {
  const out: LocalizedTextValue = {};
  if (t.en?.trim()) out.en = normaliseName(t.en);
  if (t.tr?.trim()) out.tr = normaliseName(t.tr);
  return out;
};

function assertRange(from: string, to: string) {
  if (from > to) throw invalid('Start date must be on or before the end date', { reason: 'DATES_REVERSED' });
}

// ---------------------------------------------------------------- settings

export function settingsDto(deps: AppDeps) {
  const s = getSchoolSettings(deps.db);
  return {
    schoolName: s.schoolName,
    timezone: s.timezone,
    weekStartsOn: s.weekStartsOn,
    defaultLocale: s.defaultLocale,
    emailResetEnabled: emailResetEnabled(deps),
    weatherEnabled: s.weatherEnabled,
    weatherLabel: s.weatherLabel,
    weatherLatitude: s.weatherLatitude,
    weatherLongitude: s.weatherLongitude,
  };
}

export function updateSettings(ctx: RequestContext, input: In<typeof C.updateSettings>) {
  return tx(ctx.db, () => {
    const before = getSchoolSettings(ctx.db);
    const patch: Partial<typeof schoolSettings.$inferInsert> = { updatedAt: ctx.now() };
    if (input.schoolName !== undefined) patch.schoolName = normaliseName(input.schoolName);
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.weekStartsOn !== undefined) patch.weekStartsOn = input.weekStartsOn;
    if (input.defaultLocale !== undefined) patch.defaultLocale = input.defaultLocale;
    if (input.weatherEnabled !== undefined) patch.weatherEnabled = input.weatherEnabled;
    if (input.weatherLabel !== undefined) patch.weatherLabel = input.weatherLabel;
    if (input.weatherLatitude !== undefined) patch.weatherLatitude = input.weatherLatitude;
    if (input.weatherLongitude !== undefined) patch.weatherLongitude = input.weatherLongitude;
    ctx.db.update(schoolSettings).set(patch).where(eq(schoolSettings.id, 1)).run();
    const { updatedAt: _a, ...b } = before;
    const { updatedAt: _b, ...a } = getSchoolSettings(ctx.db);
    audit(ctx.db, ctx.actor, { action: 'school.settings_update', entity: 'school_settings', entityId: '1', before: b, after: a }, ctx.now());
    return settingsDto(ctx);
  });
}

// ---------------------------------------------------------------- years & terms
function termDto(t: typeof terms.$inferSelect) {
  return { id: t.id, schoolYearId: t.schoolYearId, name: t.name, startsOn: t.startsOn, endsOn: t.endsOn };
}

export function yearDto(db: Db, yearId: string) {
  const y = getYear(db, yearId);
  const ts = db.select().from(terms).where(eq(terms.schoolYearId, y.id)).orderBy(asc(terms.startsOn)).all();
  return { id: y.id, name: y.name, startsOn: y.startsOn, endsOn: y.endsOn, archived: y.archivedAt !== null, terms: ts.map(termDto) };
}

export function listYears(db: Db) {
  const ys = db.select({ id: schoolYears.id }).from(schoolYears).orderBy(asc(schoolYears.startsOn)).all();
  return ys.map((y) => yearDto(db, y.id));
}

/** School years must not overlap: every local date belongs to at most one year (DAT-1). */
function assertNoYearOverlap(db: Db, startsOn: string, endsOn: string, exceptId?: string) {
  const clash = db
    .select()
    .from(schoolYears)
    .all()
    .find((y) => y.id !== exceptId && y.startsOn <= endsOn && startsOn <= y.endsOn);
  if (clash) throw conflict(`These dates overlap the school year ${clash.name}`, { reason: 'YEAR_OVERLAP', yearId: clash.id });
}

export function createYear(ctx: RequestContext, input: In<typeof C.createYear>) {
  assertRange(input.startsOn, input.endsOn);
  return tx(ctx.db, () => {
    assertNoYearOverlap(ctx.db, input.startsOn, input.endsOn);
    const now = ctx.now();
    const row = { id: newId(), name: normaliseName(input.name), startsOn: input.startsOn, endsOn: input.endsOn, archivedAt: null, createdAt: now, updatedAt: now };
    ctx.db.insert(schoolYears).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'school_year.create', entity: 'school_year', entityId: row.id, after: { name: row.name, startsOn: row.startsOn, endsOn: row.endsOn } }, now);
    return yearDto(ctx.db, row.id);
  });
}

export function updateYear(ctx: RequestContext, input: In<typeof C.updateYear>) {
  return tx(ctx.db, () => {
    const y = assertYearWritable(ctx.db, input.yearId);
    const next = { name: input.name !== undefined ? normaliseName(input.name) : y.name, startsOn: input.startsOn ?? y.startsOn, endsOn: input.endsOn ?? y.endsOn };
    assertRange(next.startsOn, next.endsOn);
    assertNoYearOverlap(ctx.db, next.startsOn, next.endsOn, y.id);
    // Keep existing data inside the year: terms (as on term create/update) and enrolment start dates.
    const outsideTerm = ctx.db
      .select()
      .from(terms)
      .where(eq(terms.schoolYearId, y.id))
      .all()
      .find((t) => t.startsOn < next.startsOn || t.endsOn > next.endsOn);
    if (outsideTerm) throw conflict('A term of this year would fall outside the new dates; change the term first', { reason: 'TERM_OUTSIDE_YEAR', termId: outsideTerm.id });
    // The holiday calendar too (S25b, D-186): a closure stays inside its year.
    const outsideClosure = ctx.db
      .select({ id: schoolClosures.id })
      .from(schoolClosures)
      .where(and(eq(schoolClosures.schoolYearId, y.id), sql`(${schoolClosures.startsOn} < ${next.startsOn} or ${schoolClosures.endsOn} > ${next.endsOn})`))
      .get();
    if (outsideClosure) throw conflict('A holiday of this year would fall outside the new dates; change the holiday first', { reason: 'CLOSURE_OUTSIDE_YEAR', closureId: outsideClosure.id });
    const outsideEnrolment = ctx.db
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(and(eq(enrolments.schoolYearId, y.id), sql`(${enrolments.fromDate} < ${next.startsOn} or ${enrolments.fromDate} > ${next.endsOn})`))
      .get();
    if (outsideEnrolment) throw conflict('Students joined classes of this year on dates outside the new range', { reason: 'ENROLMENT_OUTSIDE_YEAR' });
    ctx.db.update(schoolYears).set({ ...next, updatedAt: ctx.now() }).where(eq(schoolYears.id, y.id)).run();
    audit(ctx.db, ctx.actor, { action: 'school_year.update', entity: 'school_year', entityId: y.id, before: { name: y.name, startsOn: y.startsOn, endsOn: y.endsOn }, after: next }, ctx.now());
    return yearDto(ctx.db, y.id);
  });
}

export function setYearArchived(ctx: RequestContext, yearId: string, archived: boolean) {
  return tx(ctx.db, () => {
    const y = getYear(ctx.db, yearId);
    if ((y.archivedAt !== null) !== archived) {
      ctx.db.update(schoolYears).set({ archivedAt: archived ? ctx.now() : null, updatedAt: ctx.now() }).where(eq(schoolYears.id, y.id)).run();
      audit(ctx.db, ctx.actor, { action: archived ? 'school_year.archive' : 'school_year.unarchive', entity: 'school_year', entityId: y.id }, ctx.now());
    }
    return yearDto(ctx.db, y.id);
  });
}

function assertTermInYear(y: { startsOn: string; endsOn: string }, startsOn: string, endsOn: string) {
  assertRange(startsOn, endsOn);
  if (startsOn < y.startsOn || endsOn > y.endsOn) throw invalid('Term dates must fall inside the school year', { reason: 'TERM_OUTSIDE_YEAR' });
}

export function createTerm(ctx: RequestContext, input: In<typeof C.createTerm>) {
  return tx(ctx.db, () => {
    const y = assertYearWritable(ctx.db, input.yearId);
    assertTermInYear(y, input.startsOn, input.endsOn);
    const now = ctx.now();
    const row = { id: newId(), schoolYearId: y.id, name: cleanText(input.name), startsOn: input.startsOn, endsOn: input.endsOn, createdAt: now, updatedAt: now };
    ctx.db.insert(terms).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'term.create', entity: 'term', entityId: row.id, after: termDto(row) }, now);
    return termDto(row);
  });
}

function getTerm(db: Db, termId: string) {
  const t = db.select().from(terms).where(eq(terms.id, termId)).get();
  if (!t) throw notFound('Term');
  return t;
}

export function updateTerm(ctx: RequestContext, input: In<typeof C.updateTerm>) {
  return tx(ctx.db, () => {
    const t = getTerm(ctx.db, input.termId);
    const y = assertYearWritable(ctx.db, t.schoolYearId);
    const next = { name: input.name ? cleanText(input.name) : t.name, startsOn: input.startsOn ?? t.startsOn, endsOn: input.endsOn ?? t.endsOn };
    assertTermInYear(y, next.startsOn, next.endsOn);
    ctx.db.update(terms).set({ ...next, updatedAt: ctx.now() }).where(eq(terms.id, t.id)).run();
    audit(ctx.db, ctx.actor, { action: 'term.update', entity: 'term', entityId: t.id, before: termDto(t), after: next }, ctx.now());
    return termDto({ ...t, ...next });
  });
}

/** Terms are calendar configuration (nothing references them by id), so deletion is allowed while the year is writable. */
export function deleteTerm(ctx: RequestContext, termId: string) {
  tx(ctx.db, () => {
    const t = getTerm(ctx.db, termId);
    assertYearWritable(ctx.db, t.schoolYearId);
    ctx.db.delete(terms).where(eq(terms.id, t.id)).run();
    audit(ctx.db, ctx.actor, { action: 'term.delete', entity: 'term', entityId: t.id, before: termDto(t) }, ctx.now());
  });
}

// ---------------------------------------------------------------- subjects
const subjectDto = (s: typeof subjects.$inferSelect) => ({ id: s.id, name: s.name, archived: s.archivedAt !== null });
const subjectSortKey = (s: { name: LocalizedTextValue }) => s.name.en ?? s.name.tr ?? '';

function getSubject(db: Db, id: string) {
  const s = db.select().from(subjects).where(eq(subjects.id, id)).get();
  if (!s) throw notFound('Subject');
  return s;
}

export function listSubjects(db: Db, includeArchived: boolean) {
  const rows = db.select().from(subjects).where(includeArchived ? undefined : isNull(subjects.archivedAt)).all();
  return rows.map(subjectDto).sort((a, b) => compareNames(subjectSortKey(a), subjectSortKey(b)));
}

export function createSubject(ctx: RequestContext, name: LocalizedTextValue) {
  return tx(ctx.db, () => {
    const now = ctx.now();
    const row = { id: newId(), name: cleanText(name), archivedAt: null, createdAt: now, updatedAt: now };
    ctx.db.insert(subjects).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'subject.create', entity: 'subject', entityId: row.id, after: { name: row.name } }, now);
    return subjectDto(row);
  });
}

export function updateSubject(ctx: RequestContext, id: string, name: LocalizedTextValue) {
  return tx(ctx.db, () => {
    const s = getSubject(ctx.db, id);
    const next = cleanText(name);
    ctx.db.update(subjects).set({ name: next, updatedAt: ctx.now() }).where(eq(subjects.id, id)).run();
    audit(ctx.db, ctx.actor, { action: 'subject.update', entity: 'subject', entityId: id, before: { name: s.name }, after: { name: next } }, ctx.now());
    return subjectDto({ ...s, name: next });
  });
}

export function setSubjectArchived(ctx: RequestContext, id: string, archived: boolean) {
  return tx(ctx.db, () => {
    const s = getSubject(ctx.db, id);
    const archivedAt = archived ? (s.archivedAt ?? ctx.now()) : null;
    if ((s.archivedAt !== null) !== archived) {
      ctx.db.update(subjects).set({ archivedAt, updatedAt: ctx.now() }).where(eq(subjects.id, id)).run();
      audit(ctx.db, ctx.actor, { action: archived ? 'subject.archive' : 'subject.unarchive', entity: 'subject', entityId: id }, ctx.now());
    }
    return subjectDto({ ...s, archivedAt });
  });
}

// ---------------------------------------------------------------- classes
/** Active students enrolled in the class today (class timezone), matching the rosters (D-021). */
export function activeStudentCount(deps: Pick<AppDeps, 'db' | 'now'>, cls: ClassRow): number {
  const r = deps.db
    .select({ n: sql<number>`count(*)` })
    .from(enrolments)
    .innerJoin(students, eq(students.id, enrolments.studentId))
    .where(and(eq(enrolments.classId, cls.id), enrolmentActiveOn(todayFor(deps, cls)), isNull(students.deactivatedAt)))
    .get();
  return r?.n ?? 0;
}

export function classDto(deps: Pick<AppDeps, 'db' | 'now'>, c: ClassRow) {
  const y = getYear(deps.db, c.schoolYearId);
  return {
    id: c.id,
    schoolYearId: c.schoolYearId,
    name: c.name,
    grade: c.grade,
    // The stored choice (D-158): the admin editor sends it back unchanged, so saving other fields never
    // replaces an imported theme that is switched off for now. Screens read `effectiveTheme`.
    theme: c.theme,
    themeAvailable: isThemeUsable(deps.db, c.theme),
    timezone: c.timezone,
    soundsEnabled: c.soundsEnabled,
    animationsEnabled: c.animationsEnabled,
    mainLanguage: c.mainLanguage,
    secondLanguageEnabled: c.secondLanguageEnabled,
    studentPageMainLanguage: c.studentPageMainLanguage,
    studentPageSecondLanguageEnabled: c.studentPageSecondLanguageEnabled,
    soundVolume: c.soundVolume,
    quoteEnabled: c.quoteEnabled,
    timeUpSound: c.timeUpSound,
    archived: c.archivedAt !== null,
    yearArchived: y.archivedAt !== null,
    studentCount: activeStudentCount(deps, c),
  };
}

export function listClasses(deps: Pick<AppDeps, 'db' | 'now'>, input: In<typeof C.listClasses>) {
  const { db } = deps;
  const conds = [];
  if (input.yearId) conds.push(eq(classes.schoolYearId, input.yearId));
  if (!input.includeArchived) conds.push(isNull(classes.archivedAt));
  const rows = db.select().from(classes).where(and(...conds)).all();
  return rows.sort((a, b) => compareNames(a.name, b.name)).map((c) => classDto(deps, c));
}

function assertUniqueClassName(db: Db, yearId: string, name: string, exceptId?: string) {
  const fold = foldForSearch(name);
  const clash = db
    .select()
    .from(classes)
    .where(and(eq(classes.schoolYearId, yearId), isNull(classes.archivedAt)))
    .all()
    .find((c) => c.id !== exceptId && foldForSearch(c.name) === fold);
  if (clash) throw conflict('A class with this name already exists in this school year', { reason: 'DUPLICATE_CLASS_NAME' });
}

export function createClass(ctx: RequestContext, input: In<typeof C.createClass>) {
  return tx(ctx.db, () => {
    assertYearWritable(ctx.db, input.schoolYearId);
    const name = normaliseName(input.name);
    assertUniqueClassName(ctx.db, input.schoolYearId, name);
    if (input.theme !== undefined) assertThemeUsable(ctx.db, input.theme);
    const now = ctx.now();
    const row: ClassRow = {
      id: newId(),
      schoolYearId: input.schoolYearId,
      name,
      grade: input.grade ?? null,
      theme: input.theme ?? DEFAULT_THEME,
      timezone: input.timezone ?? null,
      soundsEnabled: input.soundsEnabled ?? true,
      animationsEnabled: input.animationsEnabled ?? true,
      mainLanguage: input.mainLanguage ?? 'en',
      secondLanguageEnabled: input.secondLanguageEnabled ?? false,
      studentPageMainLanguage: input.studentPage?.mainLanguage ?? null,
      studentPageSecondLanguageEnabled: input.studentPage ? input.studentPage.secondLanguageEnabled : null,
      avatarsLocked: false,
      avatarFallback: 'generated',
      avatarUploads: false,
      soundVolume: input.soundVolume ?? DEFAULT_SOUND_VOLUME,
      quoteEnabled: input.quoteEnabled ?? true,
      timeUpSound: input.timeUpSound ?? 'voice',
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    ctx.db.insert(classes).values(row).run();
    const { createdAt: _c, updatedAt: _u, ...after } = row;
    audit(ctx.db, ctx.actor, { action: 'class.create', entity: 'class', entityId: row.id, after }, now);
    return classDto(ctx, row);
  });
}

/**
 * Runs inside the transaction that changes a class's language mode (class or student pages; S20d,
 * D-172): modules whose seeded defaults were written only in the class's languages complete the
 * untouched ones with the language just switched on. Registered by module manifests (`routes`), never
 * by import side effects; keep listeners synchronous and small.
 */
export type ClassLanguageListener = (ctx: RequestContext, cls: ClassRow) => void;
const languageListeners: ClassLanguageListener[] = [];
export function onClassLanguageChanged(fn: ClassLanguageListener): void {
  if (!languageListeners.includes(fn)) languageListeners.push(fn);
}
const LANGUAGE_FIELDS = ['mainLanguage', 'secondLanguageEnabled', 'studentPageMainLanguage', 'studentPageSecondLanguageEnabled'] as const;
function languageChanged(ctx: RequestContext, before: ClassRow): void {
  const after = getClass(ctx.db, before.id);
  if (LANGUAGE_FIELDS.every((k) => before[k] === after[k])) return;
  for (const fn of languageListeners) fn(ctx, after);
}

export function updateClass(ctx: RequestContext, input: In<typeof C.updateClass>) {
  return tx(ctx.db, () => {
    const c = getClass(ctx.db, input.classId);
    assertClassWritable(ctx.db, c);
    const patch: Partial<ClassRow> = {};
    if (input.name !== undefined) {
      patch.name = normaliseName(input.name);
      assertUniqueClassName(ctx.db, c.schoolYearId, patch.name, c.id);
    }
    if (input.grade !== undefined) patch.grade = input.grade;
    if (input.theme !== undefined && input.theme !== c.theme) {
      assertThemeUsable(ctx.db, input.theme);
      patch.theme = input.theme;
    }
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.soundsEnabled !== undefined) patch.soundsEnabled = input.soundsEnabled;
    if (input.animationsEnabled !== undefined) patch.animationsEnabled = input.animationsEnabled;
    if (input.mainLanguage !== undefined) patch.mainLanguage = input.mainLanguage;
    if (input.secondLanguageEnabled !== undefined) patch.secondLanguageEnabled = input.secondLanguageEnabled;
    if (input.studentPage !== undefined) Object.assign(patch, studentPagePatch(input.studentPage));
    if (input.soundVolume !== undefined) patch.soundVolume = input.soundVolume;
    if (input.quoteEnabled !== undefined) patch.quoteEnabled = input.quoteEnabled;
    if (input.timeUpSound !== undefined) patch.timeUpSound = input.timeUpSound;
    ctx.db.update(classes).set({ ...patch, updatedAt: ctx.now() }).where(eq(classes.id, c.id)).run();
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, c[k as keyof ClassRow]]));
    audit(ctx.db, ctx.actor, { action: 'class.update', entity: 'class', entityId: c.id, before, after: patch }, ctx.now());
    languageChanged(ctx, c);
    return classDto(ctx, getClass(ctx.db, c.id));
  });
}

export function setClassArchived(ctx: RequestContext, classId: string, archived: boolean) {
  return tx(ctx.db, () => {
    const c = getClass(ctx.db, classId);
    assertYearWritable(ctx.db, c.schoolYearId);
    if ((c.archivedAt !== null) !== archived) {
      if (!archived) assertUniqueClassName(ctx.db, c.schoolYearId, c.name, c.id);
      ctx.db.update(classes).set({ archivedAt: archived ? ctx.now() : null, updatedAt: ctx.now() }).where(eq(classes.id, c.id)).run();
      audit(ctx.db, ctx.actor, { action: archived ? 'class.archive' : 'class.unarchive', entity: 'class', entityId: c.id }, ctx.now());
    }
    return classDto(ctx, getClass(ctx.db, c.id));
  });
}

// ---------------------------------------------------------------- teaching contexts
function contextAdminDto(db: Db, t: ContextRow) {
  const teacher = db.select({ displayName: users.displayName }).from(users).where(eq(users.id, t.teacherId)).get();
  const c = getClass(db, t.classId);
  const s = getSubject(db, t.subjectId);
  return {
    id: t.id,
    teacherId: t.teacherId,
    teacherName: teacher?.displayName ?? '',
    classId: t.classId,
    className: c.name,
    subjectId: t.subjectId,
    subjectName: s.name,
    activeFrom: t.activeFrom,
    endedAt: t.endedAt,
  };
}

export function listTeachingContexts(db: Db, input: In<typeof C.listTeachingContexts>) {
  const conds = [];
  if (input.classId) conds.push(eq(teachingContexts.classId, input.classId));
  if (input.teacherId) conds.push(eq(teachingContexts.teacherId, input.teacherId));
  if (!input.includeEnded) conds.push(isNull(teachingContexts.endedAt));
  const rows = db.select().from(teachingContexts).where(and(...conds)).all();
  return rows
    .map((r) => contextAdminDto(db, r))
    .sort((a, b) => compareNames(a.className, b.className) || compareNames(subjectSortKey({ name: a.subjectName }), subjectSortKey({ name: b.subjectName })) || compareNames(a.teacherName, b.teacherName));
}

export function assignTeachingContext(ctx: RequestContext, input: In<typeof C.assignTeachingContext>) {
  return tx(ctx.db, () => {
    const teacher = ctx.db.select().from(users).where(eq(users.id, input.teacherId)).get();
    if (!teacher) throw notFound('Teacher');
    if (teacher.role !== 'teacher') throw invalid('Only teacher accounts can be assigned to classes', { reason: 'NOT_A_TEACHER' });
    if (teacher.disabledAt) throw invalid('This account is deactivated');
    const c = getClass(ctx.db, input.classId);
    assertClassWritable(ctx.db, c);
    const s = getSubject(ctx.db, input.subjectId);
    if (s.archivedAt) throw invalid('This subject is archived');
    const existing = ctx.db
      .select({ id: teachingContexts.id })
      .from(teachingContexts)
      .where(and(eq(teachingContexts.teacherId, teacher.id), eq(teachingContexts.classId, c.id), eq(teachingContexts.subjectId, s.id), isNull(teachingContexts.endedAt)))
      .get();
    if (existing) throw conflict('This teacher already teaches this subject in this class', { reason: 'ALREADY_ASSIGNED', contextId: existing.id });
    const now = ctx.now();
    const row: ContextRow = { id: newId(), teacherId: teacher.id, classId: c.id, subjectId: s.id, activeFrom: now, endedAt: null, createdAt: now };
    ctx.db.insert(teachingContexts).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'teaching_context.assign', entity: 'teaching_context', entityId: row.id, after: { teacherId: row.teacherId, classId: row.classId, subjectId: row.subjectId } }, now);
    return contextAdminDto(ctx.db, row);
  });
}

/** Ending keeps the row and all context-owned history (DAT-3, CFG-2). */
export function endTeachingContext(ctx: RequestContext, contextId: string) {
  return tx(ctx.db, () => {
    const t = ctx.db.select().from(teachingContexts).where(eq(teachingContexts.id, contextId)).get();
    if (!t) throw notFound('Teaching assignment');
    assertYearWritable(ctx.db, getClass(ctx.db, t.classId).schoolYearId);
    if (t.endedAt === null) {
      t.endedAt = ctx.now();
      ctx.db.update(teachingContexts).set({ endedAt: t.endedAt }).where(eq(teachingContexts.id, t.id)).run();
      audit(ctx.db, ctx.actor, { action: 'teaching_context.end', entity: 'teaching_context', entityId: t.id }, ctx.now());
    }
    return contextAdminDto(ctx.db, t);
  });
}

// ---------------------------------------------------------------- module policies
// Media flags and school-wide modules (D-127) have no teacher switch.
const isMedia = (m: string) => (MEDIA_MODULES as readonly string[]).includes(m) || isSchoolModule(m);

export function listModulePolicies(db: Db) {
  const a = getAvailability(db);
  return (Object.keys(a) as ModuleKey[]).map((m) => ({ module: m, availability: a[m] ? ('enabled' as const) : ('disabled' as const), adminOnly: isMedia(m) }));
}

/** Changing availability never deletes data or teacher settings (CFG-2). */
export function setModulePolicy(ctx: RequestContext, module: ModuleKey, availability: 'enabled' | 'disabled') {
  return tx(ctx.db, () => {
    const before = getAvailability(ctx.db)[module] ? 'enabled' : 'disabled';
    const now = ctx.now();
    ctx.db
      .insert(modulePolicies)
      .values({ module, availability, updatedAt: now, updatedBy: requireUser(ctx).id })
      .onConflictDoUpdate({ target: modulePolicies.module, set: { availability, updatedAt: now, updatedBy: requireUser(ctx).id } })
      .run();
    audit(ctx.db, ctx.actor, { action: 'module_policy.set', entity: 'module_policy', entityId: module, before: { availability: before }, after: { availability } }, now);
    return { module, availability, adminOnly: isMedia(module) };
  });
}

// ---------------------------------------------------------------- teacher: own contexts & modules
export function myContexts(ctx: RequestContext) {
  const tid = requireUser(ctx).id;
  const rows = ctx.db
    .select({ ctx: teachingContexts, cls: classes, subject: subjects })
    .from(teachingContexts)
    .innerJoin(classes, eq(classes.id, teachingContexts.classId))
    .innerJoin(schoolYears, eq(schoolYears.id, classes.schoolYearId))
    .innerJoin(subjects, eq(subjects.id, teachingContexts.subjectId))
    .where(and(eq(teachingContexts.teacherId, tid), isNull(teachingContexts.endedAt), isNull(classes.archivedAt), isNull(schoolYears.archivedAt)))
    .all();
  const schoolTz = getSchoolSettings(ctx.db).timezone;
  const contexts = rows
    .map(({ ctx: t, cls, subject }) => {
      const states = contextModuleStates(ctx.db, t.id);
      return {
        id: t.id,
        classId: cls.id,
        className: cls.name,
        subjectId: subject.id,
        subjectName: subject.name,
        theme: effectiveTheme(ctx.db, cls.theme),
        chosenTheme: cls.theme,
        timezone: cls.timezone ?? schoolTz,
        soundsEnabled: cls.soundsEnabled,
        animationsEnabled: cls.animationsEnabled,
        mainLanguage: cls.mainLanguage,
        secondLanguageEnabled: cls.secondLanguageEnabled,
        studentPageMainLanguage: cls.studentPageMainLanguage,
        studentPageSecondLanguageEnabled: cls.studentPageSecondLanguageEnabled,
        soundVolume: cls.soundVolume,
        quoteEnabled: cls.quoteEnabled,
        timeUpSound: cls.timeUpSound,
        modules: Object.fromEntries(states.map((s) => [s.module, s.effective])) as Record<ContextModule, boolean>,
      };
    })
    .sort((a, b) => compareNames(a.className, b.className) || compareNames(subjectSortKey({ name: a.subjectName }), subjectSortKey({ name: b.subjectName })));
  const avail = getAvailability(ctx.db);
  return {
    contexts,
    media: mediaRecord(ctx.db),
    available: Object.fromEntries(CONTEXT_MODULES.map((m) => [m, avail[m]])) as Record<ContextModule, boolean>,
    timeUpClip: requireUser(ctx).timeUpClipFileId !== null,
  };
}

const DISPLAY_KEYS = ['theme', 'soundsEnabled', 'soundVolume', 'animationsEnabled', 'quoteEnabled', 'timeUpSound'] as const;
const displayOf = (db: Db, c: ClassRow) => ({ classId: c.id, theme: effectiveTheme(db, c.theme), soundsEnabled: c.soundsEnabled, soundVolume: c.soundVolume, animationsEnabled: c.animationsEnabled, quoteEnabled: c.quoteEnabled, timeUpSound: c.timeUpSound });

/**
 * Display settings of a class changed by one of its teachers (S13b, D-105; admins also use
 * updateClass): theme, sounds and volume, animations, quote of the day, time's-up announcement.
 * Shared by every teacher of the class and audited ('class.display').
 */
export function setClassDisplay(ctx: RequestContext, input: In<typeof C.setClassDisplay>) {
  return tx(ctx.db, () => {
    const c = getClass(ctx.db, input.classId);
    if (ctx.user?.role !== 'admin') assertTeachesClass(ctx, c.id);
    assertClassWritable(ctx.db, c);
    const patch: Partial<ClassRow> = {};
    for (const k of DISPLAY_KEYS) if (input[k] !== undefined && input[k] !== c[k]) (patch as Record<string, unknown>)[k] = input[k];
    if (patch.theme !== undefined) assertThemeUsable(ctx.db, patch.theme);
    if (Object.keys(patch).length) {
      ctx.db.update(classes).set({ ...patch, updatedAt: ctx.now() }).where(eq(classes.id, c.id)).run();
      const before = Object.fromEntries(Object.keys(patch).map((k) => [k, c[k as keyof ClassRow]]));
      audit(ctx.db, ctx.actor, { action: 'class.display', entity: 'class', entityId: c.id, before, after: patch }, ctx.now());
    }
    return displayOf(ctx.db, getClass(ctx.db, c.id));
  });
}

/** Student-page override columns (S13b2, D-117): null = same as the class. */
const studentPagePatch = (v: { mainLanguage: 'en' | 'tr'; secondLanguageEnabled: boolean } | null) => ({
  studentPageMainLanguage: v?.mainLanguage ?? null,
  studentPageSecondLanguageEnabled: v ? v.secondLanguageEnabled : null,
});

/**
 * Class language mode by a teacher of the class (S13a, D-099), with the optional student-page override
 * (S13b2, D-117; left unchanged when `studentPage` is not sent). Label data is never removed; untouched
 * seeded defaults get the language switched on through `onClassLanguageChanged` (D-172).
 */
export function setClassLanguage(ctx: RequestContext, input: In<typeof C.setClassLanguage>) {
  return tx(ctx.db, () => {
    const c = getClass(ctx.db, input.classId);
    if (ctx.user?.role !== 'admin') assertTeachesClass(ctx, c.id);
    assertClassWritable(ctx.db, c);
    const before = { mainLanguage: c.mainLanguage, secondLanguageEnabled: c.secondLanguageEnabled, studentPageMainLanguage: c.studentPageMainLanguage, studentPageSecondLanguageEnabled: c.studentPageSecondLanguageEnabled };
    const after = {
      mainLanguage: input.mainLanguage,
      secondLanguageEnabled: input.secondLanguageEnabled,
      ...(input.studentPage !== undefined ? studentPagePatch(input.studentPage) : { studentPageMainLanguage: c.studentPageMainLanguage, studentPageSecondLanguageEnabled: c.studentPageSecondLanguageEnabled }),
    };
    if ((Object.keys(after) as Array<keyof typeof after>).some((k) => before[k] !== after[k])) {
      ctx.db.update(classes).set({ ...after, updatedAt: ctx.now() }).where(eq(classes.id, c.id)).run();
      audit(ctx.db, ctx.actor, { action: 'class.language', entity: 'class', entityId: c.id, before, after }, ctx.now());
      languageChanged(ctx, c);
    }
    return { classId: c.id, ...after };
  });
}

export function getContextModules(ctx: RequestContext, contextId: string) {
  assertOwnsContext(ctx, contextId);
  return contextModuleStates(ctx.db, contextId);
}

const MAX_CONFIG_BYTES = 8 * 1024;

/** Teachers customise within admin policy (ACC-5, ACC-12). Turning a module off keeps its data and config (CFG-2). */
export function setContextModule(ctx: RequestContext, input: In<typeof C.setContextModule>): ContextModuleState {
  return tx(ctx.db, () => {
    const t = assertOwnsContext(ctx, input.contextId);
    assertClassWritable(ctx.db, getClass(ctx.db, t.classId));
    if (!(CONTEXT_MODULES as readonly string[]).includes(input.module)) throw invalid('Unknown module');
    const available = getAvailability(ctx.db)[input.module];
    if (input.enabled && !available) throw new AppError('FEATURE_DISABLED', 'Your administrator has turned this module off', { module: input.module });
    const existing = ctx.db
      .select()
      .from(contextModules)
      .where(and(eq(contextModules.contextId, t.id), eq(contextModules.module, input.module)))
      .get();
    let configJson = existing?.configJson ?? null;
    if (input.config !== undefined) {
      configJson = input.config === null ? null : JSON.stringify(validateModuleConfig(input.module, input.config));
      if (configJson && Buffer.byteLength(configJson) > MAX_CONFIG_BYTES) throw invalid('Module settings are too large');
    }
    const now = ctx.now();
    const uid = requireUser(ctx).id;
    ctx.db
      .insert(contextModules)
      .values({ contextId: t.id, module: input.module, enabled: input.enabled, configJson, updatedAt: now, updatedBy: uid })
      .onConflictDoUpdate({ target: [contextModules.contextId, contextModules.module], set: { enabled: input.enabled, configJson, updatedAt: now, updatedBy: uid } })
      .run();
    audit(
      ctx.db,
      ctx.actor,
      { action: 'context_module.set', entity: 'teaching_context', entityId: t.id, before: existing ? { module: input.module, enabled: existing.enabled } : { module: input.module, enabled: contextDefaultOn(input.module) }, after: { module: input.module, enabled: input.enabled, configChanged: input.config !== undefined } },
      now,
    );
    return contextModuleStates(ctx.db, t.id).find((s) => s.module === input.module)!;
  });
}

/** Ids of the classes a teacher currently teaches (any subject). */
export function taughtClassIds(db: Db, teacherId: string): string[] {
  return db
    .selectDistinct({ classId: teachingContexts.classId })
    .from(teachingContexts)
    .where(and(eq(teachingContexts.teacherId, teacherId), isNull(teachingContexts.endedAt)))
    .all()
    .map((r) => r.classId);
}
