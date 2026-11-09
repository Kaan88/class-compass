/**
 * Super Speakers (S12, SSP-1..12, D-127..D-134): school-wide English points.
 *
 * - School-wide module (D-127): one administrator switch (`superSpeakers` in the school catalogue), no
 *   per class+subject switch; everything uses the school timezone.
 * - Scorer and board links (D-128): a 256-bit token in the URL fragment, looked up by
 *   HMAC(pepper, token), also kept encrypted so the administrator can copy and show it again. The token
 *   is exchanged once for a strict cookie; every request re-checks the link, so revoking or
 *   regenerating it ends its sessions at once. The token is never logged or audited.
 * - Pairing codes (D-129): the installed iPhone app has its own cookie store, so the link page shows a
 *   6-digit code (HMAC stored, 10 minutes, single use; failures limited per address).
 * - Points (D-130): +1 only, through outbox commands; the student must be active and in a
 *   participating class today; a per-scorer rate limit; own undo within the undo window; an
 *   administrator voids with a reason. The week is a time window in the school timezone.
 */
import crypto from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { generatedAvatar, type AvatarSpecValue } from '../../../shared/avatars.ts';
import type * as C from '../../../shared/contracts/superSpeakers.ts';
import { boardLinkUrl, scorerLinkUrl, PAIRING_CODE_TTL_MS, type AdminAward, type Board, type BoardMessages, type DisplayLinkInfo, type ScorerLinkInfo, type SpeakersSettings, type SpeakersSettingsView } from '../../../shared/contracts/superSpeakers.ts';
import { compareNames, initials } from '../../../shared/text/turkish.ts';
import { localDate } from '../../../domain/dates.ts';
import { classTotals, podium, totalsByStudent, weekRangeOf } from '../../../domain/speakers.ts';
import { weekStartOf } from '../../../domain/counters.ts';
import { tx, type Db } from '../../db/client.ts';
import { authAttempts, classes, displayLinks, enrolments, pointEvents, schoolYears, scorerLinks, scorerPairings, sessions, students, subjects, superSpeakersSettings, users } from '../../db/schema.ts';
import { assertThemeUsable, effectiveTheme, isThemeUsable, themeRevision } from '../themes/service.ts';
import { emitStudentActivity } from '../../lib/activity.ts';
import { audit } from '../../lib/audit.ts';
import type { CommandMeta } from '../../lib/commands.ts';
import { requireScorer, requireUser, type AppDeps, type DisplayPrincipal, type RequestContext, type ScorerPrincipal, type SessionRow } from '../../lib/context.ts';
import { newId, openSecret, randomToken, sealSecret, sha256, timingSafeEqualStr, tokenHash } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { DISPLAY_SESSION_ABSOLUTE_MS, SCORER_SESSION_ABSOLUTE_MS } from '../../lib/http.ts';
import { createSession } from '../auth/service.ts';
import { specOf } from '../avatars/service.ts';
import { isModuleAvailable } from '../school/modules.ts';
import { enrolmentActiveOn, getSchoolSettings, type ClassRow } from '../school/policy.ts';
import { notifyBoardChange } from './events.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type Deps = Pick<AppDeps, 'db' | 'now' | 'config'>;
type SettingsRow = typeof superSpeakersSettings.$inferSelect;
type ScorerLinkRow = typeof scorerLinks.$inferSelect;
type DisplayLinkRow = typeof displayLinks.$inferSelect;
type PointRow = typeof pointEvents.$inferSelect;
type StudentRow = typeof students.$inferSelect;

export const MODULE = 'superSpeakers' as const;
const SCORER_SEAL = 'scorer-link-token';
const DISPLAY_SEAL = 'display-link-token';
const LAST_USED_INTERVAL_MS = 60_000;

export const DEFAULT_BOARD_TITLE = { en: 'Super Speakers', tr: 'Süper Konuşmacılar' };

// ---------------------------------------------------------------- settings
const defaultSettingsRow = (now: number): SettingsRow => ({
  id: 1,
  weekStartsOn: 1,
  participatingClassIds: null,
  undoWindowMinutes: 10,
  rateLimitMax: 60,
  rateLimitWindowMinutes: 10,
  boardTitle: DEFAULT_BOARD_TITLE,
  boardMessages: null,
  boardLanguage: 'en',
  theme: 'explorer',
  boardSound: false,
  badgeSubjectId: null,
  updatedAt: now,
  updatedBy: null,
});

export function getSettings(db: Db): SettingsRow {
  return db.select().from(superSpeakersSettings).where(eq(superSpeakersSettings.id, 1)).get() ?? defaultSettingsRow(0);
}

/** Start-up: the settings row exists (defaults: Monday weeks, all classes, 10-minute undo, 60 per 10 minutes). */
export function ensureSettings(db: Db, now: number): void {
  db.insert(superSpeakersSettings).values(defaultSettingsRow(now)).onConflictDoNothing().run();
}

/** The board messages as stored; an empty text means the built-in translated message (S12 review). */
export const boardMessagesOf = (s: SettingsRow): BoardMessages => ({ placeholder: s.boardMessages?.placeholder ?? {}, waiting: s.boardMessages?.waiting ?? {} });

/**
 * The stored settings (audit rows and the admin page). `theme` is the stored choice, so the admin form
 * sends it back unchanged and never replaces an imported theme that is switched off for now (D-158);
 * the board and the scorer read `effectiveTheme` instead.
 */
export const settingsDto = (s: SettingsRow): SpeakersSettings => ({
  weekStartsOn: s.weekStartsOn,
  participatingClassIds: s.participatingClassIds,
  undoWindowMinutes: s.undoWindowMinutes,
  rateLimitMax: s.rateLimitMax,
  rateLimitWindowMinutes: s.rateLimitWindowMinutes,
  boardTitle: s.boardTitle,
  boardMessages: boardMessagesOf(s),
  boardLanguage: s.boardLanguage,
  theme: s.theme,
  boardSound: s.boardSound,
  badgeSubjectId: s.badgeSubjectId,
});
/** The admin page's view: the stored settings plus whether the chosen theme can be shown now. */
const settingsView = (s: SettingsRow, db: Db): SpeakersSettingsView => ({ ...settingsDto(s), themeAvailable: isThemeUsable(db, s.theme) });

