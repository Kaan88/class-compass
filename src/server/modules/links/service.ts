/**
 * Personal student links (S10: STU-1..7, D-084; permanent since S13b2, D-115, D-118).
 *
 * - Every active student has exactly one link, made automatically (on creation and import through
 *   `onStudentCreated`, at start-up for students without one, and lazily when a links page is shown).
 *   A link holds a 256-bit random token; `HMAC(pepper, token)` is the lookup key and the token itself
 *   is stored encrypted (AES-256-GCM, key derived from the pepper by HKDF, bound to the row id), so
 *   teachers can show and print the same link again. The token is never logged or audited.
 * - The token travels in the URL fragment (`/s#<token>`) and is posted once to the public exchange
 *   endpoint, which answers with a strict student session cookie.
 * - The student resolver re-checks the link on EVERY request: a revoked or replaced link, or a
 *   deactivated or erased student, ends the session at once (STU-3). Deactivating a student is not a
 *   revoke: the link works again after reactivation.
 * - There is no routine revoke or regenerate. In an emergency an administrator or one of the student's
 *   current teachers revokes the link or replaces it (typed full name, reason, audit, D-118).
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { studentPageLanguage } from '../../../shared/classLanguage.ts';
import type * as C from '../../../shared/contracts/links.ts';
import { studentLinkUrl, type LinkStatus, type StudentLinkState } from '../../../shared/contracts/links.ts';
import { initials, lowerTr, normaliseName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { authAttempts, classes, sessions, studentLinks, students } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { notify } from '../../lib/notify.ts';
import type { Actor, AppDeps, RequestContext, SessionRow, StudentPrincipal } from '../../lib/context.ts';
import { actorUserId, requireUser } from '../../lib/context.ts';
import { newId, openSecret, randomToken, sealSecret, timingSafeEqualStr, tokenHash } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { STUDENT_SESSION_ABSOLUTE_MS } from '../../lib/http.ts';
import { createSession } from '../auth/service.ts';
import { assertTeachesClass, getClass, type ClassRow } from '../school/policy.ts';
import { taughtClassIds } from '../school/service.ts';
import { liveClassIdsOf, rosterRows } from '../students/service.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type LinkRow = typeof studentLinks.$inferSelect;
type LinkDeps = Pick<AppDeps, 'db' | 'now' | 'config'>;

const LAST_USED_INTERVAL_MS = 60_000;
/** HKDF purpose of the token encryption key (separate from the HMAC lookup key). */
const SEAL_PURPOSE = 'student-link-token';
const SYSTEM: Actor = { type: 'system', id: null };

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
 * The token from the fragment → a new student session. Unknown, revoked and replaced tokens and
 * deactivated students get the same answer (401 LINK_INVALID), so the endpoint reveals nothing about
 * which links existed; too many of them from one address answer 429 instead.
 */
/**
 * Exchanges a link token for a student session. `knownLinkId` is the link of the live student session
 * the device already holds (null when none): opening the same link again on that device is not a new
 * device, so it does not notify the teachers (D-155).
 */
export function exchangeToken(deps: AppDeps, ip: string, token: string, knownLinkId: string | null = null): { token: string } {
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
    // A device without a live session for this link (a new phone, or one whose cookie was cleared or
    // ran out) tells the teachers who want it; the same device opening its link again does not.
    if (knownLinkId !== link.id) notify(deps, { category: 'linkNewDevice', studentId: link.studentId, subjectId: null, entity: 'student_link', entityId: link.id });
    return { token: sessionToken };
  });
}

export function endStudentSession(ctx: RequestContext): void {
  if (ctx.session) ctx.db.update(sessions).set({ revokedAt: ctx.now() }).where(eq(sessions.id, ctx.session.id)).run();
}

// ---------------------------------------------------------------- permanent links (D-115)
const activeLink = (db: Db, studentId: string): LinkRow | undefined =>
  db.select().from(studentLinks).where(and(eq(studentLinks.studentId, studentId), isNull(studentLinks.revokedAt))).get();

const latestLink = (db: Db, studentId: string): LinkRow | undefined =>
  db.select().from(studentLinks).where(eq(studentLinks.studentId, studentId)).orderBy(desc(studentLinks.generation)).get();

/** The student has no link because it was revoked in an emergency (and no new one was made since). */
function emergencyRevoked(db: Db, studentId: string): LinkRow | null {
  const last = latestLink(db, studentId);
  return last && last.revokedAt !== null && last.revokeKind === 'emergency_revoke' ? last : null;
}

