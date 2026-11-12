/**
 * Module availability (CFG-1/2, ACC-5/12, D-014). Effective = admin global availability AND the
 * teacher's per-context switch (default on, or off for an opt-in module such as Lesson goals: the
 * catalogue's `contextDefault`, S25d, D-188). Disabling only flips flags: no data is ever deleted.
 * Later stages call `isModuleEnabled` before serving or accepting module data.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import {
  CONTEXT_MODULES,
  DEFAULT_AVAILABILITY,
  MEDIA_MODULES,
  MODULE_KEYS,
  type ContextModule,
  type MediaModule,
  type ModuleKey,
} from '../../../shared/contracts/school.ts';
import { contextDefaultOn } from '../../../shared/modules.ts';
import type { Db } from '../../db/client.ts';
import { contextModules, modulePolicies } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';

export const isContextModule = (m: string): m is ContextModule => (CONTEXT_MODULES as readonly string[]).includes(m);

/** Admin availability for every module (missing rows fall back to the documented defaults). */
export function getAvailability(db: Db): Record<ModuleKey, boolean> {
  const rows = db.select().from(modulePolicies).all();
  const byKey = new Map(rows.map((r) => [r.module, r.availability]));
  const out = {} as Record<ModuleKey, boolean>;
  for (const k of MODULE_KEYS) out[k] = (byKey.get(k) ?? DEFAULT_AVAILABILITY[k]) === 'enabled';
  return out;
}

export function isModuleAvailable(db: Db, module: ModuleKey): boolean {
  const row = db.select().from(modulePolicies).where(eq(modulePolicies.module, module)).get();
  return (row?.availability ?? DEFAULT_AVAILABILITY[module]) === 'enabled';
}

/**
 * Is `module` usable in teaching context `contextId`? Media flags are global (admin only); context
 * modules additionally need the teacher's switch (no row = the catalogue's `contextDefault`, on unless
 * the module is opt-in, D-188).
 */
export function isModuleEnabled(db: Db, contextId: string, module: ModuleKey): boolean {
  if (!isModuleAvailable(db, module)) return false;
  if (!isContextModule(module)) return true;
  const row = db
    .select({ enabled: contextModules.enabled })
    .from(contextModules)
    .where(and(eq(contextModules.contextId, contextId), eq(contextModules.module, module)))
    .get();
  return row?.enabled ?? contextDefaultOn(module);
}

/**
 * `isModuleEnabled` for many contexts at once (S15a, D-162): the admin availability and the
 * teacher's switches of `contextIds` are read in two queries, then each answer follows exactly the
 * same rules (unknown contexts fall back to "no row = enabled", as `isModuleEnabled` does).
 */
export function moduleEnabledLookup(db: Db, contextIds: readonly string[]): (contextId: string, module: ModuleKey) => boolean {
  const available = getAvailability(db);
  const switches = new Map<string, boolean>();
  const ids = [...new Set(contextIds)];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = db.select({ contextId: contextModules.contextId, module: contextModules.module, enabled: contextModules.enabled }).from(contextModules).where(inArray(contextModules.contextId, ids.slice(i, i + 500))).all();
    for (const r of rows) switches.set(`${r.contextId}:${r.module}`, r.enabled);
  }
  return (contextId, module) => {
    if (!available[module]) return false;
    if (!isContextModule(module)) return true;
    return switches.get(`${contextId}:${module}`) ?? contextDefaultOn(module);
  };
}

/** Throw FEATURE_DISABLED unless the module is usable in the context. */
export function assertModuleEnabled(db: Db, contextId: string, module: ModuleKey): void {
  if (!isModuleEnabled(db, contextId, module)) throw new AppError('FEATURE_DISABLED', `Module ${module} is turned off`, { module });
}

export type MediaPolicy = { studentPhotos: boolean; evidencePhotos: boolean; evidenceAudio: boolean; evidenceDocuments: boolean; evidenceVideo: boolean; avatarPictures: boolean };

/** Global media flags (D-014). Upload endpoints must reject when the matching flag is off. */
export function getMediaPolicy(db: Db): MediaPolicy {
  const a = getAvailability(db);
  return {
    studentPhotos: a['media.studentPhotos'],
    evidencePhotos: a['media.evidencePhotos'],
    evidenceAudio: a['media.evidenceAudio'],
    evidenceDocuments: a['media.evidenceDocuments'],
    evidenceVideo: a['media.evidenceVideo'],
    avatarPictures: a['media.avatarPictures'],
  };
}

export function mediaRecord(db: Db): Record<MediaModule, boolean> {
  const a = getAvailability(db);
  return Object.fromEntries(MEDIA_MODULES.map((m) => [m, a[m]])) as Record<MediaModule, boolean>;
}

