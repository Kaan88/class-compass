/**
 * The privacy gate of the AI tools (S14h1, D-161). Every tool, resource and prompt result passes
 * through `privateResult` before it leaves the school:
 *
 * - Both modes: fields marked `note`, `level`, `file`, `secret` or `linkToken` are removed (private
 *   teacher notes, grouping levels, files, photos and audio, Secret Student data, link tokens).
 * - Pseudonymous mode (the default, and the only mode while the school's "student data to AI tools"
 *   switch is off): student name fields become "Student N" (stable per token family, `mcp_pseudonyms`),
 *   student ids become `student-N`, student text is withheld, and student names and numbers that appear
 *   in free text (teacher-written text, labels, row keys, unmarked fields) are replaced too
 *   (Turkish-aware matching, `NameScrubber`): a full name of one of the caller's own students by its
 *   pseudonym, anything else (a single name part, another class's student) by the neutral `[name]`, so
 *   no predictable text can map a name to a pseudonym. Staff names and fields marked `none` (school
 *   name, keys, static documents) are not scrubbed (review fix, D-161).
 * - Named mode: names stay; student text is wrapped as `{ untrustedText }` so the client can treat it
 *   as data, never as instructions.
 *
 * `student-N` aliases are accepted as tool input and resolved only to the caller's own students
 * (`resolveAliases`).
 */
import { and, eq, isNull, max } from 'drizzle-orm';
import { z } from 'zod';
import { NEVER_LEAVES, type AiPrivacyMode, type PiiKind } from '../../../shared/mcp.ts';
import type { Db } from '../../db/client.ts';
import { enrolments, mcpPseudonyms, students, teachingContexts } from '../../db/schema.ts';
import type { UserRow } from '../../lib/context.ts';

export const WITHHELD_TEXT = '[withheld: student text]';
export const UNKNOWN_STUDENT = '[a student]';
const REMOVE = Symbol('remove');

/** The `pii` mark of a schema node, if any. */
export function piiOf(schema: z.ZodType): PiiKind | undefined {
  const meta = z.globalRegistry.get(schema) as { cc?: { pii?: PiiKind } } | undefined;
  return meta?.cc?.pii;
}

type Def = { type: string; [k: string]: unknown };
const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: Def } })._zod.def;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------- Turkish-aware name matching
/** One UTF-16 unit folded case- and accent-insensitively (Turkish rules), length-preserving. */
function foldChar(ch: string): string {
  const lower = ch.toLocaleLowerCase('tr-TR');
  let c = lower.length === 1 ? lower : ch.toLowerCase();
  if (c.length !== 1) c = ch;
  c = c.normalize('NFD')[0] ?? c;
  return c === 'ı' ? 'i' : c;
}
export function foldSameLength(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) out += foldChar(s[i]!);
  return out;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

interface NameEntry {
  ids: Set<string>;
  full: boolean;
}

/**
 * Name parts that are also very common words (English "can", "will", "may"; Turkish "su" water, "ay"
 * month or moon). Written in lower case they are left alone; capitalised they are replaced like any
 * other name part. Kept deliberately short: over-replacing is the safe direction (D-161).
 */
export const COMMON_WORD_NAMES: ReadonlySet<string> = new Set(['can', 'will', 'may', 'su', 'ay']);
/**
 * Turkish case endings written straight after a name without the apostrophe ("Elifin", "Elife",
 * "Elifte"), already folded (ı→i, ü→u): genitive, accusative, dative, locative, ablative, instrumental.
 */