export const schoolTimezone = (db: Db) => getSchoolSettings(db).timezone;
export const isEnabled = (db: Db) => isModuleAvailable(db, MODULE);

function assertEnabled(db: Db): void {
  if (!isEnabled(db)) throw new AppError('FEATURE_DISABLED', 'Super Speakers is turned off', { module: MODULE, reason: 'SPEAKERS_OFF' });
}

/**
 * The subject whose class+subjects receive the Super Speakers badges (D-132): the chosen one, else the
 * one subject whose English name is "English" (null when there is none or several).
 */
export function badgeSubject(db: Db): { id: string; name: { en?: string; tr?: string } } | null {
  const s = getSettings(db);
  const all = db.select().from(subjects).where(isNull(subjects.archivedAt)).all();
  if (s.badgeSubjectId) {
    const chosen = db.select().from(subjects).where(eq(subjects.id, s.badgeSubjectId)).get();
    return chosen ? { id: chosen.id, name: chosen.name } : null;
  }
  const english = all.filter((x) => (x.name.en ?? '').trim().toLowerCase() === 'english');
  return english.length === 1 ? { id: english[0]!.id, name: english[0]!.name } : null;
}

// ---------------------------------------------------------------- classes and participants
/** Active (not archived) classes of the school year(s) containing today; any active year's classes when none does. */
export function currentClasses(db: Db, now: number): ClassRow[] {
  const today = localDate(now, schoolTimezone(db));
  const rows = db
    .select({ cls: classes, year: schoolYears })
    .from(classes)
    .innerJoin(schoolYears, eq(schoolYears.id, classes.schoolYearId))
    .where(and(isNull(classes.archivedAt), isNull(schoolYears.archivedAt)))
    .all();
  const current = rows.filter((r) => r.year.startsOn <= today && today <= r.year.endsOn);
  return (current.length ? current : rows).map((r) => r.cls).sort((a, b) => compareNames(a.name, b.name));
}

/** The classes taking part (SSP-3): the chosen ones that are still active, or every current class. */
export function participatingClasses(db: Db, now: number, s: SettingsRow = getSettings(db)): ClassRow[] {
  const all = currentClasses(db, now);
  if (s.participatingClassIds === null) return all;
  const chosen = new Set(s.participatingClassIds);
  return all.filter((c) => chosen.has(c.id));
}

export interface Participant {
  student: StudentRow;
  cls: ClassRow;
}

/** Active students enrolled today in a participating class (one row per student; the first class by name wins). */
export function participants(db: Db, now: number, s: SettingsRow = getSettings(db)): Participant[] {
  const classRows = participatingClasses(db, now, s);
  if (!classRows.length) return [];
  const byId = new Map(classRows.map((c) => [c.id, c]));
  const today = localDate(now, schoolTimezone(db));
  const rows = db
    .select({ student: students, classId: enrolments.classId })
    .from(enrolments)
    .innerJoin(students, eq(students.id, enrolments.studentId))
    .where(and(inArray(enrolments.classId, [...byId.keys()]), enrolmentActiveOn(today), isNull(students.deactivatedAt)))
    .all();
  const out = new Map<string, Participant>();
  for (const r of rows) {
    const cls = byId.get(r.classId)!;
    const prev = out.get(r.student.id);
    if (!prev || compareNames(cls.name, prev.cls.name) < 0) out.set(r.student.id, { student: r.student, cls });
  }
  return [...out.values()].sort((a, b) => compareNames(a.student.fullName, b.student.fullName));
}

/** The avatar to show (S13c, D-124): the student's own, else the generated one when the class uses it, else null (initials). */
export function avatarOf(student: StudentRow, cls: Pick<ClassRow, 'avatarFallback'> | null): AvatarSpecValue | null {
  return specOf(student) ?? (cls?.avatarFallback === 'initials' ? null : generatedAvatar(student.id));
}

const speakerStudent = (student: StudentRow, cls: ClassRow | null, className: string) => ({
  id: student.id,
  fullName: student.fullName,
  initials: initials(student.fullName),
  avatarHue: student.avatarHue,
  avatar: avatarOf(student, cls),
  classId: cls?.id ?? '',
  className,
});

// ---------------------------------------------------------------- failure limits (exchange, pairing)
/** Refused link exchanges and pairing codes per address: after this many in the window, 429. */
export const FREE_FAILURES = { link: 20, pairing: 10 } as const;
export const FAILURE_WINDOW_MS = 10 * 60_000;

function failuresOf(db: Db, key: string, now: number): number {
  const cur = db.select().from(authAttempts).where(eq(authAttempts.key, key)).get();
  return cur && now - cur.updatedAt < FAILURE_WINDOW_MS ? cur.failures : 0;
}

function recordFailure(db: Db, key: string, now: number): number {
  const failures = failuresOf(db, key, now) + 1;
  db.insert(authAttempts)
    .values({ key, failures, lockedUntil: null, updatedAt: now })
    .onConflictDoUpdate({ target: authAttempts.key, set: { failures, updatedAt: now } })
    .run();
  return failures;
}

// ---------------------------------------------------------------- session resolution (every request)
export function resolveScorer(deps: AppDeps, session: SessionRow): ScorerPrincipal | null {
  if (!session.scorerLinkId) return null;
  const link = deps.db.select().from(scorerLinks).where(eq(scorerLinks.id, session.scorerLinkId)).get();
  if (!link || link.revokedAt !== null) return null;
  const now = deps.now();
  if (link.lastUsedAt === null || now - link.lastUsedAt > LAST_USED_INTERVAL_MS) deps.db.update(scorerLinks).set({ lastUsedAt: now }).where(eq(scorerLinks.id, link.id)).run();
  return { scorerLinkId: link.id, userId: link.userId, label: link.label, locale: link.locale };
}

