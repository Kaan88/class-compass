/** Homework (HW-1..4, ATT-1, DSH-8): assignments, statuses, fast checking with undo, views, outstanding work. */
import { z } from 'zod';
import { DEFAULT_HOMEWORK_STATUSES, HomeworkStatusSet } from '../../../shared/contracts/homework.ts';
import { defineServerModule } from '../manifest.ts';
import { registerHomeworkRoutes } from './routes.ts';
import { homeworkReport } from './service.ts';

/** Status list for new assignments (HW-2) and whether checking may happen on the classroom screen (D-075). */
export const homeworkConfigSchema = z.object({ statuses: HomeworkStatusSet, checkingInClassroom: z.boolean() });

export const homeworkManifest = defineServerModule({
  key: 'homework',
  policyKey: 'homework',
  routes: registerHomeworkRoutes,
  reports: [{ key: 'homework', order: 60, build: homeworkReport }],
  config: { schema: homeworkConfigSchema, defaults: { statuses: DEFAULT_HOMEWORK_STATUSES, checkingInClassroom: false } },
});
