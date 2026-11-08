/**
 * Student achievements (S13c items 1-8, D-121, D-122).
 *
 * - Definitions: the built-in defaults (seeded once with stable ids, `defaults.ts`) and badges a
 *   teacher makes. A teacher can archive a default for their own classes (`default_item_archives`,
 *   kind 'achievement'); an admin can archive a default school-wide (`archived_at`).
 * - Automatic badges (rule engine, `domain/achievements.ts`) are awarded when the student's facts in
 *   the class+subject reach the rule. Evaluation is idempotent (one live award per student,
 *   achievement and class+subject), so a replayed event or a second backfill never double-awards.
 *   They wait until the teacher chose how to start (item 3): "award past achievements quietly"
 *   (backfill, `quiet`, no celebration) or "start fresh" (only what happens from now counts).
 * - Manual badges are given by the teacher: from the teacher area (PIN) or in class through the
 *   outbox (no PIN), with undo within 10 minutes; later a PIN-gated revoke with a reason.
 * - Nothing is ranked or compared: counts are per student, the level path is private.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { z } from 'zod';
import { ruleProgress, ruleReached } from '../../../domain/achievements.ts';
import { CLASSROOM_UNDO_MS, INACTIVE_EVENTS, TIER_POINTS, levelFor, type AchievementRule } from '../../../shared/achievements.ts';
import type * as C from '../../../shared/contracts/achievements.ts';
import type { AchievementDef, AchievementSettings, Award, StudentAchievementsSection } from '../../../shared/contracts/achievements.ts';
import { initials } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { achievementDefinitions, defaultItemArchives, lessons, studentAchievements, students, users } from '../../db/schema.ts';
import type { StudentActivity } from '../../lib/activity.ts';
import { audit } from '../../lib/audit.ts';
import type { CommandMeta } from '../../lib/commands.ts';
import { requireStudent, requireUser, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { lessonForCommand } from '../lessons/service.ts';
import { studentScope } from '../links/scope.ts';
import type { StudentPageInput } from '../manifest.ts';
import { assertModuleEnabled, isModuleEnabled, mergeModuleConfig, moduleConfig } from '../school/modules.ts';
import { assertClassWritable, assertOwnsContext, effectiveTimezone, getClass, getSchoolSettings, type ContextRow } from '../school/policy.ts';
import { rosterRows } from '../students/service.ts';
import { collectFacts, collectFactsMany, type FactsOptions } from './facts.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
export type DefRow = typeof achievementDefinitions.$inferSelect;
export type AwardRow = typeof studentAchievements.$inferSelect;

export const DEFAULT_SETTINGS: AchievementSettings = { autoEnabled: true, levelsEnabled: true, announce: 'off', startMode: null, autoSince: null };
export const settingsOf = (db: Db, contextId: string): AchievementSettings => ({ ...DEFAULT_SETTINGS, ...(moduleConfig(db, contextId, 'achievements') as Partial<AchievementSettings>) });

const factsOptions = (db: Db, context: ContextRow): FactsOptions => ({ timezone: effectiveTimezone(db, getClass(db, context.classId)), weekStartsOn: getSchoolSettings(db).weekStartsOn });
const isInactive = (d: Pick<DefRow, 'ruleJson'>) => Boolean(d.ruleJson && INACTIVE_EVENTS.includes(d.ruleJson.event as AchievementRule['event']));
const ruleOf = (d: DefRow) => d.ruleJson as AchievementRule | null;

// ---------------------------------------------------------------- definitions
function teacherArchived(db: Db, teacherId: string): Set<string> {
  return new Set(
    db
      .select({ id: defaultItemArchives.itemId })
      .from(defaultItemArchives)
      .where(and(eq(defaultItemArchives.userId, teacherId), eq(defaultItemArchives.kind, 'achievement')))
      .all()
      .map((r) => r.id),
  );
}

/** Defaults and the teacher's own badges (for this subject or any), archived ones included. */
function defsOfTeacher(db: Db, teacherId: string, subjectId: string): DefRow[] {
  return db
    .select()
    .from(achievementDefinitions)
    .where(or(isNull(achievementDefinitions.createdBy), and(eq(achievementDefinitions.createdBy, teacherId), or(isNull(achievementDefinitions.subjectId), eq(achievementDefinitions.subjectId, subjectId)))))
    .all();
}

