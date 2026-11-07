/** Shared daily attendance and lesson exceptions (ACC-8, ATT-2). */
import { defineServerModule } from '../manifest.ts';
import { attendanceCommands } from './commands.ts';
import { registerAttendanceRoutes } from './routes.ts';

export const attendanceManifest = defineServerModule({
  key: 'attendance',
  policyKey: 'attendance',
  routes: registerAttendanceRoutes,
  commands: attendanceCommands,
});
