/**
 * Super Speakers (S12, SSP-1..12, D-127..D-134): school-wide English points.
 *
 * Principals (D-128):
 * - `scorer`: a teacher the administrator gave a scorer link (`/p#<token>`). The token in the URL
 *   fragment is posted once and exchanged for a strict scorer cookie; the installed iPhone app (which
 *   has its own cookie store) pairs with a 6-digit code instead (D-129). A scorer can ONLY list the
 *   participating students, award +1, undo their own awards within the undo window and see their own
 *   recent awards.
 * - `display`: a read-only board link (`/board#<token>`): the board and its change stream only.
 * - `admin`: settings, links, the award log (void with a reason) and the weekly history.
 *
 * Positive points only (+1, SSP-5). Awards and own undos are outbox commands (`points.award`,
 * `points.voidOwn`) sent to `/api/scorer/commands` (idempotent opIds).
 */
import { z } from 'zod';
import { AvatarSpec } from './avatars.ts';
import { LocalizedText, Ok, endpoint } from './define.ts';
import { ReportSection } from './reports.ts';
import { CommandEnvelope, CommandResult } from './commands.ts';
import { Id, IsoDate, Locale, Theme } from './school.ts';

export const SCORER_PAGE_PATH = '/p';
/** The installed app's start URL (manifest `start_url`): never carries a token. */
export const SCORER_APP_PATH = '/p/app';
export const BOARD_PAGE_PATH = '/board';
/**
 * Set by the scorer app (path `/p`, not secret, value `1`) while awards wait in its outbox (D-157).
 * While Super Speakers has its own origin, the main host then still serves `/p` and `/p/app` instead
 * of redirecting, so the queue in this origin's IndexedDB can be sent before the app moves itself.
 */
export const SCORER_QUEUE_COOKIE = 'cc_scorer_queue';
export const scorerLinkUrl = (origin: string, token: string) => `${new URL(origin).origin}${SCORER_PAGE_PATH}#${token}`;
export const boardLinkUrl = (origin: string, token: string) => `${new URL(origin).origin}${BOARD_PAGE_PATH}#${token}`;

/** Pairing codes: 6 digits, valid 10 minutes, single use (D-129). */
export const PAIRING_CODE_TTL_MS = 10 * 60_000;
export const PairingCode = z.string().regex(/^\d{6}$/u, 'Six digits');

/** Client double-tap guard: a second +1 for the same student within this time is ignored (SSP-6). */
export const DOUBLE_TAP_MS = 700;

const Token = z.string().min(20).max(200);

// ---------------------------------------------------------------- shared pieces
/** A student as the scorer app and the board show them: no levels, numbers only inside the search key. */
export const SpeakerStudent = z.object({
  id: z.string(),
  fullName: z.string(),
  initials: z.string(),
  avatarHue: z.number().int(),
  /** The student's own avatar, the generated one (class choice) or null for initials (S13c, D-124). */
  avatar: AvatarSpec.nullable(),
  classId: z.string(),
  className: z.string(),
});
export type SpeakerStudent = z.infer<typeof SpeakerStudent>;

/** Board messages {en,tr} chosen by the administrator; an empty text = the built-in translated message. */
export const BoardMessages = z.object({
  /** Shown while nobody has a point this week ("We are waiting for our super speakers"). */
  placeholder: LocalizedText,
  /** Shown in an empty podium place ("Who will be next?"). */
  waiting: LocalizedText,
});
export type BoardMessages = z.infer<typeof BoardMessages>;

export const BoardPlace = z.object({
  rank: z.number().int(),
  points: z.number().int(),
  /** Every student with this total (all tied students are shown, D-133). */
  students: z.array(SpeakerStudent.omit({ classId: true })),
});
export type BoardPlace = z.infer<typeof BoardPlace>;

export const Board = z.object({
  /** The administrator turned the module on (otherwise the board shows a calm "not active" page). */
  enabled: z.boolean(),
  title: LocalizedText,
  messages: BoardMessages,
  language: Locale,
  theme: Theme,
  /** Board sound for a podium change (off by default, S13b sounds). */
  sound: z.boolean(),
  week: z.object({ start: z.string(), end: z.string() }),
  timezone: z.string(),
  /** Top 3 places of the current week (empty = placeholder message). Students with 0 points are never here. */
  places: z.array(BoardPlace),
  /** Every participating class with its weekly total, including 0 (SSP-3). */
  classes: z.array(z.object({ classId: z.string(), name: z.string(), points: z.number().int() })),
  /** Time of the latest point (or void) of the week; null = none yet. */
  updatedAt: z.number().nullable(),
  /** Changes whenever the board would look different (the SSE stream sends it too). */
  version: z.string(),
});
export type Board = z.infer<typeof Board>;

// ---------------------------------------------------------------- scorer (public exchange, pairing)
export const exchangeScorerLink = endpoint({ method: 'POST', path: '/api/scorer/session', access: 'public', input: z.object({ token: Token }), output: Ok });
export const pairScorer = endpoint({ method: 'POST', path: '/api/scorer/pair', access: 'public', input: z.object({ code: PairingCode }), output: Ok });
export const leaveScorerSession = endpoint({ method: 'POST', path: '/api/scorer/session/end', access: 'scorer', input: z.object({}), output: Ok });

