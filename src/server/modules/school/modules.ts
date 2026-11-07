/**
 * Module availability (CFG-1/2, ACC-5/12, D-014). Effective = admin global availability AND the
 * teacher's per-context switch (default on). Disabling only flips flags: no data is ever deleted.
 * Later stages call `isModuleEnabled` before serving or accepting module data.
 */
import { and, eq } from 'drizzle-orm';
import {
  CONTEXT_MODULES,
  DEFAULT_AVAILABILITY,
  MEDIA_MODULES,
  MODULE_KEYS,
  type ContextModule,
  type MediaModule,
  type ModuleKey,
} from '../../../shared/contracts/school.ts';
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
 * modules additionally need the teacher's switch (no row = enabled).
 */
export function isModuleEnabled(db: Db, contextId: string, module: ModuleKey): boolean {
  if (!isModuleAvailable(db, module)) return false;
  if (!isContextModule(module)) return true;
  const row = db
    .select({ enabled: contextModules.enabled })
    .from(contextModules)
    .where(and(eq(contextModules.contextId, contextId), eq(contextModules.module, module)))
    .get();
  return row?.enabled ?? true;
}

/** Throw FEATURE_DISABLED unless the module is usable in the context. */
export function assertModuleEnabled(db: Db, contextId: string, module: ModuleKey): void {
  if (!isModuleEnabled(db, contextId, module)) throw new AppError('FEATURE_DISABLED', `Module ${module} is turned off`, { module });
}

export type MediaPolicy = { studentPhotos: boolean; evidencePhotos: boolean; evidenceAudio: boolean; evidenceDocuments: boolean };

/** Global media flags (D-014). Upload endpoints must reject when the matching flag is off. */
export function getMediaPolicy(db: Db): MediaPolicy {
  const a = getAvailability(db);
  return {
    studentPhotos: a['media.studentPhotos'],
    evidencePhotos: a['media.evidencePhotos'],
    evidenceAudio: a['media.evidenceAudio'],
    evidenceDocuments: a['media.evidenceDocuments'],
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
    const enabled = row?.enabled ?? true;
    return {
      module: m,
      available: avail[m],
      enabled,
      effective: avail[m] && enabled,
      config: row?.configJson ? (JSON.parse(row.configJson) as Record<string, unknown>) : null,
    };
  });
}
