/**
 * Lesson commands (POST /api/commands). Handlers run inside the command transaction and re-verify
 * ownership + the active lesson (LES-4). Payload schemas are shared with the client outbox.
 */
import { pauseTimer, resetTimer, setTimer, startTimer } from '../../../domain/timer.ts';
import { LessonCommands } from '../../../shared/contracts/lessons.ts';
import { command } from '../../lib/commands.ts';
import { changeTimer, endLesson, setStage, startLesson } from './service.ts';

/** Listed in the manifest; registered once by installModules() (D-069). */
export const lessonCommands = [
  command({ type: 'lesson.start', payload: LessonCommands['lesson.start'], handle: (ctx, p, meta) => startLesson(ctx, p, meta) }),
  command({ type: 'lesson.setStage', payload: LessonCommands['lesson.setStage'], handle: (ctx, p, meta) => setStage(ctx, p, meta) }),
  command({ type: 'lesson.timer.start', payload: LessonCommands['lesson.timer.start'], handle: (ctx, p, meta) => changeTimer(ctx, p, meta, startTimer) }),
  command({ type: 'lesson.timer.pause', payload: LessonCommands['lesson.timer.pause'], handle: (ctx, p, meta) => changeTimer(ctx, p, meta, pauseTimer) }),
  command({ type: 'lesson.timer.reset', payload: LessonCommands['lesson.timer.reset'], handle: (ctx, p, meta) => changeTimer(ctx, p, meta, resetTimer) }),
  command({ type: 'lesson.timer.set', payload: LessonCommands['lesson.timer.set'], handle: (ctx, p, meta) => changeTimer(ctx, p, meta, () => setTimer(p.durationMs)) }),
  command({ type: 'lesson.end', payload: LessonCommands['lesson.end'], handle: (ctx, p, meta) => endLesson(ctx, p, meta) })
];