export function resolveDisplay(deps: AppDeps, session: SessionRow): DisplayPrincipal | null {
  if (!session.displayLinkId) return null;
  const link = deps.db.select().from(displayLinks).where(eq(displayLinks.id, session.displayLinkId)).get();
  if (!link || link.revokedAt !== null) return null;
  const now = deps.now();
  if (link.lastUsedAt === null || now - link.lastUsedAt > LAST_USED_INTERVAL_MS) deps.db.update(displayLinks).set({ lastUsedAt: now }).where(eq(displayLinks.id, link.id)).run();
  return { displayLinkId: link.id };
}

// ---------------------------------------------------------------- exchange (public)
function linkInvalid(deps: Deps, ip: string, now: number): never {
  if (recordFailure(deps.db, `speakers_link:ip:${ip}`, now) > FREE_FAILURES.link) throw new AppError('RATE_LIMITED', 'Too many attempts. Try again later.');
  throw new AppError('UNAUTHENTICATED', 'This link no longer works', { reason: 'LINK_INVALID' });
}

/** Scorer link token → a new scorer session token (for the cookie). Unknown and revoked tokens answer the same 401. */
export function exchangeScorerToken(deps: Deps, ip: string, token: string): { token: string } {
  const now = deps.now();
  const hash = tokenHash(deps.config.SECRET_PEPPER, token);
  const link = deps.db.select().from(scorerLinks).where(eq(scorerLinks.tokenHash, hash)).get();
  if (!link || !timingSafeEqualStr(link.tokenHash, hash) || link.revokedAt !== null) linkInvalid(deps, ip, now);
  return tx(deps.db, () => {
    const { token: t } = createSession(deps as AppDeps, { kind: 'scorer', scorerLinkId: link.id }, now, SCORER_SESSION_ABSOLUTE_MS, 'scorer_link');
    deps.db.update(scorerLinks).set({ lastUsedAt: now }).where(eq(scorerLinks.id, link.id)).run();
    audit(deps.db, { type: 'scorer', id: link.id }, { action: 'speakers.scorer_link.open', entity: 'scorer_link', entityId: link.id, after: { generation: link.generation } }, now);
    return { token: t };
  });
}

export function exchangeDisplayToken(deps: Deps, ip: string, token: string): { token: string } {
  const now = deps.now();
  const hash = tokenHash(deps.config.SECRET_PEPPER, token);
  const link = deps.db.select().from(displayLinks).where(eq(displayLinks.tokenHash, hash)).get();
  if (!link || !timingSafeEqualStr(link.tokenHash, hash) || link.revokedAt !== null) linkInvalid(deps, ip, now);
  return tx(deps.db, () => {
    const { token: t } = createSession(deps as AppDeps, { kind: 'display', displayLinkId: link.id }, now, DISPLAY_SESSION_ABSOLUTE_MS, 'display_link');
    deps.db.update(displayLinks).set({ lastUsedAt: now }).where(eq(displayLinks.id, link.id)).run();
    audit(deps.db, { type: 'display', id: link.id }, { action: 'speakers.display_link.open', entity: 'display_link', entityId: link.id, after: { generation: link.generation } }, now);
    return { token: t };
  });
}

export function endSession(ctx: RequestContext): void {
  if (ctx.session) ctx.db.update(sessions).set({ revokedAt: ctx.now() }).where(eq(sessions.id, ctx.session.id)).run();
}

// ---------------------------------------------------------------- pairing (D-129)
const codeHashOf = (deps: Deps, code: string) => tokenHash(deps.config.SECRET_PEPPER, `scorer-pairing:${code}`);

/** A new 6-digit code for the installed app; earlier unused codes of this link stop working. */
export function createPairingCode(ctx: RequestContext): { code: string; expiresAt: number } {
  const scorer = requireScorer(ctx);
  const now = ctx.now();
  return tx(ctx.db, () => {
    ctx.db
      .update(scorerPairings)
      .set({ expiresAt: now })
      .where(and(eq(scorerPairings.scorerLinkId, scorer.scorerLinkId), isNull(scorerPairings.usedAt), gte(scorerPairings.expiresAt, now)))
      .run();
    for (let i = 0; i < 10; i++) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const hash = codeHashOf(ctx, code);
      const clash = ctx.db
        .select({ id: scorerPairings.id })
        .from(scorerPairings)
        .where(and(eq(scorerPairings.codeHash, hash), isNull(scorerPairings.usedAt), gte(scorerPairings.expiresAt, now)))
        .get();
      if (clash) continue;
      const expiresAt = now + PAIRING_CODE_TTL_MS;
      ctx.db.insert(scorerPairings).values({ id: newId(), scorerLinkId: scorer.scorerLinkId, codeHash: hash, createdAt: now, expiresAt, usedAt: null }).run();
      audit(ctx.db, ctx.actor, { action: 'speakers.pairing.create', entity: 'scorer_link', entityId: scorer.scorerLinkId }, now);
      return { code, expiresAt };
    }
    throw new AppError('CONFLICT', 'Try again', { reason: 'PAIRING_BUSY' });
  });
}

/**
 * School-wide guard against guessing (D-129, S12 review): every `PAIRING_GUARD_FAILURES` wrong codes
 * (all addresses together, within the failure window) end every unused pairing code, so one guesser
 * can try at most that many codes against any code a teacher is about to use.
 */
export const PAIRING_GUARD_FAILURES = 100;