export const ScorerMe = z.object({
  /** The scorer link id: the device outbox belongs to it. */
  id: z.string(),
  label: z.string(),
  locale: Locale,
  enabled: z.boolean(),
  undoWindowMinutes: z.number().int(),
  timezone: z.string(),
  today: z.string(),
  theme: Theme,
});
export type ScorerMe = z.infer<typeof ScorerMe>;
export const scorerMe = endpoint({ method: 'GET', path: '/api/scorer/me', access: 'scorer', input: z.object({}), output: ScorerMe });

/** A fresh pairing code for the installed app (shown on the link page). */
export const createPairingCode = endpoint({
  method: 'POST',
  path: '/api/scorer/pairing',
  access: 'scorer',
  input: z.object({}),
  output: z.object({ code: PairingCode, expiresAt: z.number() }),
});

export const ScorerStudent = SpeakerStudent.extend({
  /** Only for search ("finds by student number"); never shown. */
  studentNumber: z.string().nullable(),
});
export type ScorerStudent = z.infer<typeof ScorerStudent>;
export const scorerStudents = endpoint({
  method: 'GET',
  path: '/api/scorer/students',
  access: 'scorer',
  input: z.object({}),
  output: z.object({ students: z.array(ScorerStudent), classes: z.array(z.object({ id: z.string(), name: z.string() })) }),
});

export const ScorerAward = z.object({
  id: z.string(),
  studentId: z.string(),
  fullName: z.string(),
  className: z.string(),
  occurredAt: z.number(),
  voidedAt: z.number().nullable(),
  /** Own undo still possible until (null = no longer). */
  undoUntil: z.number().nullable(),
});
export type ScorerAward = z.infer<typeof ScorerAward>;
/** The scorer's own awards today (newest first) and their recently awarded students. */
export const scorerAwards = endpoint({
  method: 'GET',
  path: '/api/scorer/awards',
  access: 'scorer',
  input: z.object({}),
  output: z.object({ today: z.array(ScorerAward), recentStudentIds: z.array(z.string()) }),
});

export const SpeakerCommands = {
  'points.award': z.object({ studentId: Id }).strict(),
  'points.voidOwn': z.object({ eventId: Id }).strict(),
} as const;
export type SpeakerCommandType = keyof typeof SpeakerCommands;

/** Outbox endpoint of the scorer app: only `points.*` commands; `asScorer` = the link that queued them. */
export const submitScorerCommands = endpoint({
  method: 'POST',
  path: '/api/scorer/commands',
  access: 'scorer',
  input: z.object({ commands: z.array(CommandEnvelope).min(1).max(50), asScorer: z.string().optional() }),
  output: z.object({ results: z.array(CommandResult) }),
});

// ---------------------------------------------------------------- board (display)
export const exchangeBoardLink = endpoint({ method: 'POST', path: '/api/board/session', access: 'public', input: z.object({ token: Token }), output: Ok });
export const board = endpoint({ method: 'GET', path: '/api/board', access: 'display', input: z.object({}), output: Board });
/** Server-Sent Events: `event: version` with the board version on every change, comments as heartbeats. */
export const boardEvents = endpoint({ method: 'GET', path: '/api/board/events', access: 'display', input: z.object({}), output: z.unknown() });

// ---------------------------------------------------------------- admin
export const SpeakersSettings = z.object({
  weekStartsOn: z.number().int().min(0).max(6),
  /** null = every active class of the current school year. */
  participatingClassIds: z.array(z.string()).nullable(),
  undoWindowMinutes: z.number().int().min(1).max(60),
  rateLimitMax: z.number().int().min(5).max(500),
  rateLimitWindowMinutes: z.number().int().min(1).max(60),
  boardTitle: LocalizedText,
  boardMessages: BoardMessages,
  boardLanguage: Locale,
  /** The board's chosen theme as stored (D-158); the board shows the default while an imported choice is switched off. */
  theme: Theme,
  boardSound: z.boolean(),
  /** The subject whose class+subjects receive the Super Speakers badges (null = the subject named "English"). */
  badgeSubjectId: z.string().nullable(),
});
/** The settings as the admin page reads them: plus whether the chosen theme can be shown now (D-158). */
export const SpeakersSettingsView = SpeakersSettings.extend({ themeAvailable: z.boolean() });
export type SpeakersSettings = z.infer<typeof SpeakersSettings>;
export type SpeakersSettingsView = z.infer<typeof SpeakersSettingsView>;

