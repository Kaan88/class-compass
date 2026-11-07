/** Daily assistant (AST-1..6): weekly plan, swaps, absence carry-forward, thank-you step. */
import { z } from 'zod';
import { DEFAULT_SCHOOL_DAYS } from '../../../shared/contracts/assistant.ts';
import { defineServerModule } from '../manifest.ts';
import { assistantSection, assistantTimeline } from './report.ts';
import { assistantCommands, assistantEndStep } from './commands.ts';
import { assistantLessonState, registerAssistantRoutes } from './routes.ts';
import { onAttendanceChange } from './service.ts';

export const assistantConfigSchema = z.object({ schoolDays: z.array(z.number().int().min(0).max(6)).min(1).max(7), showPanel: z.boolean() });

export const assistantManifest = defineServerModule({
  key: 'assistant',
  policyKey: 'assistant',
  routes: registerAssistantRoutes,
  // Today's assistant rides on the polled lesson state (DSH-3); first use creates this week's plan (AST-2).
  lessonState: [assistantLessonState],
  endSteps: [assistantEndStep],
  commands: assistantCommands,
  reports: [{ key: 'assistant', order: 70, build: assistantSection }],
  timeline: [{ key: 'assistant', order: 70, build: assistantTimeline }],
  // Absence carry-forward and same-day correction (D-065, D-068).
  attendanceListeners: [onAttendanceChange],
  config: { schema: assistantConfigSchema, defaults: { schoolDays: [...DEFAULT_SCHOOL_DAYS], showPanel: true } },
});
