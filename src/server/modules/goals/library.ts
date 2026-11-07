/**
 * Skill categories, preset goals and outcome labels (GOL-1, GOL-2).
 *
 * - Default categories (Reading, Writing, Grammar, Vocabulary, Listening, EN+TR) and a few preset goals
 *   for each are created once at start-up with fixed ids; they belong to no subject and no teacher.
 * - Teachers add custom categories and presets for one subject; they see the defaults plus their own,
 *   and their students see the defaults plus the custom ones of their teachers in that subject.
 * - Archived categories and presets are kept (goals refer to them), only hidden from choosing.
 */
import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import { DEFAULT_GOAL_OUTCOMES, OutcomeSet, type Category, type GoalLibrary, type OutcomeDef, type Preset } from '../../../shared/contracts/goals.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import type { Db } from '../../db/client.ts';
import { goalPresets, skillCategories } from '../../db/schema.ts';
import { moduleConfig } from '../school/modules.ts';

export type CategoryRow = typeof skillCategories.$inferSelect;
export type PresetRow = typeof goalPresets.$inferSelect;

const DEFAULTS: Array<{ id: string; name: LocalizedTextValue; presets: Array<{ id: string; text: LocalizedTextValue }> }> = [
  {
    id: '00000000-0000-7000-8000-00000000c001',
    name: { en: 'Reading', tr: 'Okuma' },
    presets: [
      { id: '00000000-0000-7000-8000-00000000d011', text: { en: 'I will read a short book every week.', tr: 'Her hafta kısa bir kitap okuyacağım.' } },
      { id: '00000000-0000-7000-8000-00000000d012', text: { en: 'I will read aloud for five minutes every day.', tr: 'Her gün beş dakika sesli okuyacağım.' } },
    ],
  },
  {
    id: '00000000-0000-7000-8000-00000000c002',
    name: { en: 'Writing', tr: 'Yazma' },
    presets: [
      { id: '00000000-0000-7000-8000-00000000d021', text: { en: 'I will write three sentences about my day.', tr: 'Günümle ilgili üç cümle yazacağım.' } },
      { id: '00000000-0000-7000-8000-00000000d022', text: { en: 'I will check my capital letters and full stops.', tr: 'Büyük harflerimi ve noktalarımı kontrol edeceğim.' } },
    ],
  },
  {
    id: '00000000-0000-7000-8000-00000000c003',
    name: { en: 'Grammar', tr: 'Dil bilgisi' },
    presets: [{ id: '00000000-0000-7000-8000-00000000d031', text: { en: 'I will use "is" and "are" correctly.', tr: '"is" ve "are"yı doğru kullanacağım.' } }],
  },
  {
    id: '00000000-0000-7000-8000-00000000c004',
    name: { en: 'Vocabulary', tr: 'Kelime bilgisi' },
    presets: [
      { id: '00000000-0000-7000-8000-00000000d041', text: { en: 'I will learn five new words every week.', tr: 'Her hafta beş yeni kelime öğreneceğim.' } },
      { id: '00000000-0000-7000-8000-00000000d042', text: { en: 'I will use a new word in a sentence.', tr: 'Yeni bir kelimeyi bir cümlede kullanacağım.' } },
    ],
  },
  {
    id: '00000000-0000-7000-8000-00000000c005',
    name: { en: 'Listening', tr: 'Dinleme' },
    presets: [{ id: '00000000-0000-7000-8000-00000000d051', text: { en: 'I will listen to an English song and find three words.', tr: 'İngilizce bir şarkı dinleyip üç kelime bulacağım.' } }],
  },
];

/** Create the default categories and presets once (idempotent; never re-creates archived ones). */
export function ensureGoalDefaults(db: Db, now: number): void {
  DEFAULTS.forEach((c, i) => {
    db.insert(skillCategories).values({ id: c.id, subjectId: null, name: c.name, sortOrder: (i + 1) * 10, createdBy: null, archivedAt: null, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
    for (const p of c.presets) {
      db.insert(goalPresets).values({ id: p.id, categoryId: c.id, subjectId: null, text: p.text, createdBy: null, archivedAt: null, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
    }
  });
}

export const categoryDto = (c: CategoryRow): Category => ({ id: c.id, name: c.name, subjectId: c.subjectId, custom: c.createdBy !== null, archived: c.archivedAt !== null });
export const presetDto = (p: PresetRow): Preset => ({ id: p.id, categoryId: p.categoryId, text: p.text, custom: p.createdBy !== null, archived: p.archivedAt !== null });

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
  return {
    categories: categoriesFor(db, subjectId, teacherIds, includeArchived).map(categoryDto),
    presets: presetsFor(db, subjectId, teacherIds, includeArchived).map(presetDto),
    outcomes: outcomesOf(db, contextId),
  };
}

export const getCategory = (db: Db, id: string): CategoryRow | undefined => db.select().from(skillCategories).where(eq(skillCategories.id, id)).get();
export const getPreset = (db: Db, id: string): PresetRow | undefined => db.select().from(goalPresets).where(eq(goalPresets.id, id)).get();

/** A category or preset row usable here: a default, or a custom one of these teachers for this subject. */
export const inScope = (row: { subjectId: string | null; createdBy: string | null }, subjectId: string, teacherIds: readonly string[]) =>
  row.createdBy === null || (row.subjectId === subjectId && teacherIds.includes(row.createdBy));
