/**
 * Sentence starters (S14d, D-152), following the `library.ts` pattern for categories and presets:
 *
 * - Built-in starters (six per kind, English and Turkish, for 7–10-year-olds learning English) are
 *   created once at start-up with fixed ids (`ensureStarterDefaults`); they belong to no subject and
 *   no teacher. Their words are simple on purpose and every one passes the student text checks once
 *   the blank is filled (test-enforced).
 * - Teachers add starters for one subject (optionally one goal category). A student sees the usable
 *   defaults plus the starters of their teachers in that subject, only in the student page's
 *   language(s).
 * - Archiving follows D-116: a teacher hides a default for their own classes (`default_item_archives`,
 *   kind 'starter'), an administrator archives it for the school (`archivedAt`).
 * - `starterTextsFor` gives every starter text of a subject and kind (archived ones too) to the
 *   server's `STARTER_UNFINISHED` check, so a starter sent unchanged is refused even after it was
 *   hidden, and a goal is never compared with a practice idea's starter.
 */
import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import type { Starter, StudentStarter } from '../../../shared/contracts/goals.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import type { ClassLocale } from '../../../shared/classLanguage.ts';
import { STARTER_KINDS, type StarterKind } from '../../../shared/text/starters.ts';
import type { Db } from '../../db/client.ts';
import { textStarters } from '../../db/schema.ts';
import type { HiddenDefaults } from './library.ts';

export type StarterRow = typeof textStarters.$inferSelect;

/** Built-in starters, one row per starter with its English and Turkish words. */
export const DEFAULT_STARTERS: Record<StarterKind, LocalizedTextValue[]> = {
  goal: [
    { en: 'I want to get better at ___.', tr: '___ konusunda daha iyi olmak istiyorum.' },
    { en: 'I will practise ___ every day.', tr: 'Her gün ___ çalışacağım.' },
    { en: 'I will read ___ this week.', tr: 'Bu hafta ___ okuyacağım.' },
    { en: 'I want to learn new words about ___.', tr: '___ hakkında yeni kelimeler öğrenmek istiyorum.' },
    { en: 'I will try to say ___ in English.', tr: 'İngilizce ___ söylemeyi deneyeceğim.' },
    { en: 'My goal is ___.', tr: 'Hedefim ___.' },
  ],
  reflection: [
    { en: 'Today I learned ___.', tr: 'Bugün ___ öğrendim.' },
    { en: 'I found out that ___.', tr: 'Şunu öğrendim: ___.' },
    { en: 'Now I can ___.', tr: 'Artık ___ yapabiliyorum.' },
    { en: 'A new word I know is ___.', tr: 'Yeni öğrendiğim bir kelime: ___.' },
    { en: 'I was proud when ___.', tr: '___ gurur duydum.' },
    { en: 'Next time I will ___.', tr: 'Bir dahaki sefere ___.' },
  ],
  note: [
    { en: 'Remember to ___.', tr: 'Unutma: ___.' },
    { en: 'Next lesson I will ___.', tr: 'Gelecek derste ___.' },
    { en: 'I need help with ___.', tr: '___ için yardım istiyorum.' },
    { en: 'I want to ask about ___.', tr: '___ hakkında soru sormak istiyorum.' },
    { en: 'At home I will ___.', tr: 'Evde ___.' },
    { en: 'Bring ___ to school.', tr: 'Okula ___ getir.' },
  ],
  selfAssessment: [
    { en: 'It is going well because ___.', tr: 'İyi gidiyor çünkü ___.' },
    { en: 'It is hard because ___.', tr: 'Zor geliyor çünkü ___.' },
    { en: 'I am getting better at ___.', tr: '___ konusunda daha iyiyim.' },
    { en: 'I still find ___ hard.', tr: '___ hâlâ zor geliyor.' },
    { en: 'I am happy about ___.', tr: '___ için mutluyum.' },
    { en: 'I need more practice with ___.', tr: '___ için daha çok çalışmalıyım.' },
  ],
  evidence: [
    { en: 'This is my ___.', tr: 'Bu benim ___.' },
    { en: 'I made this when ___.', tr: 'Bunu ___ yaptım.' },
    { en: 'In this work I ___.', tr: 'Bu çalışmada ___.' },
    { en: 'I am proud of this because ___.', tr: 'Bununla gurur duyuyorum çünkü ___.' },
    { en: 'I used ___ in this work.', tr: 'Bu çalışmada ___ kullandım.' },
    { en: 'This shows that I can ___.', tr: 'Bu, ___ yapabildiğimi gösteriyor.' },
  ],
  caption: [
    { en: 'My ___.', tr: 'Benim ___.' },
    { en: 'Me and my ___.', tr: 'Ben ve ___.' },
    { en: 'My work about ___.', tr: '___ hakkında çalışmam.' },
    { en: 'A picture of ___.', tr: '___ resmi.' },
    { en: 'Listen to me: ___.', tr: 'Beni dinle: ___.' },
    { en: 'A story about ___.', tr: '___ hakkında bir hikâye.' },
  ],
  practice: [
    { en: 'Read ___ at bedtime.', tr: 'Yatmadan önce ___ okumak.' },
    { en: 'Play a word game about ___.', tr: '___ ile kelime oyunu oynamak.' },
    { en: 'Say ___ out loud.', tr: '___ sesli söylemek.' },
    { en: 'Write ___ in my notebook.', tr: 'Defterime ___ yazmak.' },
    { en: 'Sing a song about ___.', tr: '___ hakkında şarkı söylemek.' },
    { en: 'Practise ___ with a friend.', tr: 'Bir arkadaşla ___ çalışmak.' },
  ],
};

