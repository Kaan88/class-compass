/**
 * Grouping contracts (S8: GRP-1..8, DSH-8, D-072, D-073).
 *
 * PRIVACY (GRP-7): levels, the arrangement type and pair rules (with their private notes) are
 * teacher-area only (`teacher` access, PIN-gated in classroom mode). Classroom responses carry group
 * names, icons, members (classroom-safe student fields) and roles, plus counts; never a level, a
 * mode, a rule or a note. `tests/server/grouping.test.ts` scans every classroom response for them.
 */
import { z } from 'zod';
import { LocalizedText, endpoint } from './define.ts';
import { Id, RequiredLocalizedText } from './school.ts';

export const GROUPING_MODES = ['level', 'mixed', 'custom'] as const;
export const GroupingMode = z.enum(GROUPING_MODES);
export type GroupingMode = z.infer<typeof GroupingMode>;
export const PAIR_RULE_KINDS = ['together', 'apart'] as const;
export const PairRuleKind = z.enum(PAIR_RULE_KINDS);
export const UNSATISFIED_REASONS = ['ONE_GROUP', 'GROUP_TOO_SMALL', 'CONFLICTS_WITH_APART', 'NOT_POSSIBLE_WITH_OTHER_RULES', 'NO_ARRANGEMENT_FOUND', 'ARRANGED_BY_HAND'] as const;
export const MAX_GROUPS = 20;
export const MAX_GROUP_SIZE = 20;

/** Number of groups OR target group size (GRP-2). */
export const Sizing = z.union([
  z.object({ groupCount: z.number().int().min(1).max(MAX_GROUPS) }).strict(),
  z.object({ targetSize: z.number().int().min(1).max(MAX_GROUP_SIZE) }).strict(),
]);
export type Sizing = z.infer<typeof Sizing>;

/**
 * Neutral, child-friendly group names (GRP-6): animals, planets and colours as words plus an icon
 * (emoji, decorative). Teachers can rename any group; this list only provides the defaults.
 */
export const GROUP_NAME_LIST = [
  { icon: '🦊', name: { en: 'Foxes', tr: 'Tilkiler' } },
  { icon: '🦉', name: { en: 'Owls', tr: 'Baykuşlar' } },
  { icon: '🐬', name: { en: 'Dolphins', tr: 'Yunuslar' } },
  { icon: '🐢', name: { en: 'Turtles', tr: 'Kaplumbağalar' } },
  { icon: '🐝', name: { en: 'Bees', tr: 'Arılar' } },
  { icon: '🐼', name: { en: 'Pandas', tr: 'Pandalar' } },
  { icon: '🐧', name: { en: 'Penguins', tr: 'Penguenler' } },
  { icon: '🦁', name: { en: 'Lions', tr: 'Aslanlar' } },
  { icon: '🪐', name: { en: 'Saturn', tr: 'Satürn' } },
  { icon: '🌍', name: { en: 'Earth', tr: 'Dünya' } },
  { icon: '🌙', name: { en: 'Moon', tr: 'Ay' } },
  { icon: '⭐', name: { en: 'Stars', tr: 'Yıldızlar' } },
  { icon: '🟦', name: { en: 'Blue team', tr: 'Mavi takım' } },
  { icon: '🟩', name: { en: 'Green team', tr: 'Yeşil takım' } },
  { icon: '🟨', name: { en: 'Yellow team', tr: 'Sarı takım' } },
  { icon: '🟥', name: { en: 'Red team', tr: 'Kırmızı takım' } },
  { icon: '🐙', name: { en: 'Octopuses', tr: 'Ahtapotlar' } },
  { icon: '🦒', name: { en: 'Giraffes', tr: 'Zürafalar' } },
  { icon: '🐳', name: { en: 'Whales', tr: 'Balinalar' } },
  { icon: '🦋', name: { en: 'Butterflies', tr: 'Kelebekler' } },
] as const;

/** Suggested group roles (optional, GRP-6); teachers may type their own. */
export const ROLE_SUGGESTIONS = [
  { en: 'Leader', tr: 'Lider' },
  { en: 'Writer', tr: 'Yazıcı' },
  { en: 'Reporter', tr: 'Sözcü' },
  { en: 'Timekeeper', tr: 'Zaman tutucu' },
  { en: 'Materials', tr: 'Malzeme sorumlusu' },
] as const;