const SUFFIX = '(?:n?[iu]n|y?[iu]|y?[ea]|[dt][ea]n?|y?l[ea])';
/** A student number in text: four or more digits on its own, or any length next to "no", "nr", "#", "numara", "number". */
const NUMBER_WORD_BEFORE = /(?:(?<![\p{L}\p{N}])(?:no|nr)\.?|(?<![\p{L}\p{N}])numara(?:s[iı])?|(?<![\p{L}\p{N}])number|#)\s*:?\s*$/iu;
const NUMBER_WORD_AFTER = /^\s*(?:numaral[iı]|numara|nolu|no(?![\p{L}\p{N}]))/iu;

/** What a name found in text becomes: the pseudonym (only for a full name the caller may see) or a neutral word. */
export type LabelFor = (studentId: string) => string | null;
/** The neutral word for a name that must not be tied to a pseudonym (a name part, someone else's student, text the client sent). */
export const NAME_WITHHELD = '[name]';
export const NUMBER_WITHHELD = '[student no.]';

/**
 * Finds student names in any text (D-161), case- and accent-insensitively (ı/i and İ/I alike), whole
 * words only, so "Ali'nin" matches "Ali" but "Alice" does not:
 * - a full name becomes `label(id)` when exactly one student has it and the caller may see that student,
 *   otherwise the neutral `[name]`;
 * - a single name part (given or family name), in any case, becomes `[name]`; never a pseudonym, so a
 *   predictable text (a teacher's or the school's name) cannot reveal which child is "Student N". The
 *   few parts in `COMMON_WORD_NAMES` count only when capitalised;
 * - capitalised names and full names also match with a Turkish case ending and no apostrophe
 *   ("Elifin" → "[name]'in");
 * - student numbers (four or more digits, or any length after "no" / before "numara") become `[student no.]`.
 * Misspelt names, nicknames, former names and the names of erased students are not known here.
 */
export class NameScrubber {
  private re: RegExp | null;
  private entries = new Map<string, NameEntry>();
  private numbers = new Set<string>();
  constructor(rows: ReadonlyArray<{ id: string; fullName: string; givenNames: string | null; familyName: string | null; studentNumber?: string | null }>) {
    const add = (text: string, id: string, full: boolean) => {
      const key = foldSameLength(text.normalize('NFC').trim().replace(/\s+/gu, ' '));
      if (key.length < 2) return;
      const e = this.entries.get(key) ?? { ids: new Set<string>(), full };
      e.ids.add(id);
      e.full = e.full || full;
      this.entries.set(key, e);
    };
    for (const r of rows) {
      add(r.fullName, r.id, true);
      const parts = new Set([...r.fullName.split(/\s+/u), ...(r.givenNames ?? '').split(/\s+/u), ...(r.familyName ?? '').split(/\s+/u)]);
      for (const p of parts) if (p.trim().length >= 2) add(p, r.id, false);
      const n = r.studentNumber?.trim();
      if (n) this.numbers.add(foldSameLength(n));
    }
    const keys = [...this.entries.keys()].sort((a, b) => b.length - a.length).map((k) => escapeRe(k).replace(/ /gu, '\\s+'));
    this.re = keys.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${keys.join('|')})(${SUFFIX})?(?![\\p{L}\\p{N}])`, 'gu') : null;
  }

  /** `text` with every student name (and student number) replaced; see the class comment. */
  scrub(text: string, label: LabelFor): string {
    const src = this.scrubNumbers(text.normalize('NFC'));
    if (!this.re) return src;
    const folded = foldSameLength(src);
    let out = '';
    let last = 0;
    this.re.lastIndex = 0;
    for (let m = this.re.exec(folded); m; m = this.re.exec(folded)) {
      const e = this.entries.get(m[1]!.replace(/\s+/gu, ' '));
      if (!e) continue;
      const first = src[m.index]!;
      const lower = first === first.toLocaleLowerCase('tr-TR') && first !== first.toLocaleUpperCase('tr-TR');
      const suffix = m[2] ? src.slice(m.index + m[1]!.length, m.index + m[0].length) : '';
      if (!e.full && lower && (suffix || COMMON_WORD_NAMES.has(m[1]!))) continue;
      const one = e.ids.size === 1 ? [...e.ids][0]! : null;
      const replacement = (e.full && one ? label(one) : null) ?? NAME_WITHHELD;
      out += src.slice(last, m.index) + replacement + (suffix ? `'${suffix}` : '');
      last = m.index + m[0].length;
    }
    return last === 0 ? src : out + src.slice(last);
  }

  private scrubNumbers(src: string): string {
    if (!this.numbers.size) return src;
    // Whole numbers only, not parts of dates, times or decimals ("2026-11-09", "10:30", "2.5").
    return src.replace(/(?<![\p{L}\p{N}]|\p{N}[-./:,])\p{N}+(?![\p{L}\p{N}]|[-./:,]\p{N})/gu, (n, at: number) => {
      if (!this.numbers.has(foldSameLength(n))) return n;
      const flagged = n.length >= 4 || NUMBER_WORD_BEFORE.test(src.slice(Math.max(0, at - 12), at)) || NUMBER_WORD_AFTER.test(src.slice(at + n.length, at + n.length + 12));
      return flagged ? NUMBER_WITHHELD : n;
    });
  }
}