export function defDto(d: DefRow, archivedByTeacher: ReadonlySet<string>): AchievementDef {
  const custom = d.createdBy !== null;
  return {
    id: d.id,
    key: d.key,
    name: d.name,
    description: d.description,
    icon: d.icon as AchievementDef['icon'],
    tier: d.tier,
    category: d.category,
    kind: d.kind,
    rule: ruleOf(d),
    custom,
    archived: custom ? d.archivedAt !== null : d.archivedAt !== null || archivedByTeacher.has(d.id),
    schoolArchived: !custom && d.archivedAt !== null,
    inactive: isInactive(d),
  };
}

/** Definitions usable in a class+subject now (not archived anywhere that applies). */
export function activeDefs(db: Db, context: ContextRow): DefRow[] {
  const archived = teacherArchived(db, context.teacherId);
  return defsOfTeacher(db, context.teacherId, context.subjectId).filter((d) => d.archivedAt === null && !archived.has(d.id));
}

// ---------------------------------------------------------------- awards
function insertAward(ctx: RequestContext, d: DefRow, studentId: string, contextId: string, a: { source: AwardRow['source']; by: string | null; lessonId?: string | null; ref?: string | null; quiet?: boolean }): AwardRow {
  const row: AwardRow = {
    id: newId(),
    studentId,
    achievementId: d.id,
    contextId,
    lessonId: a.lessonId ?? null,
    awardedAt: ctx.now(),
    awardedBy: a.by,
    source: a.source,
    sourceRef: a.ref ?? null,
    nameSnapshot: d.name,
    iconSnapshot: d.icon,
    tierSnapshot: d.tier,
    quiet: a.quiet ?? false,
    seenAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  };
  ctx.db.insert(studentAchievements).values(row).run();
  return row;
}

const liveAwardsOf = (db: Db, studentIds: readonly string[], contextId: string) =>
  studentIds.length ? db.select().from(studentAchievements).where(and(inArray(studentAchievements.studentId, [...studentIds]), eq(studentAchievements.contextId, contextId), isNull(studentAchievements.revokedAt))).all() : [];

/**
 * Evaluate the automatic badges of some students in one class+subject (idempotent). Returns the new
 * awards. Does nothing while the module is off, automatic badges are off or the start was not chosen.
 */
export function evaluate(ctx: RequestContext, context: ContextRow, studentIds: readonly string[], opts: { quiet?: boolean; source?: 'auto' | 'backfill'; ref?: string } = {}): AwardRow[] {
  if (!studentIds.length || !isModuleEnabled(ctx.db, context.id, 'achievements')) return [];
  const settings = settingsOf(ctx.db, context.id);
  if (!settings.autoEnabled || settings.startMode === null) return [];
  const defs = activeDefs(ctx.db, context).filter((d) => d.kind === 'auto' && d.ruleJson && !isInactive(d));
  if (!defs.length) return [];
  const since = settings.startMode === 'fresh' ? settings.autoSince : null;
  const held = new Set(liveAwardsOf(ctx.db, studentIds, context.id).map((a) => `${a.studentId}:${a.achievementId}`));
  const facts = collectFactsMany(ctx.db, studentIds, context, factsOptions(ctx.db, context));
  const out: AwardRow[] = [];
  for (const sid of studentIds) {
    const f = facts.get(sid)!;
    for (const d of defs) {
      if (held.has(`${sid}:${d.id}`) || !ruleReached(ruleOf(d)!, f, since)) continue;
      out.push(insertAward(ctx, d, sid, context.id, { source: opts.source ?? 'auto', by: null, ref: opts.ref ?? null, quiet: opts.quiet ?? false }));
      held.add(`${sid}:${d.id}`);
    }
  }
  return out;
}

