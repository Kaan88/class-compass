/**
 * Student list importer (S9: IMP-1..7, D-013, DAT-5).
 *
 * - Access: teachers import into classes they teach (and see/revert their own batches), admins into
 *   any class. Archived classes and years are read-only (DAT-1).
 * - Matching (IMP-4): the same student number = a `match` suggestion; a similar name without a number
 *   match = `possible_match`, which the teacher must decide before committing. Nothing is merged
 *   silently; a number that belongs to a student the teacher cannot see is reported, not used.
 * - Re-import (IMP-5): matched rows change nothing destructive. The only update is filling a missing
 *   student number, and only when the teacher ticked it for that row. No duplicates are created.
 * - Revert (IMP-5, DAT-5): what the batch created is removed when nothing refers to it since;
 *   otherwise the student is deactivated / the enrolment closed and the row reports it. Audited.
 * - Several classes in one file (S20c, D-171): `previewSplit` groups the rows by the class column
 *   and matches each class name to the caller's writable classes; `createSplit` makes one ordinary
 *   draft batch per chosen class (same preview, confirm, report, audit and undo per class), linked by
 *   a split id kept in the batch's mapping JSON with the file's class labels for that class, and the
 *   rows that are also listed under another class of the file (`crossClass`, flagged on every check).
 *   A split list is read up to MAX_SPLIT_ROWS rows and refused when it is longer; each class made from
 *   it has at most MAX_IMPORT_ROWS rows (never a class cut short without saying so). Once the batches
 *   are made the uploaded file's bytes are deleted (each batch keeps its own rows): the file names
 *   children of skipped classes, whom student erasure could not find through any batch row.
 */
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/import.ts';
import type { ImportBatch, ImportClassGroup, ImportFlag, ImportMapping, ImportRow, ImportSplit } from '../../../shared/contracts/import.ts';
import { foldForSearch } from '../../../shared/text/turkish.ts';
import {
  classKey,
  classLabelKey,
  classifyRows,
  crossClassDuplicates,
  splitByClass,
  type CrossClassKind,
  type ClassGroup,
  columnLabels,
  inferMapping,
  LOW_CONFIDENCE,
  markDuplicates,
  MAX_IMPORT_ROWS,
  MAX_SPLIT_ROWS,
  nameSimilarity,
  parseCells,
  POSSIBLE_MATCH,
  type ClassifiedRow,
  type Mapping,
  type Parsed,
  type SourceRow,
} from '../../../domain/importing.ts';
import { tx, type Db } from '../../db/client.ts';
import { assistantAssignments, assistantDutyChecks, attendanceDaily, attendanceLessonExceptions, classes, counterEvents, enrolments, files, homeworkAssignments, homeworkMarkChanges, homeworkMarks, importBatches, importRows, lessons, mcpPseudonyms, notifications, pairConstraints, pointEvents, schoolYears, studentAchievements, studentSubjectLevels, students, teachingContexts, textCheckAttempts, type ImportCandidateJson, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.ts';
import { hasPictureSince } from '../avatars/pictures.ts';
import { assertCanReadFile, deleteFileRow, getFileRow } from '../files/service.ts';
import { storagePath } from '../files/storage.ts';
import { assertClassWritable, assertTeachesClass, defaultEnrolmentDate, getClass, isClassWritable, todayFor, type ClassRow } from '../school/policy.ts';
import { taughtClassIds } from '../school/service.ts';
import { GOALS_HISTORY_TABLES, goalsHistorySince } from '../goals/history.ts';
import { SELECTIONS_TABLE_NAME, studentInContextSelections } from '../secret/service.ts';
import { createStudentInClass, liveClassIdsOf, liveEnrolmentsOf } from '../students/service.ts';
import { discardUnusedAutoLinks } from '../links/service.ts';
import { extractFile, extractPaste, listSheets as listWorkbookSheets, type Extracted } from './parsers/index.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type BatchRow = typeof importBatches.$inferSelect;
/**
 * The mapping as stored: the field columns plus, for a split batch (D-171), its split id, class labels
 * and the batch rows (by idx) that are also listed under another class of the same file.
 */
type StoredMapping = Mapping & { splitId?: string; classLabels?: string[]; crossClass?: Record<string, CrossClassKind> };
const fieldMapping = (m: StoredMapping): ImportMapping => ({
  headerRow: m.headerRow,
  fullName: m.fullName,
  givenNames: m.givenNames,
  familyName: m.familyName,
  studentNumber: m.studentNumber,
  className: m.className,
});
const splitPart = (m: StoredMapping): Pick<StoredMapping, 'splitId' | 'classLabels' | 'crossClass'> =>
  m.splitId ? { splitId: m.splitId, classLabels: m.classLabels ?? [], ...(m.crossClass ? { crossClass: m.crossClass } : {}) } : {};
type RowRow = typeof importRows.$inferSelect;
type StudentRow = typeof students.$inferSelect;

// ---------------------------------------------------------------- access
const isAdmin = (ctx: RequestContext) => requireUser(ctx).role === 'admin';

function visibleClasses(ctx: RequestContext): string[] | 'all' {
  return isAdmin(ctx) ? 'all' : taughtClassIds(ctx.db, requireUser(ctx).id);
}

/** Teachers: a class they teach; admins: any class. Always writable (DAT-1). */
function assertCanImportInto(ctx: RequestContext, classId: string): ClassRow {
  const cls = isAdmin(ctx) ? getClass(ctx.db, classId) : assertTeachesClass(ctx, classId);
  assertClassWritable(ctx.db, cls);
  return cls;
}

/** The batch, if the caller may see it: admins any; teachers their own, in a class they still teach. */
function loadBatch(ctx: RequestContext, batchId: string): { batch: BatchRow; cls: ClassRow } {
  const batch = ctx.db.select().from(importBatches).where(eq(importBatches.id, batchId)).get();
  if (!batch) throw notFound('Import');
  if (!isAdmin(ctx)) {
    if (batch.createdBy !== requireUser(ctx).id) throw notFound('Import');
    assertTeachesClass(ctx, batch.targetClassId);
  }
  return { batch, cls: getClass(ctx.db, batch.targetClassId) };
}

// ---------------------------------------------------------------- matching pool
interface Pool {
  /** Every student with a number (to tell "number of a student you cannot see" apart). */
  byNumber: Map<string, StudentRow>;
  /** Students the caller may see (name candidates). */
  visible: Array<StudentRow & { className: string | null; fold: string }>;
  visibleIds: Set<string>;
  /**
   * Folded names (and their word-order-free form) of students the caller may NOT see: other
   * classes, no class this year, deactivated. Only ever used as "exists elsewhere" (ACC-4, D-022).
   */
  hiddenNames: Set<string>;
}

const wordOrderFree = (fold: string) => fold.split(' ').filter(Boolean).sort().join(' ');

function buildPool(ctx: RequestContext): Pool {
  const all = ctx.db.select().from(students).all();
  const byNumber = new Map(all.filter((s) => s.studentNumber).map((s) => [s.studentNumber!, s]));
  const vis = visibleClasses(ctx);
  const classNames = new Map(ctx.db.select({ id: classes.id, name: classes.name }).from(classes).all().map((c) => [c.id, c.name]));
  const visible: Pool['visible'] = [];
  const hiddenNames = new Set<string>();
  for (const s of all) {
    const live = liveClassIdsOf(ctx, s.id);
    if (vis !== 'all' && !live.some((c) => vis.includes(c))) {
      hiddenNames.add(s.nameFold);
      hiddenNames.add(wordOrderFree(s.nameFold));
      continue;
    }
    const cid = (vis === 'all' ? live : live.filter((c) => vis.includes(c)))[0] ?? null;
    visible.push({ ...s, className: cid ? (classNames.get(cid) ?? null) : null, fold: s.nameFold });
  }
  return { byNumber, visible, visibleIds: new Set(visible.map((s) => s.id)), hiddenNames };
}

const candidateOf = (s: Pool['visible'][number], score: number): ImportCandidateJson => ({
  id: s.id,
  fullName: s.fullName,
  className: s.className,
  studentNumber: s.studentNumber,
  active: s.deactivatedAt === null,
  score: Math.round(score * 100) / 100,
});

// ---------------------------------------------------------------- evaluation
interface RowState {
  id: string;
  idx: number;
  raw: string[];
  page: number | null;
  confidence: number | null;
  parsed: Parsed;
  heading: boolean;
  /** Looks like a heading only by a generic word that can be a name: flagged, skipped by default. */
  weakHeading: boolean;
  edited: boolean;
  decision: 'add' | 'match' | 'skip';
  decisionSource: 'auto' | 'teacher';
  matchedStudentId: string | null;
  fillNumber: boolean;
  flags: ImportFlag[];
  candidates: ImportCandidateJson[];
  repeat: boolean;
}

/**
 * Flags, candidates and suggested decisions for every row (IMP-2, IMP-4). A decision the teacher
 * chose is kept as long as it still makes sense (a matched student must still be a candidate).
 */
function evaluate(ctx: RequestContext, cls: ClassRow, mapping: StoredMapping, rows: RowState[], pool: Pool): void {
  const target = classKey(cls.name);
  // A split batch (D-171): the file's labels chosen for this class are not "another class".
  const chosen = new Set((mapping.classLabels ?? []).map((l) => classLabelKey(l)).filter((k): k is string => k !== null));
  for (const r of rows) {
    const f: ImportFlag[] = [];
    if (r.heading) f.push('heading_ignored');
    else {
      if (r.weakHeading) f.push('possible_heading');
      if (!/\p{L}/u.test(r.parsed.fullName)) f.push('missing_name');
      if (mapping.studentNumber !== null && !r.parsed.studentNumber) f.push('missing_number');
      if (r.confidence !== null && r.confidence < LOW_CONFIDENCE) f.push('low_confidence');
      const k = r.parsed.className ? classKey(r.parsed.className) : null;
      if (target && k && k !== target && !chosen.has(classLabelKey(r.parsed.className) ?? '')) f.push('class_mismatch');
    }
    r.flags = f;
  }
  // Duplicates within the file (domain rule, shared with the pure tests).
  const view: ClassifiedRow[] = rows.map((r) => ({ source: r.idx, cells: r.raw, page: r.page, confidence: r.confidence, heading: r.heading, possibleHeading: r.weakHeading, parsed: r.parsed, flags: r.flags, repeat: false }));
  markDuplicates(view);
  view.forEach((v, i) => {
    rows[i]!.flags = v.flags as ImportFlag[];
    rows[i]!.repeat = v.repeat;
  });
  // A split batch (D-171): rows also listed under another class of the same file.
  for (const r of rows) {
    const k = r.heading ? undefined : mapping.crossClass?.[String(r.idx)];
    if (k === 'same_name') {
      if (!r.flags.includes('same_name_in_file')) r.flags.push('same_name_in_file');
    } else if (k) {
      r.flags.push('duplicate_other_class');
      if (k === 'repeat') r.repeat = true;
    }
  }

  for (const r of rows) {
    r.candidates = [];
    let auto: { decision: RowState['decision']; matched: string | null } = { decision: 'add', matched: null };
    if (r.heading || r.flags.includes('missing_name')) auto = { decision: 'skip', matched: null };
    else {
      const num = r.parsed.studentNumber;
      const byNum = num ? pool.byNumber.get(num) : undefined;
      if (byNum && pool.visibleIds.has(byNum.id)) {
        r.flags.push('number_match');
        const s = pool.visible.find((v) => v.id === byNum.id)!;
        const score = nameSimilarity(r.parsed.fullName, s.fullName);
        r.candidates = [candidateOf(s, score)];
        // Suggested, but a number whose name does not fit (a list position read as a number, an OCR
        // misreading) needs the teacher's choice like a possible match (IMP-4).
        if (score < POSSIBLE_MATCH) r.flags.push('number_conflict');
        auto = { decision: 'match', matched: s.id };
      } else if (byNum) {
        // The number belongs to a student in a class the teacher does not teach (ACC-4): report only.
        r.flags.push('number_elsewhere');
        auto = { decision: 'skip', matched: null };
      } else {
        const fold = foldForSearch(r.parsed.fullName);
        const scored = pool.visible
          .map((s) => ({ s, score: s.fold === fold ? 1 : nameSimilarity(r.parsed.fullName, s.fullName) }))
          .filter((x) => x.score >= POSSIBLE_MATCH)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        if (scored.length) {
          r.flags.push('possible_match');
          r.candidates = scored.map((x) => candidateOf(x.s, x.score));
          const best = scored[0]!;
          // Suggest the existing student only for (nearly) the same name; the teacher must still choose.
          auto = best.score >= 0.95 ? { decision: 'match', matched: best.s.id } : { decision: 'add', matched: null };
        }
        // The same name outside the caller's classes (D-022, ACC-4): reported as a flag only, never
        // with the student's details, and it needs the teacher's choice before a new student is made.
        if (fold && (pool.hiddenNames.has(fold) || pool.hiddenNames.has(wordOrderFree(fold)))) r.flags.push('name_elsewhere');
      }
      // Second copies of a duplicate, rows of another class and probable headings are skipped unless
      // the teacher says otherwise.
      if (r.repeat || r.flags.includes('class_mismatch') || r.flags.includes('possible_heading')) auto = { decision: 'skip', matched: null };
    }
    const keep =
      r.decisionSource === 'teacher' &&
      (r.decision !== 'match' || (r.matchedStudentId !== null && r.candidates.some((c) => c.id === r.matchedStudentId))) &&
      !(r.decision !== 'skip' && (r.heading || r.flags.includes('missing_name')));
    if (!keep) {
      r.decision = auto.decision;
      r.matchedStudentId = auto.matched;
      r.decisionSource = 'auto';
    }
    if (r.decision !== 'match') {
      r.matchedStudentId = null;
      r.fillNumber = false;
    }
  }
}

/**
 * Rows the teacher must decide before committing (IMP-4: never a silent merge, never a silent
 * second identity): a similar name in their classes, the same name outside them, a number whose name
 * differs, or a number match read by OCR with low confidence. Skipped rows need nothing.
 */
const CHOICE_FLAGS: readonly ImportFlag[] = ['possible_match', 'name_elsewhere', 'number_conflict', 'duplicate_other_class'];
const needsChoice = (r: Pick<RowState, 'flags' | 'decisionSource' | 'decision'>) =>
  r.decisionSource !== 'teacher' &&
  r.decision !== 'skip' &&
  (r.flags.some((f) => CHOICE_FLAGS.includes(f)) || (r.flags.includes('number_match') && r.flags.includes('low_confidence')));

function canFillNumber(r: Pick<RowState, 'decision' | 'matchedStudentId' | 'parsed' | 'candidates'>): boolean {
  if (r.decision !== 'match' || !r.matchedStudentId || !r.parsed.studentNumber) return false;
  const c = r.candidates.find((x) => x.id === r.matchedStudentId);
  return Boolean(c && !c.studentNumber);
}

function draftCounts(rows: RowState[]): Record<string, number> {
  return {
    rows: rows.length,
    add: rows.filter((r) => r.decision === 'add').length,
    match: rows.filter((r) => r.decision === 'match').length,
    skip: rows.filter((r) => r.decision === 'skip').length,
    flagged: rows.filter((r) => r.flags.some((f) => f !== 'heading_ignored')).length,
    needsChoice: rows.filter(needsChoice).length,
  };
}

// ---------------------------------------------------------------- persistence helpers
function stateOf(r: RowRow): RowState {
  return {
    id: r.id,
    idx: r.idx,
    raw: r.rawJson,
    page: r.page,
    confidence: r.ocrConfidence,
    parsed: r.parsedJson,
    heading: r.flagsJson.includes('heading_ignored'),
    weakHeading: r.flagsJson.includes('possible_heading'),
    edited: r.edited,
    decision: r.decision,
    decisionSource: r.decisionSource,
    matchedStudentId: r.matchedStudentId,
    fillNumber: r.fillNumber,
    flags: r.flagsJson,
    candidates: r.candidatesJson,
    repeat: false,
  };
}

function rowsOf(db: Db, batchId: string): RowRow[] {
  return db.select().from(importRows).where(eq(importRows.batchId, batchId)).all().sort((a, b) => a.idx - b.idx);
}

function saveStates(db: Db, states: RowState[]): void {
  for (const r of states) {
    db.update(importRows)
      .set({
        parsedJson: r.parsed,
        edited: r.edited,
        flagsJson: r.flags,
        candidatesJson: r.candidates,
        decision: r.decision,
        decisionSource: r.decisionSource,
        matchedStudentId: r.matchedStudentId,
        fillNumber: r.fillNumber,
      })
      .where(eq(importRows.id, r.id))
      .run();
  }
}

function rowDto(r: RowRow): ImportRow {
  const s = stateOf(r);
  return {
    id: r.id,
    idx: r.idx,
    raw: r.rawJson,
    page: r.page,
    parsed: r.parsedJson,
    edited: r.edited,
    ocrConfidence: r.ocrConfidence,
    flags: r.flagsJson,
    candidates: r.candidatesJson,
    decision: r.decision,
    decisionSource: r.decisionSource,
    needsChoice: r.outcome === null && needsChoice(s),
    matchedStudentId: r.matchedStudentId,
    canFillNumber: r.outcome === null && canFillNumber(s),
    fillNumber: r.fillNumber,
    outcome: r.outcome,
    reason: r.reason,
    revertOutcome: r.revertOutcome,
  };
}

function summaryOf(db: Db, b: BatchRow) {
  const cls = db.select({ name: classes.name }).from(classes).where(eq(classes.id, b.targetClassId)).get();
  const by = db.select({ name: users.displayName }).from(users).where(eq(users.id, b.createdBy)).get();
  let fileName: string | null = null;
  if (b.fileId) fileName = db.select({ name: files.originalName }).from(files).where(eq(files.id, b.fileId)).get()?.name ?? null;
  return {
    id: b.id,
    sourceType: b.sourceType,
    fileName,
    classId: b.targetClassId,
    className: cls?.name ?? '',
    status: b.status,
    counts: b.countsJson,
    createdAt: b.createdAt,
    createdByName: by?.name ?? '',
    committedAt: b.committedAt,
    revertedAt: b.revertedAt,
    split: b.mappingJson.splitId ? { id: b.mappingJson.splitId, labels: b.mappingJson.classLabels ?? [] } : null,
  };
}

function batchDto(db: Db, batchId: string): ImportBatch {
  const b = db.select().from(importBatches).where(eq(importBatches.id, batchId)).get()!;
  return { ...summaryOf(db, b), columns: b.columnsJson, mapping: fieldMapping(b.mappingJson), notices: b.noticesJson, sheets: b.sheetsJson ?? null, rows: rowsOf(db, b.id).map(rowDto) };
}

function touch(ctx: RequestContext, batchId: string, states: RowState[]) {
  ctx.db.update(importBatches).set({ countsJson: draftCounts(states), updatedAt: ctx.now() }).where(eq(importBatches.id, batchId)).run();
}

function assertDraft(b: BatchRow) {
  if (b.status !== 'draft') throw conflict('This import has already been applied', { reason: 'IMPORT_NOT_DRAFT' });
}

// ---------------------------------------------------------------- create
export async function createBatch(ctx: RequestContext, input: In<typeof C.createImportBatch>): Promise<ImportBatch> {
  const cls = assertCanImportInto(ctx, input.classId);
  const read = await readSource(ctx, input);
  const mapping = inferMapping(read.source);
  return tx(ctx.db, () => {
    assertClassWritable(ctx.db, cls);
    return batchDto(ctx.db, insertDraft(ctx, cls, read, read.source, mapping, buildPool(ctx)));
  });
}

interface ReadSource {
  extracted: Extracted;
  fileId: string | null;
  fileName: string | null;
  /** The extracted rows without blank rows, in file order. */
  source: SourceRow[];
}

/** Extract the rows of pasted text or an uploaded `import_source` file the caller may read. */
async function readSource(ctx: RequestContext, input: { text?: string | undefined; fileId?: string | undefined; sheets?: string[] | undefined }, maxRows: number = MAX_IMPORT_ROWS): Promise<ReadSource> {
  let extracted: Extracted;
  let fileId: string | null = null;
  let fileName: string | null = null;
  if (input.fileId) {
    const f = assertCanReadFile(ctx, input.fileId);
    if (f.kind !== 'import_source') throw invalid('This file is not a student list upload', { reason: 'NOT_AN_IMPORT_FILE' });
    fileId = f.id;
    fileName = f.originalName;
    extracted = await extractFile(ctx.config, { path: storagePath(ctx.config, f.storageKey), mime: f.sniffedMime, name: f.originalName }, { sheets: input.sheets, maxRows });
  } else {
    if (!input.text?.trim()) throw invalid('Paste a list first', { reason: 'IMPORT_EMPTY' });
    extracted = extractPaste(input.text, maxRows);
  }
  // Blank rows are dropped here; the remaining rows keep their order (idx).
  const source: SourceRow[] = extracted.rows.filter((r) => r.cells.some((c) => c.trim()));
  if (!source.some((r) => r.cells.some((c) => /\p{L}/u.test(c)))) throw invalid('No names were found', { reason: 'IMPORT_NO_ROWS' });
  return { extracted, fileId, fileName, source };
}

/** Insert a draft batch for `cls` from `source` under `mapping` (inside the caller's transaction); returns its id. */
function insertDraft(ctx: RequestContext, cls: ClassRow, read: Pick<ReadSource, 'extracted' | 'fileId'>, source: SourceRow[], mapping: StoredMapping, pool: Pool): string {
  const { extracted, fileId } = read;
  const classified = classifyRows(source, mapping, { targetClassName: cls.name });
  const now = ctx.now();
  const user = requireUser(ctx);
  const batchId = newId();
  {
    const states: RowState[] = classified.map((c, i) => ({
      id: newId(),
      idx: i,
      raw: c.cells,
      page: c.page,
      confidence: c.confidence === null ? null : Math.round(c.confidence),
      parsed: c.parsed,
      heading: c.heading,
      weakHeading: c.possibleHeading,
      edited: false,
      decision: 'add',
      decisionSource: 'auto',
      matchedStudentId: null,
      fillNumber: false,
      flags: [],
      candidates: [],
      repeat: false,
    }));
    evaluate(ctx, cls, mapping, states, pool);
    ctx.db
      .insert(importBatches)
      .values({
        id: batchId,
        sourceType: extracted.sourceType,
        fileId,
        targetClassId: cls.id,
        schoolYearId: cls.schoolYearId,
        createdBy: user.id,
        status: 'draft',
        columnsJson: columnLabels(source, mapping),
        mappingJson: mapping,
        noticesJson: extracted.notices,
        countsJson: draftCounts(states),
        sheetsJson: extracted.sheets,
        createdAt: now,
        updatedAt: now,
        committedAt: null,
        committedBy: null,
        revertedAt: null,
        revertedBy: null,
      })
      .run();
    for (const s of states) {
      ctx.db
        .insert(importRows)
        .values({
          id: s.id,
          batchId,
          idx: s.idx,
          rawJson: s.raw,
          page: s.page,
          parsedJson: s.parsed,
          edited: false,
          ocrConfidence: s.confidence,
          flagsJson: s.flags,
          candidatesJson: s.candidates,
          decision: s.decision,
          decisionSource: s.decisionSource,
          matchedStudentId: s.matchedStudentId,
          fillNumber: false,
          filledNumber: false,
          createdStudentId: null,
          createdEnrolmentId: null,
          outcome: null,
          reason: null,
          revertOutcome: null,
        })
        .run();
    }
    audit(
      ctx.db,
      ctx.actor,
      { action: 'import.create', entity: 'import_batch', entityId: batchId, after: { classId: cls.id, sourceType: extracted.sourceType, fileId, rows: states.length, ...(mapping.splitId ? { splitId: mapping.splitId } : {}) } },
      now,
    );
  }
  return batchId;
}

// ---------------------------------------------------------------- several classes in one file (S20c, D-171)
/** The classes the caller may import into: admins every writable class, teachers the writable classes they teach. */
function importableClasses(ctx: RequestContext): ClassRow[] {
  const vis = visibleClasses(ctx);
  return ctx.db
    .select()
    .from(classes)
    .all()
    .filter((c) => (vis === 'all' || vis.includes(c.id)) && isClassWritable(ctx.db, c));
}

type PlannedGroup = ClassGroup & Omit<ImportClassGroup, 'rows' | 'key' | 'labels' | 'alsoElsewhere' | 'sameNameElsewhere'>;

/**
 * Rows of `source` also listed under another class (D-171), with `classOf` giving each row's class
 * (null: not imported). Keys are source row indices.
 */
function crossClassOf(source: SourceRow[], mapping: Mapping, classOf: (i: number) => string | null) {
  return crossClassDuplicates(classifyRows(source, mapping), classOf);
}

async function planSplit(ctx: RequestContext, input: In<typeof C.previewImportSplit>): Promise<ReadSource & { mapping: Mapping; groups: PlannedGroup[] }> {
  // The whole list is read further than one class (D-171); a list cut short is refused, so no class
  // is ever made from part of its rows.
  const read = await readSource(ctx, input, MAX_SPLIT_ROWS);
  if (read.extracted.notices.includes('TOO_MANY_ROWS')) throw invalid('This list is too long to split', { reason: 'IMPORT_SPLIT_TOO_MANY_ROWS', max: MAX_SPLIT_ROWS });
  const mapping = inferMapping(read.source);
  if (mapping.className === null) throw invalid('No class column was found in this list', { reason: 'IMPORT_NO_CLASS_COLUMN' });
  const options = importableClasses(ctx);
  const years = new Map(ctx.db.select({ id: schoolYears.id, name: schoolYears.name }).from(schoolYears).all().map((y) => [y.id, y.name]));
  const groups = splitByClass(read.source, mapping).map((g): PlannedGroup => {
    if (!g.key) return { ...g, status: 'none', classId: null, className: null, candidateIds: [], candidates: [] };
    const found = options.filter((c) => classLabelKey(c.name) === g.key);
    if (found.length === 1) return { ...g, status: 'matched', classId: found[0]!.id, className: found[0]!.name, candidateIds: [], candidates: [] };
    return {
      ...g,
      status: found.length ? 'ambiguous' : 'unknown',
      classId: null,
      className: null,
      candidateIds: found.map((c) => c.id),
      candidates: found.map((c) => ({ id: c.id, name: c.name, yearName: years.get(c.schoolYearId) ?? '' })),
    };
  });
  return { ...read, mapping, groups };
}

/** Group the rows of a source by its class column, matched to the caller's classes; nothing is saved. */
export async function previewSplit(ctx: RequestContext, input: In<typeof C.previewImportSplit>): Promise<ImportSplit> {
  const plan = await planSplit(ctx, input);
  // The same child (or the same name) under two classes of the list, before anything is chosen.
  const groupOf = new Map(plan.groups.flatMap((g) => g.rows.map((i) => [i, g.key] as const)));
  const cross = crossClassOf(plan.source, plan.mapping, (i) => groupOf.get(i) || null);
  const count = (g: PlannedGroup, kinds: CrossClassKind[]) => g.rows.filter((i) => kinds.includes(cross.get(i)!)).length;
  return {
    sourceType: plan.extracted.sourceType,
    fileName: plan.fileName,
    notices: plan.extracted.notices,
    sheets: plan.extracted.sheets,
    classColumn: columnLabels(plan.source, plan.mapping)[plan.mapping.className!] ?? '',
    scope: isAdmin(ctx) ? 'school' : 'taught',
    groups: plan.groups.map((g) => ({
      key: g.key,
      labels: g.labels,
      rows: g.rows.length,
      status: g.status,
      classId: g.classId,
      className: g.className,
      candidateIds: g.candidateIds,
      candidates: g.candidates,
      alsoElsewhere: count(g, ['duplicate', 'repeat']),
      sameNameElsewhere: count(g, ['same_name']),
    })),
  };
}

/**
 * One draft batch per chosen class, all in one transaction (all or none). Each keeps the rows above
 * the header (so the header row stays where the mapping says) and its own classes' rows in file
 * order. Audited per batch (`import.create` with the split id) and once for the split. The uploaded
 * source file is then deleted (`file.delete`; its row and name stay for the history).
 */
export async function createSplit(ctx: RequestContext, input: In<typeof C.createImportSplit>) {
  const plan = await planSplit(ctx, input);
  const keys = new Set(plan.groups.map((g) => g.key));
  const assign = new Map<string, string | null>();
  for (const a of input.assign) {
    if (!keys.has(a.key)) throw invalid('The classes in this list changed; read it again', { reason: 'IMPORT_SPLIT_CHANGED' });
    assign.set(a.key, a.classId);
  }
  const byClass = new Map<string, { cls: ClassRow; rows: number[]; labels: string[] }>();
  let skippedRows = 0;
  for (const g of plan.groups) {
    const classId = assign.has(g.key) ? assign.get(g.key)! : g.classId;
    if (!classId) {
      skippedRows += g.rows.length;
      continue;
    }
    const cls = assertCanImportInto(ctx, classId);
    const entry = byClass.get(cls.id) ?? { cls, rows: [], labels: [] };
    entry.rows.push(...g.rows);
    entry.labels.push(...g.labels.filter((l) => !entry.labels.includes(l)));
    byClass.set(cls.id, entry);
  }
  if (!byClass.size) throw invalid('Choose a class for at least one group of rows', { reason: 'IMPORT_SPLIT_NOTHING' });
  // One class still has at most MAX_IMPORT_ROWS rows (D-079): refused, never cut.
  for (const { cls, rows } of byClass.values()) {
    if (rows.length > MAX_IMPORT_ROWS) throw invalid('Too many rows for one class', { reason: 'IMPORT_SPLIT_CLASS_TOO_BIG', className: cls.name, max: MAX_IMPORT_ROWS });
  }
  const header = plan.mapping.headerRow === null ? [] : plan.source.slice(0, plan.mapping.headerRow + 1);
  // Rows also listed under another chosen class (D-171), by the class each row now goes to.
  const classOfRow = new Map<number, string>();
  for (const [id, { rows }] of byClass) for (const i of rows) classOfRow.set(i, id);
  const cross = crossClassOf(plan.source, plan.mapping, (i) => classOfRow.get(i) ?? null);
  const splitId = newId();
  const made = tx(ctx.db, () => {
    const pool = buildPool(ctx);
    const ids: string[] = [];
    for (const { cls, rows, labels } of byClass.values()) {
      assertClassWritable(ctx.db, cls);
      const order = [...rows].sort((a, b) => a - b);
      const source = [...header, ...order.map((i) => plan.source[i]!)];
      const crossClass: Record<string, CrossClassKind> = {};
      order.forEach((i, n) => {
        const k = cross.get(i);
        if (k) crossClass[String(header.length + n)] = k;
      });
      ids.push(insertDraft(ctx, cls, plan, source, { ...plan.mapping, splitId, classLabels: labels, ...(Object.keys(crossClass).length ? { crossClass } : {}) }, pool));
    }
    audit(ctx.db, ctx.actor, { action: 'import.split', entity: 'import_split', entityId: splitId, after: { fileId: plan.fileId, sourceType: plan.extracted.sourceType, batchIds: ids, classIds: [...byClass.keys()], skippedRows } }, ctx.now());
    const batches = ids.map((id) => summaryOf(ctx.db, ctx.db.select().from(importBatches).where(eq(importBatches.id, id)).get()!));
    return { splitId, batches, skippedRows };
  });
  // Each batch now holds its own rows; the uploaded whole-school file is not kept (audit fix): it
  // names children of classes that were skipped or not chosen, whom no batch row (and so no erasure,
  // D-109) could ever find. The file row stays without its bytes, so the history keeps its name.
  if (plan.fileId) {
    const f = getFileRow(ctx.db, plan.fileId);
    if (f && f.deletedAt === null) await deleteFileRow(ctx, f);
  }
  return made;
}

/** Sheet picker (S13b): the sheets of an uploaded workbook, read in the parser worker. */
export async function listSheets(ctx: RequestContext, fileId: string) {
  const f = assertCanReadFile(ctx, fileId);
  if (f.kind !== 'import_source') throw invalid('This file is not a student list upload', { reason: 'NOT_AN_IMPORT_FILE' });
  return { sheets: await listWorkbookSheets(ctx.config, { path: storagePath(ctx.config, f.storageKey), mime: f.sniffedMime }) };
}

export function listBatches(ctx: RequestContext, input: In<typeof C.listImportBatches>) {
  const conds = [];
  if (input.classId) {
    if (!isAdmin(ctx)) assertTeachesClass(ctx, input.classId);
    conds.push(eq(importBatches.targetClassId, input.classId));
  }
  if (!isAdmin(ctx)) conds.push(eq(importBatches.createdBy, requireUser(ctx).id));
  let rows = ctx.db
    .select()
    .from(importBatches)
    .where(conds.length ? and(...conds) : undefined)
    .all();
  if (!isAdmin(ctx)) {
    const taught = taughtClassIds(ctx.db, requireUser(ctx).id);
    rows = rows.filter((b) => taught.includes(b.targetClassId));
  }
  if (input.splitId) rows = rows.filter((b) => b.mappingJson.splitId === input.splitId);
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return { batches: rows.slice(0, 100).map((b) => summaryOf(ctx.db, b)) };
}

export function getBatch(ctx: RequestContext, batchId: string): ImportBatch {
  const { batch } = loadBatch(ctx, batchId);
  return batchDto(ctx.db, batch.id);
}

// ---------------------------------------------------------------- edit
export function setMapping(ctx: RequestContext, input: In<typeof C.setImportMapping>): ImportBatch {
  return tx(ctx.db, () => {
    const { batch, cls } = loadBatch(ctx, input.batchId);
    assertDraft(batch);
    assertClassWritable(ctx.db, cls);
    const rows = rowsOf(ctx.db, batch.id);
    // The split id and class labels (D-171) are the server's, never the client's: kept from the batch.
    const mapping: StoredMapping = { ...fieldMapping(input.mapping), ...splitPart(batch.mappingJson) };
    const width = Math.max(0, ...rows.map((r) => r.rawJson.length));
    for (const k of ['fullName', 'givenNames', 'familyName', 'studentNumber', 'className'] as const) {
      const v = mapping[k];
      if (v !== null && v >= width) throw invalid('That column does not exist', { reason: 'IMPORT_BAD_MAPPING' });
    }
    if (mapping.fullName === null && mapping.givenNames === null && mapping.familyName === null) throw invalid('Choose the column with the names', { reason: 'IMPORT_NAME_COLUMN_REQUIRED' });
    if (mapping.headerRow !== null && mapping.headerRow >= rows.length) throw invalid('That row does not exist', { reason: 'IMPORT_BAD_MAPPING' });
    const source: SourceRow[] = rows.map((r) => ({ cells: r.rawJson, page: r.page, confidence: r.ocrConfidence }));
    const classified = classifyRows(source, mapping, { targetClassName: cls.name });
    const states = rows.map((r, i) => {
      const s = stateOf(r);
      const c = classified[i]!;
      if (!s.edited) {
        s.parsed = c.parsed;
        s.heading = c.heading;
        s.weakHeading = c.possibleHeading;
        s.decisionSource = 'auto';
      }
      return s;
    });
    evaluate(ctx, cls, mapping, states, buildPool(ctx));
    saveStates(ctx.db, states);
    ctx.db.update(importBatches).set({ mappingJson: mapping, columnsJson: columnLabels(source, mapping) }).where(eq(importBatches.id, batch.id)).run();
    touch(ctx, batch.id, states);
    return batchDto(ctx.db, batch.id);
  });
}

export function updateRow(ctx: RequestContext, input: In<typeof C.updateImportRow>): ImportBatch {
  return tx(ctx.db, () => {
    const { batch, cls } = loadBatch(ctx, input.batchId);
    assertDraft(batch);
    assertClassWritable(ctx.db, cls);
    const rows = rowsOf(ctx.db, batch.id);
    const states = rows.map(stateOf);
    const s = states.find((r) => r.id === input.rowId);
    if (!s) throw notFound('Row');
    const fieldsChanged = input.fullName !== undefined || input.givenNames !== undefined || input.familyName !== undefined || input.studentNumber !== undefined;
    if (fieldsChanged) {
      const p = { ...s.parsed };
      const part = (v: string | null | undefined) => (v === undefined ? undefined : v === null || !v.trim() ? null : v.trim());
      const g = part(input.givenNames);
      const f = part(input.familyName);
      if (g !== undefined) p.givenNames = g;
      if (f !== undefined) p.familyName = f;
      if (input.fullName !== undefined) p.fullName = input.fullName.trim();
      else if (g !== undefined || f !== undefined) p.fullName = [p.givenNames, p.familyName].filter(Boolean).join(' ');
      if (input.studentNumber !== undefined) p.studentNumber = input.studentNumber?.trim() || null;
      // Re-use the domain clean-up (Turkish title case for ALL CAPS, NFC, spacing).
      const cleaned = parseCells([p.fullName, p.givenNames ?? '', p.familyName ?? '', p.studentNumber ?? '', p.className ?? ''], {
        headerRow: null,
        fullName: 0,
        givenNames: p.givenNames ? 1 : null,
        familyName: p.familyName ? 2 : null,
        studentNumber: 3,
        className: p.className ? 4 : null,
      });
      s.parsed = { ...cleaned, studentNumber: p.studentNumber ? cleaned.studentNumber ?? p.studentNumber : null };
      s.edited = true;
      s.heading = false;
      s.weakHeading = false;
      if (input.decision === undefined && s.decisionSource === 'teacher' && s.decision === 'skip') s.decisionSource = 'auto';
    }
    if (input.decision !== undefined) {
      s.decision = input.decision;
      s.decisionSource = 'teacher';
      if (input.decision === 'match') {
        const id = input.matchedStudentId ?? s.matchedStudentId ?? s.candidates[0]?.id ?? null;
        if (!id) throw invalid('Choose the student this row is', { reason: 'IMPORT_MATCH_REQUIRED' });
        s.matchedStudentId = id;
      } else s.matchedStudentId = null;
      if ((input.decision === 'add' || input.decision === 'match') && (s.heading || !/\p{L}/u.test(s.parsed.fullName))) {
        throw invalid('This row has no name to import', { reason: 'IMPORT_ROW_HAS_NO_NAME' });
      }
    } else if (input.matchedStudentId !== undefined && input.matchedStudentId !== null) {
      s.decision = 'match';
      s.decisionSource = 'teacher';
      s.matchedStudentId = input.matchedStudentId;
    }
    evaluate(ctx, cls, batch.mappingJson, states, buildPool(ctx));
    if (s.decision === 'match' && s.matchedStudentId && !s.candidates.some((c) => c.id === s.matchedStudentId)) {
      throw invalid('That student is not one of the suggested matches', { reason: 'IMPORT_MATCH_NOT_CANDIDATE' });
    }
    if (input.fillNumber !== undefined) {
      if (input.fillNumber && !canFillNumber(s)) throw invalid('There is no missing number to fill in', { reason: 'IMPORT_CANNOT_FILL_NUMBER' });
      s.fillNumber = input.fillNumber;
    }
    saveStates(ctx.db, states);
    touch(ctx, batch.id, states);
    return batchDto(ctx.db, batch.id);
  });
}

export function setDecisions(ctx: RequestContext, input: In<typeof C.setImportDecisions>): ImportBatch {
  return tx(ctx.db, () => {
    const { batch, cls } = loadBatch(ctx, input.batchId);
    assertDraft(batch);
    assertClassWritable(ctx.db, cls);
    const states = rowsOf(ctx.db, batch.id).map(stateOf);
    const ids = new Set(input.rowIds);
    for (const s of states) {
      if (!ids.has(s.id)) continue;
      const nameless = s.heading || !/\p{L}/u.test(s.parsed.fullName);
      if (input.decision === 'skip') {
        s.decision = 'skip';
        s.matchedStudentId = null;
      } else if (input.decision === 'add') {
        if (nameless) continue;
        s.decision = 'add';
        s.matchedStudentId = null;
      } else {
        const best = s.matchedStudentId ?? s.candidates[0]?.id ?? null;
        if (nameless || !best) continue;
        s.decision = 'match';
        s.matchedStudentId = best;
      }
      s.decisionSource = 'teacher';
    }
    evaluate(ctx, cls, batch.mappingJson, states, buildPool(ctx));
    saveStates(ctx.db, states);
    touch(ctx, batch.id, states);
    return batchDto(ctx.db, batch.id);
  });
}

// ---------------------------------------------------------------- commit
/** Run `fn` in a SAVEPOINT inside the current transaction: a failing row is rolled back alone. */
function savepoint<T>(db: Db, fn: () => T): T {
  return db.$client.transaction(fn)();
}

const reasonOf = (err: unknown) => (err instanceof AppError ? (((err.details as { reason?: string } | undefined)?.reason ?? err.code) as string) : 'FAILED');

export function commitBatch(ctx: RequestContext, batchId: string): ImportBatch {
  // Re-check against the current roster first and KEEP the result (another teacher, or another class
  // of the same list, may have added students since the preview): a refused confirm then shows in
  // the preview which rows now need a choice, instead of the old preview with none (D-171).
  const pending = tx(ctx.db, () => {
    const { batch, cls } = loadBatch(ctx, batchId);
    assertDraft(batch);
    assertCanImportInto(ctx, cls.id);
    const states = rowsOf(ctx.db, batch.id).map(stateOf);
    evaluate(ctx, cls, batch.mappingJson, states, buildPool(ctx));
    saveStates(ctx.db, states);
    touch(ctx, batch.id, states);
    return states.filter(needsChoice).map((r) => r.idx);
  });
  if (pending.length) throw conflict('Decide what happens to the possible matches first', { reason: 'IMPORT_DECISIONS_NEEDED', rows: pending });
  return tx(ctx.db, () => {
    const { batch, cls } = loadBatch(ctx, batchId);
    assertDraft(batch);
    assertCanImportInto(ctx, cls.id);
    const rows = rowsOf(ctx.db, batch.id);
    const states = rows.map(stateOf);
    // Checked again inside the writing transaction.
    evaluate(ctx, cls, batch.mappingJson, states, buildPool(ctx));
    const open = states.filter(needsChoice);
    if (open.length) throw conflict('Decide what happens to the possible matches first', { reason: 'IMPORT_DECISIONS_NEEDED', rows: open.map((r) => r.idx) });
    saveStates(ctx.db, states);
    const visible = visibleClasses(ctx);
    const now = ctx.now();
    const counts = { added: 0, matched: 0, skipped: 0, failed: 0 };
    for (const s of states) {
      const set = (v: Partial<RowRow>) => ctx.db.update(importRows).set(v).where(eq(importRows.id, s.id)).run();
      if (s.decision === 'skip') {
        counts.skipped++;
        const why = s.heading ? 'HEADING' : s.flags.includes('missing_name') ? 'NO_NAME' : s.flags.includes('number_elsewhere') ? 'NUMBER_ELSEWHERE' : s.decisionSource === 'teacher' ? 'CHOSEN' : s.repeat ? 'DUPLICATE_IN_FILE' : s.flags.includes('class_mismatch') ? 'OTHER_CLASS' : s.flags.includes('possible_heading') ? 'POSSIBLE_HEADING' : 'CHOSEN';
        set({ outcome: 'skipped', reason: why });
        continue;
      }
      if (s.decision === 'add') {
        try {
          const created = savepoint(ctx.db, () =>
            createStudentInClass(
              ctx,
              ctx.actor,
              cls,
              { fullName: s.parsed.fullName, givenNames: s.parsed.givenNames, familyName: s.parsed.familyName, studentNumber: s.parsed.studentNumber, allowDuplicateName: true },
              { reason: 'import', importBatchId: batch.id, visibleClassIds: visible },
            ),
          );
          const enr = ctx.db.select({ id: enrolments.id }).from(enrolments).where(and(eq(enrolments.studentId, created.id), eq(enrolments.importBatchId, batch.id))).get();
          set({ outcome: 'added', reason: null, createdStudentId: created.id, createdEnrolmentId: enr?.id ?? null });
          counts.added++;
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          set({ outcome: 'failed', reason: reasonOf(err) });
          counts.failed++;
        }
        continue;
      }
      // match
      const student = s.matchedStudentId ? ctx.db.select().from(students).where(eq(students.id, s.matchedStudentId)).get() : undefined;
      if (!student || (visible !== 'all' && !liveClassIdsOf(ctx, student.id).some((c) => visible.includes(c)))) {
        set({ outcome: 'failed', reason: 'MATCH_NOT_FOUND' });
        counts.failed++;
        continue;
      }
      let reason = 'ALREADY_IN_CLASS';
      let createdEnrolmentId: string | null = null;
      // Date-aware (D-027): the classes the student is in today or is scheduled to join.
      const live = liveEnrolmentsOf(ctx, student.id);
      if (student.deactivatedAt) reason = 'STUDENT_DEACTIVATED';
      else if (live.some((e) => e.classId === cls.id)) reason = 'ALREADY_IN_CLASS';
      else if (live.some((e) => e.schoolYearId === cls.schoolYearId)) reason = 'IN_OTHER_CLASS';
      else {
        // Not in any class this school year: enrol them here (history in other years is untouched).
        createdEnrolmentId = newId();
        const fromDate = defaultEnrolmentDate(ctx, cls);
        ctx.db
          .insert(enrolments)
          .values({ id: createdEnrolmentId, studentId: student.id, classId: cls.id, schoolYearId: cls.schoolYearId, fromDate, toDate: null, reason: 'import', importBatchId: batch.id, createdAt: now, createdBy: requireUser(ctx).id })
          .run();
        audit(ctx.db, ctx.actor, { action: 'student.enrol', entity: 'student', entityId: student.id, after: { classId: cls.id, fromDate, importBatchId: batch.id } }, now);
        reason = 'ENROLLED';
      }
      let filled = false;
      if (s.fillNumber && s.parsed.studentNumber && !student.studentNumber) {
        const taken = ctx.db.select({ id: students.id }).from(students).where(eq(students.studentNumber, s.parsed.studentNumber)).get();
        if (taken) reason = `${reason}+NUMBER_TAKEN`;
        else {
          ctx.db.update(students).set({ studentNumber: s.parsed.studentNumber, updatedAt: now, updatedBy: requireUser(ctx).id }).where(eq(students.id, student.id)).run();
          audit(ctx.db, ctx.actor, { action: 'student.update', entity: 'student', entityId: student.id, before: { studentNumber: null }, after: { studentNumber: s.parsed.studentNumber, importBatchId: batch.id } }, now);
          filled = true;
        }
      }
      set({ outcome: 'matched', reason, createdEnrolmentId, filledNumber: filled });
      counts.matched++;
    }
    ctx.db
      .update(importBatches)
      .set({ status: 'committed', countsJson: { rows: states.length, ...counts }, committedAt: now, committedBy: requireUser(ctx).id, updatedAt: now })
      .where(eq(importBatches.id, batch.id))
      .run();
    audit(ctx.db, ctx.actor, { action: 'import.commit', entity: 'import_batch', entityId: batch.id, after: { classId: cls.id, ...counts } }, now);
    return batchDto(ctx.db, batch.id);
  });
}

// ---------------------------------------------------------------- revert
class HasHistory extends Error {}

/** JSON columns that hold student ids without a foreign key (grouping, assistant). */
const JSON_REFERENCES = [
  ['group_templates', 'groups_json'],
  ['group_templates', 'unsatisfied_json'],
  ['lesson_groupings', 'effective_groups_json'],
  ['lesson_groupings', 'excluded_absent_ids'],
  ['lesson_groupings', 'unsatisfied_json'],
  ['assistant_assignments', 'absent_student_ids'],
  ['assistant_assignments', 'absence_undo'],
] as const;

function referencedInJson(db: Db, studentId: string): boolean {
  for (const [table, col] of JSON_REFERENCES) {
    const hit = db.$client.prepare(`SELECT 1 FROM ${table} WHERE instr(${col}, ?) > 0 LIMIT 1`).get(studentId);
    if (hit) return true;
  }
  return false;
}

/**
 * Remove a student the batch created, if nothing refers to them any more: no other enrolment, no
 * JSON reference and no row in any table with a foreign key to students (attendance, counters,
 * Secret Student picks, assistant, homework, levels, files…). The foreign keys make this check complete
 * for every table, including ones added by later stages.
 */
function removeCreatedStudent(db: Db, studentId: string, enrolmentId: string | null): void {
  savepoint(db, () => {
    if (enrolmentId) db.delete(enrolments).where(eq(enrolments.id, enrolmentId)).run();
    const other = db.select({ id: enrolments.id }).from(enrolments).where(eq(enrolments.studentId, studentId)).get();
    if (other || referencedInJson(db, studentId)) throw new HasHistory();
    // The permanent link made automatically (D-115) is not history while it was never opened.
    if (!discardUnusedAutoLinks(db, studentId)) throw new HasHistory();
    try {
      db.delete(students).where(eq(students.id, studentId)).run();
    } catch (err) {
      if (String((err as Error).message).includes('FOREIGN KEY')) throw new HasHistory();
      throw err;
    }
  });
}

/**
 * Tables with a foreign key to `students` that `enrolmentHasHistory` consults. A test compares this
 * list with the live schema, so a table added later cannot be forgotten (IMP-5: history is never
 * deleted, only closed). `enrolments` itself and `files` (checked by time) are handled separately.
 */
export const ENROLMENT_HISTORY_TABLES = [
  'attendance_daily',
  'attendance_lesson_exceptions',
  'counter_events',
  SELECTIONS_TABLE_NAME, // through studentInContextSelections (Secret Student boundary, D-064)
  'assistant_assignments',
  'assistant_duty_checks',
  'pair_constraints',
  'homework_marks',
  'homework_mark_changes',
  'student_subject_levels',
  'files',
  // S10: goals, reflections, evidence, feedback, private notes and personal links (through goalsHistorySince)
  ...GOALS_HISTORY_TABLES,
  // S13c: badges and blocked-word counts (since the enrolment was created)
  'student_achievements',
  'text_check_attempts',
  // S12: Super Speakers points earned while in the class (class snapshot)
  'point_events',
  // S14e3: teacher notifications about the student (they follow the rows above; since the enrolment was created)
  'notifications',
  // S14h1 (D-161): the student was shown to an AI tool under a pseudonym (kept so "Student N" stays the same student)
  'mcp_pseudonyms',
  // S24 (D-184): the student's own avatar picture (sent since the enrolment was created)
  'avatar_pictures',
] as const;

/**
 * Has anything been recorded for the student in this class (its teaching contexts, lessons and
 * homework) — or for the student at all since the enrolment was created (levels, files)? Then the
 * enrolment is closed instead of deleted on revert, so history keeps a matching enrolment.
 */
function enrolmentHasHistory(db: Db, e: typeof enrolments.$inferSelect): boolean {
  const { studentId, classId } = e;
  const att = db
    .select({ id: attendanceDaily.studentId })
    .from(attendanceDaily)
    .where(and(eq(attendanceDaily.studentId, studentId), eq(attendanceDaily.classId, classId)))
    .get();
  if (att) return true;
  if (db.select({ id: studentSubjectLevels.studentId }).from(studentSubjectLevels).where(and(eq(studentSubjectLevels.studentId, studentId), gte(studentSubjectLevels.updatedAt, e.createdAt))).get()) return true;
  if (db.select({ id: files.id }).from(files).where(and(eq(files.ownerStudentId, studentId), gte(files.createdAt, e.createdAt))).get()) return true;
  if (goalsHistorySince(db, studentId, e.createdAt)) return true;
  if (db.select({ id: studentAchievements.id }).from(studentAchievements).where(and(eq(studentAchievements.studentId, studentId), gte(studentAchievements.awardedAt, e.createdAt))).get()) return true;
  if (db.select({ id: textCheckAttempts.studentId }).from(textCheckAttempts).where(and(eq(textCheckAttempts.studentId, studentId), gte(textCheckAttempts.updatedAt, e.createdAt))).get()) return true;
  if (db.select({ id: pointEvents.id }).from(pointEvents).where(and(eq(pointEvents.studentId, studentId), eq(pointEvents.classIdSnapshot, classId))).get()) return true;
  if (db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.studentId, studentId), gte(notifications.createdAt, e.createdAt))).get()) return true;
  if (db.select({ id: mcpPseudonyms.studentId }).from(mcpPseudonyms).where(and(eq(mcpPseudonyms.studentId, studentId), gte(mcpPseudonyms.createdAt, e.createdAt))).get()) return true;
  if (hasPictureSince(db, studentId, e.createdAt)) return true;
  if (referencedInJson(db, studentId)) return true;
  const ctxIds = db.select({ id: teachingContexts.id }).from(teachingContexts).where(eq(teachingContexts.classId, classId)).all().map((r) => r.id);
  if (!ctxIds.length) return false;
  const lessonIds = db.select({ id: lessons.id }).from(lessons).where(inArray(lessons.contextId, ctxIds)).all().map((r) => r.id);
  if (lessonIds.length) {
    if (db.select({ id: attendanceLessonExceptions.studentId }).from(attendanceLessonExceptions).where(and(eq(attendanceLessonExceptions.studentId, studentId), inArray(attendanceLessonExceptions.lessonId, lessonIds))).get()) return true;
    if (db.select({ id: counterEvents.id }).from(counterEvents).where(and(eq(counterEvents.studentId, studentId), inArray(counterEvents.lessonId, lessonIds))).get()) return true;
  }
  if (studentInContextSelections(db, studentId, ctxIds)) return true;
  const assistant = db
    .select({ id: assistantAssignments.id })
    .from(assistantAssignments)
    .where(and(inArray(assistantAssignments.contextId, ctxIds), or(eq(assistantAssignments.plannedStudentId, studentId), eq(assistantAssignments.actualStudentId, studentId))))
    .get();
  if (assistant) return true;
  if (db.select({ id: assistantDutyChecks.id }).from(assistantDutyChecks).where(and(inArray(assistantDutyChecks.contextId, ctxIds), eq(assistantDutyChecks.studentId, studentId))).get()) return true;
  const pair = db
    .select({ id: pairConstraints.id })
    .from(pairConstraints)
    .where(and(inArray(pairConstraints.contextId, ctxIds), or(eq(pairConstraints.studentA, studentId), eq(pairConstraints.studentB, studentId))))
    .get();
  if (pair) return true;
  const hw = db.select({ id: homeworkAssignments.id }).from(homeworkAssignments).where(inArray(homeworkAssignments.contextId, ctxIds)).all().map((r) => r.id);
  if (hw.length) {
    if (db.select({ id: homeworkMarks.studentId }).from(homeworkMarks).where(and(eq(homeworkMarks.studentId, studentId), inArray(homeworkMarks.assignmentId, hw))).get()) return true;
    if (db.select({ id: homeworkMarkChanges.id }).from(homeworkMarkChanges).where(and(eq(homeworkMarkChanges.studentId, studentId), inArray(homeworkMarkChanges.assignmentId, hw))).get()) return true;
  }
  return false;
}

