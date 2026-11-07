/**
 * Lesson commands (POST /api/commands). Handlers run inside the command transaction and re-verify
 * ownership + the active lesson (LES-4). Payload schemas are shared with the client outbox.
 */
import { pauseTimer, resetTimer, setTimer, startTimer } from '../../../domain/timer.ts';
import { LessonCommands } from '../../../shared/contracts/lessons.ts';
import { defineCommand } from '../../lib/commands.ts';
import { changeTimer, endLesson, setStage, startLesson } from './service.ts';

defineCommand({ type: 'lesson.start', payload: LessonCommands['lesson.start'], handle: (ctx, p, meta) => startLesson(ctx, p, meta) });
defineCommand({ type: 'lesson.setStage', payload: LessonCommands['lesson.setStage'], handle: (ctx, p, meta) => setStage(ctx, p, meta) });
defineCommand({ type: 'lesson.timer.start', payload: LessonCommands['lesson.timer.start'], handle: (ctx, p, meta) => changeTimer(ctx, p, meta, startTimer) });
defineCommand({ type: 'lesson.timer.pause', payload: LessonCommands['lesson.timer.pause'], handle: (ctx, p, meta) => changeTimer(ctx, p, meta, pauseTimer) });
defineCommand({ type: 'lesson.timer.reset', payload: LessonCommands['lesson.timer.reset'], handle: (ctx, p, meta) => changeTimer(ctx, p, meta, resetTimer) });
defineCommand({ type: 'lesson.timer.set', payload: LessonCommands['lesson.timer.set'], handle: (ctx, p, meta) => changeTimer(ctx, p, meta, () => setTimer(p.durationMs)) });
defineCommand({ type: 'lesson.end', payload: LessonCommands['lesson.end'], handle: (ctx, p, meta) => endLesson(ctx, p, meta) });