/** Activity listener (manifest): re-evaluate the students in the class+subjects the activity belongs to. */
export function onActivity(ctx: RequestContext, a: StudentActivity): void {
  for (const sid of a.studentIds) {
    const scope = studentScope(ctx, sid);
    const contexts = scope.contexts.filter((c) => (a.contextId ? c.context.id === a.contextId : a.subjectId ? c.subject.id === a.subjectId : false));
    for (const c of contexts) evaluate(ctx, c.context, [sid], { ref: `event:${a.source}` });
  }
}

// ---------------------------------------------------------------- teacher area
function studentSummary(s: typeof students.$inferSelect) {
  return { id: s.id, fullName: s.fullName, initials: initials(s.fullName), avatarHue: s.avatarHue };
}

function awardDtos(db: Db, rows: readonly AwardRow[]): Award[] {
  const defIds = [...new Set(rows.map((r) => r.achievementId))];
  const cats = new Map((defIds.length ? db.select().from(achievementDefinitions).where(inArray(achievementDefinitions.id, defIds)).all() : []).map((d) => [d.id, d.category]));
  const byIds = [...new Set(rows.flatMap((r) => (r.awardedBy ? [r.awardedBy] : [])))];
  const names = new Map((byIds.length ? db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, byIds)).all() : []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    achievementId: r.achievementId,
    studentId: r.studentId,
    contextId: r.contextId,
    name: r.nameSnapshot,
    icon: r.iconSnapshot as Award['icon'],
    tier: r.tierSnapshot,
    category: cats.get(r.achievementId) ?? 'custom',
    source: r.source,
    awardedAt: r.awardedAt,
    awardedBy: r.awardedBy ? (names.get(r.awardedBy) ?? '') : null,
    revokedAt: r.revokedAt,
    revokeReason: r.revokeReason,
  }));
}

export function overview(ctx: RequestContext, contextId: string) {
  const context = assertOwnsContext(ctx, contextId);
  const cls = getClass(ctx.db, context.classId);
  const archived = teacherArchived(ctx.db, context.teacherId);
  const roster = rosterRows(ctx, cls).map((r) => r.student);
  const awards = liveAwardsOf(
    ctx.db,
    roster.map((s) => s.id),
    context.id,
  );
  return {
    contextId: context.id,
    className: cls.name,
    enabled: isModuleEnabled(ctx.db, context.id, 'achievements'),
    settings: settingsOf(ctx.db, context.id),
    definitions: defsOfTeacher(ctx.db, context.teacherId, context.subjectId)
      .map((d) => defDto(d, archived))
      .sort((a, b) => Number(a.custom) - Number(b.custom) || a.category.localeCompare(b.category)),
    students: roster.map((s) => {
      const mine = awards.filter((a) => a.studentId === s.id);
      return { ...studentSummary(s), awards: mine.length, manual: mine.filter((a) => a.source === 'manual').length, auto: mine.filter((a) => a.source !== 'manual').length };
    }),
  };
}

function assertStudentInRoster(ctx: RequestContext, context: ContextRow, studentIds: readonly string[]) {
  const ids = new Set(rosterRows(ctx, getClass(ctx.db, context.classId)).map((r) => r.student.id));
  for (const id of studentIds) if (!ids.has(id)) throw new AppError('NOT_FOUND', 'Student not in this class', { reason: 'STUDENT_NOT_IN_CLASS' });
}

