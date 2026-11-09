/**
 * Client module registry (SX, D-069): one line per module manifest (`<module>/manifest.tsx`). Read it
 * through `registry.ts`. See docs/EXTENDING.md.
 */
import { assistantClientManifest } from './assistant/manifest.tsx';
import { attendanceClientManifest } from './attendance/manifest.tsx';
import { coreClientManifest } from './core/manifest.tsx';
import { countersClientManifest } from './counters/manifest.tsx';
import { goalsClientManifest } from './goals/manifest.tsx';
import { groupingClientManifest } from './grouping/manifest.tsx';
import { homeworkClientManifest } from './homework/manifest.tsx';
import { lessonsClientManifest } from './lessons/manifest.tsx';
import { linksClientManifest } from './links/manifest.tsx';
import { routinesClientManifest } from './routines/manifest.tsx';
import { secretClientManifest } from './secret/manifest.tsx';
import { achievementsClientManifest } from './achievements/manifest.tsx';
import { avatarsClientManifest } from './avatars/manifest.tsx';
import { textChecksClientManifest } from './textChecks/manifest.tsx';
import { superSpeakersClientManifest } from './superSpeakers/manifest.tsx';
import { notificationsClientManifest } from './notifications/manifest.tsx';
import type { ClientModuleManifest } from './types.ts';

export const CLIENT_MODULES: readonly ClientModuleManifest[] = [
  coreClientManifest,
  lessonsClientManifest,
  routinesClientManifest,
  attendanceClientManifest,
  countersClientManifest,
  assistantClientManifest,
  secretClientManifest,
  groupingClientManifest,
  homeworkClientManifest,
  goalsClientManifest,
  linksClientManifest,
  achievementsClientManifest,
  avatarsClientManifest,
  textChecksClientManifest,
  superSpeakersClientManifest,
  notificationsClientManifest,
];
