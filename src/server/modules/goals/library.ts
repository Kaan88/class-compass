/**
 * Skill categories, preset goals and outcome labels (GOL-1, GOL-2).
 *
 * - Default categories (Reading, Writing, Grammar, Vocabulary, Listening, EN+TR) and a few preset goals
 *   for each are created once at start-up with fixed ids; they belong to no subject and no teacher.
 * - Teachers add custom categories and presets for one subject; they see the defaults plus their own,
 *   and their students see the defaults plus the custom ones of their teachers in that subject.
 * - Archived categories and presets are kept (goals refer to them), only hidden from choosing.
 * - Defaults can be archived too (S13b2, D-116): by a teacher for their own classes only (a row in
 *   `default_item_archives`), or school-wide by an administrator (the row's own `archivedAt`). A
 *   student sees what the teacher of that class+subject sees; goals keep their label snapshot (DAT-6).
 */
import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { DEFAULT_GOAL_OUTCOMES, OutcomeSet, type Category, type GoalLibrary, type OutcomeDef, type Preset, type Starter } from '../../../shared/contracts/goals.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import type { TopicIcon } from '../../../shared/lessons.ts';
import type { Db } from '../../db/client.ts';
import { defaultItemArchives, goalPresets, skillCategories } from '../../db/schema.ts';
import { moduleConfig } from '../school/modules.ts';
import { defaultStarters, ensureStarterDefaults, starterDto, startersFor } from './starters.ts';

export type CategoryRow = typeof skillCategories.$inferSelect;
export type PresetRow = typeof goalPresets.$inferSelect;

const DEFAULTS: Array<{ id: string; name: LocalizedTextValue; icon: TopicIcon; presets: Array<{ id: string; text: LocalizedTextValue }> }> = [
  {
    id: '00000000-0000-7000-8000-00000000c001',
    icon: 'book',
    name: { en: 'Reading', tr: 'Okuma' },
    presets: [
      { id: '00000000-0000-7000-8000-00000000d011', text: { en: 'I will read a short book every week.', tr: 'Her hafta kısa bir kitap okuyacağım.' } },
      { id: '00000000-0000-7000-8000-00000000d012', text: { en: 'I will read aloud for five minutes every day.', tr: 'Her gün beş dakika sesli okuyacağım.' } },
    ],
  },
  {
    id: '00000000-0000-7000-8000-00000000c002',
    icon: 'pen',
    name: { en: 'Writing', tr: 'Yazma' },
    presets: [
      { id: '00000000-0000-7000-8000-00000000d021', text: { en: 'I will write three sentences about my day.', tr: 'Günümle ilgili üç cümle yazacağım.' } },
      { id: '00000000-0000-7000-8000-00000000d022', text: { en: 'I will check my capital letters and full stops.', tr: 'Büyük harflerimi ve noktalarımı kontrol edeceğim.' } },
    ],
  },
  {
    id: '00000000-0000-7000-8000-00000000c003',
    icon: 'grammar',
    name: { en: 'Grammar', tr: 'Dil bilgisi' },
    presets: [{ id: '00000000-0000-7000-8000-00000000d031', text: { en: 'I will use "is" and "are" correctly.', tr: '"is" ve "are"yı doğru kullanacağım.' } }],
  },
  {
    id: '00000000-0000-7000-8000-00000000c004',
    icon: 'words',
    name: { en: 'Vocabulary', tr: 'Kelime bilgisi' },
    presets: [
      { id: '00000000-0000-7000-8000-00000000d041', text: { en: 'I will learn five new words every week.', tr: 'Her hafta beş yeni kelime öğreneceğim.' } },
      { id: '00000000-0000-7000-8000-00000000d042', text: { en: 'I will use a new word in a sentence.', tr: 'Yeni bir kelimeyi bir cümlede kullanacağım.' } },
    ],
  },
  {
    id: '00000000-0000-7000-8000-00000000c005',
    icon: 'ear',
    name: { en: 'Listening', tr: 'Dinleme' },
    presets: [{ id: '00000000-0000-7000-8000-00000000d051', text: { en: 'I will listen to an English song and find three words.', tr: 'İngilizce bir şarkı dinleyip üç kelime bulacağım.' } }],
  },
  // S13a (D-101): Speaking and Phonics join the defaults, also as lesson topics.
  {
    id: '00000000-0000-7000-8000-00000000c006',
    icon: 'speech',
    name: { en: 'Speaking', tr: 'Konuşma' },
    presets: [{ id: '00000000-0000-7000-8000-00000000d061', text: { en: 'I will answer a question in English in every lesson.', tr: 'Her derste bir soruyu İngilizce yanıtlayacağım.' } }],
  },
  {
    id: '00000000-0000-7000-8000-00000000c007',
    icon: 'letters',
    name: { en: 'Phonics', tr: 'Sesletim' },
    presets: [{ id: '00000000-0000-7000-8000-00000000d071', text: { en: 'I will practise two letter sounds every day.', tr: 'Her gün iki harf sesi çalışacağım.' } }],
  },
];

