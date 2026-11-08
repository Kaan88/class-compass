/**
 * Routines history (module 'routines'): one teacher-made routine used as the default of some classes,
 * and stage changes during every lesson (not always to the last stage).
 */
import { createRoutineTemplate, setContextRoutine as setContextRoutineEp } from '../../../shared/contracts/lessons.ts';
import { createTemplate, setContextRoutine } from '../../modules/lessons/routines.ts';
import type { HistoryGenerator } from './types.ts';

const KEY = 'routines';

export const routinesGenerator: HistoryGenerator = {
  key: KEY,
  module: 'routines',
  setup(h, plan) {
    if (plan.subject !== 'english') return;
    // Each English teacher makes one routine of their own and uses it in every second class.
    const made = h.memo(`${KEY}:templates`, () => new Map<string, { id: string; uses: number }>());
    let mine = made.get(plan.teacher.id);
    if (!mine) {
      const t = h.call(createRoutineTemplate, createTemplate, plan.ctx, {
        name: { en: 'Phonics and story', tr: 'Sesletim ve hikâye' },
        contextId: null,
        stages: [
          { name: { en: 'Hello song', tr: 'Merhaba şarkısı' } },
          { name: { en: 'Phonics', tr: 'Sesletim' } },
          { name: { en: 'Story time', tr: 'Hikâye zamanı' } },
          { name: { en: 'Game', tr: 'Oyun' } },
          { name: { en: 'Goodbye', tr: 'Hoşça kal' } },
        ],
      });
      mine = { id: t.id, uses: 0 };
      made.set(plan.teacher.id, mine);
      h.count(KEY, 'routine templates');
    }
    if (mine.uses++ % 2 === 1) {
      h.call(setContextRoutineEp, (ctx, i) => setContextRoutine(ctx, i.contextId, i.templateId), plan.ctx, { contextId: plan.context.id, templateId: mine.id });
      h.count(KEY, 'class defaults set');
    }
  },
  duringLesson(h, lesson) {
    const stages = lesson.state.lesson?.routine.stages.length ?? 0;
    if (stages < 2) return;
    // Usually the lesson reaches the last stage; sometimes time runs out one or two stages early.
    const reach = h.chance(0.75) ? stages - 1 : Math.max(1, stages - 1 - h.int(1, 2));
    const ref = { contextId: lesson.plan.context.id, lessonId: lesson.lessonId };
    for (let i = 1; i <= reach; i++) {
      h.during(lesson, (i / stages) * 0.95);
      h.command(lesson.plan.ctx, 'lesson.setStage', { ...ref, stageIndex: i });
      h.count(KEY, 'stage changes');
      // Now and then the teacher taps one stage too far and goes back.
      if (i < reach && h.chance(0.04)) {
        h.command(lesson.plan.ctx, 'lesson.setStage', { ...ref, stageIndex: i + 1 });
        h.command(lesson.plan.ctx, 'lesson.setStage', { ...ref, stageIndex: i });
        h.count(KEY, 'stage corrections');
      }
    }
  },
};