export function revertBatch(ctx: RequestContext, batchId: string): ImportBatch {
  return tx(ctx.db, () => {
    const { batch, cls } = loadBatch(ctx, batchId);
    if (batch.status !== 'committed') throw conflict('Only an applied import can be undone', { reason: 'IMPORT_NOT_COMMITTED' });
    assertCanImportInto(ctx, cls.id);
    const now = ctx.now();
    const uid = requireUser(ctx).id;
    const today = todayFor(ctx, cls);
    const counts = { removed: 0, deactivated: 0, movedElsewhere: 0, enrolmentsRemoved: 0, enrolmentsClosed: 0, numbersCleared: 0, unchanged: 0 };
    for (const r of rowsOf(ctx.db, batch.id)) {
      const set = (v: string) => ctx.db.update(importRows).set({ revertOutcome: v }).where(eq(importRows.id, r.id)).run();
      if (r.outcome === 'added' && r.createdStudentId) {
        const s = ctx.db.select().from(students).where(eq(students.id, r.createdStudentId)).get();
        if (!s) {
          set('unchanged');
          counts.unchanged++;
          continue;
        }
        try {
          removeCreatedStudent(ctx.db, s.id, r.createdEnrolmentId);
          audit(ctx.db, ctx.actor, { action: 'student.remove_imported', entity: 'student', entityId: s.id, before: { fullName: s.fullName, studentNumber: s.studentNumber, importBatchId: batch.id } }, now);
          set('removed');
          counts.removed++;
        } catch (err) {
          if (!(err instanceof HasHistory)) throw err;
          // Moved since (by an admin, a promotion…) into another class: the student no longer depends
          // on this import, and possibly belongs to another teacher now (ACC-4). Never deactivate them
          // school-wide; only end this batch's own enrolment if it is still open.
          const elsewhere = liveEnrolmentsOf(ctx, s.id).filter((e) => e.id !== r.createdEnrolmentId);
          if (elsewhere.length) {
            const own = r.createdEnrolmentId ? ctx.db.select().from(enrolments).where(eq(enrolments.id, r.createdEnrolmentId)).get() : undefined;
            if (own && own.toDate === null) {
              const toDate = today > own.fromDate ? today : own.fromDate;
              ctx.db.update(enrolments).set({ toDate }).where(eq(enrolments.id, own.id)).run();
              audit(ctx.db, ctx.actor, { action: 'student.enrolment_close', entity: 'student', entityId: s.id, before: { classId: own.classId, fromDate: own.fromDate, importBatchId: batch.id }, after: { toDate } }, now);
            }
            set('moved_elsewhere');
            counts.movedElsewhere++;
            continue;
          }
          if (!s.deactivatedAt) {
            ctx.db.update(students).set({ deactivatedAt: now, updatedAt: now, updatedBy: uid }).where(eq(students.id, s.id)).run();
            audit(ctx.db, ctx.actor, { action: 'student.deactivate', entity: 'student', entityId: s.id, after: { reason: 'import_revert', importBatchId: batch.id } }, now);
          }
          set('deactivated');
          counts.deactivated++;
        }
        continue;
      }
      if (r.outcome === 'matched') {
        let outcome = 'unchanged';
        if (r.createdEnrolmentId) {
          const e = ctx.db.select().from(enrolments).where(eq(enrolments.id, r.createdEnrolmentId)).get();
          if (e && e.toDate === null) {
            if (!enrolmentHasHistory(ctx.db, e)) {
              ctx.db.delete(enrolments).where(eq(enrolments.id, e.id)).run();
              outcome = 'enrolment_removed';
              counts.enrolmentsRemoved++;
            } else {
              ctx.db.update(enrolments).set({ toDate: today > e.fromDate ? today : e.fromDate }).where(eq(enrolments.id, e.id)).run();
              outcome = 'enrolment_closed';
              counts.enrolmentsClosed++;
            }
            audit(ctx.db, ctx.actor, { action: outcome === 'enrolment_removed' ? 'student.unenrol' : 'student.enrolment_close', entity: 'student', entityId: e.studentId, before: { classId: e.classId, fromDate: e.fromDate, importBatchId: batch.id } }, now);
          }
        }
        if (r.filledNumber && r.matchedStudentId) {
          const s = ctx.db.select().from(students).where(eq(students.id, r.matchedStudentId)).get();
          if (s && s.studentNumber === r.parsedJson.studentNumber) {
            ctx.db.update(students).set({ studentNumber: null, updatedAt: now, updatedBy: uid }).where(eq(students.id, s.id)).run();
            audit(ctx.db, ctx.actor, { action: 'student.update', entity: 'student', entityId: s.id, before: { studentNumber: s.studentNumber }, after: { studentNumber: null, importBatchId: batch.id } }, now);
            outcome = outcome === 'unchanged' ? 'number_cleared' : `${outcome}+number_cleared`;
            counts.numbersCleared++;
          }
        }
        if (outcome === 'unchanged') counts.unchanged++;
        set(outcome);
      }
    }
    ctx.db
      .update(importBatches)
      .set({ status: 'reverted', countsJson: { ...batch.countsJson, ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [`revert_${k}`, v])) }, revertedAt: now, revertedBy: uid, updatedAt: now })
      .where(eq(importBatches.id, batch.id))
      .run();
    audit(ctx.db, ctx.actor, { action: 'import.revert', entity: 'import_batch', entityId: batch.id, after: counts }, now);
    return batchDto(ctx.db, batch.id);
  });
}
