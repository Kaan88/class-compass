/**
 * Theme packages (S14g, D-158). Administrators import a JSON package; it is validated with the shared
 * validator (`shared/themePackage/validate.ts`: schema, contrast, sound limits, strict SVG) and stored
 * as a draft only when it has no errors. A draft can be previewed (the admin page builds it on the
 * client) but not chosen; enabling offers it next to the built-in themes; disabling keeps the classes'
 * choice but they show the default theme; deleting moves its classes and the board to the default.
 * Every change is audited (the key, status and size, never the whole package).
 *
 * Other modules use two helpers and never read `custom_themes` themselves:
 * - `assertThemeUsable(db, key)` before writing a theme key (classes, class display, the board);
 * - `effectiveTheme(db, key)` when sending a stored key to a screen (a package that is not enabled
 *   reads as the default theme).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type * as C from '../../../shared/contracts/themes.ts';
import { THEME_DRAFTS_PER_SCHOOL, THEME_DRAFTS_PER_TEACHER, type CustomThemeStatus, type CustomThemeSummary, type ThemeReportDto } from '../../../shared/contracts/themes.ts';
import { DEFAULT_THEME, isThemeKey, type ThemeKey } from '../../../shared/themes.ts';
import { PACKAGE_LIMITS } from '../../../shared/themePackage/limits.ts';
import type { ThemePackage } from '../../../shared/themePackage/schema.ts';
import { validateThemePackage } from '../../../shared/themePackage/validate.ts';
import { tx, type Db } from '../../db/client.ts';
import { classes, customThemes, superSpeakersSettings, users } from '../../db/schema.ts';
import { audit } from '../../lib/audit.ts';
import { requireUser, type RequestContext } from '../../lib/context.ts';
import { AppError, conflict, invalid, notFound } from '../../lib/errors.ts';
import { notifyBoardChange } from '../superSpeakers/events.ts';

type In<T extends { input: z.ZodType }> = z.infer<T['input']>;
type Row = typeof customThemes.$inferSelect;

/** Keys of the enabled imported themes. */
export function enabledThemeKeys(db: Db): Set<string> {
  return new Set(
    db
      .select({ key: customThemes.key })
      .from(customThemes)
      .where(eq(customThemes.status, 'enabled'))
      .all()
      .map((r) => r.key),
  );
}

/** Can a class or the board use this key now? Built-in themes always; imported ones while enabled. */
export function isThemeUsable(db: Db, key: string): boolean {
  if (isThemeKey(key)) return true;
  return db.select({ key: customThemes.key }).from(customThemes).where(and(eq(customThemes.key, key), eq(customThemes.status, 'enabled'))).get() !== undefined;
}

/** Throws 400 `THEME_NOT_AVAILABLE` unless the key is a built-in theme or an enabled package. */
export function assertThemeUsable(db: Db, key: string): void {
  if (!isThemeUsable(db, key)) throw invalid('This theme is not available', { reason: 'THEME_NOT_AVAILABLE', theme: key });
}

/** The theme a screen should show for a stored key: the key while usable, else the default theme. */
export function effectiveTheme(db: Db, key: string): ThemeKey {
  return isThemeUsable(db, key) ? key : DEFAULT_THEME;
}

function rowOf(db: Db, key: string): Row {
  const row = db.select().from(customThemes).where(eq(customThemes.key, key)).get();
  if (!row) throw notFound('Theme');
  return row;
}

const pkgOf = (r: Row) => r.packageJson as unknown as ThemePackage;

function usage(db: Db, key: string) {
  const n = db.select({ n: sql<number>`count(*)` }).from(classes).where(eq(classes.theme, key)).get()?.n ?? 0;
  const board = db.select({ theme: superSpeakersSettings.theme }).from(superSpeakersSettings).where(eq(superSpeakersSettings.id, 1)).get()?.theme === key;
  return { classCount: n, board };
}

