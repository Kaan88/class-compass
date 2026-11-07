/**
 * Secret Students (SEC-1..7). Only this folder may read `secret_selections` (D-064): the lesson state,
 * the attendance listener and the close hook below return or record counts only before the reveal.
 */
import { z } from 'zod';
import { SECRET_DEFAULT_COUNT, SECRET_MAX_COUNT } from '../../../shared/contracts/secret.ts';
import { defineServerModule } from '../manifest.ts';
import { secretSection, secretTimeline } from './report.ts';
import { secretCommands, secretEndStep } from './commands.ts';
import { registerSecretRoutes, secretLessonState } from './routes.ts';
import { onAttendanceChange, onLessonClose } from './service.ts';

export const secretConfigSchema = z.object({ count: z.number().int().min(1).max(SECRET_MAX_COUNT) });

export const secretManifest = defineServerModule({
  key: 'secret',
  policyKey: 'secretStudents',
  routes: registerSecretRoutes,
  commands: secretCommands,
  lessonState: [secretLessonState],
  endSteps: [secretEndStep],
  // Revealed rounds only (SEC-3).
  reports: [{ key: 'secretStudents', order: 71, build: secretSection }],
  timeline: [{ key: 'secretStudents', order: 71, build: secretTimeline }],
  // A chosen student marked absent is replaced silently inside the attendance write (D-064).
  attendanceListeners: [onAttendanceChange],
  // Unrevealed rounds of abandoned lessons are closed and never shown (D-010).
  lessonCloseHooks: [onLessonClose],
  config: { schema: secretConfigSchema, defaults: { count: SECRET_DEFAULT_COUNT } },
});