export function studentAwards(ctx: RequestContext, contextId: string, studentId: string) {
  const context = assertOwnsContext(ctx, contextId);
  assertStudentInRoster(ctx, context, [studentId]);
  const s = ctx.db.select().from(students).where(eq(students.id, studentId)).get()!;
  const rows = ctx.db
    .select()
    .from(studentAchievements)
    .where(and(eq(studentAchievements.studentId, studentId), eq(studentAchievements.contextId, context.id)))
    .all()
    .sort((a, b) => b.awardedAt - a.awardedAt);
  return { student: studentSummary(s), awards: awardDtos(ctx.db, rows) };
}

/** The teacher's own context in a class that is not archived (archived classes are read-only, DAT-1). */
function ownedWritable(ctx: RequestContext, contextId: string): ContextRow {
  const context = assertOwnsContext(ctx, contextId);
  assertClassWritable(ctx.db, getClass(ctx.db, context.classId));
  return context;
}

function writableContext(ctx: RequestContext, contextId: string): ContextRow {
  const context = ownedWritable(ctx, contextId);
  assertModuleEnabled(ctx.db, context.id, 'achievements');
  return context;
}

export function createDef(ctx: RequestContext, input: In<typeof C.createAchievement>): AchievementDef {
  return tx(ctx.db, () => {
    const context = writableContext(ctx, input.contextId);
    const uid = requireUser(ctx).id;
    const rule = input.kind === 'auto' ? (input.rule ?? null) : null;
    if (input.kind === 'auto' && !rule) throw new AppError('VALIDATION', 'An automatic badge needs a rule', { reason: 'RULE_REQUIRED' });
    const now = ctx.now();
    const row: DefRow = {
      id: newId(),
      key: null,
      name: input.name,
      description: input.description,
      icon: input.icon,
      tier: input.tier,
      category: 'custom',
      kind: input.kind,
      ruleJson: rule,
      subjectId: context.subjectId,
      createdBy: uid,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    ctx.db.insert(achievementDefinitions).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'achievement.create', entity: 'achievement_definition', entityId: row.id, after: { kind: row.kind, tier: row.tier, icon: row.icon, rule } }, now);
    return defDto(row, new Set());
  });
}

export function updateDef(ctx: RequestContext, input: In<typeof C.updateAchievement>): AchievementDef {
  return tx(ctx.db, () => {
    const context = ownedWritable(ctx, input.contextId);
    const uid = requireUser(ctx).id;
    const d = ctx.db.select().from(achievementDefinitions).where(eq(achievementDefinitions.id, input.achievementId)).get();
    if (!d || (d.createdBy !== null && d.createdBy !== uid)) throw notFound('Achievement');
    const now = ctx.now();
    if (d.createdBy === null) {
      // A default: the teacher can only archive or restore it for their own classes.
      const changes = ['name', 'description', 'icon', 'tier', 'kind', 'rule'].filter((k) => (input as Record<string, unknown>)[k] !== undefined);
      if (changes.length) throw new AppError('FORBIDDEN', 'Default badges cannot be changed; make your own instead', { reason: 'DEFAULT_READ_ONLY' });
      if (input.archived === true)
        ctx.db.insert(defaultItemArchives).values({ userId: uid, kind: 'achievement', itemId: d.id, archivedAt: now }).onConflictDoNothing().run();
      if (input.archived === false)
        ctx.db.delete(defaultItemArchives).where(and(eq(defaultItemArchives.userId, uid), eq(defaultItemArchives.kind, 'achievement'), eq(defaultItemArchives.itemId, d.id))).run();
      audit(ctx.db, ctx.actor, { action: input.archived ? 'achievement_default.hide' : 'achievement_default.show', entity: 'achievement_definition', entityId: d.id, after: { contextId: context.id } }, now);
      return defDto(d, teacherArchived(ctx.db, uid));
    }
    const patch: Partial<DefRow> = { updatedAt: now };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.tier !== undefined) patch.tier = input.tier;
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.rule !== undefined) patch.ruleJson = input.rule;
    if ((patch.kind ?? d.kind) === 'auto' && !(patch.ruleJson ?? d.ruleJson)) throw new AppError('VALIDATION', 'An automatic badge needs a rule', { reason: 'RULE_REQUIRED' });
    if ((patch.kind ?? d.kind) === 'manual') patch.ruleJson = null;
    if (input.archived !== undefined) patch.archivedAt = input.archived ? now : null;
    ctx.db.update(achievementDefinitions).set(patch).where(eq(achievementDefinitions.id, d.id)).run();
    audit(ctx.db, ctx.actor, { action: 'achievement.update', entity: 'achievement_definition', entityId: d.id, before: { archived: d.archivedAt !== null }, after: { archived: input.archived, fields: Object.keys(patch).filter((k) => k !== 'updatedAt') } }, now);
    return defDto(ctx.db.select().from(achievementDefinitions).where(eq(achievementDefinitions.id, d.id)).get()!, new Set());
  });
}