/** The teacher who proposed a draft (S27d, D-196): the creator when that account is a teacher's. */
function proposerOf(db: Db, r: Row): CustomThemeSummary['proposedBy'] {
  if (!r.createdBy) return null;
  const u = db.select({ id: users.id, name: users.displayName, role: users.role }).from(users).where(eq(users.id, r.createdBy)).get();
  return u && u.role === 'teacher' ? { id: u.id, name: u.name } : null;
}

function summary(db: Db, r: Row): CustomThemeSummary {
  const p = pkgOf(r);
  const report = r.reportJson as unknown as ThemeReportDto;
  return {
    key: r.key,
    status: r.status,
    name: { en: p.name?.en ?? r.key, tr: p.name?.tr ?? r.key },
    base: p.base ?? DEFAULT_THEME,
    ...usage(db, r.key),
    warnings: report.warnings?.length ?? 0,
    bytes: r.bytes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    proposedBy: proposerOf(db, r),
  };
}

const auditOf = (r: Pick<Row, 'key' | 'status' | 'bytes'>, p: ThemePackage) => ({ key: r.key, status: r.status, base: p.base, name: p.name, bytes: r.bytes });

export function listThemes(ctx: RequestContext) {
  const rows = ctx.db.select().from(customThemes).all();
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return { themes: rows.map((r) => summary(ctx.db, r)), limit: PACKAGE_LIMITS.maxCustomThemes };
}

export function getTheme(ctx: RequestContext, input: In<typeof C.getCustomTheme>) {
  const r = rowOf(ctx.db, input.key);
  return { summary: summary(ctx.db, r), package: r.packageJson as z.infer<typeof C.getCustomTheme.output>['package'], report: r.reportJson as unknown as ThemeReportDto };
}

/** Checks a package; nothing is stored. `exists` says whether saving it would replace a theme. */
export function validateTheme(ctx: RequestContext, input: In<typeof C.validateCustomTheme>) {
  const { report, pkg } = validateThemePackage(input.source);
  const exists = report.key !== null && ctx.db.select({ key: customThemes.key }).from(customThemes).where(eq(customThemes.key, report.key)).get() !== undefined;
  return { report, package: pkg as unknown as z.infer<typeof C.validateCustomTheme.output>['package'], exists };
}

/** Validates and returns the package, or throws 400 `THEME_INVALID` with the report. */
function validOrThrow(source: string): { pkg: ThemePackage; report: ThemeReportDto; bytes: number } {
  const { report, pkg } = validateThemePackage(source);
  if (!pkg) throw invalid('The theme package has errors', { reason: 'THEME_INVALID', errors: report.errors.slice(0, 20) });
  return { pkg, report, bytes: report.stats.bytes };
}

export function createTheme(ctx: RequestContext, input: In<typeof C.createCustomTheme>): CustomThemeSummary {
  return saveDraft(ctx, input.source, 'theme.create');
}

/**
 * A teacher's proposal (S27d, D-196): the same validation and limits as an import, saved as a draft
 * that records the teacher (`created_by`, shown as "Proposed by" on Admin → Themes), at most
 * `THEME_DRAFTS_PER_TEACHER` waiting drafts per teacher. Never enabled and never assigned here.
 */
export function proposeTheme(ctx: RequestContext, input: In<typeof C.proposeCustomTheme>): CustomThemeSummary {
  return saveDraft(ctx, input.source, 'theme.propose');
}

