/**
 * Report catalogue and saved report views (S14e1, D-153).
 * - The catalogue lists every report section with its tables (`ReportContribution.meta`); with a
 *   class+subject, only the sections of the modules switched on there (after the report access check).
 * - Saved views belong to the signed-in account and to the area they were saved in (teacher or admin):
 *   a teacher never sees or changes another account's views (404). At most MAX_REPORT_VIEWS per
 *   account, names unique per account and area; deleting is final (a personal preference, not history).
 * - The default view is the user setting `reports.defaultView.<viewer>`; deleting the default view
 *   puts the default back to "Everything".
 * Views hold section and table keys only (no class, student or period), so they carry no student data
 * and are not audited.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { ReportCatalog, ReportViews, SavedReportView } from '../../../shared/contracts/reports.ts';
import { builtinOf, MAX_REPORT_VIEWS, type ReportViewSpec, type ViewRef } from '../../../shared/reportViews.ts';
import { lowerTr } from '../../../shared/text/turkish.ts';
import { tx } from '../../db/client.ts';
import { reportViews } from '../../db/schema.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { newId } from '../../lib/crypto.ts';
import { conflict, invalid, notFound } from '../../lib/errors.ts';
import { clearUserSetting, getUserSetting, setUserSetting, type UserSettingKey } from '../../lib/userSettings.ts';
import { allReportContributions, reportContributions } from '../index.ts';
import { key } from './cells.ts';
import { reportableContext, type Viewer } from './scope.ts';

const defaultKey = (viewer: Viewer): UserSettingKey => (viewer === 'admin' ? 'reports.defaultView.admin' : 'reports.defaultView.teacher');

export function reportCatalog(ctx: RequestContext, viewer: Viewer, contextId?: string): ReportCatalog {
  const list = contextId ? reportContributions(ctx.db, reportableContext(ctx, contextId, viewer).id) : allReportContributions();
  return {
    sections: list.map((c) => ({
      key: c.key,
      module: c.module,
      title: key(c.meta.title),
      tables: c.meta.tables.map((t) => ({ key: t.key, title: key(t.title), perItem: t.perItem === true })),
    })),
  };
}

/** Every section and table of the spec must exist in the catalogue (a module that is off for a class still counts). */
function assertKnownSpec(spec: ReportViewSpec) {
  const all = allReportContributions();
  for (const s of spec.sections) {
    const c = all.find((x) => x.key === s.key);
    if (!c) throw invalid('Unknown report section', { reason: 'REPORT_VIEW_UNKNOWN_SECTION', section: s.key });
    for (const t of s.tables ?? []) {
      if (!c.meta.tables.some((m) => m.key === t)) throw invalid('Unknown report table', { reason: 'REPORT_VIEW_UNKNOWN_SECTION', section: s.key, table: t });
    }
  }
}

type Row = typeof reportViews.$inferSelect;
const out = (r: Row): SavedReportView => ({ id: r.id, name: r.name, spec: r.specJson, updatedAt: r.updatedAt });

function mine(ctx: RequestContext, viewer: Viewer): Row[] {
  const user = requireUser(ctx);
  return ctx.db
    .select()
    .from(reportViews)
    .where(and(eq(reportViews.userId, user.id), eq(reportViews.viewer, viewer)))
    .orderBy(asc(reportViews.createdAt))
    .all();
}

function ownView(ctx: RequestContext, viewer: Viewer, viewId: string): Row {
  const row = mine(ctx, viewer).find((r) => r.id === viewId);
  if (!row) throw notFound('Report view');
  return row;
}

function assertNameFree(rows: readonly Row[], name: string, except?: string) {
  const folded = lowerTr(name.trim());
  if (rows.some((r) => r.id !== except && lowerTr(r.name) === folded)) throw conflict('A view with this name already exists', { reason: 'REPORT_VIEW_NAME_TAKEN' });
}

/** The default view, or "Everything" when the stored one is gone or unknown. */
function defaultViewOf(ctx: RequestContext, viewer: Viewer, rows: readonly Row[]): ViewRef {
  const ref = getUserSetting(ctx.db, requireUser(ctx).id, defaultKey(viewer));
  if (builtinOf(ref) || rows.some((r) => r.id === ref)) return ref;
  return 'builtin:everything';
}

export function listReportViews(ctx: RequestContext, viewer: Viewer): ReportViews {
  const rows = mine(ctx, viewer);
  return { views: rows.map(out), defaultView: defaultViewOf(ctx, viewer, rows), max: MAX_REPORT_VIEWS };
}

export function createReportView(ctx: RequestContext, viewer: Viewer, input: { name: string; spec: ReportViewSpec }): SavedReportView {
  assertKnownSpec(input.spec);
  const user = requireUser(ctx);
  return tx(ctx.db, (db) => {
    // Counted over both areas: the limit is per account.
    const count = db.select({ id: reportViews.id }).from(reportViews).where(eq(reportViews.userId, user.id)).all().length;
    if (count >= MAX_REPORT_VIEWS) throw conflict('Too many saved views', { reason: 'REPORT_VIEWS_LIMIT', max: MAX_REPORT_VIEWS });
    assertNameFree(mine({ ...ctx, db }, viewer), input.name);
    const now = ctx.now();
    const row: Row = { id: newId(), userId: user.id, viewer, name: input.name.trim(), specJson: input.spec, createdAt: now, updatedAt: now };
    db.insert(reportViews).values(row).run();
    return out(row);
  });
}

export function updateReportView(ctx: RequestContext, viewer: Viewer, input: { viewId: string; name?: string | undefined; spec?: ReportViewSpec | undefined }): SavedReportView {
  if (input.spec) assertKnownSpec(input.spec);
  return tx(ctx.db, (db) => {
    const c = { ...ctx, db };
    const row = ownView(c, viewer, input.viewId);
    if (input.name !== undefined) assertNameFree(mine(c, viewer), input.name, row.id);
    const next: Row = { ...row, name: input.name?.trim() ?? row.name, specJson: input.spec ?? row.specJson, updatedAt: ctx.now() };
    db.update(reportViews).set({ name: next.name, specJson: next.specJson, updatedAt: next.updatedAt }).where(eq(reportViews.id, row.id)).run();
    return out(next);
  });
}

export function deleteReportView(ctx: RequestContext, viewer: Viewer, viewId: string): { ok: true } {
  const user = requireUser(ctx);
  tx(ctx.db, (db) => {
    const row = ownView({ ...ctx, db }, viewer, viewId);
    db.delete(reportViews).where(eq(reportViews.id, row.id)).run();
    if (getUserSetting(db, user.id, defaultKey(viewer)) === row.id) clearUserSetting(db, user.id, defaultKey(viewer));
  });
  return { ok: true };
}

export function setDefaultReportView(ctx: RequestContext, viewer: Viewer, view: ViewRef): { ok: true } {
  const user = requireUser(ctx);
  if (view.startsWith('builtin:')) {
    if (!builtinOf(view)) throw notFound('Report view');
  } else ownView(ctx, viewer, view);
  setUserSetting(ctx.db, user.id, defaultKey(viewer), view, ctx.now());
  return { ok: true };
}