/** Create the default categories and presets once (idempotent; never re-creates archived ones). */
export function ensureGoalDefaults(db: Db, now: number): void {
  DEFAULTS.forEach((c, i) => {
    db.insert(skillCategories).values({ id: c.id, subjectId: null, name: c.name, icon: c.icon, sortOrder: (i + 1) * 10, createdBy: null, archivedAt: null, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
    // Rows made before S13a get their topic icon once (never overwriting a chosen one).
    db.update(skillCategories).set({ icon: c.icon }).where(and(eq(skillCategories.id, c.id), isNull(skillCategories.icon))).run();
    for (const p of c.presets) {
      db.insert(goalPresets).values({ id: p.id, categoryId: c.id, subjectId: null, text: p.text, createdBy: null, archivedAt: null, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
    }
  });
  // S14d (D-152): the built-in sentence starters come with the goal defaults.
  ensureStarterDefaults(db, now);
}

/** Defaults hidden by these teachers for their own classes (D-116; sentence starters since S14d, D-152). */
export interface HiddenDefaults {
  categories: ReadonlySet<string>;
  presets: ReadonlySet<string>;
  starters: ReadonlySet<string>;
}
export const NOTHING_HIDDEN: HiddenDefaults = { categories: new Set(), presets: new Set(), starters: new Set() };

export function hiddenDefaultsOf(db: Db, teacherIds: readonly string[]): HiddenDefaults {
  if (!teacherIds.length) return NOTHING_HIDDEN;
  const rows = db.select().from(defaultItemArchives).where(inArray(defaultItemArchives.userId, [...teacherIds])).all();
  const of = (kind: string) => new Set(rows.filter((r) => r.kind === kind).map((r) => r.itemId));
  return { categories: of('category'), presets: of('preset'), starters: of('starter') };
}

/**
 * `archived` = hidden from choosing for this viewer: archived by its owner, by the school (a default),
 * or a default this teacher archived for their classes. `schoolArchived`: only an administrator can restore it.
 */
export const categoryDto = (c: CategoryRow, hidden: HiddenDefaults = NOTHING_HIDDEN): Category => ({
  id: c.id,
  name: c.name,
  icon: (c.icon as Category['icon']) ?? null,
  subjectId: c.subjectId,
  custom: c.createdBy !== null,
  archived: c.archivedAt !== null || (c.createdBy === null && hidden.categories.has(c.id)),
  schoolArchived: c.createdBy === null && c.archivedAt !== null,
});
export const presetDto = (p: PresetRow, hidden: HiddenDefaults = NOTHING_HIDDEN): Preset => ({
  id: p.id,
  categoryId: p.categoryId,
  text: p.text,
  custom: p.createdBy !== null,
  archived: p.archivedAt !== null || (p.createdBy === null && hidden.presets.has(p.id)),
  schoolArchived: p.createdBy === null && p.archivedAt !== null,
});

/** Usable for choosing here: not archived, not a default hidden by the class's teacher. */
export const categoryUsable = (c: CategoryRow, hidden: HiddenDefaults) => c.archivedAt === null && !(c.createdBy === null && hidden.categories.has(c.id));
export const presetUsable = (p: PresetRow, hidden: HiddenDefaults) => p.archivedAt === null && !(p.createdBy === null && hidden.presets.has(p.id));

/** Defaults, plus the custom rows of these teachers for this subject. */
function scopeWhere(table: typeof skillCategories | typeof goalPresets, subjectId: string, teacherIds: readonly string[]): SQL {
  const own = teacherIds.map((tid) => and(eq(table.subjectId, subjectId), eq(table.createdBy, tid))!);
  return or(isNull(table.createdBy), ...own)!;
}

export function categoriesFor(db: Db, subjectId: string, teacherIds: readonly string[], includeArchived: boolean): CategoryRow[] {
  return db
    .select()
    .from(skillCategories)
    .where(and(scopeWhere(skillCategories, subjectId, teacherIds), includeArchived ? undefined : isNull(skillCategories.archivedAt)))
    .all()
    .sort((a, b) => (a.createdBy === null ? 0 : 1) - (b.createdBy === null ? 0 : 1) || a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
}

export function presetsFor(db: Db, subjectId: string, teacherIds: readonly string[], includeArchived: boolean): PresetRow[] {
  return db
    .select()
    .from(goalPresets)
    .where(and(scopeWhere(goalPresets, subjectId, teacherIds), includeArchived ? undefined : isNull(goalPresets.archivedAt)))
    .all()
    .sort((a, b) => (a.createdBy === null ? 0 : 1) - (b.createdBy === null ? 0 : 1) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function outcomesOf(db: Db, contextId: string): OutcomeDef[] {
  const parsed = OutcomeSet.safeParse(moduleConfig(db, contextId, 'goals').outcomes);
  return parsed.success ? parsed.data : DEFAULT_GOAL_OUTCOMES;
}

export function libraryFor(db: Db, contextId: string, subjectId: string, teacherIds: readonly string[], includeArchived: boolean): GoalLibrary {
  const hidden = hiddenDefaultsOf(db, teacherIds);
  return {
    categories: categoriesFor(db, subjectId, teacherIds, includeArchived).map((c) => categoryDto(c, hidden)),
    presets: presetsFor(db, subjectId, teacherIds, includeArchived).map((p) => presetDto(p, hidden)),
    starters: startersFor(db, subjectId, teacherIds, includeArchived).map((s) => starterDto(s, hidden)),
    outcomes: outcomesOf(db, contextId),
  };
}

/** What students of this class+subject may choose (D-116): usable categories and their usable presets. */
export function studentChoices(db: Db, subjectId: string, teacherIds: readonly string[], contextTeacherId: string): { categories: Category[]; presets: Preset[] } {
  const hidden = hiddenDefaultsOf(db, [contextTeacherId]);
  const cats = categoriesFor(db, subjectId, teacherIds, false).filter((c) => categoryUsable(c, hidden));
  const catIds = new Set(cats.map((c) => c.id));
  return {
    categories: cats.map((c) => categoryDto(c, hidden)),
    presets: presetsFor(db, subjectId, teacherIds, false)
      .filter((p) => presetUsable(p, hidden) && catIds.has(p.categoryId))
      .map((p) => presetDto(p, hidden)),
  };
}

/** Every default category, preset and (S14d) sentence starter with its school-wide state (admin, D-116). */
export function defaultLibrary(db: Db): { categories: Category[]; presets: Preset[]; starters: Starter[] } {
  return {
    categories: db.select().from(skillCategories).where(isNull(skillCategories.createdBy)).all().sort((a, b) => a.sortOrder - b.sortOrder).map((c) => categoryDto(c)),
    presets: db.select().from(goalPresets).where(isNull(goalPresets.createdBy)).all().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((p) => presetDto(p)),
    starters: defaultStarters(db, NOTHING_HIDDEN),
  };
}

export const getCategory = (db: Db, id: string): CategoryRow | undefined => db.select().from(skillCategories).where(eq(skillCategories.id, id)).get();
export const getPreset = (db: Db, id: string): PresetRow | undefined => db.select().from(goalPresets).where(eq(goalPresets.id, id)).get();

/** A category or preset row usable here: a default, or a custom one of these teachers for this subject. */
export const inScope = (row: { subjectId: string | null; createdBy: string | null }, subjectId: string, teacherIds: readonly string[]) =>
  row.createdBy === null || (row.subjectId === subjectId && teacherIds.includes(row.createdBy));