export function setSettings(ctx: RequestContext, input: In<typeof C.setAchievementSettings>): AchievementSettings {
  return tx(ctx.db, () => {
    const context = ownedWritable(ctx, input.contextId);
    const before = settingsOf(ctx.db, context.id);
    const patch: Record<string, unknown> = {};
    if (input.autoEnabled !== undefined) patch.autoEnabled = input.autoEnabled;
    if (input.levelsEnabled !== undefined) patch.levelsEnabled = input.levelsEnabled;
    if (input.announce !== undefined) patch.announce = input.announce;
    mergeModuleConfig(ctx.db, context.id, 'achievements', patch, requireUser(ctx).id, ctx.now());
    audit(ctx.db, ctx.actor, { action: 'achievements.settings', entity: 'teaching_context', entityId: context.id, before: { autoEnabled: before.autoEnabled, levelsEnabled: before.levelsEnabled, announce: before.announce }, after: patch }, ctx.now());
    return settingsOf(ctx.db, context.id);
  });
}

/** Item 3: choose once how automatic badges start (quiet backfill or start fresh). */
export function start(ctx: RequestContext, input: In<typeof C.startAchievements>) {
  return tx(ctx.db, () => {
    const context = writableContext(ctx, input.contextId);
    const before = settingsOf(ctx.db, context.id);
    if (before.startMode !== null) throw new AppError('CONFLICT', 'Achievements have already started for this class', { reason: 'ACHIEVEMENTS_ALREADY_STARTED' });
    const now = ctx.now();
    mergeModuleConfig(ctx.db, context.id, 'achievements', { startMode: input.mode, autoSince: input.mode === 'fresh' ? now : null }, requireUser(ctx).id, now);
    const ids = rosterRows(ctx, getClass(ctx.db, context.classId)).map((r) => r.student.id);
    const awarded = input.mode === 'quiet' ? evaluate(ctx, context, ids, { quiet: true, source: 'backfill', ref: 'backfill' }).length : 0;
    audit(ctx.db, ctx.actor, { action: 'achievements.start', entity: 'teaching_context', entityId: context.id, after: { mode: input.mode, awarded } }, now);
    return { settings: settingsOf(ctx.db, context.id), awarded };
  });
}

function manualDef(ctx: RequestContext, context: ContextRow, achievementId: string): DefRow {
  const d = activeDefs(ctx.db, context).find((x) => x.id === achievementId);
  if (!d) throw notFound('Achievement');
  if (d.kind !== 'manual') throw new AppError('VALIDATION', 'This badge is given automatically', { reason: 'NOT_MANUAL' });
  return d;
}