function pairingFailed(deps: Deps, ip: string, now: number): never {
  const global = recordFailure(deps.db, 'speakers_pair:all', now);
  if (global % PAIRING_GUARD_FAILURES === 0) {
    tx(deps.db, () => {
      deps.db
        .update(scorerPairings)
        .set({ expiresAt: now })
        .where(and(isNull(scorerPairings.usedAt), gte(scorerPairings.expiresAt, now)))
        .run();
      audit(deps.db, { type: 'system', id: null }, { action: 'speakers.pairing.guard', entity: 'scorer_pairing', entityId: 'all', after: { failures: global } }, now);
    });
  }
  // Per address: after FREE_FAILURES.pairing wrong codes the answer is 429 (a valid code still pairs).
  if (recordFailure(deps.db, `speakers_pair:ip:${ip}`, now) > FREE_FAILURES.pairing) throw new AppError('RATE_LIMITED', 'Too many attempts. Try again later.');
  throw new AppError('UNAUTHENTICATED', 'This code does not work', { reason: 'PAIRING_CODE_INVALID' });
}

/**
 * A pairing code → a session of its scorer link (single use, before expiry, link still active).
 * The code is checked first: wrong codes are limited per address and school-wide, but a valid code
 * always pairs, so a phone on the school's shared address cannot lock pairing for every teacher
 * (S12 review). Guessing is bounded by the school-wide guard above and the route rate limit.
 */
export function pairWithCode(deps: Deps, ip: string, code: string): { token: string } {
  const now = deps.now();
  const hash = codeHashOf(deps, code);
  const row = deps.db
    .select()
    .from(scorerPairings)
    .where(and(eq(scorerPairings.codeHash, hash), isNull(scorerPairings.usedAt)))
    .orderBy(desc(scorerPairings.createdAt))
    .get();
  const link = row ? deps.db.select().from(scorerLinks).where(eq(scorerLinks.id, row.scorerLinkId)).get() : undefined;
  if (!row || row.expiresAt <= now || !link || link.revokedAt !== null) pairingFailed(deps, ip, now);
  return tx(deps.db, () => {
    // Single use: only the request that marks it used gets a session.
    const used = deps.db.update(scorerPairings).set({ usedAt: now }).where(and(eq(scorerPairings.id, row.id), isNull(scorerPairings.usedAt))).run();
    if (used.changes !== 1) throw new AppError('UNAUTHENTICATED', 'This code does not work', { reason: 'PAIRING_CODE_INVALID' });
    const { token } = createSession(deps as AppDeps, { kind: 'scorer', scorerLinkId: link.id }, now, SCORER_SESSION_ABSOLUTE_MS, 'scorer_pairing');
    audit(deps.db, { type: 'scorer', id: link.id }, { action: 'speakers.pairing.use', entity: 'scorer_link', entityId: link.id }, now);
    return { token };
  });
}

// ---------------------------------------------------------------- scorer reads
export function scorerMe(ctx: RequestContext) {
  const s = requireScorer(ctx);
  const settings = getSettings(ctx.db);
  const tz = schoolTimezone(ctx.db);
  return { id: s.scorerLinkId, label: s.label, locale: s.locale, enabled: isEnabled(ctx.db), undoWindowMinutes: settings.undoWindowMinutes, timezone: tz, today: localDate(ctx.now(), tz), theme: effectiveTheme(ctx.db, settings.theme) };
}

/** Every participating student for the in-memory search (SSP-6): names, class, avatar; numbers for search only. */
export function scorerStudents(ctx: RequestContext) {
  requireScorer(ctx);
  assertEnabled(ctx.db);
  const now = ctx.now();
  const settings = getSettings(ctx.db);
  const list = participants(ctx.db, now, settings);
  return {
    students: list.map(({ student, cls }) => ({ ...speakerStudent(student, cls, cls.name), studentNumber: student.studentNumber })),
    classes: participatingClasses(ctx.db, now, settings).map((c) => ({ id: c.id, name: c.name })),
  };
}

const undoUntilOf = (row: PointRow, s: SettingsRow, now: number) => {
  const until = row.occurredAt + s.undoWindowMinutes * 60_000;
  return row.voidedAt === null && until > now ? until : null;
};

/** The scorer's own awards today (newest first) and the students they awarded most recently. */
export function scorerAwards(ctx: RequestContext) {
  const scorer = requireScorer(ctx);
  const now = ctx.now();
  const s = getSettings(ctx.db);
  const today = localDate(now, schoolTimezone(ctx.db));
  const rows = ctx.db
    .select({ p: pointEvents, name: students.fullName })
    .from(pointEvents)
    .innerJoin(students, eq(students.id, pointEvents.studentId))
    .where(and(eq(pointEvents.scorerLinkId, scorer.scorerLinkId), eq(pointEvents.localDate, today)))
    .orderBy(desc(pointEvents.occurredAt))
    .limit(200)
    .all();
  const recent = ctx.db
    .select({ studentId: pointEvents.studentId, at: sql<number>`max(${pointEvents.occurredAt})` })
    .from(pointEvents)
    .where(and(eq(pointEvents.scorerLinkId, scorer.scorerLinkId), isNull(pointEvents.voidedAt)))
    .groupBy(pointEvents.studentId)
    .orderBy(desc(sql`max(${pointEvents.occurredAt})`))
    .limit(8)
    .all();
  return {
    today: rows.map(({ p, name }) => ({ id: p.id, studentId: p.studentId, fullName: name, className: p.classNameSnapshot, occurredAt: p.occurredAt, voidedAt: p.voidedAt, undoUntil: undoUntilOf(p, s, now) })),
    recentStudentIds: recent.map((r) => r.studentId),
  };
}

// ---------------------------------------------------------------- commands (D-130)
/** How old a queued point's tap time may be and still be used (a weekend plus a day off, D-130). */
export const MAX_OFFLINE_AGE_MS = 4 * 24 * 3600_000;

/**
 * The instant a point was given: the device's tap time (`clientTime`, sent by the outbox) when it lies
 * within the last `MAX_OFFLINE_AGE_MS`, otherwise the server time (a missing, future or far older
 * device clock is not trusted). So a +1 tapped offline on Friday and sent on Monday counts on Friday.
 */
export function tapTime(now: number, clientTime: number | undefined): number {
  if (clientTime === undefined || !Number.isFinite(clientTime)) return now;
  if (clientTime > now || clientTime < now - MAX_OFFLINE_AGE_MS) return now;
  return clientTime;
}