/** New link row (inside a transaction). The token is only kept encrypted; it leaves the server only as the card URL. */
function insertLink(deps: LinkDeps, actor: Actor, studentId: string, origin: LinkRow['origin']): LinkRow {
  const now = deps.now();
  const generation = (latestLink(deps.db, studentId)?.generation ?? 0) + 1;
  const token = randomToken(32); // 256 bits (STU-4)
  const id = newId();
  const row: LinkRow = {
    id,
    studentId,
    tokenHash: tokenHash(deps.config.SECRET_PEPPER, token),
    tokenCipher: sealSecret(deps.config.SECRET_PEPPER, SEAL_PURPOSE, id, token),
    generation,
    origin,
    createdBy: actorUserId(actor),
    createdAt: now,
    revokedAt: null,
    revokedBy: null,
    revokeKind: null,
    revokeReason: null,
    lastUsedAt: null,
  };
  deps.db.insert(studentLinks).values(row).run();
  audit(deps.db, actor, { action: 'student_link.create', entity: 'student_link', entityId: id, after: { studentId, generation, origin } }, now);
  return row;
}

/**
 * The student's active link, made now when an active student has none (inside a transaction). A
 * student whose link was revoked in an emergency stays without one until someone makes a new link;
 * deactivated students get none (an existing link keeps its row and works again on reactivation).
 */
export function ensureLinkFor(deps: LinkDeps, studentId: string): LinkRow | null {
  const current = activeLink(deps.db, studentId);
  if (current) return current;
  const st = deps.db.select({ deactivatedAt: students.deactivatedAt }).from(students).where(eq(students.id, studentId)).get();
  if (!st || st.deactivatedAt !== null || emergencyRevoked(deps.db, studentId)) return null;
  return insertLink(deps, SYSTEM, studentId, 'auto');
}

/** `onStudentCreated` listener: a new student (teacher, admin, importer, seed) gets a link at once. */
export function linkForNewStudent(deps: LinkDeps, studentId: string): void {
  ensureLinkFor(deps, studentId);
}

/** Start-up backfill: every active student without a link (and not revoked in an emergency) gets one. */
export function backfillLinks(deps: LinkDeps): number {
  return tx(deps.db, () => {
    const active = deps.db.select({ id: students.id }).from(students).where(isNull(students.deactivatedAt)).all();
    const linked = new Set(deps.db.select({ s: studentLinks.studentId }).from(studentLinks).where(isNull(studentLinks.revokedAt)).all().map((r) => r.s));
    let made = 0;
    for (const s of active) if (!linked.has(s.id) && ensureLinkFor(deps, s.id)) made++;
    return made;
  });
}

/**
 * Importer revert (IMP-5): links made automatically and never opened are not history. Removes them so
 * a student the batch created can still be deleted; false (nothing removed) when the student has any
 * other link or opened theirs.
 */
export function discardUnusedAutoLinks(db: Db, studentId: string): boolean {
  const rows = db.select().from(studentLinks).where(eq(studentLinks.studentId, studentId)).all();
  if (rows.some((r) => r.origin !== 'auto' || r.lastUsedAt !== null)) return false;
  if (rows.length) db.delete(studentLinks).where(eq(studentLinks.studentId, studentId)).run();
  return true;
}

function linkStatus(deps: LinkDeps, l: LinkRow): LinkStatus {
  const token = openSecret(deps.config.SECRET_PEPPER, SEAL_PURPOSE, l.id, l.tokenCipher);
  return {
    url: token ? studentLinkUrl(deps.config.PUBLIC_ORIGIN, token) : null,
    generation: l.generation,
    createdAt: l.createdAt,
    lastUsedAt: l.lastUsedAt,
    replacedAt: l.origin === 'emergency' ? l.createdAt : null,
  };
}

const cardLanguageOf = (cls: ClassRow | null) => (cls ? studentPageLanguage(cls).mainLanguage : 'en');

// ---------------------------------------------------------------- teacher area
/** The student is in a class the signed-in teacher teaches now (active context, live enrolment); returns that class. */
function assertTeachesStudent(ctx: RequestContext, studentId: string): ClassRow {
  const taught = taughtClassIds(ctx.db, requireUser(ctx).id);
  const classId = liveClassIdsOf(ctx, studentId).find((c) => taught.includes(c));
  if (!classId) throw new AppError('FORBIDDEN', 'This student is not in a class you teach');
  return getClass(ctx.db, classId);
}