/** Fixed id of a built-in starter: kind number (1–7) and row number (1–9). */
export const defaultStarterId = (kind: StarterKind, row: number) => `00000000-0000-7000-8000-00000000e${STARTER_KINDS.indexOf(kind) + 1}${row}0`;

/** Create the built-in starters once (idempotent; never re-creates or changes archived ones). */
export function ensureStarterDefaults(db: Db, now: number): void {
  STARTER_KINDS.forEach((kind, k) => {
    DEFAULT_STARTERS[kind].forEach((text, i) => {
      db.insert(textStarters)
        .values({ id: defaultStarterId(kind, i + 1), kind, subjectId: null, categoryId: null, text, sortOrder: (k + 1) * 100 + (i + 1) * 10, createdBy: null, archivedAt: null, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .run();
    });
  });
}

export const starterDto = (s: StarterRow, hidden: HiddenDefaults): Starter => ({
  id: s.id,
  kind: s.kind,
  categoryId: s.categoryId,
  text: s.text,
  custom: s.createdBy !== null,
  archived: s.archivedAt !== null || (s.createdBy === null && hidden.starters.has(s.id)),
  schoolArchived: s.createdBy === null && s.archivedAt !== null,
});

export const starterUsable = (s: StarterRow, hidden: HiddenDefaults) => s.archivedAt === null && !(s.createdBy === null && hidden.starters.has(s.id));

/** Defaults, plus the starters these teachers made for this subject. */
function scopeWhere(subjectId: string, teacherIds: readonly string[]): SQL {
  const own = teacherIds.map((tid) => and(eq(textStarters.subjectId, subjectId), eq(textStarters.createdBy, tid))!);
  return or(isNull(textStarters.createdBy), ...own)!;
}

const sortStarters = (a: StarterRow, b: StarterRow) => (a.createdBy === null ? 0 : 1) - (b.createdBy === null ? 0 : 1) || a.sortOrder - b.sortOrder || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

export function startersFor(db: Db, subjectId: string, teacherIds: readonly string[], includeArchived: boolean): StarterRow[] {
  return db
    .select()
    .from(textStarters)
    .where(and(scopeWhere(subjectId, teacherIds), includeArchived ? undefined : isNull(textStarters.archivedAt)))
    .all()
    .sort(sortStarters);
}

/**
 * What the student page offers (D-152): usable starters (not archived, not a default the class's
 * teacher hid), a category starter only with a category the students can choose, and only the texts
 * in the student page's languages (a starter with none of them is left out).
 */
export function studentStarters(db: Db, subjectId: string, teacherIds: readonly string[], hidden: HiddenDefaults, categoryIds: ReadonlySet<string>, locales: readonly ClassLocale[]): StudentStarter[] {
  const out: StudentStarter[] = [];
  for (const s of startersFor(db, subjectId, teacherIds, false)) {
    if (!starterUsable(s, hidden) || (s.categoryId !== null && !categoryIds.has(s.categoryId))) continue;
    const text: LocalizedTextValue = {};
    for (const l of locales) if (s.text[l]?.trim()) text[l] = s.text[l];
    if (Object.keys(text).length) out.push({ id: s.id, kind: s.kind, categoryId: s.categoryId, text });
  }
  return out;
}

/** Every starter text of these kinds (both languages, archived ones too) a student of this subject may have been offered. */
export function starterTextsFor(db: Db, subjectId: string, teacherIds: readonly string[], kinds: readonly StarterKind[]): string[] {
  if (!kinds.length) return [];
  return startersFor(db, subjectId, teacherIds, true)
    .filter((s) => kinds.includes(s.kind))
    .flatMap((s) => [s.text.en, s.text.tr].filter((x): x is string => Boolean(x?.trim())));
}

/** Every built-in starter with its school-wide state (admin, D-116). */
export function defaultStarters(db: Db, hidden: HiddenDefaults): Starter[] {
  return db.select().from(textStarters).where(isNull(textStarters.createdBy)).all().sort(sortStarters).map((s) => starterDto(s, hidden));
}

export const getStarter = (db: Db, id: string): StarterRow | undefined => db.select().from(textStarters).where(eq(textStarters.id, id)).get();