export interface ContextModuleState {
  module: ContextModule;
  available: boolean;
  enabled: boolean;
  effective: boolean;
  config: Record<string, unknown> | null;
}

export function contextModuleStates(db: Db, contextId: string): ContextModuleState[] {
  const avail = getAvailability(db);
  const rows = db.select().from(contextModules).where(eq(contextModules.contextId, contextId)).all();
  const byKey = new Map(rows.map((r) => [r.module, r]));
  return CONTEXT_MODULES.map((m) => {
    const row = byKey.get(m);
    const enabled = row?.enabled ?? contextDefaultOn(m);
    return {
      module: m,
      available: avail[m],
      enabled,
      effective: avail[m] && enabled,
      config: row?.configJson ? (JSON.parse(row.configJson) as Record<string, unknown>) : null,
    };
  });
}

/** The teacher's stored config of a context module (null when none was saved). */
export function getModuleConfig(db: Db, contextId: string, module: ContextModule): Record<string, unknown> | null {
  const row = db
    .select({ configJson: contextModules.configJson })
    .from(contextModules)
    .where(and(eq(contextModules.contextId, contextId), eq(contextModules.module, module)))
    .get();
  if (!row?.configJson) return null;
  try {
    return JSON.parse(row.configJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Merge `patch` into a context module's config, keeping the teacher's on/off switch (no row = on).
 * The patch is validated against the manifest schema first (400 `INVALID_MODULE_CONFIG`), like
 * `setContextModule`, so every write path enforces it. Callers check ownership and audit; must run
 * inside a transaction.
 */
export function mergeModuleConfig(db: Db, contextId: string, module: ContextModule, patch: Record<string, unknown>, userId: string, now: number): Record<string, unknown> {
  const valid = validateModuleConfig(module, patch);
  const row = db.select().from(contextModules).where(and(eq(contextModules.contextId, contextId), eq(contextModules.module, module))).get();
  const next = { ...(getModuleConfig(db, contextId, module) ?? {}), ...valid };
  const configJson = JSON.stringify(next);
  db.insert(contextModules)
    .values({ contextId, module, enabled: row?.enabled ?? contextDefaultOn(module), configJson, updatedAt: now, updatedBy: userId })
    .onConflictDoUpdate({ target: [contextModules.contextId, contextModules.module], set: { configJson, updatedAt: now, updatedBy: userId } })
    .run();
  return next;
}

// ---------------------------------------------------------------- module config schemas (SX, D-069)
/**
 * Default config + Zod schema of a context module's `configJson`, declared in its server manifest
 * (`config`). The schema describes the full config object; teacher patches are validated against its
 * partial form, so a module never stores keys it does not know.
 */
export interface ModuleConfigSpec<S extends z.ZodObject = z.ZodObject> {
  schema: S;
  defaults: z.infer<S>;
}

const configSpecs = new Map<ContextModule, ModuleConfigSpec>();

export function registerModuleConfig(module: ContextModule, spec: ModuleConfigSpec): void {
  if (configSpecs.has(module) && configSpecs.get(module) !== spec) throw new Error(`Duplicate config schema for module ${module}`);
  const ok = spec.schema.safeParse(spec.defaults);
  if (!ok.success) throw new Error(`Default config of module ${module} does not match its schema`);
  configSpecs.set(module, spec);
}

export const moduleConfigSpec = (module: ContextModule): ModuleConfigSpec | undefined => configSpecs.get(module);

/** Validate a (partial) config patch for `module`; modules without a schema accept any object. */
export function validateModuleConfig(module: ContextModule, config: Record<string, unknown>): Record<string, unknown> {
  const spec = configSpecs.get(module);
  if (!spec) return config;
  const parsed = spec.schema.partial().strict().safeParse(config);
  if (!parsed.success) throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid module settings', { module, reason: 'INVALID_MODULE_CONFIG' });
  return parsed.data as Record<string, unknown>;
}

/**
 * Effective config: the manifest defaults overlaid with the stored values that still match the schema
 * (a stored value that no longer validates falls back to its default).
 */
export function moduleConfig(db: Db, contextId: string, module: ContextModule): Record<string, unknown> {
  const spec = configSpecs.get(module);
  const stored = getModuleConfig(db, contextId, module) ?? {};
  if (!spec) return stored;
  const out: Record<string, unknown> = { ...(spec.defaults as Record<string, unknown>) };
  const shape = spec.schema.shape as Record<string, z.ZodType>;
  for (const [k, v] of Object.entries(stored)) {
    const field = shape[k];
    if (field && field.safeParse(v).success) out[k] = v;
  }
  return out;
}