function giveManual(ctx: RequestContext, context: ContextRow, achievementId: string, studentIds: readonly string[], ref: { lessonId?: string; opId?: string }) {
  const d = manualDef(ctx, context, achievementId);
  const unique = [...new Set(studentIds)];
  assertStudentInRoster(ctx, context, unique);
  const held = new Set(liveAwardsOf(ctx.db, unique, context.id).filter((a) => a.achievementId === d.id).map((a) => a.studentId));
  const uid = requireUser(ctx).id;
  const rows = unique.filter((s) => !held.has(s)).map((s) => insertAward(ctx, d, s, context.id, { source: 'manual', by: uid, lessonId: ref.lessonId ?? null, ref: ref.opId ?? null }));
  if (rows.length)
    audit(ctx.db, ctx.actor, { action: 'achievement.award', entity: 'achievement_definition', entityId: d.id, opId: ref.opId, after: { contextId: context.id, lessonId: ref.lessonId ?? null, studentIds: rows.map((r) => r.studentId), awardIds: rows.map((r) => r.id) } }, ctx.now());
  return { rows, already: unique.length - rows.length };
}

export function teacherAward(ctx: RequestContext, input: In<typeof C.teacherAward>) {
  return tx(ctx.db, () => {
    const context = writableContext(ctx, input.contextId);
    const { rows, already } = giveManual(ctx, context, input.achievementId, input.studentIds, {});
    return { awards: awardDtos(ctx.db, rows), already };
  });
}

export function revoke(ctx: RequestContext, input: In<typeof C.revokeAward>): Award {
  return tx(ctx.db, () => {
    const a = ctx.db.select().from(studentAchievements).where(eq(studentAchievements.id, input.awardId)).get();
    if (!a || !a.contextId) throw notFound('Award');
    const context = ownedWritable(ctx, a.contextId);
    if (a.revokedAt !== null) throw new AppError('CONFLICT', 'Already removed', { reason: 'ALREADY_REVOKED' });
    if (a.source !== 'manual') throw new AppError('VALIDATION', 'Automatic badges follow what the student did', { reason: 'NOT_MANUAL' });
    const now = ctx.now();
    ctx.db.update(studentAchievements).set({ revokedAt: now, revokedBy: requireUser(ctx).id, revokeReason: input.reason }).where(eq(studentAchievements.id, a.id)).run();
    audit(ctx.db, ctx.actor, { action: 'achievement.revoke', entity: 'student_achievement', entityId: a.id, after: { studentId: a.studentId, contextId: context.id, reason: input.reason } }, now);
    return awardDtos(ctx.db, [ctx.db.select().from(studentAchievements).where(eq(studentAchievements.id, a.id)).get()!])[0]!;
  });
}

// ---------------------------------------------------------------- admin
export function adminDefaults(ctx: RequestContext) {
  return { definitions: ctx.db.select().from(achievementDefinitions).where(isNull(achievementDefinitions.createdBy)).all().map((d) => defDto(d, new Set())) };
}

export function adminArchive(ctx: RequestContext, input: In<typeof C.adminArchiveAchievementDefault>) {
  return tx(ctx.db, () => {
    const d = ctx.db.select().from(achievementDefinitions).where(eq(achievementDefinitions.id, input.achievementId)).get();
    if (!d || d.createdBy !== null) throw notFound('Default achievement');
    ctx.db.update(achievementDefinitions).set({ archivedAt: input.archived ? ctx.now() : null, updatedAt: ctx.now() }).where(eq(achievementDefinitions.id, d.id)).run();
    audit(ctx.db, ctx.actor, { action: input.archived ? 'achievement_default.archive' : 'achievement_default.restore', entity: 'achievement_definition', entityId: d.id }, ctx.now());
    return adminDefaults(ctx);
  });
}

// ---------------------------------------------------------------- classroom
const badgeOf = (d: Pick<DefRow, 'id' | 'name' | 'description' | 'icon' | 'tier'>) => ({ id: d.id, name: d.name, description: d.description, icon: d.icon as AchievementDef['icon'], tier: d.tier });

