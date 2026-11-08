/**
 * Goals, reflections and evidence (S10: GOL-1..6). Teachers set goals with students, record progress,
 * outcomes, feedback and private notes; students add goals, reflections, self-assessments and evidence
 * on their personal page (`studentPage` section 'goals').
 */
import { z } from 'zod';
import { DEFAULT_GOAL_OUTCOMES, OutcomeSet } from '../../../shared/contracts/goals.ts';
import { defineServerModule } from '../manifest.ts';
import { goalsReportSection, goalsTimeline, studentReflectionsSection } from './report.ts';
import { registerGoalRoutes } from './routes.ts';
import { goalsSection } from './student.ts';

/** Outcome labels for teacher assessments (GOL-3), per class+subject. */
/** `blockedTextNotice` (S13c, D-123): show the teacher how often students tried to save blocked words (counts only). */
export const goalsConfigSchema = z.object({ outcomes: OutcomeSet, blockedTextNotice: z.boolean() });

export const goalsManifest = defineServerModule({
  key: 'goals',
  policyKey: 'goals',
  routes: registerGoalRoutes,
  reports: [
    { key: 'goals', order: 50, build: goalsReportSection },
    { key: 'studentReflections', order: 61, build: studentReflectionsSection },
  ],
  timeline: [{ key: 'goals', order: 50, build: goalsTimeline }],
  studentPage: [{ key: 'goals', order: 10, build: goalsSection }],
  config: { schema: goalsConfigSchema, defaults: { outcomes: DEFAULT_GOAL_OUTCOMES, blockedTextNotice: false } },
});