/** `points.award` {studentId}: +1 for an active student of a participating class (SSP-5, SSP-6). */
export function awardPoint(ctx: RequestContext, p: z.infer<(typeof C.SpeakerCommands)['points.award']>, meta: CommandMeta) {
  if (!ctx.scorer) throw new AppError('FORBIDDEN', 'Only a scorer link can give Super Speakers points', { reason: 'SCORER_ONLY' });
  const scorer = ctx.scorer;
  assertEnabled(ctx.db);
  const now = ctx.now();
  // The time of the tap: a point queued offline counts in the week (and rate window) it was given in.
  const at = tapTime(now, meta.clientTime);
  const s = getSettings(ctx.db);
  const who = participants(ctx.db, now, s).find((x) => x.student.id === p.studentId);
  if (!who) throw new AppError('NOT_FOUND', 'This student does not take part in Super Speakers', { reason: 'NOT_PARTICIPATING' });
  const windowMs = s.rateLimitWindowMinutes * 60_000;
  const recent = ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(pointEvents)
    .where(and(eq(pointEvents.scorerLinkId, scorer.scorerLinkId), gte(pointEvents.occurredAt, at - windowMs), lte(pointEvents.occurredAt, at)))
    .get();
  if ((recent?.n ?? 0) >= s.rateLimitMax) {
    throw new AppError('RATE_LIMITED', 'Too many points in a short time', { reason: 'SCORER_RATE_LIMIT', max: s.rateLimitMax, minutes: s.rateLimitWindowMinutes });
  }
  const tz = schoolTimezone(ctx.db);
  const row: PointRow = {
    id: meta.opId,
    studentId: who.student.id,
    scorerLinkId: scorer.scorerLinkId,
    userId: scorer.userId,
    occurredAt: at,
    localDate: localDate(at, tz),
    weekStart: weekStartOf(at, tz, s.weekStartsOn),
    classIdSnapshot: who.cls.id,
    classNameSnapshot: who.cls.name,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  };
  ctx.db.insert(pointEvents).values(row).run();
  audit(ctx.db, ctx.actor, { action: 'speakers.award', entity: 'point_event', entityId: row.id, opId: meta.opId, after: { studentId: row.studentId, classId: row.classIdSnapshot, userId: row.userId } }, now);
  // S13c achievements (D-132): the badge subject's class+subjects re-evaluate the student's badges.
  const subject = badgeSubject(ctx.db);
  if (subject) emitStudentActivity(ctx, { source: 'speakers', studentIds: [row.studentId], subjectId: subject.id });
  notifyBoardChange();
  return { eventId: row.id, studentId: row.studentId, undoUntil: at + s.undoWindowMinutes * 60_000 };
}

/** `points.voidOwn` {eventId}: the scorer takes back their own point within the undo window. */
export function voidOwnPoint(ctx: RequestContext, p: z.infer<(typeof C.SpeakerCommands)['points.voidOwn']>, meta: CommandMeta) {
  if (!ctx.scorer) throw new AppError('FORBIDDEN', 'Only a scorer link can undo Super Speakers points', { reason: 'SCORER_ONLY' });
  const scorer = ctx.scorer;
  const now = ctx.now();
  const s = getSettings(ctx.db);
  const ev = ctx.db.select().from(pointEvents).where(eq(pointEvents.id, p.eventId)).get();
  if (!ev || ev.scorerLinkId !== scorer.scorerLinkId) throw new AppError('NOT_FOUND', 'Award not found', { reason: 'NOT_YOUR_AWARD' });
  if (ev.voidedAt !== null) return { eventId: ev.id, voided: true };
  if (now - ev.occurredAt > s.undoWindowMinutes * 60_000) throw new AppError('CONFLICT', 'The undo time has passed', { reason: 'POINT_UNDO_PASSED', minutes: s.undoWindowMinutes });
  ctx.db.update(pointEvents).set({ voidedAt: now, voidedBy: `scorer:${scorer.scorerLinkId}`, voidReason: null }).where(eq(pointEvents.id, ev.id)).run();
  audit(ctx.db, ctx.actor, { action: 'speakers.undo', entity: 'point_event', entityId: ev.id, opId: meta.opId, before: { voidedAt: null }, after: { voidedAt: now } }, now);
  notifyBoardChange();
  return { eventId: ev.id, voided: true };
}

// ---------------------------------------------------------------- board (SSP-1..4)
export function buildBoard(db: Db, now: number): Board {
  const s = getSettings(db);
  const tz = schoolTimezone(db);
  const week = weekRangeOf(now, tz, s.weekStartsOn);
  const enabled = isEnabled(db);
  const base = { enabled, title: s.boardTitle, messages: boardMessagesOf(s), language: s.boardLanguage, theme: effectiveTheme(db, s.theme), sound: s.boardSound, week, timezone: tz };
  if (!enabled) {
    const rest = { ...base, places: [], classes: [], updatedAt: null };
    return { ...rest, version: versionOf(rest, db) };
  }
  const rows = db
    .select()
    .from(pointEvents)
    .where(and(gte(pointEvents.localDate, week.start), lte(pointEvents.localDate, week.end)))
    .all();
  const live = rows.filter((r) => r.voidedAt === null);
  const updatedAt = rows.length ? Math.max(...rows.map((r) => Math.max(r.occurredAt, r.voidedAt ?? 0))) : null;
  const totals = totalsByStudent(live);
  // Class and name shown for a student: their latest point of the week (a class change mid-week shows the newer class).
  const latest = new Map<string, PointRow>();
  for (const r of live) if (!latest.has(r.studentId) || latest.get(r.studentId)!.occurredAt < r.occurredAt) latest.set(r.studentId, r);
  // Only the students with one of the three highest totals need their names (Turkish order within a place).
  const topTotals = new Set([...new Set(totals.values())].sort((a, b) => b - a).slice(0, 3));
  const candidates = [...totals].filter(([, n]) => topTotals.has(n)).map(([id]) => id);
  const studentRows = new Map((candidates.length ? db.select().from(students).where(inArray(students.id, candidates)).all() : []).map((r) => [r.id, r]));
  const top = podium(
    candidates.map((id) => ({ student: id, points: totals.get(id)! })),
    (id) => studentRows.get(id)?.fullName ?? '',
  );
  const shownIds = top.flatMap((p) => p.students);
  const classIds = [...new Set(shownIds.map((id) => latest.get(id)!.classIdSnapshot))];
  const classRows = new Map((classIds.length ? db.select().from(classes).where(inArray(classes.id, classIds)).all() : []).map((c) => [c.id, c]));
  const places = top.map((p) => ({
    rank: p.rank,
    points: p.points,
    students: p.students.map((id) => {
      const st = studentRows.get(id)!;
      const ev = latest.get(id)!;
      const { classId: _c, ...rest } = speakerStudent(st, classRows.get(ev.classIdSnapshot) ?? null, ev.classNameSnapshot);
      return rest;
    }),
  }));
  const classList = participatingClasses(db, now, s);
  const rest = { ...base, places, classes: classTotals(classList, live.map((r) => ({ classId: r.classIdSnapshot }))), updatedAt };
  return { ...rest, version: versionOf(rest, db) };
}

