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
 */
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/import.ts';
import type { ImportBatch, ImportFlag, ImportMapping, ImportRow } from '../../../shared/contracts/import.ts';
import { foldForSearch } from '../../../shared/text/turkish.ts';
import {
  classKey,
  classifyRows,
  columnLabels,
  inferMapping,
  LOW_CONFIDENCE,
  markDuplicates,
  nameSimilarity,
  parseCells,
  POSSIBLE_MATCH,
  type ClassifiedRow,
  type Mapping,
  type Parsed,
  type SourceRow,
} from '../../../domain/importing.ts';
import { tx, type Db } from '../../db/client.ts';
import {
  assistantAssignments,
  attendanceDaily,
  attendanceLessonExceptions,
  classes,
  counterEvents,
  enrolments,
  files,
  homeworkAssignments,
  homeworkMarkChanges,
  homeworkMarks,
  importBatches,
  importRows,
  lessons,
  pairConstraints,
  students,
  studentSubjectLevels,
  teachingContexts,
  users,
  type ImportCandidateJson,
} from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import type { RequestContext } from '../../lib/context.ts';
import { requireUser } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.ts';
import { assertCanReadFile } from '../files/service.ts';
import { storagePath } from '../files/storage.ts';
import { assertClassWritable, assertTeachesClass, defaultEnrolmentDate, getClass, todayFor, type ClassRow } from '../school/policy.ts';
import { taughtClassIds } from '../school/service.ts';
import { GOALS_HISTORY_TABLES, goalsHistorySince } from '../goals/history.ts';
import { SELECTIONS_TABLE_NAME, studentInContextSelections } from '../secret/service.ts';
import { createStudentInClass, liveClassIdsOf, liveEnrolmentsOf } from '../students/service.ts';
import { extractFile, extractPaste, type Extracted } from './parsers/index.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type BatchRow = typeof importBatches.$inferSelect;
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
function evaluate(ctx: RequestContext, cls: ClassRow, mapping: Mapping, rows: RowState[], pool: Pool): void {
  const target = classKey(cls.name);
  for (const r of rows) {
    const f: ImportFlag[] = [];
    if (r.heading) f.push('heading_ignored');
    else {
      if (r.weakHeading) f.push('possible_heading');
      if (!/\p{L}/u.test(r.parsed.fullName)) f.push('missing_name');
      if (mapping.studentNumber !== null && !r.parsed.studentNumber) f.push('missing_number');
      if (r.confidence !== null && r.confidence < LOW_CONFIDENCE) f.push('low_confidence');
      const k = r.parsed.className ? classKey(r.parsed.className) : null;
      if (target && k && k !== target) f.push('class_mismatch');
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
const CHOICE_FLAGS: readonly ImportFlag[] = ['possible_match', 'name_elsewhere', 'number_conflict'];
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
  };
}

function batchDto(db: Db, batchId: string): ImportBatch {
  const b = db.select().from(importBatches).where(eq(importBatches.id, batchId)).get()!;
  return { ...summaryOf(db, b), columns: b.columnsJson, mapping: b.mappingJson, notices: b.noticesJson, rows: rowsOf(db, b.id).map(rowDto) };
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
  let extracted: Extracted;
  let fileId: string | null = null;
  if (input.fileId) {
    const f = assertCanReadFile(ctx, input.fileId);
    if (f.kind !== 'import_source') throw invalid('This file is not a student list upload', { reason: 'NOT_AN_IMPORT_FILE' });
    fileId = f.id;
    extracted = await extractFile(ctx.config, { path: storagePath(ctx.config, f.storageKey), mime: f.sniffedMime, name: f.originalName });
  } else {
    if (!input.text?.trim()) throw invalid('Paste a list first', { reason: 'IMPORT_EMPTY' });
    extracted = extractPaste(input.text);
  }
  // Blank rows are dropped here; the remaining rows keep their order (idx).
  const source: SourceRow[] = extracted.rows.filter((r) => r.cells.some((c) => c.trim()));
  if (!source.some((r) => r.cells.some((c) => /\p{L}/u.test(c)))) throw invalid('No names were found', { reason: 'IMPORT_NO_ROWS' });
  const mapping = inferMapping(source);
  const classified = classifyRows(source, mapping, { targetClassName: cls.name });
  const now = ctx.now();
  const user = requireUser(ctx);
  const batchId = newId();
  return tx(ctx.db, () => {
    assertClassWritable(ctx.db, cls);
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
    evaluate(ctx, cls, mapping, states, buildPool(ctx));
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
    audit(ctx.db, ctx.actor, { action: 'import.create', entity: 'import_batch', entityId: batchId, after: { classId: cls.id, sourceType: extracted.sourceType, fileId, rows: states.length } }, now);
    return batchDto(ctx.db, batchId);
  });
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
    const mapping: ImportMapping = input.mapping;
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
  return tx(ctx.db, () => {
    const { batch, cls } = loadBatch(ctx, batchId);
    assertDraft(batch);
    assertCanImportInto(ctx, cls.id);
    const rows = rowsOf(ctx.db, batch.id);
    const states = rows.map(stateOf);
    // Re-check against the current roster (another teacher may have added students since the preview).
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
  'pair_constraints',
  'homework_marks',
  'homework_mark_changes',
  'student_subject_levels',
  'files',
  // S10: goals, reflections, evidence, feedback, private notes and personal links (through goalsHistorySince)
  ...GOALS_HISTORY_TABLES,
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
