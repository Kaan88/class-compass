import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/grouping.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import type { LessonStateContributor } from '../lessons/service.ts';
import { isModuleEnabled } from '../school/modules.ts';
import * as svc from './service.ts';

// The groups in use ride on the polled lesson state (DSH-8): names, icons, members and roles only (GRP-7).
export const groupingLessonState: LessonStateContributor = {
  key: 'grouping',
  stamp: (ctx, context, lesson) => (isModuleEnabled(ctx.db, context.id, 'grouping') ? svc.groupingStamp(ctx.db, lesson) : 'off'),
  body: (ctx, context, lesson) => (lesson && isModuleEnabled(ctx.db, context.id, 'grouping') ? svc.groupingLessonState(ctx.db, lesson) : null),
};

export function registerGroupingRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.getGrouping, (ctx, input) => svc.overview(ctx, input.contextId, input.includeArchived === '1'));
  route(app, deps, C.createGroupTemplate, (ctx, input) => svc.createTemplate(ctx, input));
  route(app, deps, C.generateGroupTemplate, (ctx, input) => svc.generateTemplate(ctx, input));
  route(app, deps, C.updateGroupTemplate, (ctx, input) => svc.updateTemplate(ctx, input));
  route(app, deps, C.archiveGroupTemplate, (ctx, input) => svc.archiveTemplate(ctx, input));
  route(app, deps, C.createPairRule, (ctx, input) => svc.createRule(ctx, input));
  route(app, deps, C.updatePairRule, (ctx, input) => svc.updateRule(ctx, input));
  route(app, deps, C.removePairRule, (ctx, input) => svc.removeRule(ctx, input.ruleId));
  route(app, deps, C.classroomArrangements, (ctx, input) => svc.classroomArrangements(ctx, input.contextId));
}