function saveDraft(ctx: RequestContext, source: string, action: 'theme.create' | 'theme.propose'): CustomThemeSummary {
  const user = requireUser(ctx);
  const { pkg, report, bytes } = validOrThrow(source);
  return tx(ctx.db, () => {
    if (ctx.db.select({ key: customThemes.key }).from(customThemes).where(eq(customThemes.key, pkg.key)).get()) throw conflict('A theme with this key exists', { reason: 'THEME_KEY_TAKEN' });
    // Teachers' waiting drafts have their own room (S27d review, D-196): at most THEME_DRAFTS_PER_TEACHER
    // per teacher and THEME_DRAFTS_PER_SCHOOL together, and they never count against the administrators'
    // limit of imported themes, so proposals can never block an administrator's import.
    const teacherDrafts =
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(customThemes)
        .innerJoin(users, eq(users.id, customThemes.createdBy))
        .where(and(eq(customThemes.status, 'draft'), eq(users.role, 'teacher')))
        .get()?.n ?? 0;
    if (action === 'theme.propose') {
      const open = ctx.db.select({ n: sql<number>`count(*)` }).from(customThemes).where(and(eq(customThemes.createdBy, user.id), eq(customThemes.status, 'draft'))).get()?.n ?? 0;
      if (open >= THEME_DRAFTS_PER_TEACHER) throw conflict('Too many theme drafts are waiting', { reason: 'THEME_DRAFT_LIMIT', limit: THEME_DRAFTS_PER_TEACHER });
      if (teacherDrafts >= THEME_DRAFTS_PER_SCHOOL) throw conflict('Too many theme drafts from teachers are waiting', { reason: 'THEME_DRAFTS_SCHOOL_LIMIT', limit: THEME_DRAFTS_PER_SCHOOL });
    } else {
      const count = ctx.db.select({ n: sql<number>`count(*)` }).from(customThemes).get()?.n ?? 0;
      if (count - teacherDrafts >= PACKAGE_LIMITS.maxCustomThemes) throw conflict('Too many imported themes', { reason: 'THEME_LIMIT', limit: PACKAGE_LIMITS.maxCustomThemes });
    }
    const now = ctx.now();
    const row: Row = {
      key: pkg.key,
      packageJson: pkg as unknown as Record<string, unknown>,
      reportJson: report as unknown as Record<string, unknown>,
      status: 'draft',
      bytes,
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
    };
    ctx.db.insert(customThemes).values(row).run();
    audit(ctx.db, ctx.actor, { action, entity: 'custom_theme', entityId: row.key, after: auditOf(row, pkg) }, now);
    return summary(ctx.db, row);
  });
}

export function replaceTheme(ctx: RequestContext, input: In<typeof C.replaceCustomTheme>): CustomThemeSummary {
  const user = requireUser(ctx);
  const { pkg, report, bytes } = validOrThrow(input.source);
  if (pkg.key !== input.key) throw invalid('The package key does not match this theme', { reason: 'THEME_KEY_MISMATCH' });
  return tx(ctx.db, () => {
    const before = rowOf(ctx.db, input.key);
    const now = ctx.now();
    ctx.db
      .update(customThemes)
      .set({ packageJson: pkg as unknown as Record<string, unknown>, reportJson: report as unknown as Record<string, unknown>, bytes, updatedBy: user.id, updatedAt: now })
      .where(eq(customThemes.key, input.key))
      .run();
    const after = rowOf(ctx.db, input.key);
    notifyBoardIfUsing(ctx.db, input.key);
    audit(ctx.db, ctx.actor, { action: 'theme.replace', entity: 'custom_theme', entityId: input.key, before: auditOf(before, pkgOf(before)), after: auditOf(after, pkg) }, now);
    return summary(ctx.db, after);
  });
}

