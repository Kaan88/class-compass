/**
 * Student achievements (S13c, D-121, D-122). Teacher area (PIN-gated), classroom-safe reads and
 * outbox commands for awarding in class, the student page section, admin defaults.
 *
 * - Classroom responses carry badge names/icons and student names only (no levels, no counts that
 *   compare students, no private data).
 * - Students see only their own awards (studentId from the link session).
 */
import { z } from 'zod';
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_KINDS, ACHIEVEMENT_SKILLS, ACHIEVEMENT_TIERS, BADGE_ICONS, EVIDENCE_FILTER_KINDS, RULE_EVENTS } from '../achievements.ts';
import { LocalizedText, Ok, endpoint } from './define.ts';
import { Id, RequiredLocalizedText } from './school.ts';

export const Tier = z.enum(ACHIEVEMENT_TIERS);
export const BadgeIconKey = z.enum(BADGE_ICONS);
export const AchievementCategory = z.enum(ACHIEVEMENT_CATEGORIES);
export const AchievementKind = z.enum(ACHIEVEMENT_KINDS);
export const Rule = z
  .object({ event: z.enum(RULE_EVENTS), threshold: z.number().int().min(1).max(500), skill: z.enum(ACHIEVEMENT_SKILLS).optional(), evidenceKind: z.enum(EVIDENCE_FILTER_KINDS).optional() })
  .strict();
export type Rule = z.infer<typeof Rule>;

export const AchievementDef = z.object({
  id: z.string(),
  key: z.string().nullable(),
  name: LocalizedText,
  description: LocalizedText,
  icon: BadgeIconKey,
  tier: Tier,
  category: AchievementCategory,
  kind: AchievementKind,
  rule: Rule.nullable(),
  /** Made by a teacher (editable by that teacher). */
  custom: z.boolean(),
  /** Hidden for this viewer (own archive, or a default archived for these classes / school-wide). */
  archived: z.boolean(),
  schoolArchived: z.boolean(),
  /** Waits for a module that does not exist yet (Super Speakers, S12). */
  inactive: z.boolean(),
});
export type AchievementDef = z.infer<typeof AchievementDef>;

export const ANNOUNCE_MODES = ['off', 'endOfLesson'] as const;
export const AchievementSettings = z.object({
  /** Automatic badges for this class+subject (manual badges always work while the module is on). */
  autoEnabled: z.boolean(),
  /** The optional private level path on the student page (D-121). */
  levelsEnabled: z.boolean(),
  /** Automatic badges are never announced on the display; optionally gathered into an End Lesson "Well done!" (item 7). */
  announce: z.enum(ANNOUNCE_MODES),
  /** How the class started (item 3): null = not chosen yet (automatic badges wait for the choice). */
  startMode: z.enum(['quiet', 'fresh']).nullable(),
  /** "Start fresh": only what happens after this moment counts. */
  autoSince: z.number().nullable(),
});
export type AchievementSettings = z.infer<typeof AchievementSettings>;

const StudentSummary = z.object({ id: z.string(), fullName: z.string(), initials: z.string(), avatarHue: z.number().int() });

export const Award = z.object({
  id: z.string(),
  achievementId: z.string(),
  studentId: z.string(),
  contextId: z.string().nullable(),
  name: LocalizedText,
  icon: BadgeIconKey,
  tier: Tier,
  category: AchievementCategory,
  source: z.enum(['auto', 'manual', 'backfill']),
  awardedAt: z.number(),
  /** The awarding teacher's name; null for automatic badges. */
  awardedBy: z.string().nullable(),
  revokedAt: z.number().nullable(),
  revokeReason: z.string().nullable(),
});
export type Award = z.infer<typeof Award>;

// ---------------------------------------------------------------- teacher area
export const achievementsOverview = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/achievements',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: z.object({
    contextId: z.string(),
    className: z.string(),
    enabled: z.boolean(),
    settings: AchievementSettings,
    definitions: z.array(AchievementDef),
    students: z.array(StudentSummary.extend({ awards: z.number().int(), manual: z.number().int(), auto: z.number().int() })),
  }),
});

export const studentAchievements = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/students/:studentId/achievements',
  access: 'teacher',
  input: z.object({ contextId: Id, studentId: Id }),
  output: z.object({ student: StudentSummary, awards: z.array(Award) }),
});

const DefInput = z.object({
  name: RequiredLocalizedText,
  description: LocalizedText,
  icon: BadgeIconKey,
  tier: Tier,
  kind: AchievementKind,
  rule: Rule.nullable().optional(),
});
export const createAchievement = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/achievement-definitions',
  access: 'teacher',
  input: DefInput.extend({ contextId: Id }),
  output: AchievementDef,
});
export const updateAchievement = endpoint({
  method: 'PATCH',
  path: '/api/teacher/contexts/:contextId/achievement-definitions/:achievementId',
  access: 'teacher',
  input: DefInput.partial().extend({ contextId: Id, achievementId: Id, archived: z.boolean().optional() }),
  output: AchievementDef,
});