// ---------------------------------------------------------------- pseudonyms
/** "Student N" numbers for one token family, given in order of first appearance and never changed. */
export class Pseudonyms {
  private byStudent = new Map<string, number>();
  private byNumber = new Map<number, string>();
  private next: number;
  private db: Db;
  private familyId: string;
  private now: number;
  constructor(db: Db, familyId: string, now: number) {
    this.db = db;
    this.familyId = familyId;
    this.now = now;
    for (const r of db.select().from(mcpPseudonyms).where(eq(mcpPseudonyms.familyId, familyId)).all()) {
      this.byStudent.set(r.studentId, r.number);
      this.byNumber.set(r.number, r.studentId);
    }
    this.next = (db.select({ n: max(mcpPseudonyms.number) }).from(mcpPseudonyms).where(eq(mcpPseudonyms.familyId, familyId)).get()?.n ?? 0) + 1;
  }
  numberOf(studentId: string): number {
    const known = this.byStudent.get(studentId);
    if (known !== undefined) return known;
    const n = this.next++;
    this.db.insert(mcpPseudonyms).values({ familyId: this.familyId, studentId, number: n, createdAt: this.now }).run();
    this.byStudent.set(studentId, n);
    this.byNumber.set(n, studentId);
    return n;
  }
  label = (studentId: string) => `Student ${this.numberOf(studentId)}`;
  alias = (studentId: string) => `student-${this.numberOf(studentId)}`;
  studentOf = (n: number) => this.byNumber.get(n) ?? null;
}

// ---------------------------------------------------------------- the gate
export interface PrivacyEnv {
  mode: AiPrivacyMode;
  pseudonyms: Pseudonyms;
  /** Every student of the school (names are matched in any text). */
  directory: Map<string, { id: string; fullName: string }>;
  scrubber: NameScrubber;
  /** A full name found in text becomes this (the pseudonym) only for the caller's own students; others get a neutral word. */
  labelFor: LabelFor;
}

type StudentRowLite = { id: string; fullName: string; givenNames: string | null; familyName: string | null; studentNumber: string | null };