/**
 * The five default arrangements (GRP-1): two level-based and three mixed-level. They are arrangements
 * (each makes several groups), created once per class+subject on first use and freely editable.
 * Arrangement names are shown on the classroom screen, so the defaults are neutral and never say
 * "level" (GRP-7); the teacher area shows the type next to the name.
 */
export const DEFAULT_ARRANGEMENTS = [
  { key: 'level-groups', mode: 'level', sizing: { groupCount: 3 }, name: { en: 'Three groups', tr: 'Üç grup' } },
  { key: 'level-pairs', mode: 'level', sizing: { targetSize: 2 }, name: { en: 'Pairs A', tr: 'İkililer A' } },
  { key: 'mixed-a', mode: 'mixed', sizing: { targetSize: 4 }, name: { en: 'Teams A', tr: 'Takımlar A' } },
  { key: 'mixed-b', mode: 'mixed', sizing: { targetSize: 4 }, name: { en: 'Teams B', tr: 'Takımlar B' } },
  { key: 'mixed-pairs', mode: 'mixed', sizing: { targetSize: 2 }, name: { en: 'Pairs B', tr: 'İkililer B' } },
] as const satisfies ReadonlyArray<{ key: string; mode: GroupingMode; sizing: Sizing; name: { en: string; tr: string } }>;

export const GroupRole = z.object({ studentId: z.string(), label: LocalizedText });
export const SavedGroup = z.object({
  id: z.string(),
  name: LocalizedText,
  icon: z.string().max(16),
  memberIds: z.array(z.string()),
  roles: z.array(GroupRole),
});
export type SavedGroup = z.infer<typeof SavedGroup>;

export const UnsatisfiedRule = z.object({
  ruleId: z.string(),
  a: z.string(),
  b: z.string(),
  kind: PairRuleKind,
  reason: z.enum(UNSATISFIED_REASONS),
});
export type UnsatisfiedRule = z.infer<typeof UnsatisfiedRule>;

// ---------------------------------------------------------------- teacher area (PIN-gated)
export const GroupTemplate = z.object({
  id: z.string(),
  name: LocalizedText,
  mode: GroupingMode,
  sizing: Sizing,
  seed: z.string(),
  version: z.number().int(),
  groups: z.array(SavedGroup),
  /** Rules this arrangement breaks, with reasons (GRP-8). */
  unsatisfied: z.array(UnsatisfiedRule),
  defaultKey: z.string().nullable(),
  archived: z.boolean(),
  updatedAt: z.number(),
});
export type GroupTemplate = z.infer<typeof GroupTemplate>;

export const GroupingStudent = z.object({ id: z.string(), fullName: z.string(), initials: z.string(), avatarHue: z.number().int() });
export type GroupingStudent = z.infer<typeof GroupingStudent>;
/** Teacher-only: includes the subject level (GRP-3, GRP-7). */
export const TeacherGroupingStudent = GroupingStudent.extend({ level: z.string().nullable() });

export const PairRule = z.object({
  id: z.string(),
  studentA: z.string(),
  studentB: z.string(),
  kind: PairRuleKind,
  /** Private teacher note (never on the classroom screen). */
  note: z.string().nullable(),
  updatedAt: z.number(),
});
export type PairRule = z.infer<typeof PairRule>;

export const GroupingOverview = z.object({
  contextId: z.string(),
  templates: z.array(GroupTemplate),
  students: z.array(TeacherGroupingStudent),
  rules: z.array(PairRule),
});
export type GroupingOverview = z.infer<typeof GroupingOverview>;

export const getGrouping = endpoint({
  method: 'GET',
  path: '/api/teacher/contexts/:contextId/grouping',
  access: 'teacher',
  input: z.object({ contextId: Id, includeArchived: z.enum(['0', '1']).optional() }),
  output: GroupingOverview,
});

export const GroupInput = z.object({
  id: Id.optional(),
  name: RequiredLocalizedText,
  icon: z.string().max(16).optional(),
  memberIds: z.array(Id).max(200),
  roles: z.array(z.object({ studentId: Id, label: LocalizedText })).max(200).optional(),
});
export type GroupInput = z.infer<typeof GroupInput>;

/** Create an arrangement: generated from mode + sizing, or saved from hand-made groups ("save as", GRP-3). */
export const createGroupTemplate = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/grouping/templates',
  access: 'teacher',
  input: z.object({
    contextId: Id,
    name: RequiredLocalizedText,
    mode: GroupingMode,
    sizing: Sizing,
    /** Required for mode 'custom' (hand-made groups); ignored otherwise. */
    groups: z.array(GroupInput).max(MAX_GROUPS).optional(),
  }),
  output: GroupTemplate,
});