export function classroomView(ctx: RequestContext, input: In<typeof C.classroomAchievements>) {
  const context = assertOwnsContext(ctx, input.contextId);
  const settings = settingsOf(ctx.db, context.id);
  if (!isModuleEnabled(ctx.db, context.id, 'achievements')) return { enabled: false, badges: [], lessonAwards: [], wellDone: [], announce: settings.announce };
  const defs = activeDefs(ctx.db, context);
  const lesson = input.lessonId ? ctx.db.select().from(lessons).where(eq(lessons.id, input.lessonId)).get() : undefined;
  const inLesson = lesson && lesson.contextId === context.id ? lesson : undefined;
  const uid = requireUser(ctx).id;
  const rows = inLesson
    ? ctx.db
        .select()
        .from(studentAchievements)
        .where(and(eq(studentAchievements.contextId, context.id), isNull(studentAchievements.revokedAt)))
        .all()
        .filter((a) => a.awardedAt >= inLesson.startedAt)
    : [];
  const now = ctx.now();
  const lessonAwards = rows
    .filter((a) => a.source === 'manual' && a.lessonId === inLesson?.id)
    .map((a) => ({ id: a.id, studentId: a.studentId, achievementId: a.achievementId, awardedAt: a.awardedAt, undoable: a.awardedBy === uid && now - a.awardedAt <= CLASSROOM_UNDO_MS }));
  const autos = settings.announce === 'endOfLesson' ? rows.filter((a) => a.source === 'auto' && !a.quiet) : [];
  const names = new Map(
    (autos.length
      ? ctx.db
          .select()
          .from(students)
          .where(
            inArray(
              students.id,
              autos.map((a) => a.studentId),
            ),
          )
          .all()
      : []
    ).map((s) => [s.id, s.fullName]),
  );
  return {
    enabled: true,
    badges: defs.filter((d) => d.kind === 'manual').map(badgeOf),
    lessonAwards,
    wellDone: autos.map((a) => ({ studentId: a.studentId, fullName: names.get(a.studentId) ?? '', badge: badgeOf({ id: a.achievementId, name: a.nameSnapshot, description: { en: '', tr: '' }, icon: a.iconSnapshot, tier: a.tierSnapshot }) })),
    announce: settings.announce,
  };
}

export function classroomAward(ctx: RequestContext, p: z.infer<(typeof C.AchievementCommands)['achievements.award']>, meta: CommandMeta) {
  const { context, lesson } = lessonForCommand(ctx, p, meta);
  assertModuleEnabled(ctx.db, context.id, 'achievements');
  const { rows, already } = giveManual(ctx, context, p.achievementId, p.studentIds, { lessonId: lesson.id, opId: meta.opId });
  // The awarded students (not those who already had it) are what the classroom moment names.
  return { awardIds: rows.map((r) => r.id), studentIds: rows.map((r) => r.studentId), already };
}

export function classroomUndo(ctx: RequestContext, p: z.infer<(typeof C.AchievementCommands)['achievements.undo']>, meta: CommandMeta) {
  const { context } = lessonForCommand(ctx, p, meta);
  const uid = requireUser(ctx).id;
  const now = ctx.now();
  const rows = ctx.db.select().from(studentAchievements).where(inArray(studentAchievements.id, [...new Set(p.awardIds)])).all();
  if (rows.length !== new Set(p.awardIds).size) throw notFound('Award');
  for (const a of rows) {
    if (a.contextId !== context.id || a.source !== 'manual' || a.awardedBy !== uid) throw notFound('Award');
    if (a.revokedAt !== null) continue;
    // Later than 10 minutes the award is removed in the teacher area (PIN) with a reason.
    if (now - a.awardedAt > CLASSROOM_UNDO_MS) throw new AppError('CONFLICT', 'Too late to undo here; remove it in the teacher area', { reason: 'UNDO_WINDOW_PASSED' });
  }
  const live = rows.filter((a) => a.revokedAt === null);
  for (const a of live) ctx.db.update(studentAchievements).set({ revokedAt: now, revokedBy: uid, revokeReason: 'undo' }).where(eq(studentAchievements.id, a.id)).run();
  if (live.length) audit(ctx.db, ctx.actor, { action: 'achievement.undo', entity: 'teaching_context', entityId: context.id, opId: meta.opId, after: { awardIds: live.map((a) => a.id) } }, now);
  return { undone: live.length };
}