export const setAchievementSettings = endpoint({
  method: 'PUT',
  path: '/api/teacher/contexts/:contextId/achievements/settings',
  access: 'teacher',
  input: z.object({ contextId: Id, autoEnabled: z.boolean().optional(), levelsEnabled: z.boolean().optional(), announce: z.enum(ANNOUNCE_MODES).optional() }),
  output: AchievementSettings,
});

/** Item 3: once per class+subject, "award past achievements quietly" (backfill) or "start fresh". */
export const startAchievements = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/achievements/start',
  access: 'teacher',
  input: z.object({ contextId: Id, mode: z.enum(['quiet', 'fresh']) }),
  output: z.object({ settings: AchievementSettings, awarded: z.number().int() }),
});

/** Manual award from the student card in the teacher area (one or more students). */
export const teacherAward = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/achievements/award',
  access: 'teacher',
  input: z.object({ contextId: Id, achievementId: Id, studentIds: z.array(Id).min(1).max(80) }),
  output: z.object({ awards: z.array(Award), already: z.number().int() }),
});

/** A mistaken manual award is revoked with a reason (kept, never deleted). PIN-gated in classroom mode. */
export const revokeAward = endpoint({
  method: 'POST',
  path: '/api/teacher/awards/:awardId/revoke',
  access: 'teacher',
  input: z.object({ awardId: Id, reason: z.string().trim().min(3).max(300) }),
  output: Award,
});

export const adminAchievementDefaults = endpoint({
  method: 'GET',
  path: '/api/admin/achievement-defaults',
  access: 'admin',
  input: z.object({}),
  output: z.object({ definitions: z.array(AchievementDef) }),
});
export const adminArchiveAchievementDefault = endpoint({
  method: 'PUT',
  path: '/api/admin/achievement-defaults/:achievementId',
  access: 'admin',
  input: z.object({ achievementId: Id, archived: z.boolean() }),
  output: z.object({ definitions: z.array(AchievementDef) }),
});

// ---------------------------------------------------------------- classroom (outbox commands)
export const ClassroomBadge = z.object({ id: z.string(), name: LocalizedText, description: LocalizedText, icon: BadgeIconKey, tier: Tier });
export const ClassroomAward = z.object({ id: z.string(), studentId: z.string(), achievementId: z.string(), awardedAt: z.number(), undoable: z.boolean() });
export const classroomAchievements = endpoint({
  method: 'GET',
  path: '/api/classroom/contexts/:contextId/achievements',
  access: 'classroom',
  input: z.object({ contextId: Id, lessonId: Id.optional() }),
  output: z.object({
    enabled: z.boolean(),
    /** Manual badges that can be given in class. */
    badges: z.array(ClassroomBadge),
    /** This lesson's manual awards (for undo within 10 minutes). */
    lessonAwards: z.array(ClassroomAward),
    /** Item 7: automatic badges of this lesson, for the optional End Lesson "Well done!" moment (empty unless the class chose it). */
    wellDone: z.array(z.object({ studentId: z.string(), fullName: z.string(), badge: ClassroomBadge })),
    announce: z.enum(ANNOUNCE_MODES),
  }),
});

export const AchievementCommands = {
  /** Give a manual badge to students in class (no PIN). The award id is derived from the opId. */
  'achievements.award': z.object({ contextId: Id, lessonId: Id, achievementId: Id, studentIds: z.array(Id).min(1).max(80) }),
  /** Undo awards of this lesson within 10 minutes (later: PIN-gated revoke in the teacher area). */
  'achievements.undo': z.object({ contextId: Id, lessonId: Id, awardIds: z.array(Id).min(1).max(80) }),
} as const;
export type AchievementCommandType = keyof typeof AchievementCommands;
export type AchievementCommandPayload<T extends AchievementCommandType> = z.input<(typeof AchievementCommands)[T]>;
export const AchievementsEndStepInput = z.object({}).passthrough();

// ---------------------------------------------------------------- student page section
export const StudentBadge = z.object({
  id: z.string(),
  name: LocalizedText,
  description: LocalizedText,
  icon: BadgeIconKey,
  tier: Tier,
  category: AchievementCategory,
});
export const StudentAchievementsSection = z.object({
  earned: z.array(StudentBadge.extend({ awardedAt: z.number(), by: z.string().nullable(), isNew: z.boolean() })),
  locked: z.array(StudentBadge.extend({ progress: z.object({ current: z.number().int(), target: z.number().int() }).nullable() })),
  /** null when the class turned levels off. Personal only, never ranked (D-121). */
  level: z.object({ level: z.number().int(), name: LocalizedText, points: z.number().int(), nextAt: z.number().int().nullable() }).nullable(),
});
export type StudentAchievementsSection = z.infer<typeof StudentAchievementsSection>;

/** The student has seen their new badges (the celebration then plays only once). */
export const studentSeenAchievements = endpoint({ method: 'POST', path: '/api/student/achievements/seen', access: 'student', input: z.object({}), output: Ok });