/** Generate the groups again with a new seed (or the given one); bumps the version. */
export const generateGroupTemplate = endpoint({
  method: 'POST',
  path: '/api/teacher/grouping/templates/:templateId/generate',
  access: 'teacher',
  input: z.object({ templateId: Id, expectedVersion: z.number().int(), seed: z.string().min(1).max(64).optional() }),
  output: GroupTemplate,
});

/**
 * Edit an arrangement (GRP-2/3/6): rename, change type or size (the groups are generated again), or
 * save hand-edited groups (moves, group names, roles). `expectedVersion` guards against overwriting
 * a newer edit (409 VERSION_CONFLICT).
 */
export const updateGroupTemplate = endpoint({
  method: 'PUT',
  path: '/api/teacher/grouping/templates/:templateId',
  access: 'teacher',
  input: z.object({
    templateId: Id,
    expectedVersion: z.number().int(),
    name: RequiredLocalizedText.optional(),
    mode: GroupingMode.optional(),
    sizing: Sizing.optional(),
    groups: z.array(GroupInput).max(MAX_GROUPS).optional(),
  }),
  output: GroupTemplate,
});

export const archiveGroupTemplate = endpoint({
  method: 'POST',
  path: '/api/teacher/grouping/templates/:templateId/archive',
  access: 'teacher',
  input: z.object({ templateId: Id, archived: z.boolean() }),
  output: GroupTemplate,
});

const Note = z.string().trim().max(300).nullable().optional();
export const createPairRule = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/grouping/rules',
  access: 'teacher',
  input: z.object({ contextId: Id, studentA: Id, studentB: Id, kind: PairRuleKind, note: Note }),
  output: PairRule,
});
export const updatePairRule = endpoint({
  method: 'PATCH',
  path: '/api/teacher/grouping/rules/:ruleId',
  access: 'teacher',
  input: z.object({ ruleId: Id, kind: PairRuleKind.optional(), note: Note }),
  output: PairRule,
});
/** Rules are archived, never deleted (history). */
export const removePairRule = endpoint({
  method: 'POST',
  path: '/api/teacher/grouping/rules/:ruleId/archive',
  access: 'teacher',
  input: z.object({ ruleId: Id }),
  output: z.object({ ok: z.literal(true) }),
});

// ---------------------------------------------------------------- classroom (display-safe)
/** Arrangement names to choose from in the lesson (no type, no levels, no rules). */
export const classroomArrangements = endpoint({
  method: 'GET',
  path: '/api/classroom/contexts/:contextId/grouping/arrangements',
  access: 'classroom',
  input: z.object({ contextId: Id }),
  output: z.object({ arrangements: z.array(z.object({ id: z.string(), name: LocalizedText, groupCount: z.number().int() })) }),
});

export const DisplayMember = GroupingStudent.extend({ role: LocalizedText.nullable() });
export const DisplayGroup = z.object({ id: z.string(), name: LocalizedText, icon: z.string(), members: z.array(DisplayMember) });
export type DisplayGroup = z.infer<typeof DisplayGroup>;

/** Part of the polled lesson state (DSH-8): the groups shown on the classroom display. */
export const GroupingLessonState = z.object({
  applied: z.boolean(),
  arrangementId: z.string().nullable(),
  groups: z.array(DisplayGroup),
  /** Students of the class who are absent or excused now, so not in a group (count only). */
  excludedCount: z.number().int(),
  /** Students here now who are in no group yet (arrived late, joined the class), count only. */
  notPlacedCount: z.number().int(),
  /** Rules this lesson's groups break (count only; the rules are teacher-area, GRP-7/8). */
  unsatisfiedCount: z.number().int(),
});
export type GroupingLessonState = z.infer<typeof GroupingLessonState>;

/** Classroom commands (POST /api/commands), lesson-scoped (LES-4). */
export const GroupingCommands = {
  /** Use a saved arrangement in this lesson; absent students are left out for this lesson only (GRP-5). */
  'grouping.apply': z.object({ contextId: Id, lessonId: Id, templateId: Id }),
  /** Take the groups off the display. */
  'grouping.clear': z.object({ contextId: Id, lessonId: Id }),
} as const;
export type GroupingCommandType = keyof typeof GroupingCommands;
export type GroupingCommandPayload<T extends GroupingCommandType> = z.input<(typeof GroupingCommands)[T]>;
