/**
 * Classroom screen size, recorded for administrators (S16c, D-165). Core (`policyKey: null`): always
 * on, with no teacher-facing switch, because it records nothing about students and a per-class switch
 * would only puzzle teachers.
 *
 * How to remove this module (the owner asked for it to be easy):
 * 1. Delete `src/server/modules/displayInfo/`, `src/client/modules/displayInfo/`,
 *    `src/shared/contracts/displayInfo.ts`, `tests/server/displayInfo.test.ts`,
 *    `tests/client/displayInfo.test.tsx` and `e2e/display-info.spec.ts`.
 * 2. Remove `displayInfoManifest` from `SERVER_MODULES` (`src/server/modules/index.ts`) and
 *    `displayInfoClientManifest` from `CLIENT_MODULES` (`src/client/modules/index.ts`).
 * 3. Remove the `'displayInfo.lastSeen'` line (and its import) from `USER_SETTINGS`
 *    (`src/server/lib/userSettings.ts`).
 * 4. Delete the `displayInfo.*` keys from `src/shared/i18n/en.ts` and `tr.ts`, and the "Classroom
 *    screens" section from `docs/guides/{en,tr}/admin.md`.
 * 5. Optionally drop the stored rows (no migration is involved):
 *    `DELETE FROM user_settings WHERE key = 'displayInfo.lastSeen';`
 * There is no catalogue line to remove: as a core module it is not in `src/shared/modules.ts`. The
 * generic client hooks it uses (`boardWatchers`, `maintenanceTabs`) stay and simply have no entries.
 */
import { defineServerModule } from '../manifest.ts';
import { registerDisplayInfoRoutes } from './routes.ts';

export const displayInfoManifest = defineServerModule({ key: 'displayInfo', policyKey: null, routes: registerDisplayInfoRoutes });