export const LinkInfo = z.object({
  id: z.string(),
  label: z.string(),
  /** Null when revoked, or when the token cannot be decrypted (the server pepper changed). */
  url: z.string().nullable(),
  generation: z.number().int(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
});
export const ScorerLinkInfo = LinkInfo.extend({ locale: Locale, userId: z.string().nullable(), userName: z.string().nullable(), awardsThisWeek: z.number().int() });
export type ScorerLinkInfo = z.infer<typeof ScorerLinkInfo>;
export type DisplayLinkInfo = z.infer<typeof LinkInfo>;

export const SpeakersAdmin = z.object({
  enabled: z.boolean(),
  settings: SpeakersSettingsView,
  /** The subject the badges use now (resolved), or null when there is none. */
  badgeSubject: z.object({ id: z.string(), name: LocalizedText }).nullable(),
  subjects: z.array(z.object({ id: z.string(), name: LocalizedText })),
  /** Active classes of the current school year, with whether they take part. */
  classes: z.array(z.object({ id: z.string(), name: z.string(), participating: z.boolean() })),
  teachers: z.array(z.object({ id: z.string(), name: z.string() })),
  scorerLinks: z.array(ScorerLinkInfo),
  displayLinks: z.array(LinkInfo),
  week: z.object({ start: z.string(), end: z.string() }),
  timezone: z.string(),
});
export type SpeakersAdmin = z.infer<typeof SpeakersAdmin>;
export const speakersAdmin = endpoint({ method: 'GET', path: '/api/admin/speakers', access: 'admin', input: z.object({}), output: SpeakersAdmin });
export const setSpeakersSettings = endpoint({ method: 'PUT', path: '/api/admin/speakers/settings', access: 'admin', input: SpeakersSettings.partial(), output: SpeakersSettingsView });

const Label = z.string().trim().min(1).max(80);
export const createScorerLink = endpoint({
  method: 'POST',
  path: '/api/admin/speakers/scorers',
  access: 'admin',
  input: z.object({ label: Label, locale: Locale.default('en'), userId: Id.nullable().optional() }),
  output: ScorerLinkInfo,
});
export const updateScorerLink = endpoint({
  method: 'PATCH',
  path: '/api/admin/speakers/scorers/:id',
  access: 'admin',
  input: z.object({ id: Id, label: Label.optional(), locale: Locale.optional(), userId: Id.nullable().optional() }),
  output: ScorerLinkInfo,
});
export const regenerateScorerLink = endpoint({ method: 'POST', path: '/api/admin/speakers/scorers/:id/regenerate', access: 'admin', input: z.object({ id: Id }), output: ScorerLinkInfo });
export const revokeScorerLink = endpoint({ method: 'POST', path: '/api/admin/speakers/scorers/:id/revoke', access: 'admin', input: z.object({ id: Id }), output: ScorerLinkInfo });

export const createDisplayLink = endpoint({ method: 'POST', path: '/api/admin/speakers/displays', access: 'admin', input: z.object({ label: Label }), output: LinkInfo });
export const regenerateDisplayLink = endpoint({ method: 'POST', path: '/api/admin/speakers/displays/:id/regenerate', access: 'admin', input: z.object({ id: Id }), output: LinkInfo });
export const revokeDisplayLink = endpoint({ method: 'POST', path: '/api/admin/speakers/displays/:id/revoke', access: 'admin', input: z.object({ id: Id }), output: LinkInfo });

export const AdminAward = z.object({
  id: z.string(),
  studentId: z.string(),
  fullName: z.string(),
  className: z.string(),
  scorerLinkId: z.string(),
  scorerLabel: z.string(),
  userName: z.string().nullable(),
  occurredAt: z.number(),
  localDate: z.string(),
  voidedAt: z.number().nullable(),
  /** 'scorer' (own undo) or 'admin'. */
  voidedByKind: z.enum(['scorer', 'admin']).nullable(),
  voidReason: z.string().nullable(),
});
export type AdminAward = z.infer<typeof AdminAward>;
export const speakersAwards = endpoint({
  method: 'GET',
  path: '/api/admin/speakers/awards',
  access: 'admin',
  input: z.object({
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    classId: Id.optional(),
    scorerLinkId: Id.optional(),
    studentId: Id.optional(),
    includeVoided: z.enum(['0', '1']).optional(),
  }),
  output: z.object({ awards: z.array(AdminAward), total: z.number().int(), truncated: z.boolean() }),
});
export const voidAward = endpoint({
  method: 'POST',
  path: '/api/admin/speakers/awards/:id/void',
  access: 'admin',
  input: z.object({ id: Id, reason: z.string().trim().min(3).max(300) }),
  output: AdminAward,
});
/** The board as the display shows it (admin preview). */
export const adminBoard = endpoint({ method: 'GET', path: '/api/admin/speakers/board', access: 'admin', input: z.object({}), output: Board });

/** Weekly history (SSP-9): winners per week, totals per class and week, per scorer, per student. */
export const speakersHistory = endpoint({
  method: 'GET',
  path: '/api/admin/speakers/history',
  access: 'admin',
  input: z.object({ from: IsoDate, to: IsoDate }),
  output: z.object({ from: z.string(), to: z.string(), section: ReportSection }),
});
export const speakersHistoryCsv = endpoint({
  method: 'GET',
  path: '/api/admin/speakers/history.csv',
  access: 'admin',
  input: z.object({ from: IsoDate, to: IsoDate, table: z.string().min(1).max(40), delimiter: z.enum(['comma', 'semicolon']).optional() }),
  output: z.unknown(),
});