// The theme package's revision is part of the version: a replaced package reaches an open board (D-158).
const versionOf = (b: Omit<Board, 'version'>, db: Db) => sha256(JSON.stringify({ ...b, themeRev: themeRevision(db, b.theme) })).slice(0, 20);

export const boardVersion = (db: Db, now: number) => buildBoard(db, now).version;

// ---------------------------------------------------------------- admin (SSP-4, SSP-10)
/** Scorer and board links (and their QR codes) point at the Super Speakers origin: SPEAKERS_ORIGIN when set, else PUBLIC_ORIGIN (D-157). */
function linkUrl(deps: Deps, purpose: string, id: string, cipher: string | null, make: (origin: string, token: string) => string): string | null {
  const token = openSecret(deps.config.SECRET_PEPPER, purpose, id, cipher);
  return token ? make(deps.config.origins.speakers, token) : null;
}

function scorerInfo(ctx: RequestContext, l: ScorerLinkRow, weekStart: string, weekEnd: string): ScorerLinkInfo {
  const user = l.userId ? ctx.db.select({ name: users.displayName }).from(users).where(eq(users.id, l.userId)).get() : undefined;
  const n = ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(pointEvents)
    .where(and(eq(pointEvents.scorerLinkId, l.id), isNull(pointEvents.voidedAt), gte(pointEvents.localDate, weekStart), lte(pointEvents.localDate, weekEnd)))
    .get();
  return {
    id: l.id,
    label: l.label,
    locale: l.locale,
    userId: l.userId,
    userName: user?.name ?? null,
    url: l.revokedAt === null ? linkUrl(ctx, SCORER_SEAL, l.id, l.tokenCipher, scorerLinkUrl) : null,
    generation: l.generation,
    createdAt: l.createdAt,
    lastUsedAt: l.lastUsedAt,
    revokedAt: l.revokedAt,
    awardsThisWeek: n?.n ?? 0,
  };
}

function displayInfo(ctx: RequestContext, l: DisplayLinkRow): DisplayLinkInfo {
  return {
    id: l.id,
    label: l.label,
    url: l.revokedAt === null ? linkUrl(ctx, DISPLAY_SEAL, l.id, l.tokenCipher, boardLinkUrl) : null,
    generation: l.generation,
    createdAt: l.createdAt,
    lastUsedAt: l.lastUsedAt,
    revokedAt: l.revokedAt,
  };
}

const currentWeek = (ctx: RequestContext) => weekRangeOf(ctx.now(), schoolTimezone(ctx.db), getSettings(ctx.db).weekStartsOn);

export function adminOverview(ctx: RequestContext) {
  const now = ctx.now();
  const s = getSettings(ctx.db);
  const week = currentWeek(ctx);
  const chosen = s.participatingClassIds === null ? null : new Set(s.participatingClassIds);
  const teachers = ctx.db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(and(eq(users.role, 'teacher'), isNull(users.disabledAt)))
    .all()
    .sort((a, b) => compareNames(a.name, b.name));
  const subjectList = ctx.db
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(isNull(subjects.archivedAt))
    .all()
    .sort((a, b) => compareNames(a.name.en ?? a.name.tr ?? '', b.name.en ?? b.name.tr ?? ''));
  return {
    enabled: isEnabled(ctx.db),
    settings: settingsView(s, ctx.db),
    badgeSubject: badgeSubject(ctx.db),
    subjects: subjectList,
    classes: currentClasses(ctx.db, now).map((c) => ({ id: c.id, name: c.name, participating: chosen === null || chosen.has(c.id) })),
    teachers,
    scorerLinks: ctx.db
      .select()
      .from(scorerLinks)
      .all()
      .sort((a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null) || compareNames(a.label, b.label))
      .map((l) => scorerInfo(ctx, l, week.start, week.end)),
    displayLinks: ctx.db
      .select()
      .from(displayLinks)
      .all()
      .sort((a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null) || compareNames(a.label, b.label))
      .map((l) => displayInfo(ctx, l)),
    week,
    timezone: schoolTimezone(ctx.db),
  };
}

