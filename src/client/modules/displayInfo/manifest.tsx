/**
 * Classroom screen size, recorded for administrators (S16c, D-165). Removable: see the header of
 * `src/server/modules/displayInfo/manifest.ts`. Core (no teacher-facing switch).
 */
import { defineClientModule } from '../types.ts';
import { ClassroomScreens } from './ClassroomScreens.tsx';
import { DisplayReporter } from './Reporter.tsx';

export const displayInfoClientManifest = defineClientModule({
  key: 'displayInfo',
  policyKey: null,
  i18nNamespace: 'displayInfo',
  boardWatchers: [{ key: 'displayInfo', Component: DisplayReporter }],
  maintenanceTabs: [{ key: 'displayInfo', order: 10, label: 'displayInfo.tab', Component: ClassroomScreens }],
});