/** Show and print (D-115): every student of the class with their permanent link. */
export function classLinks(ctx: RequestContext, classId: string) {
  const cls = assertTeachesClass(ctx, classId);
  const roster = rosterRows(ctx, cls).map((r) => r.student);
  const links = tx(ctx.db, () => new Map(roster.map((s) => [s.id, ensureLinkFor(ctx, s.id)])));
  return {
    classId: cls.id,
    className: cls.name,
    archived: cls.archivedAt !== null,
    cardLanguage: cardLanguageOf(cls),
    students: roster.map((s) => {
      const l = links.get(s.id) ?? null;
      return {
        id: s.id,
        fullName: s.fullName,
        initials: initials(s.fullName),
        avatarHue: s.avatarHue,
        link: l ? linkStatus(ctx, l) : null,
        revokedAt: l ? null : (emergencyRevoked(ctx.db, s.id)?.revokedAt ?? null),
      };
    }),
  };
}

function stateOf(ctx: RequestContext, studentId: string, cls: ClassRow | null): StudentLinkState {
  const st = ctx.db.select().from(students).where(eq(students.id, studentId)).get();
  if (!st) throw notFound('Student');
  const l = activeLink(ctx.db, studentId) ?? null;
  return {
    studentId,
    fullName: st.fullName,
    className: cls?.name ?? null,
    cardLanguage: cardLanguageOf(cls),
    link: l ? linkStatus(ctx, l) : null,
    revokedAt: l ? null : (emergencyRevoked(ctx.db, studentId)?.revokedAt ?? null),
  };
}

/** The class an administrator sees the student in (the first live enrolment), or null. */
function adminClassOf(ctx: RequestContext, studentId: string): ClassRow | null {
  const id = liveClassIdsOf(ctx, studentId)[0];
  return id ? (ctx.db.select().from(classes).where(eq(classes.id, id)).get() ?? null) : null;
}

export function adminLink(ctx: RequestContext, studentId: string): StudentLinkState {
  if (!ctx.db.select({ id: students.id }).from(students).where(eq(students.id, studentId)).get()) throw notFound('Student');
  tx(ctx.db, () => ensureLinkFor(ctx, studentId));
  return stateOf(ctx, studentId, adminClassOf(ctx, studentId));
}

/** Typed confirmation: the student's full name (NFC, Turkish lower case, surrounding and repeated spaces ignored), like ConfirmDestructive. */
const nameKey = (n: string) => lowerTr(normaliseName(n.normalize('NFC')));
const sameName = (typed: string, fullName: string) => nameKey(typed) === nameKey(fullName);

/**
 * Emergency revoke or replacement (D-118): administrators, and teachers who teach the student now
 * (other teachers and ended assignments get 403). The full name must be typed and a reason given;
 * the old link and every session opened with it stop at once; audited with the reason (never a token).
 */
export function emergencyLink(ctx: RequestContext, input: In<typeof C.teacherEmergencyLink>): StudentLinkState {
  return tx(ctx.db, () => {
    const st = ctx.db.select().from(students).where(eq(students.id, input.studentId)).get();
    if (!st) throw notFound('Student');
    const cls = ctx.user?.role === 'admin' ? adminClassOf(ctx, st.id) : assertTeachesStudent(ctx, st.id);
    if (!sameName(input.confirmName, st.fullName)) throw invalid('Type the student’s full name to confirm', { reason: 'CONFIRMATION_MISMATCH' });
    const now = ctx.now();
    const old = activeLink(ctx.db, st.id);
    if (input.action === 'revoke' && !old) throw new AppError('CONFLICT', 'This student has no link to revoke', { reason: 'NO_ACTIVE_LINK' });
    if (input.action === 'replace' && st.deactivatedAt !== null) throw new AppError('CONFLICT', 'This student is deactivated', { reason: 'STUDENT_INACTIVE' });
    if (old) {
      ctx.db
        .update(studentLinks)
        .set({ revokedAt: now, revokedBy: requireUser(ctx).id, revokeKind: input.action === 'revoke' ? 'emergency_revoke' : 'emergency_replace', revokeReason: input.reason })
        .where(eq(studentLinks.id, old.id))
        .run();
      ctx.db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.studentLinkId, old.id), isNull(sessions.revokedAt))).run();
    }
    const fresh = input.action === 'replace' ? insertLink(ctx, ctx.actor, st.id, 'emergency') : null;
    audit(
      ctx.db,
      ctx.actor,
      {
        action: input.action === 'revoke' ? 'student_link.emergency_revoke' : 'student_link.emergency_replace',
        entity: 'student',
        entityId: st.id,
        before: old ? { linkId: old.id, generation: old.generation } : null,
        after: { linkId: fresh?.id ?? null, generation: fresh?.generation ?? null, reason: input.reason },
      },
      now,
    );
    return stateOf(ctx, st.id, cls);
  });
}