export function saveSettings(ctx: RequestContext, input: In<typeof C.setSpeakersSettings>): SpeakersSettingsView {
  const user = requireUser(ctx);
  return tx(ctx.db, () => {
    const now = ctx.now();
    ensureSettings(ctx.db, now);
    const before = getSettings(ctx.db);
    if (input.participatingClassIds) {
      const known = new Set(currentClasses(ctx.db, now).map((c) => c.id));
      const unknown = input.participatingClassIds.filter((id) => !known.has(id));
      if (unknown.length) throw invalid('Unknown or archived class', { reason: 'UNKNOWN_CLASS' });
    }
    if (input.theme !== undefined && input.theme !== before.theme) assertThemeUsable(ctx.db, input.theme);
    if (input.badgeSubjectId) {
      const subj = ctx.db.select({ id: subjects.id }).from(subjects).where(eq(subjects.id, input.badgeSubjectId)).get();
      if (!subj) throw notFound('Subject');
    }
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (input.participatingClassIds) patch.participatingClassIds = [...new Set(input.participatingClassIds)];
    ctx.db
      .update(superSpeakersSettings)
      .set({ ...patch, updatedAt: now, updatedBy: user.id })
      .where(eq(superSpeakersSettings.id, 1))
      .run();
    const after = getSettings(ctx.db);
    audit(ctx.db, ctx.actor, { action: 'speakers.settings', entity: 'super_speakers_settings', entityId: '1', before: settingsDto(before), after: settingsDto(after) }, now);
    notifyBoardChange();
    return settingsView(after, ctx.db);
  });
}

function scorerById(db: Db, id: string): ScorerLinkRow {
  const l = db.select().from(scorerLinks).where(eq(scorerLinks.id, id)).get();
  if (!l) throw notFound('Scorer link');
  return l;
}
function displayById(db: Db, id: string): DisplayLinkRow {
  const l = db.select().from(displayLinks).where(eq(displayLinks.id, id)).get();
  if (!l) throw notFound('Board link');
  return l;
}

function assertTeacher(db: Db, userId: string | null | undefined): void {
  if (!userId) return;
  const u = db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();
  if (!u || u.role !== 'teacher') throw invalid('Not a teacher account', { reason: 'NOT_A_TEACHER' });
}

/** A fresh token for a link row: the HMAC to look it up and the sealed copy to show it again. */
function freshToken(deps: Deps, purpose: string, id: string) {
  const token = randomToken(32);
  return { tokenHash: tokenHash(deps.config.SECRET_PEPPER, token), tokenCipher: sealSecret(deps.config.SECRET_PEPPER, purpose, id, token) };
}

export function createScorer(ctx: RequestContext, input: In<typeof C.createScorerLink>): ScorerLinkInfo {
  const user = requireUser(ctx);
  assertTeacher(ctx.db, input.userId);
  return tx(ctx.db, () => {
    const now = ctx.now();
    const id = newId();
    const row: ScorerLinkRow = { id, label: input.label, locale: input.locale, userId: input.userId ?? null, ...freshToken(ctx, SCORER_SEAL, id), generation: 1, createdBy: user.id, createdAt: now, updatedAt: now, revokedAt: null, revokedBy: null, lastUsedAt: null };
    ctx.db.insert(scorerLinks).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'speakers.scorer_link.create', entity: 'scorer_link', entityId: id, after: { label: row.label, locale: row.locale, userId: row.userId } }, now);
    const week = currentWeek(ctx);
    return scorerInfo(ctx, row, week.start, week.end);
  });
}

export function updateScorer(ctx: RequestContext, input: In<typeof C.updateScorerLink>): ScorerLinkInfo {
  assertTeacher(ctx.db, input.userId);
  return tx(ctx.db, () => {
    const now = ctx.now();
    const before = scorerById(ctx.db, input.id);
    const patch = { ...(input.label !== undefined ? { label: input.label } : {}), ...(input.locale !== undefined ? { locale: input.locale } : {}), ...(input.userId !== undefined ? { userId: input.userId } : {}) };
    ctx.db.update(scorerLinks).set({ ...patch, updatedAt: now }).where(eq(scorerLinks.id, input.id)).run();
    audit(ctx.db, ctx.actor, { action: 'speakers.scorer_link.update', entity: 'scorer_link', entityId: input.id, before: { label: before.label, locale: before.locale, userId: before.userId }, after: patch }, now);
    const week = currentWeek(ctx);
    return scorerInfo(ctx, scorerById(ctx.db, input.id), week.start, week.end);
  });
}

/** Ends every session (and pairing code) of a link: used by revoke and regenerate (immediate, D-128). */
function endLinkSessions(db: Db, kind: 'scorer' | 'display', id: string, now: number): void {
  const col = kind === 'scorer' ? sessions.scorerLinkId : sessions.displayLinkId;
  db.update(sessions).set({ revokedAt: now }).where(and(eq(col, id), isNull(sessions.revokedAt))).run();
  if (kind === 'scorer') db.update(scorerPairings).set({ expiresAt: now }).where(and(eq(scorerPairings.scorerLinkId, id), isNull(scorerPairings.usedAt))).run();
}

export function regenerateScorer(ctx: RequestContext, id: string): ScorerLinkInfo {
  return tx(ctx.db, () => {
    const now = ctx.now();
    const l = scorerById(ctx.db, id);
    ctx.db
      .update(scorerLinks)
      .set({ ...freshToken(ctx, SCORER_SEAL, id), generation: l.generation + 1, revokedAt: null, revokedBy: null, lastUsedAt: null, updatedAt: now })
      .where(eq(scorerLinks.id, id))
      .run();
    endLinkSessions(ctx.db, 'scorer', id, now);
    audit(ctx.db, ctx.actor, { action: 'speakers.scorer_link.regenerate', entity: 'scorer_link', entityId: id, before: { generation: l.generation }, after: { generation: l.generation + 1 } }, now);
    const week = currentWeek(ctx);
    return scorerInfo(ctx, scorerById(ctx.db, id), week.start, week.end);
  });
}

export function revokeScorer(ctx: RequestContext, id: string): ScorerLinkInfo {
  const user = requireUser(ctx);
  return tx(ctx.db, () => {
    const now = ctx.now();
    const l = scorerById(ctx.db, id);
    if (l.revokedAt === null) {
      ctx.db.update(scorerLinks).set({ revokedAt: now, revokedBy: user.id, updatedAt: now }).where(eq(scorerLinks.id, id)).run();
      endLinkSessions(ctx.db, 'scorer', id, now);
      audit(ctx.db, ctx.actor, { action: 'speakers.scorer_link.revoke', entity: 'scorer_link', entityId: id }, now);
    }
    const week = currentWeek(ctx);
    return scorerInfo(ctx, scorerById(ctx.db, id), week.start, week.end);
  });
}

