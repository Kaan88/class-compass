/**
 * Routine templates (RTN-1/2): teacher-owned, either for all of the teacher's classes
 * (`contextId` null) or for one class+subject. Edits never touch running lessons: a lesson keeps the
 * snapshot taken when it started. Archiving hides a template; nothing is deleted (CFG-2).
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { DEFAULT_ROUTINE_ID, DEFAULT_ROUTINE_NAME, DEFAULT_ROUTINE_STAGES, type RoutineStage } from '../../../domain/routines.ts';
import type { LocalizedTextValue } from '../../../shared/contracts/define.ts';
import type * as C from '../../../shared/contracts/lessons.ts';
import { normaliseName } from '../../../shared/text/turkish.ts';
import { tx, type Db } from '../../db/client.ts';
import { contextLessonSettings, routineTemplates, teachingContexts } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { AppError, invalid, notFound } from '../../lib/errors.ts';
import { assertOwnsContext } from '../school/policy.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type TemplateRow = typeof routineTemplates.$inferSelect;

export interface ResolvedRoutine {
  templateId: string | null;
  name: LocalizedTextValue;
  stages: RoutineStage[];
}

const cleanText = (t: LocalizedTextValue): LocalizedTextValue => {
  const out: LocalizedTextValue = {};
  if (t.en?.trim()) out.en = normaliseName(t.en);
  if (t.tr?.trim()) out.tr = normaliseName(t.tr);
  return out;
};

/** Normalise names, keep known ids (identity across reorder/rename), give new stages fresh ids. */
function cleanStages(input: Array<{ id?: string | undefined; name: LocalizedTextValue }>): RoutineStage[] {
  const seen = new Set<string>();
  return input.map((s) => {
    let id = s.id && /^[\w:-]{1,64}$/.test(s.id) && !seen.has(s.id) ? s.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    return { id, name: cleanText(s.name) };
  });
}

export const builtinTemplate = (): z.infer<typeof C.RoutineTemplate> => ({
  id: DEFAULT_ROUTINE_ID,
  builtIn: true,
  contextId: null,
  name: DEFAULT_ROUTINE_NAME,
  stages: DEFAULT_ROUTINE_STAGES.map((s) => ({ id: s.id, name: { ...s.name } })),
  archived: false,
});

export const templateDto = (r: TemplateRow): z.infer<typeof C.RoutineTemplate> => ({
  id: r.id,
  builtIn: false,
  contextId: r.contextId,
  name: r.name,
  stages: r.stagesJson,
  archived: r.archivedAt !== null,
});

function ownTemplate(ctx: RequestContext, id: string): TemplateRow {
  const row = ctx.db.select().from(routineTemplates).where(eq(routineTemplates.id, id)).get();
  if (!row || row.teacherId !== requireUser(ctx).id) throw notFound('Routine');
  return row;
}

/** Templates the teacher can use in this context: built-in + own, unarchived, for all classes or this one. */
export function usableTemplates(db: Db, teacherId: string, contextId: string) {
  const own = db
    .select()
    .from(routineTemplates)
    .where(and(eq(routineTemplates.teacherId, teacherId), isNull(routineTemplates.archivedAt)))
    .all()
    .filter((r) => r.contextId === null || r.contextId === contextId)
    .sort((a, b) => a.createdAt - b.createdAt);
  return [builtinTemplate(), ...own.map(templateDto)];
}

/** The context's default template id, falling back to the built-in routine when the choice is gone. */
export function defaultTemplateId(db: Db, teacherId: string, contextId: string): string {
  const row = db.select().from(contextLessonSettings).where(eq(contextLessonSettings.contextId, contextId)).get();
  const usable = usableTemplates(db, teacherId, contextId);
  return row && usable.some((t) => t.id === row.defaultTemplateId) ? row.defaultTemplateId : DEFAULT_ROUTINE_ID;
}

/** Pick the routine for a new lesson (requested id, else the context default). Unknown/foreign ids are refused. */
export function resolveRoutine(db: Db, teacherId: string, contextId: string, requested?: string): ResolvedRoutine {
  const id = requested ?? defaultTemplateId(db, teacherId, contextId);
  const t = usableTemplates(db, teacherId, contextId).find((x) => x.id === id);
  if (!t) throw invalid('This routine cannot be used here', { reason: 'ROUTINE_NOT_USABLE' });
  return { templateId: t.builtIn ? DEFAULT_ROUTINE_ID : t.id, name: t.name, stages: t.stages.map((s) => ({ id: s.id, name: { ...s.name } })) };
}