// ---------------------------------------------------------------- student page
export function studentSection(ctx: RequestContext, input: StudentPageInput): StudentAchievementsSection | null {
  const { studentId, context } = input;
  const settings = settingsOf(ctx.db, context.id);
  // Awards from every class+subject of this subject the student is in today (D-121).
  const scope = studentScope(ctx, studentId);
  const ctxIds = scope.contexts.filter((c) => c.subject.id === context.subjectId && isModuleEnabled(ctx.db, c.context.id, 'achievements')).map((c) => c.context.id);
  const rows = ctxIds.length
    ? ctx.db
        .select()
        .from(studentAchievements)
        .where(and(eq(studentAchievements.studentId, studentId), inArray(studentAchievements.contextId, ctxIds), isNull(studentAchievements.revokedAt)))
        .all()
        .sort((a, b) => b.awardedAt - a.awardedAt)
    : [];
  const seen = new Set<string>();
  const earnedRows = rows.filter((r) => (seen.has(r.achievementId) ? false : (seen.add(r.achievementId), true)));
  const defs = new Map((seen.size ? ctx.db.select().from(achievementDefinitions).where(inArray(achievementDefinitions.id, [...seen])).all() : []).map((d) => [d.id, d]));
  const byIds = [...new Set(earnedRows.flatMap((r) => (r.awardedBy ? [r.awardedBy] : [])))];
  const names = new Map((byIds.length ? ctx.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, byIds)).all() : []).map((u) => [u.id, u.name]));
  const earned = earnedRows.map((r) => {
    const d = defs.get(r.achievementId);
    return {
      id: r.achievementId,
      name: r.nameSnapshot,
      description: d?.description ?? { en: '', tr: '' },
      icon: r.iconSnapshot as AchievementDef['icon'],
      tier: r.tierSnapshot,
      // Secret Student badges are shown as a class role on the student page (the Secret Student boundary keeps the word off it, SEC-3).
      category: d?.category === 'secret' ? ('roles' as const) : (d?.category ?? 'custom'),
      awardedAt: r.awardedAt,
      by: r.awardedBy ? (names.get(r.awardedBy) ?? null) : null,
      isNew: r.seenAt === null && !r.quiet,
    };
  });
  const facts = settings.autoEnabled ? collectFacts(ctx.db, studentId, context, factsOptions(ctx.db, context)) : null;
  const since = settings.startMode === 'fresh' ? settings.autoSince : null;
  const locked = settings.autoEnabled
    ? activeDefs(ctx.db, context)
        // Secret Student badges are not advertised before they are earned (SEC-3).
        .filter((d) => d.kind === 'auto' && d.ruleJson && !isInactive(d) && !seen.has(d.id) && d.category !== 'secret')
        .map((d) => ({ ...badgeOf(d), category: d.category, progress: facts ? ruleProgress(ruleOf(d)!, facts, since) : null }))
    : [];
  if (!earned.length && !locked.length) return null;
  const points = earned.reduce((n, e) => n + TIER_POINTS[e.tier], 0);
  return { earned, locked, level: settings.levelsEnabled ? levelFor(points) : null };
}

export function markSeen(ctx: RequestContext) {
  const { studentId } = requireStudent(ctx);
  ctx.db.update(studentAchievements).set({ seenAt: ctx.now() }).where(and(eq(studentAchievements.studentId, studentId), isNull(studentAchievements.seenAt))).run();
  return { ok: true as const };
}

/** End Lesson "Well done!" (item 7): only a moment on the display; nothing is written. */
export function wellDoneStep(): void {}