export function createDisplay(ctx: RequestContext, input: In<typeof C.createDisplayLink>): DisplayLinkInfo {
  const user = requireUser(ctx);
  return tx(ctx.db, () => {
    const now = ctx.now();
    const id = newId();
    const row: DisplayLinkRow = { id, label: input.label, ...freshToken(ctx, DISPLAY_SEAL, id), generation: 1, createdBy: user.id, createdAt: now, updatedAt: now, revokedAt: null, revokedBy: null, lastUsedAt: null };
    ctx.db.insert(displayLinks).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'speakers.display_link.create', entity: 'display_link', entityId: id, after: { label: row.label } }, now);
    return displayInfo(ctx, row);
  });
}

export function regenerateDisplay(ctx: RequestContext, id: string): DisplayLinkInfo {
  return tx(ctx.db, () => {
    const now = ctx.now();
    const l = displayById(ctx.db, id);
    ctx.db
      .update(displayLinks)
      .set({ ...freshToken(ctx, DISPLAY_SEAL, id), generation: l.generation + 1, revokedAt: null, revokedBy: null, lastUsedAt: null, updatedAt: now })
      .where(eq(displayLinks.id, id))
      .run();
    endLinkSessions(ctx.db, 'display', id, now);
    audit(ctx.db, ctx.actor, { action: 'speakers.display_link.regenerate', entity: 'display_link', entityId: id, before: { generation: l.generation }, after: { generation: l.generation + 1 } }, now);
    return displayInfo(ctx, displayById(ctx.db, id));
  });
}

export function revokeDisplay(ctx: RequestContext, id: string): DisplayLinkInfo {
  const user = requireUser(ctx);
  return tx(ctx.db, () => {
    const now = ctx.now();
    const l = displayById(ctx.db, id);
    if (l.revokedAt === null) {
      ctx.db.update(displayLinks).set({ revokedAt: now, revokedBy: user.id, updatedAt: now }).where(eq(displayLinks.id, id)).run();
      endLinkSessions(ctx.db, 'display', id, now);
      audit(ctx.db, ctx.actor, { action: 'speakers.display_link.revoke', entity: 'display_link', entityId: id }, now);
    }
    return displayInfo(ctx, displayById(ctx.db, id));
  });
}

// ---------------------------------------------------------------- award log (admin)
export const AWARD_LOG_LIMIT = 500;

function awardDtos(db: Db, rows: readonly PointRow[]): AdminAward[] {
  const sIds = [...new Set(rows.map((r) => r.studentId))];
  const lIds = [...new Set(rows.map((r) => r.scorerLinkId))];
  const uIds = [...new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])))];
  const names = new Map((sIds.length ? db.select({ id: students.id, name: students.fullName }).from(students).where(inArray(students.id, sIds)).all() : []).map((r) => [r.id, r.name]));
  const labels = new Map((lIds.length ? db.select({ id: scorerLinks.id, label: scorerLinks.label }).from(scorerLinks).where(inArray(scorerLinks.id, lIds)).all() : []).map((r) => [r.id, r.label]));
  const userNames = new Map((uIds.length ? db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, uIds)).all() : []).map((r) => [r.id, r.name]));
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    fullName: names.get(r.studentId) ?? '',
    className: r.classNameSnapshot,
    scorerLinkId: r.scorerLinkId,
    scorerLabel: labels.get(r.scorerLinkId) ?? '',
    userName: r.userId ? (userNames.get(r.userId) ?? null) : null,
    occurredAt: r.occurredAt,
    localDate: r.localDate,
    voidedAt: r.voidedAt,
    voidedByKind: r.voidedAt === null ? null : r.voidedBy?.startsWith('scorer:') ? 'scorer' : 'admin',
    voidReason: r.voidReason,
  }));
}

export function listAwards(ctx: RequestContext, input: In<typeof C.speakersAwards>) {
  const conds = [
    input.from ? gte(pointEvents.localDate, input.from) : undefined,
    input.to ? lte(pointEvents.localDate, input.to) : undefined,
    input.classId ? eq(pointEvents.classIdSnapshot, input.classId) : undefined,
    input.scorerLinkId ? eq(pointEvents.scorerLinkId, input.scorerLinkId) : undefined,
    input.studentId ? eq(pointEvents.studentId, input.studentId) : undefined,
    input.includeVoided === '1' ? undefined : isNull(pointEvents.voidedAt),
  ].filter((c) => c !== undefined);
  const where = conds.length ? and(...conds) : undefined;
  const total = ctx.db.select({ n: sql<number>`count(*)` }).from(pointEvents).where(where).get()?.n ?? 0;
  const rows = ctx.db.select().from(pointEvents).where(where).orderBy(desc(pointEvents.occurredAt)).limit(AWARD_LOG_LIMIT).all();
  return { awards: awardDtos(ctx.db, rows), total, truncated: total > rows.length };
}

/** An administrator voids any award with a reason (audited; a badge already earned is kept, D-132). */
export function adminVoid(ctx: RequestContext, input: In<typeof C.voidAward>): AdminAward {
  const user = requireUser(ctx);
  return tx(ctx.db, () => {
    const now = ctx.now();
    const ev = ctx.db.select().from(pointEvents).where(eq(pointEvents.id, input.id)).get();
    if (!ev) throw notFound('Award');
    if (ev.voidedAt === null) {
      ctx.db.update(pointEvents).set({ voidedAt: now, voidedBy: user.id, voidReason: input.reason }).where(eq(pointEvents.id, ev.id)).run();
      audit(ctx.db, ctx.actor, { action: 'speakers.void', entity: 'point_event', entityId: ev.id, before: { voidedAt: null }, after: { voidedAt: now, reason: input.reason } }, now);
      notifyBoardChange();
    }
    return awardDtos(ctx.db, [ctx.db.select().from(pointEvents).where(eq(pointEvents.id, ev.id)).get()!])[0]!;
  });
}