export function listTemplates(ctx: RequestContext) {
  const tid = requireUser(ctx).id;
  const rows = ctx.db.select().from(routineTemplates).where(eq(routineTemplates.teacherId, tid)).all().sort((a, b) => a.createdAt - b.createdAt);
  const contexts = ctx.db
    .select({ id: teachingContexts.id })
    .from(teachingContexts)
    .where(and(eq(teachingContexts.teacherId, tid), isNull(teachingContexts.endedAt)))
    .all();
  return {
    templates: [builtinTemplate(), ...rows.map(templateDto)],
    defaults: contexts.map((c) => ({ contextId: c.id, templateId: defaultTemplateId(ctx.db, tid, c.id) })),
  };
}

export function createTemplate(ctx: RequestContext, input: In<typeof C.createRoutineTemplate>) {
  return tx(ctx.db, () => {
    if (input.contextId) assertOwnsContext(ctx, input.contextId);
    const now = ctx.now();
    const row: TemplateRow = {
      id: newId(),
      teacherId: requireUser(ctx).id,
      contextId: input.contextId ?? null,
      name: cleanText(input.name),
      stagesJson: input.stages ? cleanStages(input.stages) : DEFAULT_ROUTINE_STAGES.map((s) => ({ id: s.id, name: { ...s.name } })),
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    ctx.db.insert(routineTemplates).values(row).run();
    audit(ctx.db, ctx.actor, { action: 'routine.create', entity: 'routine_template', entityId: row.id, after: { name: row.name, contextId: row.contextId, stages: row.stagesJson.length } }, now);
    return templateDto(row);
  });
}

export function updateTemplate(ctx: RequestContext, input: In<typeof C.updateRoutineTemplate>) {
  return tx(ctx.db, () => {
    const row = ownTemplate(ctx, input.templateId);
    if (row.archivedAt) throw new AppError('CONFLICT', 'This routine is archived', { reason: 'ROUTINE_ARCHIVED' });
    if (input.contextId) assertOwnsContext(ctx, input.contextId);
    const patch: Partial<TemplateRow> = { updatedAt: ctx.now() };
    if (input.name) patch.name = cleanText(input.name);
    if (input.contextId !== undefined) patch.contextId = input.contextId;
    if (input.stages) patch.stagesJson = cleanStages(input.stages);
    ctx.db.update(routineTemplates).set(patch).where(eq(routineTemplates.id, row.id)).run();
    const after = ownTemplate(ctx, row.id);
    audit(
      ctx.db,
      ctx.actor,
      { action: 'routine.update', entity: 'routine_template', entityId: row.id, before: { name: row.name, contextId: row.contextId, stages: row.stagesJson }, after: { name: after.name, contextId: after.contextId, stages: after.stagesJson } },
      ctx.now(),
    );
    return templateDto(after);
  });
}

export function archiveTemplate(ctx: RequestContext, templateId: string) {
  return tx(ctx.db, () => {
    const row = ownTemplate(ctx, templateId);
    if (!row.archivedAt) {
      ctx.db.update(routineTemplates).set({ archivedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(routineTemplates.id, row.id)).run();
      audit(ctx.db, ctx.actor, { action: 'routine.archive', entity: 'routine_template', entityId: row.id }, ctx.now());
    }
    return templateDto(ownTemplate(ctx, row.id));
  });
}

export function setContextRoutine(ctx: RequestContext, contextId: string, templateId: string) {
  tx(ctx.db, () => {
    const c = assertOwnsContext(ctx, contextId);
    const uid = requireUser(ctx).id;
    if (!usableTemplates(ctx.db, uid, c.id).some((t) => t.id === templateId)) throw invalid('This routine cannot be used here', { reason: 'ROUTINE_NOT_USABLE' });
    const before = defaultTemplateId(ctx.db, uid, c.id);
    const now = ctx.now();
    ctx.db
      .insert(contextLessonSettings)
      .values({ contextId: c.id, defaultTemplateId: templateId, updatedAt: now, updatedBy: uid })
      .onConflictDoUpdate({ target: contextLessonSettings.contextId, set: { defaultTemplateId: templateId, updatedAt: now, updatedBy: uid } })
      .run();
    audit(ctx.db, ctx.actor, { action: 'routine.set_default', entity: 'teaching_context', entityId: c.id, before: { templateId: before }, after: { templateId } }, now);
  });
  return { ok: true as const };
}