/** `own`: the students the caller may see (`ownStudentIds`); only their full names map to "Student N" inside text. */
export function privacyEnv(db: Db, familyId: string, mode: AiPrivacyMode, now: number, own: Set<string> | 'all'): PrivacyEnv {
  const rows: StudentRowLite[] = db
    .select({ id: students.id, fullName: students.fullName, givenNames: students.givenNames, familyName: students.familyName, studentNumber: students.studentNumber })
    .from(students)
    .all();
  const pseudonyms = new Pseudonyms(db, familyId, now);
  return {
    mode,
    pseudonyms,
    directory: new Map(rows.map((r) => [r.id, r])),
    scrubber: new NameScrubber(rows),
    labelFor: (id) => (own === 'all' || own.has(id) ? pseudonyms.label(id) : null),
  };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
/**
 * Kinds whose text is kept as it is in pseudonymous mode (only student ids in it become aliases): staff
 * names and data marked as not personal (school name, keys, static documents). Running the name
 * scrubber over them would turn a predictable text (a teacher called like a student) into a key that
 * reveals which child a pseudonym stands for.
 */
const KEPT_KINDS: readonly PiiKind[] = ['none', 'staffName'];

/** Student ids (whole value or inside text) → `student-N`. */
function idsToAliases(env: PrivacyEnv, s: string): string {
  if (env.directory.has(s)) return env.pseudonyms.alias(s);
  return s.replace(UUID, (m) => (env.directory.has(m.toLowerCase()) ? env.pseudonyms.alias(m.toLowerCase()) : m));
}

/** Pseudonymous mode, one free-text string: ids → aliases, then (unless kept) names → pseudonyms or `[name]`; ids are never scrubbed. */
function scrubText(env: PrivacyEnv, s: string, kind: PiiKind | undefined, label: LabelFor = env.labelFor): string {
  if (s === WITHHELD_TEXT) return s;
  if (env.directory.has(s)) return env.pseudonyms.alias(s);
  const keep = kind !== undefined && KEPT_KINDS.includes(kind);
  // Ids are cut out first, so the scrubber never touches them; the parts between are scrubbed.
  const chunk = (t: string) => (keep ? t : env.scrubber.scrub(t, label));
  let out = '';
  let last = 0;
  for (const m of s.matchAll(UUID)) {
    const id = m[0].toLowerCase();
    out += chunk(s.slice(last, m.index)) + (env.directory.has(id) ? env.pseudonyms.alias(id) : m[0]);
    last = m.index + m[0].length;
  }
  return out + chunk(s.slice(last));
}

/** Which student a name field is about: its sibling id, else a unique full-name match. */
function studentIdFor(env: PrivacyEnv, name: string, parent: Record<string, unknown> | undefined): string | null {
  for (const k of ['studentId', 'id']) {
    const v = parent?.[k];
    if (typeof v === 'string' && env.directory.has(v)) return v;
  }
  const fold = foldSameLength(name.normalize('NFC').trim());
  const hits = [...env.directory.values()].filter((s) => foldSameLength(s.fullName) === fold);
  return hits.length === 1 ? hits[0]!.id : null;
}

/** One string value. `free`: a string field (free text), not an enum or literal the server defined. */
function leaf(env: PrivacyEnv, value: string, kind: PiiKind | undefined, parent: Record<string, unknown> | undefined, free = true): unknown {
  if (kind && NEVER_LEAVES.includes(kind)) return REMOVE;
  const pseudo = env.mode === 'pseudonymous';
  const studentText = kind === 'studentText' || (kind === 'authoredText' && (parent?.authorType === 'student' || parent?.src === 'student'));
  if (studentText) return pseudo ? WITHHELD_TEXT : { untrustedText: value };
  if (!pseudo) return value;
  if (kind === 'studentName') {
    const id = studentIdFor(env, value, parent);
    return id ? env.pseudonyms.label(id) : UNKNOWN_STUDENT;
  }
  if (kind === 'studentInitials') {
    const id = studentIdFor(env, '', parent);
    return id ? `S${env.pseudonyms.numberOf(id)}` : 'S';
  }
  return free ? scrubText(env, value, kind) : idsToAliases(env, value);
}

/** A key of a record or of an unknown object (it may be a student id or a name). */
const keyOf = (env: PrivacyEnv, k: string) => (env.mode === 'pseudonymous' ? scrubText(env, k, undefined) : k);

/** Applies the marks of `schema` to `value` (already parsed by the same schema, so it is an allow-list result). */
function walk(env: PrivacyEnv, schema: z.ZodType, value: unknown, inherited: PiiKind | undefined, parent: Record<string, unknown> | undefined): unknown {
  const own = piiOf(schema);
  if (own && NEVER_LEAVES.includes(own)) return REMOVE;
  const kind = own ?? inherited;
  const def = defOf(schema);
  if (value === null || value === undefined) return value;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return walk(env, def.innerType as z.ZodType, value, kind, parent);
    case 'pipe':
      return walk(env, def.out as z.ZodType, value, kind, parent);
    case 'lazy':
      return walk(env, (def.getter as () => z.ZodType)(), value, kind, parent);
    case 'object': {
      if (!isRecord(value)) return value;
      const shape = def.shape as Record<string, z.ZodType>;
      const catchall = def.catchall as z.ZodType | undefined;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        const field = shape[k] ?? catchall;
        const r = field ? walk(env, field, v, kind, value) : deep(env, v, kind, value);
        if (r !== REMOVE) out[shape[k] ? k : keyOf(env, k)] = r;
      }
      return out;
    }
    case 'array':
      return Array.isArray(value) ? value.map((v) => walk(env, def.element as z.ZodType, v, kind, parent)).filter((v) => v !== REMOVE) : value;
    case 'tuple':
      return Array.isArray(value) ? value.map((v, i) => walk(env, ((def.items as z.ZodType[])[i] ?? def.rest ?? z.unknown()) as z.ZodType, v, kind, parent)).filter((v) => v !== REMOVE) : value;
    case 'record': {
      if (!isRecord(value)) return value;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        const r = walk(env, def.valueType as z.ZodType, v, kind, value);
        if (r !== REMOVE) out[keyOf(env, k)] = r;
      }
      return out;
    }
    case 'union': {
      const options = def.options as z.ZodType[];
      const option = options.find((o) => o.safeParse(value).success) ?? options[0];
      return option ? walk(env, option, value, kind, parent) : deep(env, value, kind, parent);
    }
    case 'string':
    case 'template_literal':
      return typeof value === 'string' ? leaf(env, value, kind, parent) : value;
    case 'enum':
    case 'literal':
      return typeof value === 'string' ? leaf(env, value, kind, parent, false) : value;
    default:
      return deep(env, value, kind, parent);
  }
}

