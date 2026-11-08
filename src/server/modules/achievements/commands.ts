/**
 * Achievements in class (S13c item 5, D-122): giving a manual badge is an outbox command (no PIN, like
 * the counters), and so is undo within 10 minutes. Later, removing an award is a PIN-gated revoke in
 * the teacher area. The End Lesson "Well done!" step (item 7) writes nothing.
 */
import { AchievementCommands, AchievementsEndStepInput } from '../../../shared/contracts/achievements.ts';
import { command } from '../../lib/commands.ts';
import { endLessonStep } from '../lessons/endSteps.ts';
import { classroomAward, classroomUndo, settingsOf, wellDoneStep } from './service.ts';

export const achievementsCommands = [
  command({ type: 'achievements.award', payload: AchievementCommands['achievements.award'], handle: (ctx, p, meta) => classroomAward(ctx, p, meta) }),
  command({ type: 'achievements.undo', payload: AchievementCommands['achievements.undo'], handle: (ctx, p, meta) => classroomUndo(ctx, p, meta) }),
];

/** Shown only when the class chose the End Lesson "Well done!" moment. */
export const achievementsEndStep = endLessonStep({
  key: 'achievementsWellDone',
  module: 'achievements',
  order: 70,
  input: AchievementsEndStepInput,
  when: (db, contextId) => settingsOf(db, contextId).announce === 'endOfLesson',
  apply: () => wellDoneStep(),
});
