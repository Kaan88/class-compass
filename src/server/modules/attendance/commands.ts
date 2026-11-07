/**
 * Classroom attendance commands (ACC-8, ATT-2, LES-4). Daily attendance is written for the lesson's
 * local day; any teacher of the class may change it (audited). Every command must name the active
 * lesson of a context the teacher owns.
 */
import { LessonCommands } from '../../../shared/contracts/lessons.ts';
import { command } from '../../lib/commands.ts';
import { assertModuleEnabled } from '../school/modules.ts';
import { lessonForCommand, updateLesson } from '../lessons/service.ts';
import { markAllPresentCore, setDailyCore, setExceptionCore } from './service.ts';

/** Listed in the manifest; registered once by installModules() (D-069). */
export const attendanceCommands = [
  command({
    type: 'attendance.setDaily',
    payload: LessonCommands['attendance.setDaily'],
    handle: (ctx, p, meta) => {
      const { context, cls, lesson } = lessonForCommand(ctx, p, meta);
      assertModuleEnabled(ctx.db, context.id, 'attendance');
      const row = setDailyCore(ctx, cls, lesson.localDate, p.studentId, p.status, undefined, meta.opId);
      return { studentId: p.studentId, status: row?.status ?? null };
    },
  }),
  command({
    type: 'attendance.setLessonException',
    payload: LessonCommands['attendance.setLessonException'],
    handle: (ctx, p, meta) => {
      const { context, lesson } = lessonForCommand(ctx, p, meta);
      assertModuleEnabled(ctx.db, context.id, 'attendance');
      if (setExceptionCore(ctx, lesson, p.studentId, p.status, undefined, meta.opId)) updateLesson(ctx, lesson, {});
      return { studentId: p.studentId, status: p.status };
    },
  }),
  command({
    type: 'attendance.markAllPresent',
    payload: LessonCommands['attendance.markAllPresent'],
    handle: (ctx, p, meta) => {
      const { context, cls, lesson } = lessonForCommand(ctx, p, meta);
      assertModuleEnabled(ctx.db, context.id, 'attendance');
      return { marked: markAllPresentCore(ctx, cls, lesson.localDate, meta.opId) };
    },
  })
];