/** Unknown structure (z.unknown, catch-all fields): every string inside gets the inherited mark. */
function deep(env: PrivacyEnv, value: unknown, kind: PiiKind | undefined, parent: Record<string, unknown> | undefined): unknown {
  if (kind && NEVER_LEAVES.includes(kind)) return REMOVE;
  if (typeof value === 'string') return leaf(env, value, kind, parent);
  if (Array.isArray(value)) return value.map((v) => deep(env, v, kind, parent)).filter((v) => v !== REMOVE);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = deep(env, v, kind, value);
      if (r !== REMOVE) out[keyOf(env, k)] = r;
    }
    return out;
  }
  return value;
}

/**
 * The result as it may leave the school: marks applied; in pseudonymous mode student ids become
 * aliases and names in free text (every kind except `none` and `staffName`) are replaced.
 */
export function privateResult(env: PrivacyEnv, schema: z.ZodType, value: unknown): unknown {
  const marked = walk(env, schema, value, undefined, undefined);
  return marked === REMOVE ? null : marked;
}

/**
 * A server message that may quote stored data or the request (tool errors): in pseudonymous mode every
 * name in it becomes the neutral `[name]` (never a pseudonym, so a message cannot be used to map a
 * guessed name to "Student N").
 */
export function privateMessage(env: PrivacyEnv, text: string): string {
  return env.mode === 'pseudonymous' ? scrubText(env, text, undefined, () => null) : text;
}

// ---------------------------------------------------------------- input aliases
const ALIAS = /^student-(\d{1,7})$/u;

/** The students an account may name through an alias: an administrator any, a teacher those of the classes they teach. */
export function ownStudentIds(db: Db, user: UserRow): Set<string> | 'all' {
  if (user.role === 'admin') return 'all';
  const rows = db
    .selectDistinct({ id: enrolments.studentId })
    .from(enrolments)
    .innerJoin(teachingContexts, and(eq(teachingContexts.classId, enrolments.classId), eq(teachingContexts.teacherId, user.id), isNull(teachingContexts.endedAt)))
    .all();
  return new Set(rows.map((r) => r.id));
}

/**
 * Tool input with `student-N` aliases replaced by the student's id, only when the alias belongs to
 * this token family and the student is one of the caller's own (otherwise it stays as typed and the
 * endpoint answers "not found").
 */
export function resolveAliases(env: PrivacyEnv, own: Set<string> | 'all', value: unknown): unknown {
  if (typeof value === 'string') {
    const m = ALIAS.exec(value.trim());
    if (!m) return value;
    const id = env.pseudonyms.studentOf(Number(m[1]));
    return id && (own === 'all' || own.has(id)) ? id : value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveAliases(env, own, v));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveAliases(env, own, v)]));
  return value;
}

// ---------------------------------------------------------------- classification (test-enforced)
/** Field names that hold ids, keys, dates or codes, never personal data. */
const NON_PERSONAL_KEY = /^(?:id|key|date|today|from|to|timezone|status)$|(?:Id|Ids|Key|On|Date)$/u;

/**
 * Paths of string (or unknown) fields in `schema` that carry no `pii()` mark and whose name is not an
 * id, key or date (D-161). The classification test fails on any of them in an MCP-exposed output.
 */
export function unmarkedStrings(schema: z.ZodType, path = '$', key = '', marked = false, seen = new Set<z.ZodType>()): string[] {
  const isMarked = marked || piiOf(schema) !== undefined;
  const def = defOf(schema);
  const next = (s: unknown, p = path, k = key) => unmarkedStrings(s as z.ZodType, p, k, isMarked, seen);
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return next(def.innerType);
    case 'pipe':
      return next(def.out);
    case 'lazy':
      if (seen.has(schema)) return [];
      seen.add(schema);
      return next((def.getter as () => z.ZodType)());
    case 'object':
      return [
        ...Object.entries(def.shape as Record<string, z.ZodType>).flatMap(([k, v]) => next(v, `${path}.${k}`, k)),
        ...(def.catchall && defOf(def.catchall as z.ZodType).type !== 'never' ? next(def.catchall, `${path}.*`, '*') : []),
      ];
    case 'array':
      return next(def.element, `${path}[]`);
    case 'tuple':
      return (def.items as z.ZodType[]).flatMap((s, i) => next(s, `${path}[${i}]`));
    case 'record':
      return next(def.valueType, `${path}{}`);
    case 'union':
      return [...new Set((def.options as z.ZodType[]).flatMap((o) => next(o)))];
    case 'intersection':
      return [...next(def.left), ...next(def.right)];
    case 'string':
    case 'template_literal':
    case 'unknown':
    case 'any':
      return isMarked || NON_PERSONAL_KEY.test(key) ? [] : [path];
    default:
      return [];
  }
}
