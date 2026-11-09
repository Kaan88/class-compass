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
 * Option icons (S13a): original, theme-aware SVG icons drawn by the client (`OptionIcon`); the option's
 * name is always written next to the icon, so meaning never depends on the picture or its colour.
 */
export const OPTION_ICONS = ['lion', 'eagle', 'dolphin', 'tiger', 'owl', 'fox', 'turtle', 'bee'] as const;
export type OptionIcon = (typeof OPTION_ICONS)[number];

/**
 * The default grouping options (GRP-1 as changed by the owner on 2026-11-07, D-098): FOUR options per
 * class+subject, each arranging the present students into Group 1–5. Lions and Eagles are level-based
 * (differentiated), Dolphins and Tigers mixed-level. The option names are neutral animal names; the
 * classroom never shows the type or a level (GRP-7), only the teacher area does.
 */
export const DEFAULT_GROUP_COUNT = 5;
export const DEFAULT_ARRANGEMENTS = [
  { key: 'lions', mode: 'level', icon: 'lion', sizing: { groupCount: DEFAULT_GROUP_COUNT }, name: { en: 'Lions', tr: 'Aslanlar' } },
  { key: 'eagles', mode: 'level', icon: 'eagle', sizing: { groupCount: DEFAULT_GROUP_COUNT }, name: { en: 'Eagles', tr: 'Kartallar' } },
  { key: 'dolphins', mode: 'mixed', icon: 'dolphin', sizing: { groupCount: DEFAULT_GROUP_COUNT }, name: { en: 'Dolphins', tr: 'Yunuslar' } },
  { key: 'tigers', mode: 'mixed', icon: 'tiger', sizing: { groupCount: DEFAULT_GROUP_COUNT }, name: { en: 'Tigers', tr: 'Kaplanlar' } },
] as const satisfies ReadonlyArray<{ key: string; mode: GroupingMode; icon: OptionIcon; sizing: Sizing; name: { en: string; tr: string } }>;
/** Keys of the S8 defaults (five arrangements), kept in older contexts as history. */
export const LEGACY_DEFAULT_KEYS = ['level-groups', 'level-pairs', 'mixed-a', 'mixed-b', 'mixed-pairs'] as const;

/** Group n (1-based) as a neutral name in both languages; the classroom shows it with its number. */
export const groupName = (n: number) => ({ en: `Group ${n}`, tr: `Grup ${n}` });

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
  icon: z.enum(OPTION_ICONS).nullable(),
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
  /** true while the context uses no S13a default option yet ("Use the 4 default options", D-098). */
  canUseNewDefaults: z.boolean(),
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
    icon: z.enum(OPTION_ICONS).nullable().optional(),
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
    icon: z.enum(OPTION_ICONS).nullable().optional(),
    groups: z.array(GroupInput).max(MAX_GROUPS).optional(),
  }),
  output: GroupTemplate,
});

/**
 * "Use the 4 default options" (D-098): contexts made before S13a keep their old arrangements as
 * history (archived, restorable) and get the four default options.
 */
export const useDefaultGroupOptions = endpoint({
  method: 'POST',
  path: '/api/teacher/contexts/:contextId/grouping/use-defaults',
  access: 'teacher',
  input: z.object({ contextId: Id }),
  output: GroupingOverview,
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
  output: z.object({ arrangements: z.array(z.object({ id: z.string(), name: LocalizedText, icon: z.enum(OPTION_ICONS).nullable(), groupCount: z.number().int() })) }),
});

export const DisplayMember = GroupingStudent.extend({ role: LocalizedText.nullable() });
export const DisplayGroup = z.object({ id: z.string(), name: LocalizedText, icon: z.string(), members: z.array(DisplayMember) });
export type DisplayGroup = z.infer<typeof DisplayGroup>;

/** Part of the polled lesson state (DSH-8): the groups shown on the classroom display. */
export const GroupingLessonState = z.object({
  applied: z.boolean(),
  arrangementId: z.string().nullable(),
  /** The live lesson grouping (S13a): Shuffle's undo restores the previous one by id. */
  groupingId: z.string().nullable(),
  /** Per-class display option (S13a): names in Turkish-correct upper case. */
  upperCaseNames: z.boolean(),
  /** Students here now and in no group (classroom-safe fields), so they can be placed by a tap. */
  notPlaced: z.array(GroupingStudent),
  groups: z.array(DisplayGroup),
  /** Students of the class who are absent or excused now, so not in a group (count only). */
  excludedCount: z.number().int(),
  /** Students here now who are in no group yet (arrived late, joined the class), count only. */
  notPlacedCount: z.number().int(),
  // No rule conflicts here, not even a count: they are reported in the teacher area only (S13a 2, GRP-7/8).
});
export type GroupingLessonState = z.infer<typeof GroupingLessonState>;

/**
 * S14c (D-150): the `grouping.move` target "Not in a group". It takes the student out of every group of
 * the lesson (they show under "Not in a group" until the teacher places them). Group ids are UUIDs or
 * `extra-<n>`, so this name never collides with a group.
 */
export const UNPLACED = 'UNPLACED';

/** Classroom commands (POST /api/commands), lesson-scoped (LES-4). */
export const GroupingCommands = {
  /** Use a saved arrangement in this lesson; absent students are left out for this lesson only (GRP-5). */
  'grouping.apply': z.object({ contextId: Id, lessonId: Id, templateId: Id }),
  /** Take the groups off the display. */
  'grouping.clear': z.object({ contextId: Id, lessonId: Id }),
  /** S13a: a new seed for the option in use, for the present students (lesson only; undo = restore). */
  'grouping.shuffle': z.object({ contextId: Id, lessonId: Id }),
  /** S13a: bring back an earlier grouping of this lesson (Shuffle's undo). */
  'grouping.restore': z.object({ contextId: Id, lessonId: Id, groupingId: Id }),
  /** S13a: move one present student to another group of the lesson's groups (tap or drag); S14c: `toGroupId` `UNPLACED` takes them out of every group. */
  'grouping.move': z.object({ contextId: Id, lessonId: Id, studentId: Id, toGroupId: z.string().min(1).max(64) }),
  /**
   * S13a: save the lesson's groups into the option (absent students keep their saved group). S14c:
   * a student taken out with `UNPLACED` is saved in no group; a late arrival not placed yet keeps theirs.
   */
  'grouping.saveToOption': z.object({ contextId: Id, lessonId: Id }),
} as const;
export type GroupingCommandType = keyof typeof GroupingCommands;
export type GroupingCommandPayload<T extends GroupingCommandType> = z.input<(typeof GroupingCommands)[T]>;
