/**
 * Personal student links (S10: STU-1..7, D-084).
 *
 * - A link holds a 256-bit random token; only HMAC(pepper, token) is stored. At most one active link
 *   per student (partial unique index); making a new one revokes the old one and bumps `generation`.
 * - The token travels in the URL fragment (`/s#<token>`) and is posted once to the public exchange
 *   endpoint, which answers with a strict student session cookie. The token is never logged, audited
 *   or returned again.
 * - The student resolver (`setStudentResolver`) re-checks the link on EVERY request: a revoked or
 *   replaced link, or a deactivated student, ends the session at once (STU-3).
 * - Teachers manage links for students in classes they teach (teacher area, PIN-gated).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/links.ts';
import { studentLinkUrl, type NewLink } from '../../../shared/contracts/links.ts';
import { initials } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { authAttempts, sessions, studentLinks, students } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { AppDeps, RequestContext, SessionRow, StudentPrincipal } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { newId, randomToken, timingSafeEqualStr, tokenHash } from '../../lib/crypto.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { STUDENT_SESSION_ABSOLUTE_MS } from '../../lib/http.ts';
import { createSession } from '../auth/service.ts';
import { assertClassWritable, assertTeachesClass, getClass } from '../school/policy.ts';
import { taughtClassIds } from '../school/service.ts';
import { liveClassIdsOf, rosterRows } from '../students/service.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type LinkRow = typeof studentLinks.$inferSelect;

const LAST_USED_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------- session resolution (every request)
/** Registered with `setStudentResolver`: the session's link must still be active and the student active. */
export function resolveStudent(deps: AppDeps, session: SessionRow): StudentPrincipal | null {
  if (!session.studentLinkId) return null;
  const link = deps.db.select().from(studentLinks).where(eq(studentLinks.id, session.studentLinkId)).get();
  if (!link || link.revokedAt !== null) return null;
  const student = deps.db.select({ id: students.id, deactivatedAt: students.deactivatedAt }).from(students).where(eq(students.id, link.studentId)).get();
  if (!student || student.deactivatedAt !== null) return null;
  const now = deps.now();
  if (link.lastUsedAt === null || now - link.lastUsedAt > LAST_USED_INTERVAL_MS) {
    deps.db.update(studentLinks).set({ lastUsedAt: now }).where(eq(studentLinks.id, link.id)).run();
  }
  return { studentId: link.studentId, linkId: link.id };
}

// ---------------------------------------------------------------- exchange (public)
/**
 * Refused exchanges per address (STU-4): only FAILED attempts count, so a whole class behind one school
 * network can open valid links together. After `EXCHANGE_FREE_FAILURES` failures within the window,
 * further refused tokens answer 429 until the window has passed since the last failure. A valid token is
 * still accepted (guessing a 256-bit token is not feasible; the cap is defence in depth against
 * flooding and keeps the per-route request limit as the outer bound).
 */
export const EXCHANGE_FREE_FAILURES = 20;
export const EXCHANGE_FAILURE_WINDOW_MS = 10 * 60_000;

function recordExchangeFailure(deps: AppDeps, ip: string, now: number): number {
  const key = `student_link:ip:${ip}`;
  const cur = deps.db.select().from(authAttempts).where(eq(authAttempts.key, key)).get();
  const failures = cur && now - cur.updatedAt < EXCHANGE_FAILURE_WINDOW_MS ? cur.failures + 1 : 1;
  deps.db
    .insert(authAttempts)
    .values({ key, failures, lockedUntil: null, updatedAt: now })
    .onConflictDoUpdate({ target: authAttempts.key, set: { failures, updatedAt: now } })
    .run();
  return failures;
}

/**
 * The token from the fragment → a new student session. Unknown, revoked and replaced tokens get the
 * same answer (401 LINK_INVALID), so the endpoint reveals nothing about which links existed; too many
 * of them from one address answer 429 instead.
 */
export function exchangeToken(deps: AppDeps, ip: string, token: string): { token: string } {
  const hash = tokenHash(deps.config.SECRET_PEPPER, token);
  const link = deps.db.select().from(studentLinks).where(eq(studentLinks.tokenHash, hash)).get();
  // The lookup is by HMAC (an attacker cannot steer it); the final comparison is constant-time.
  const valid = link !== undefined && timingSafeEqualStr(link.tokenHash, hash) && link.revokedAt === null;
  const student = valid ? deps.db.select({ deactivatedAt: students.deactivatedAt }).from(students).where(eq(students.id, link.studentId)).get() : undefined;
  const now = deps.now();
  if (!valid || !student || student.deactivatedAt !== null) {
    if (recordExchangeFailure(deps, ip, now) > EXCHANGE_FREE_FAILURES) throw new AppError('RATE_LIMITED', 'Too many attempts. Try again later.');
    throw new AppError('UNAUTHENTICATED', 'This link no longer works', { reason: 'LINK_INVALID' });
  }
  return tx(deps.db, () => {
    const { token: sessionToken } = createSession(deps, { kind: 'student', studentLinkId: link.id }, now, STUDENT_SESSION_ABSOLUTE_MS);
    deps.db.update(studentLinks).set({ lastUsedAt: now }).where(eq(studentLinks.id, link.id)).run();
    audit(deps.db, { type: 'student', id: link.studentId }, { action: 'student_link.open', entity: 'student_link', entityId: link.id, after: { generation: link.generation } }, now);
    return { token: sessionToken };
  });
}

export function endStudentSession(ctx: RequestContext): void {
  if (ctx.session) ctx.db.update(sessions).set({ revokedAt: ctx.now() }).where(eq(sessions.id, ctx.session.id)).run();
}

