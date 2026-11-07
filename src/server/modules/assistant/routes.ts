import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/assistant.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import type { LessonStateContributor } from '../lessons/service.ts';
import { isModuleEnabled } from '../school/modules.ts';
import * as svc from './service.ts';

// Today's assistant rides on the polled lesson state (DSH-3); first use creates this week's plan (AST-2).
export const assistantLessonState: LessonStateContributor = {
  key: 'assistant',
  stamp: (ctx, context) => (isModuleEnabled(ctx.db, context.id, 'assistant') ? svc.assistantStamp(ctx, context) : 'off'),
  body: (ctx, context) => (isModuleEnabled(ctx.db, context.id, 'assistant') ? svc.todayDto(ctx, context) : null),
};

export function registerAssistantRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.todayAssistant, (ctx, input) => svc.todayAssistant(ctx, input.contextId));
  route(app, deps, C.assistantWeek, (ctx, input) => svc.classroomWeek(ctx, input));
  route(app, deps, C.getAssistantPlan, (ctx, input) => svc.getPlanView(ctx, input));
  route(app, deps, C.generateAssistantPlan, (ctx, input) => svc.generate(ctx, input));
  route(app, deps, C.regenerateAssistantPlan, (ctx, input) => svc.regenerate(ctx, input));
  route(app, deps, C.announceAssistantPlan, (ctx, input) => svc.announce(ctx, input));
  route(app, deps, C.swapAssistants, (ctx, input) => svc.swap(ctx, input));
  route(app, deps, C.overrideAssistant, (ctx, input) => svc.override(ctx, input));
  route(app, deps, C.getAssistantSettings, (ctx, input) => svc.getSettings(ctx, input.contextId));
  route(app, deps, C.setAssistantSettings, (ctx, input) => svc.setSettings(ctx, input));
  route(app, deps, C.assistantHistory, (ctx, input) => svc.history(ctx, input.contextId));
}
