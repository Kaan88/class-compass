/**
 * Student avatars (S13c items 9 and 11, D-124, D-125): a core module. The student picks a ready-made
 * avatar or builds one on their page; the spec is catalogue keys only (validated by the shared
 * contract, so an unknown part is a 400) and is stored on the student row. Teachers can stop changes
 * for a class (`classes.avatars_locked`), choose what shows before a student picks (generated avatar
 * or initials) and reset one student's avatar. Some parts unlock with achievements (any class+subject).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { AVATAR_UNLOCKS, generatedAvatar, lockedPartsOf, type AvatarSpecValue } from '../../../shared/avatars.ts';
import type * as C from '../../../shared/contracts/avatars.ts';
import type { StudentAvatarInfo } from '../../../shared/contracts/avatars.ts';
import { tx, type Db } from '../../db/client.ts';
import { achievementDefinitions, classes, studentAchievements, students } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireStudent, requireUser, type RequestContext } from '../../lib/context.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { studentScope } from '../links/scope.ts';
import { assertClassWritable, assertTeachesClass, getClass } from '../school/policy.ts';
import { taughtClassIds } from '../school/service.ts';
import { liveClassIdsOf, rosterRows } from '../students/service.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;

export const specOf = (row: { avatarJson: Record<string, unknown> | null }): AvatarSpecValue | null => (row.avatarJson as AvatarSpecValue | null) ?? null;

/** Keys of the default achievements a student holds (live awards in any class+subject). */
export function earnedDefaultKeys(db: Db, studentId: string): string[] {
  const rows = db
    .select({ key: achievementDefinitions.key })
    .from(studentAchievements)
    .innerJoin(achievementDefinitions, eq(achievementDefinitions.id, studentAchievements.achievementId))
    .where(and(eq(studentAchievements.studentId, studentId), isNull(studentAchievements.revokedAt)))
    .all();
  return [...new Set(rows.flatMap((r) => (r.key ? [r.key] : [])))].sort();
}

export function studentAvatarInfo(db: Db, student: typeof students.$inferSelect, classRows: ReadonlyArray<typeof classes.$inferSelect>): StudentAvatarInfo {
  return {
    spec: specOf(student),
    generated: generatedAvatar(student.id),
    locked: classRows.some((c) => c.avatarsLocked),
    fallback: classRows.some((c) => c.avatarFallback === 'initials') ? 'initials' : 'generated',
    earned: earnedDefaultKeys(db, student.id),
  };
}

export function setOwnAvatar(ctx: RequestContext, input: In<typeof C.studentSetAvatar>): StudentAvatarInfo {
  return tx(ctx.db, () => {
    const { studentId } = requireStudent(ctx);
    const scope = studentScope(ctx, studentId);
    if (!scope.classes.length) throw notFound('Class');
    if (scope.classes.some((c) => c.avatarsLocked)) throw new AppError('FORBIDDEN', 'Your teacher has paused avatar changes', { reason: 'AVATAR_LOCKED' });
    const earned = new Set(earnedDefaultKeys(ctx.db, studentId));
    const missing = lockedPartsOf(input.spec).filter((k) => !earned.has(AVATAR_UNLOCKS[k]!));
    if (missing.length) throw new AppError('FORBIDDEN', 'Earn the badge first to use this part', { reason: 'AVATAR_PART_LOCKED', parts: missing });
    const now = ctx.now();
    ctx.db.update(students).set({ avatarJson: input.spec as unknown as Record<string, unknown>, avatarUpdatedAt: now }).where(eq(students.id, studentId)).run();
    audit(ctx.db, ctx.actor, { action: 'avatar.set', entity: 'student', entityId: studentId, after: { type: input.spec.type } }, now);
    const student = ctx.db.select().from(students).where(eq(students.id, studentId)).get()!;
    return studentAvatarInfo(ctx.db, student, scope.classes);
  });
}

export function resetAvatar(ctx: RequestContext, studentId: string) {
  return tx(ctx.db, () => {
    const user = requireUser(ctx);
    const s = ctx.db.select().from(students).where(eq(students.id, studentId)).get();
    if (!s) throw notFound('Student');
    if (user.role !== 'admin') {
      const taught = taughtClassIds(ctx.db, user.id);
      if (!liveClassIdsOf(ctx, studentId).some((c) => taught.includes(c))) throw new AppError('FORBIDDEN', 'Not your student');
    }
    ctx.db.update(students).set({ avatarJson: null, avatarUpdatedAt: ctx.now() }).where(eq(students.id, studentId)).run();
    audit(ctx.db, ctx.actor, { action: 'avatar.reset', entity: 'student', entityId: studentId, before: { hadAvatar: s.avatarJson !== null } }, ctx.now());
    return { ok: true as const };
  });
}

export function getSettings(ctx: RequestContext, classId: string) {
  const cls = assertTeachesClass(ctx, classId);
  return { locked: cls.avatarsLocked, fallback: cls.avatarFallback };
}

export function setSettings(ctx: RequestContext, input: In<typeof C.setAvatarSettings>) {
  return tx(ctx.db, () => {
    const cls = assertTeachesClass(ctx, input.classId);
    assertClassWritable(ctx.db, cls);
    const patch: Partial<typeof classes.$inferInsert> = {};
    if (input.locked !== undefined) patch.avatarsLocked = input.locked;
    if (input.fallback !== undefined) patch.avatarFallback = input.fallback;
    if (Object.keys(patch).length) ctx.db.update(classes).set(patch).where(eq(classes.id, cls.id)).run();
    audit(ctx.db, ctx.actor, { action: 'avatar.settings', entity: 'class', entityId: cls.id, before: { locked: cls.avatarsLocked, fallback: cls.avatarFallback }, after: patch }, ctx.now());
    const next = getClass(ctx.db, cls.id);
    return { locked: next.avatarsLocked, fallback: next.avatarFallback };
  });
}

/** Avatars of the students in the signed-in teacher's classes (classroom-safe: catalogue keys only). */
export function classroomAvatars(ctx: RequestContext) {
  const uid = requireUser(ctx).id;
  const classIds = taughtClassIds(ctx.db, uid);
  const clsRows = classIds.length ? ctx.db.select().from(classes).where(inArray(classes.id, classIds)).all() : [];
  const out: Array<{ id: string; classId: string; spec: AvatarSpecValue | null }> = [];
  for (const cls of clsRows) for (const { student } of rosterRows(ctx, cls)) out.push({ id: student.id, classId: cls.id, spec: specOf(student) });
  return { classes: clsRows.map((c) => ({ classId: c.id, fallback: c.avatarFallback, locked: c.avatarsLocked })), students: out };
}
