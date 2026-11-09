/**
 * Classroom board layouts (S14b, D-148): each teacher's own layout, for one class+subject or for all
 * of them. The class+subject layout wins over the "all classes" one; a stored layout that no longer
 * passes `layoutIssues` (for example after a downgrade) is skipped, so the board never breaks on it.
 * A personal display preference without student data: not audited (D-148), replaced in place.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { isValidLayout, layoutIssues } from '../../../shared/classroomLayout.ts';
import type * as C from '../../../shared/contracts/classroomLayout.ts';
import { tx } from '../../db/client.ts';
import { classroomLayouts } from '../../db/schema.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { invalid } from '../../lib/errors.ts';
import { assertOwnsContext } from '../school/policy.ts';

type In<E extends { input: z.ZodType }> = z.infer<E['input']>;
type Row = typeof classroomLayouts.$inferSelect;
export const ALL_SCOPE = 'all';

function rowsFor(ctx: RequestContext, contextId: string): { cls: Row | null; all: Row | null } {
  const user = requireUser(ctx);
  const rows = ctx.db
    .select()
    .from(classroomLayouts)
    .where(and(eq(classroomLayouts.userId, user.id), inArray(classroomLayouts.scope, [contextId, ALL_SCOPE])))
    .all();
  return { cls: rows.find((r) => r.scope === contextId) ?? null, all: rows.find((r) => r.scope === ALL_SCOPE) ?? null };
}

function respond(rows: { cls: Row | null; all: Row | null }): C.ClassroomLayoutResponse {
  if (rows.cls && isValidLayout(rows.cls.layoutJson)) return { layout: rows.cls.layoutJson, source: 'class' };
  if (rows.all && isValidLayout(rows.all.layoutJson)) return { layout: rows.all.layoutJson, source: 'all' };
  return { layout: null, source: 'default' };
}

/** The layout that applies to this class+subject for the signed-in teacher, with its ETag. */
export function readLayout(ctx: RequestContext, contextId: string): { etag: string; body: C.ClassroomLayoutResponse } {
  const context = assertOwnsContext(ctx, contextId);
  const rows = rowsFor(ctx, context.id);
  const part = (r: Row | null) => (r ? `${r.version}-${r.updatedAt}` : '0');
  return { etag: `"layout.${part(rows.cls)}.${part(rows.all)}"`, body: respond(rows) };
}

function upsert(ctx: RequestContext, scope: string, layout: unknown) {
  const user = requireUser(ctx);
  const now = ctx.now();
  const existing = ctx.db
    .select({ version: classroomLayouts.version })
    .from(classroomLayouts)
    .where(and(eq(classroomLayouts.userId, user.id), eq(classroomLayouts.scope, scope)))
    .get();
  ctx.db
    .insert(classroomLayouts)
    .values({ userId: user.id, scope, layoutJson: layout, version: 1, updatedAt: now })
    .onConflictDoUpdate({ target: [classroomLayouts.userId, classroomLayouts.scope], set: { layoutJson: layout, version: (existing?.version ?? 0) + 1, updatedAt: now } })
    .run();
}

/**
 * Save the teacher's layout for this class+subject, or for all of them ('all' also forgets the
 * per-class layouts, so every class shows the one just saved).
 */
export function saveLayout(ctx: RequestContext, input: In<typeof C.saveClassroomLayout>): C.ClassroomLayoutResponse {
  const context = assertOwnsContext(ctx, input.contextId);
  const issues = layoutIssues(input.layout);
  if (issues.length) throw invalid('This layout is not valid', { reason: 'INVALID_LAYOUT', issues });
  const user = requireUser(ctx);
  tx(ctx.db, () => {
    if (input.applyTo === 'class') upsert(ctx, context.id, input.layout);
    else {
      upsert(ctx, ALL_SCOPE, input.layout);
      ctx.db
        .delete(classroomLayouts)
        .where(and(eq(classroomLayouts.userId, user.id), ne(classroomLayouts.scope, ALL_SCOPE)))
        .run();
    }
  });
  return respond(rowsFor(ctx, context.id));
}

/** Reset: forget this class's layout, or every layout of the teacher ('all'). */
export function resetLayout(ctx: RequestContext, input: In<typeof C.resetClassroomLayout>): C.ClassroomLayoutResponse {
  const context = assertOwnsContext(ctx, input.contextId);
  const user = requireUser(ctx);
  if (input.applyTo === 'class') {
    ctx.db
      .delete(classroomLayouts)
      .where(and(eq(classroomLayouts.userId, user.id), eq(classroomLayouts.scope, context.id)))
      .run();
  } else ctx.db.delete(classroomLayouts).where(eq(classroomLayouts.userId, user.id)).run();
  return respond(rowsFor(ctx, context.id));
}
