/** Shared daily attendance and lesson exceptions (ACC-8, ATT-2). */
import { defineServerModule } from '../manifest.ts';
import { attendanceSection, attendanceTimeline } from './report.ts';
import { attendanceCommands } from './commands.ts';
import { registerAttendanceRoutes } from './routes.ts';

export const attendanceManifest = defineServerModule({
  key: 'attendance',
  policyKey: 'attendance',
  routes: registerAttendanceRoutes,
  commands: attendanceCommands,
  reports: [
    {
      key: 'attendance',
      order: 20,
      meta: {
        title: 'report.section.attendance',
        tables: [
          { key: 'students', title: 'report.attendance.byStudent' },
          { key: 'weeks', title: 'report.attendance.byWeek' },
        ],
      },
      build: attendanceSection,
    },
  ],
  timeline: [{ key: 'attendance', order: 20, build: attendanceTimeline }],
});