// ---------------------------------------------------------------- teacher area
/** The student is (or will be) in a class the signed-in teacher teaches; returns that class id. */
function assertTeachesStudent(ctx: RequestContext, studentId: string): string {
  const s = ctx.db.select({ id: students.id }).from(students).where(eq(students.id, studentId)).get();
  if (!s) throw notFound('Student');
  const taught = taughtClassIds(ctx.db, requireUser(ctx).id);
  const classId = liveClassIdsOf(ctx, studentId).find((c) => taught.includes(c));
  if (!classId) throw new AppError('FORBIDDEN', 'This student is not in a class you teach');
  return classId;
}

const activeLink = (db: Db, studentId: string): LinkRow | undefined =>
  db.select().from(studentLinks).where(and(eq(studentLinks.studentId, studentId), isNull(studentLinks.revokedAt))).get();

/** Revoke a link and end every session opened with it (STU-3). Inside a transaction. */
function revokeLinkRow(ctx: RequestContext, link: LinkRow, reason: 'revoke' | 'regenerate'): void {
  const now = ctx.now();
  ctx.db.update(studentLinks).set({ revokedAt: now, revokedBy: requireUser(ctx).id }).where(eq(studentLinks.id, link.id)).run();
  ctx.db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.studentLinkId, link.id), isNull(sessions.revokedAt))).run();
  audit(ctx.db, ctx.actor, { action: reason === 'revoke' ? 'student_link.revoke' : 'student_link.replace', entity: 'student_link', entityId: link.id, before: { studentId: link.studentId, generation: link.generation } }, now);
}

/** New link for one student (revoking the active one). Inside a transaction. The token is returned once. */
function makeLink(ctx: RequestContext, studentId: string, fullName: string): NewLink {
  const now = ctx.now();
  const old = activeLink(ctx.db, studentId);
  if (old) revokeLinkRow(ctx, old, 'regenerate');
  const last = ctx.db.select({ g: studentLinks.generation }).from(studentLinks).where(eq(studentLinks.studentId, studentId)).all();
  const generation = last.reduce((m, r) => Math.max(m, r.g), 0) + 1;
  const token = randomToken(32); // 256 bits (STU-4)
  const id = newId();
  ctx.db.insert(studentLinks).values({ id, studentId, tokenHash: tokenHash(ctx.config.SECRET_PEPPER, token), generation, createdBy: requireUser(ctx).id, createdAt: now, revokedAt: null, revokedBy: null, lastUsedAt: null }).run();
  audit(ctx.db, ctx.actor, { action: 'student_link.create', entity: 'student_link', entityId: id, after: { studentId, generation } }, now);
  return { studentId, fullName, url: studentLinkUrl(ctx.config.PUBLIC_ORIGIN, token), generation };
}

export function classLinks(ctx: RequestContext, classId: string) {
  const cls = assertTeachesClass(ctx, classId);
  const roster = rosterRows(ctx, cls).map((r) => r.student);
  const ids = roster.map((s) => s.id);
  const links = ids.length ? ctx.db.select().from(studentLinks).where(and(inArray(studentLinks.studentId, ids), isNull(studentLinks.revokedAt))).all() : [];
  const byStudent = new Map(links.map((l) => [l.studentId, l]));
  return {
    classId: cls.id,
    className: cls.name,
    archived: cls.archivedAt !== null,
    students: roster.map((s) => {
      const l = byStudent.get(s.id);
      return { id: s.id, fullName: s.fullName, initials: initials(s.fullName), avatarHue: s.avatarHue, link: l ? { generation: l.generation, createdAt: l.createdAt, lastUsedAt: l.lastUsedAt } : null };
    }),
  };
}

export function generateForStudent(ctx: RequestContext, studentId: string): NewLink {
  return tx(ctx.db, () => {
    const classId = assertTeachesStudent(ctx, studentId);
    assertClassWritable(ctx.db, getClass(ctx.db, classId));
    const s = ctx.db.select().from(students).where(eq(students.id, studentId)).get()!;
    if (s.deactivatedAt !== null) throw new AppError('CONFLICT', 'This student is deactivated', { reason: 'STUDENT_INACTIVE' });
    return makeLink(ctx, s.id, s.fullName);
  });
}

export function generateForClass(ctx: RequestContext, input: In<typeof C.generateClassLinks>): { links: NewLink[] } {
  return tx(ctx.db, () => {
    const cls = assertTeachesClass(ctx, input.classId);
    assertClassWritable(ctx.db, cls);
    const out: NewLink[] = [];
    for (const { student } of rosterRows(ctx, cls)) {
      if (input.scope === 'missing' && activeLink(ctx.db, student.id)) continue;
      out.push(makeLink(ctx, student.id, student.fullName));
    }
    return { links: out };
  });
}

/** Revoking is always allowed (also in an archived year): it only ever reduces access. */
export function revokeForStudent(ctx: RequestContext, studentId: string): void {
  tx(ctx.db, () => {
    assertTeachesStudent(ctx, studentId);
    const link = activeLink(ctx.db, studentId);
    if (link) revokeLinkRow(ctx, link, 'revoke');
  });
}

export function revokeForClass(ctx: RequestContext, classId: string): { revoked: number } {
  return tx(ctx.db, () => {
    const cls = assertTeachesClass(ctx, classId);
    let revoked = 0;
    for (const { student } of rosterRows(ctx, cls)) {
      const link = activeLink(ctx.db, student.id);
      if (link) {
        revokeLinkRow(ctx, link, 'revoke');
        revoked++;
      }
    }
    return { revoked };
  });
}