export function setThemeStatus(ctx: RequestContext, key: string, status: Exclude<CustomThemeStatus, 'draft'>): CustomThemeSummary {
  const user = requireUser(ctx);
  return tx(ctx.db, () => {
    const before = rowOf(ctx.db, key);
    if (before.status === status) return summary(ctx.db, before);
    // A package is re-checked before it goes live: the limits may have changed since it was imported.
    if (status === 'enabled') {
      const { report } = validateThemePackage(before.packageJson);
      if (!report.ok) throw invalid('The theme package has errors', { reason: 'THEME_INVALID', errors: report.errors.slice(0, 20) });
    }
    const now = ctx.now();
    ctx.db.update(customThemes).set({ status, updatedBy: user.id, updatedAt: now }).where(eq(customThemes.key, key)).run();
    const after = rowOf(ctx.db, key);
    notifyBoardIfUsing(ctx.db, key);
    audit(ctx.db, ctx.actor, { action: status === 'enabled' ? 'theme.enable' : 'theme.disable', entity: 'custom_theme', entityId: key, before: { status: before.status }, after: { status, ...usage(ctx.db, key) } }, now);
    return summary(ctx.db, after);
  });
}

export function deleteTheme(ctx: RequestContext, input: In<typeof C.deleteCustomTheme>) {
  if (input.confirm.trim() !== input.key) throw invalid('Type the theme key to confirm', { reason: 'CONFIRMATION_MISMATCH' });
  return tx(ctx.db, () => {
    const before = rowOf(ctx.db, input.key);
    const now = ctx.now();
    // Theme is a display choice, not history: every class (archived ones too) moves to the default.
    const moved = ctx.db.select({ id: classes.id }).from(classes).where(eq(classes.theme, input.key)).all().map((c) => c.id);
    if (moved.length) ctx.db.update(classes).set({ theme: DEFAULT_THEME, updatedAt: now }).where(inArray(classes.id, moved)).run();
    const board = ctx.db.select({ theme: superSpeakersSettings.theme }).from(superSpeakersSettings).where(eq(superSpeakersSettings.id, 1)).get()?.theme === input.key;
    if (board) {
      ctx.db.update(superSpeakersSettings).set({ theme: DEFAULT_THEME, updatedAt: now }).where(eq(superSpeakersSettings.id, 1)).run();
      notifyBoardChange();
    }
    ctx.db.delete(customThemes).where(eq(customThemes.key, input.key)).run();
    audit(
      ctx.db,
      ctx.actor,
      { action: 'theme.delete', entity: 'custom_theme', entityId: input.key, before: auditOf(before, pkgOf(before)), after: { movedClassIds: moved, movedBoard: board, to: DEFAULT_THEME } },
      now,
    );
    return { ok: true as const, movedClasses: moved.length, movedBoard: board };
  });
}

/** Enabled packages for the pickers. */
export function availableThemes(ctx: RequestContext) {
  const rows = ctx.db.select().from(customThemes).where(eq(customThemes.status, 'enabled')).all();
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return { themes: rows.map((r) => r.packageJson as z.infer<typeof C.availableThemes.output>['themes'][number]) };
}

/**
 * One enabled package (public; drafts, disabled and unknown keys are 404) with its ETag, which changes
 * whenever the package is replaced: open screens re-check it and pick up a replaced package (D-158).
 */
export function publicTheme(ctx: RequestContext, input: In<typeof C.publicCustomTheme>) {
  const r = ctx.db.select().from(customThemes).where(and(eq(customThemes.key, input.key), eq(customThemes.status, 'enabled'))).get();
  if (!r) throw new AppError('NOT_FOUND', 'Theme not found');
  return { etag: `"${r.key}-${r.updatedAt}"`, body: r.packageJson as z.infer<typeof C.publicCustomTheme.output> };
}

/**
 * Revision of an enabled imported theme (its last change), or null for a built-in or unusable key.
 * The board mixes it into its version, so a replaced package reaches an open board (D-158).
 */
export function themeRevision(db: Db, key: string): number | null {
  if (isThemeKey(key)) return null;
  return db.select({ at: customThemes.updatedAt }).from(customThemes).where(and(eq(customThemes.key, key), eq(customThemes.status, 'enabled'))).get()?.at ?? null;
}

/** Tells open Super Speakers boards to re-check when a change to `key` changes what they show. */
function notifyBoardIfUsing(db: Db, key: string): void {
  if (usage(db, key).board) notifyBoardChange();
}
