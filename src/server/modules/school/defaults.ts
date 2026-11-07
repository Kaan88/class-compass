import { DEFAULT_AVAILABILITY, MODULE_KEYS } from '../../../shared/contracts/school.ts';
import { modulePolicies, schoolSettings } from '../../db/schema.ts';
import type { AppDeps } from '../../lib/context.ts';

/**
 * Idempotent startup seed: the single school_settings row (timezone from DEFAULT_TIMEZONE) and one
 * module_policies row per module with the documented defaults (media photos/audio OFF, D-014).
 * Existing rows are never changed.
 */
export function ensureSchoolDefaults(deps: AppDeps): void {
  const now = deps.now();
  deps.db
    .insert(schoolSettings)
    .values({ id: 1, timezone: deps.config.DEFAULT_TIMEZONE, updatedAt: now })
    .onConflictDoNothing()
    .run();
  for (const module of MODULE_KEYS) {
    deps.db
      .insert(modulePolicies)
      .values({ module, availability: DEFAULT_AVAILABILITY[module], updatedAt: now, updatedBy: null })
      .onConflictDoNothing()
      .run();
  }
}
